import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { EtholService } from '../ethol/ethol.service';
import type { AttendanceItem, CourseSchedule, HomeworkItem } from '../types';
import { PrismaService } from '../prisma/prisma.service';

interface AuthFileData {
  token?: unknown;
}

interface TokenPayload {
  nomor?: number | string;
  nipnrp?: string;
  nama?: string;
}

interface SubjectDraft {
  externalId: number;
  subjectName: string;
  dosen: string | null;
  gelarDpn: string | null;
  gelarBlk: string | null;
  nipDosen: string | null;
  nomorDosen: number | null;
  kodeKelas: string;
  pararel: string;
  kuliahAsal: number;
  jenisSchema: number;
}

interface StudentRecord {
  id: number;
}

interface PresensiNotificationPayload {
  externalId: string;
  subjectNomor: number;
  createdAt: Date;
}

const INDONESIAN_MONTHS: Record<string, number> = {
  januari: 0,
  februari: 1,
  maret: 2,
  april: 3,
  mei: 4,
  juni: 5,
  juli: 6,
  agustus: 7,
  september: 8,
  oktober: 9,
  november: 10,
  desember: 11,
};

const AUTH_PATH = path.join(process.cwd(), 'auth.json');

@Injectable()
export class SyncService implements OnModuleInit {
  private readonly logger = new Logger(SyncService.name);
  private activeSyncs = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly etholService: EtholService,
  ) {}

  onModuleInit(): void {
    const auth = this.readAuthFile();
    if (!auth) return;

    const token = auth.token;
    const payload = this.decodeToken(token);
    if (!payload) {
      this.logger.warn('Bootstrap sync skipped: invalid JWT token in auth.json');
      return;
    }

    const nimRaw = payload.nipnrp ?? payload.nomor;
    const nim = typeof nimRaw === 'string' || typeof nimRaw === 'number' ? String(nimRaw) : null;
    if (!nim) {
      this.logger.warn('Bootstrap sync skipped: could not extract nim from token payload');
      return;
    }

    void this.bootstrapSync(nim, token);
  }

  async bootstrapSync(nim: string, token: string): Promise<void> {
    if (this.activeSyncs.has(nim)) {
      this.logger.log(`Bootstrap sync already running for nim ${nim}`);
      return;
    }

    this.activeSyncs.add(nim);

    try {
      this.logger.log(`Starting bootstrap sync for nim ${nim}`);

      const payload = this.decodeToken(token);
      const externalStudentId = this.parseIntOrNull(payload?.nomor);
      const studentName = typeof payload?.nama === 'string' ? payload.nama : null;

      const [scheduleData, homeworkData, attendanceData, presensiNotificationData] = await Promise.all([
        this.etholService.fetchScheduleData(),
        this.etholService.fetchAllHomework(),
        this.etholService.fetchAllAttendance(),
        this.etholService.proxyRequest('GET', 'notifikasi/mahasiswa', { filterNotif: 'PRESENSI' }),
      ]);

      const subjects = this.buildSubjectDrafts(scheduleData, homeworkData, attendanceData);

      await this.prisma.$transaction(async (tx) => {
        const student = await tx.student.upsert({
          where: { nim },
          create: {
            nim,
            externalId: externalStudentId,
            name: studentName,
          },
          update: {
            externalId: externalStudentId,
            name: studentName,
          },
        });

        const subjectIdMap = new Map<number, number>();

        for (const subject of subjects.values()) {
          const upsertedSubject = await tx.subject.upsert({
            where: {
              studentId_externalId: {
                studentId: student.id,
                externalId: subject.externalId,
              },
            },
            create: {
              studentId: student.id,
              externalId: subject.externalId,
              kuliahAsal: subject.kuliahAsal,
              jenisSchema: subject.jenisSchema,
              subjectName: subject.subjectName,
              dosen: subject.dosen,
              gelarDpn: subject.gelarDpn,
              gelarBlk: subject.gelarBlk,
              nipDosen: subject.nipDosen,
              nomorDosen: subject.nomorDosen,
              kodeKelas: subject.kodeKelas,
              pararel: subject.pararel,
            },
            update: {
              kuliahAsal: subject.kuliahAsal,
              jenisSchema: subject.jenisSchema,
              subjectName: subject.subjectName,
              dosen: subject.dosen,
              gelarDpn: subject.gelarDpn,
              gelarBlk: subject.gelarBlk,
              nipDosen: subject.nipDosen,
              nomorDosen: subject.nomorDosen,
              kodeKelas: subject.kodeKelas,
              pararel: subject.pararel,
            },
          });

          subjectIdMap.set(subject.externalId, upsertedSubject.id);
        }

        for (const schedule of scheduleData) {
          const subjectId = subjectIdMap.get(schedule.id);
          if (!subjectId) continue;

          await tx.schedule.upsert({
            where: {
              subjectId_hari_jamAwal_jamAkhir_nomorHari: {
                subjectId,
                hari: schedule.hari,
                jamAwal: schedule.jamAwal,
                jamAkhir: schedule.jamAkhir,
                nomorHari: schedule.nomorHari,
              },
            },
            create: {
              externalId: schedule.id,
              subjectId,
              hari: schedule.hari,
              jamAwal: schedule.jamAwal,
              jamAkhir: schedule.jamAkhir,
              nomorHari: schedule.nomorHari,
              ruang: schedule.ruang,
              nomorRuang: null,
            },
            update: {
              externalId: schedule.id,
              ruang: schedule.ruang,
              nomorRuang: null,
            },
          });
        }

        await this.syncHomeworkSnapshot(tx, subjectIdMap, homeworkData);
        await this.syncAttendanceSnapshot(tx, subjectIdMap, attendanceData);
        await this.syncPresensiSessionsFromNotifications(
          tx,
          student,
          this.extractNotificationItems(presensiNotificationData),
        );
      });

      this.logger.log(`Bootstrap sync completed for nim ${nim}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown sync error';
      this.logger.error(`Bootstrap sync failed for nim ${nim}: ${message}`);
    } finally {
      this.activeSyncs.delete(nim);
    }
  }

  async incrementalSync(nim: string, type: string, notificationData: unknown): Promise<void> {
    if (this.activeSyncs.has(nim)) {
      this.logger.debug(`Incremental sync dropped for nim ${nim}: sync already running`);
      return;
    }

    this.activeSyncs.add(nim);

    try {
      if (type === 'tugas') {
        await this.incrementalSyncHomework(nim, this.extractDataTerkait(notificationData));
        return;
      }

      if (type === 'presensi') {
        await this.incrementalSyncAttendance(nim, notificationData);
        return;
      }

      this.logger.debug(`Incremental sync type not implemented yet: ${type}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown incremental sync error';
      this.logger.error(`Incremental sync failed for nim ${nim}: ${message}`);
    } finally {
      this.activeSyncs.delete(nim);
    }
  }

  private async incrementalSyncHomework(nim: string, dataTerkait: unknown): Promise<void> {
    const nomorTugas = this.extractDataTerkaitNumber(dataTerkait);
    if (nomorTugas === null) {
      this.logger.debug(`Incremental tugas sync skipped for nim ${nim}: invalid dataTerkait`);
      return;
    }

    const student = await this.prisma.student.findUnique({ where: { nim } });
    if (!student) {
      this.logger.debug(`Incremental tugas sync skipped for nim ${nim}: student not found`);
      return;
    }

    const payload = await this.etholService.proxyRequest('GET', 'tugas/by-nomor', {
      nomorTugas: String(nomorTugas),
    });
    const record = this.pickPrimaryRecord(payload);
    const homework = this.toHomeworkItem(record, nomorTugas);
    if (!homework) {
      this.logger.debug(`Incremental tugas sync skipped for nim ${nim}: unable to parse homework payload`);
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      const subject = await this.findOrCreateSubject(tx, student, {
        externalId: homework.subjectNomor,
        subjectName: homework.subjectName,
        dosen: null,
        gelarDpn: null,
        gelarBlk: null,
        nipDosen: null,
        nomorDosen: null,
        kodeKelas: '-',
        pararel: '-',
        kuliahAsal: homework.subjectNomor,
        jenisSchema: 0,
      });

      await tx.homework.upsert({
        where: {
          subjectId_externalId: {
            subjectId: subject.id,
            externalId: homework.id,
          },
        },
        create: {
          externalId: homework.id,
          subjectId: subject.id,
          title: homework.title,
          description: homework.description,
          deadline: this.parseDateOrNow(homework.deadline),
          deadlineIndonesia: homework.deadlineIndonesia,
          submissionTime: this.parseDateOrNull(homework.submissionTime),
          submissionTimeIndonesia: homework.submissionTimeIndonesia,
          tahun: homework.tahun,
          semester: homework.semester,
          fileCount: homework.fileCount,
          status: this.mapHomeworkStatus(homework.status),
        },
        update: {
          title: homework.title,
          description: homework.description,
          deadline: this.parseDateOrNow(homework.deadline),
          deadlineIndonesia: homework.deadlineIndonesia,
          submissionTime: this.parseDateOrNull(homework.submissionTime),
          submissionTimeIndonesia: homework.submissionTimeIndonesia,
          tahun: homework.tahun,
          semester: homework.semester,
          fileCount: homework.fileCount,
          status: this.mapHomeworkStatus(homework.status),
          deletedAt: null,
        },
      });
    });
  }

  private async incrementalSyncAttendance(nim: string, notificationData: unknown): Promise<void> {
    const student = await this.prisma.student.findUnique({ where: { nim } });
    if (!student) {
      this.logger.debug(`Incremental presensi sync skipped for nim ${nim}: student not found`);
      return;
    }

    const notification = this.parsePresensiNotificationPayload(notificationData);
    if (!notification) {
      this.logger.debug(`Incremental presensi sync skipped for nim ${nim}: invalid notification payload`);
      return;
    }

    const attendanceData = await this.etholService.fetchAllAttendance();

    await this.prisma.$transaction(async (tx) => {
      await this.upsertPresensiSession(tx, student, notification);

      const subjectIdMap = await this.ensureSubjectsForRecords(
        tx,
        student,
        this.buildSubjectDrafts([], [], attendanceData),
      );

      await this.syncAttendanceSnapshot(tx, subjectIdMap, attendanceData);
    });
  }

  private readAuthFile(): { token: string } | null {
    if (!fs.existsSync(AUTH_PATH)) return null;

    try {
      const raw = fs.readFileSync(AUTH_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as AuthFileData;
      if (typeof parsed.token !== 'string' || parsed.token.trim() === '') {
        return null;
      }

      return { token: parsed.token };
    } catch {
      return null;
    }
  }

  private decodeToken(token: string): TokenPayload | null {
    try {
      const payload = token.split('.')[1];
      if (!payload) return null;

      const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);

      const decoded = Buffer.from(padded, 'base64').toString('utf-8');
      return JSON.parse(decoded) as TokenPayload;
    } catch {
      return null;
    }
  }

  private extractDataTerkaitNumber(dataTerkait: unknown): number | null {
    if (typeof dataTerkait === 'number') {
      return Number.isFinite(dataTerkait) ? dataTerkait : null;
    }

    if (typeof dataTerkait === 'string') {
      const parsed = Number.parseInt(dataTerkait, 10);
      return Number.isNaN(parsed) ? null : parsed;
    }

    if (typeof dataTerkait !== 'object' || dataTerkait === null) {
      return null;
    }

    const record = dataTerkait as Record<string, unknown>;
    const candidates = [record.dataTerkait, record.nomorTugas, record.idTugas, record.nomor, record.id];
    for (const candidate of candidates) {
      const parsed = this.extractDataTerkaitNumber(candidate);
      if (parsed !== null) return parsed;
    }

    return null;
  }

  private pickPrimaryRecord(payload: unknown): Record<string, unknown> | null {
    if (Array.isArray(payload)) {
      const first = payload.find((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
      return first ?? null;
    }

    if (typeof payload !== 'object' || payload === null) {
      return null;
    }

    const record = payload as Record<string, unknown>;
    if ('data' in record) {
      return this.pickPrimaryRecord(record.data);
    }

    return record;
  }

  private toHomeworkItem(record: Record<string, unknown> | null, fallbackId: number): HomeworkItem | null {
    if (!record) return null;

    const id = this.parseUnknownInt(record.id) ?? fallbackId;
    const subjectNomor =
      this.parseUnknownInt(record.subjectNomor) ??
      this.parseUnknownInt(record.nomor) ??
      this.parseUnknownInt(record.kuliah);
    const title = typeof record.title === 'string' ? record.title : null;
    const description = typeof record.description === 'string' ? record.description : '';
    const deadline = typeof record.deadline === 'string' ? record.deadline : null;
    const deadlineIndonesia =
      typeof record.deadlineIndonesia === 'string'
        ? record.deadlineIndonesia
        : typeof record.deadline_indonesia === 'string'
          ? record.deadline_indonesia
          : '';
    const submissionTime =
      typeof record.submissionTime === 'string'
        ? record.submissionTime
        : typeof record.submission_time === 'string'
          ? record.submission_time
          : null;
    const submissionTimeIndonesia =
      typeof record.submissionTimeIndonesia === 'string'
        ? record.submissionTimeIndonesia
        : typeof record.submission_time_indonesia === 'string'
          ? record.submission_time_indonesia
          : null;
    const subjectName =
      typeof record.subjectName === 'string'
        ? record.subjectName
        : typeof record.namaMatakuliah === 'string'
          ? record.namaMatakuliah
          : 'Unknown Subject';
    const tahun = this.parseUnknownInt(record.tahun) ?? 0;
    const semester = this.parseUnknownInt(record.semester) ?? 0;
    const fileCount = Array.isArray(record.file)
      ? record.file.length
      : this.parseUnknownInt(record.fileCount) ?? this.parseUnknownInt(record.file_count) ?? 0;

    if (!subjectNomor || !title || !deadline) {
      return null;
    }

    return {
      id,
      title,
      description,
      deadline,
      deadlineIndonesia,
      submissionTime,
      submissionTimeIndonesia,
      status: this.mapHomeworkStatusFromUnknown(record.status ?? record.status_pengumpulan),
      subjectName,
      subjectNomor,
      tahun,
      semester,
      fileCount,
    };
  }

  private async ensureSubjectsForRecords(
    tx: Prisma.TransactionClient,
    student: StudentRecord,
    subjects: Map<number, SubjectDraft>,
  ): Promise<Map<number, number>> {
    const subjectIdMap = new Map<number, number>();

    for (const subject of subjects.values()) {
      const upsertedSubject = await tx.subject.upsert({
        where: {
          studentId_externalId: {
            studentId: student.id,
            externalId: subject.externalId,
          },
        },
        create: {
          studentId: student.id,
          externalId: subject.externalId,
          kuliahAsal: subject.kuliahAsal,
          jenisSchema: subject.jenisSchema,
          subjectName: subject.subjectName,
          dosen: subject.dosen,
          gelarDpn: subject.gelarDpn,
          gelarBlk: subject.gelarBlk,
          nipDosen: subject.nipDosen,
          nomorDosen: subject.nomorDosen,
          kodeKelas: subject.kodeKelas,
          pararel: subject.pararel,
        },
        update: {
          kuliahAsal: subject.kuliahAsal,
          jenisSchema: subject.jenisSchema,
          subjectName: subject.subjectName,
          dosen: subject.dosen,
          gelarDpn: subject.gelarDpn,
          gelarBlk: subject.gelarBlk,
          nipDosen: subject.nipDosen,
          nomorDosen: subject.nomorDosen,
          kodeKelas: subject.kodeKelas,
          pararel: subject.pararel,
        },
      });

      subjectIdMap.set(subject.externalId, upsertedSubject.id);
    }

    return subjectIdMap;
  }

  private async findOrCreateSubject(
    tx: Prisma.TransactionClient,
    student: StudentRecord,
    subject: SubjectDraft,
  ) {
    return tx.subject.upsert({
      where: {
        studentId_externalId: {
          studentId: student.id,
          externalId: subject.externalId,
        },
      },
      create: {
        studentId: student.id,
        externalId: subject.externalId,
        kuliahAsal: subject.kuliahAsal,
        jenisSchema: subject.jenisSchema,
        subjectName: subject.subjectName,
        dosen: subject.dosen,
        gelarDpn: subject.gelarDpn,
        gelarBlk: subject.gelarBlk,
        nipDosen: subject.nipDosen,
        nomorDosen: subject.nomorDosen,
        kodeKelas: subject.kodeKelas,
        pararel: subject.pararel,
      },
      update: {
        subjectName: subject.subjectName,
      },
    });
  }

  private async syncHomeworkSnapshot(
    tx: Prisma.TransactionClient,
    subjectIdMap: Map<number, number>,
    homeworkData: HomeworkItem[],
  ): Promise<void> {
    const activeHomeworkIds = new Map<number, number[]>();

    for (const homework of homeworkData) {
      const subjectId = subjectIdMap.get(homework.subjectNomor);
      if (!subjectId) continue;

      const subjectHomeworkIds = activeHomeworkIds.get(subjectId) ?? [];
      subjectHomeworkIds.push(homework.id);
      activeHomeworkIds.set(subjectId, subjectHomeworkIds);

      await tx.homework.upsert({
        where: {
          subjectId_externalId: {
            subjectId,
            externalId: homework.id,
          },
        },
        create: {
          externalId: homework.id,
          subjectId,
          title: homework.title,
          description: homework.description,
          deadline: this.parseDateOrNow(homework.deadline),
          deadlineIndonesia: homework.deadlineIndonesia,
          submissionTime: this.parseDateOrNull(homework.submissionTime),
          submissionTimeIndonesia: homework.submissionTimeIndonesia,
          tahun: homework.tahun,
          semester: homework.semester,
          fileCount: homework.fileCount,
          status: this.mapHomeworkStatus(homework.status),
        },
        update: {
          title: homework.title,
          description: homework.description,
          deadline: this.parseDateOrNow(homework.deadline),
          deadlineIndonesia: homework.deadlineIndonesia,
          submissionTime: this.parseDateOrNull(homework.submissionTime),
          submissionTimeIndonesia: homework.submissionTimeIndonesia,
          tahun: homework.tahun,
          semester: homework.semester,
          fileCount: homework.fileCount,
          status: this.mapHomeworkStatus(homework.status),
          deletedAt: null,
        },
      });
    }

    for (const subjectId of subjectIdMap.values()) {
      const externalIds = activeHomeworkIds.get(subjectId) ?? [];

      if (externalIds.length === 0) {
        await tx.homework.updateMany({
          where: { subjectId, deletedAt: null },
          data: { deletedAt: new Date() },
        });
        continue;
      }

      await tx.homework.updateMany({
        where: {
          subjectId,
          deletedAt: null,
          externalId: { notIn: externalIds },
        },
        data: { deletedAt: new Date() },
      });
    }
  }

  private async syncAttendanceSnapshot(
    tx: Prisma.TransactionClient,
    subjectIdMap: Map<number, number>,
    attendanceData: AttendanceItem[],
  ): Promise<void> {
    const activeAttendanceIds = new Map<number, number[]>();

    for (const attendance of attendanceData) {
      const subjectId = subjectIdMap.get(attendance.subjectNomor);
      if (!subjectId) continue;

      const idsForSubject = activeAttendanceIds.get(subjectId) ?? [];

      for (const history of attendance.history) {
        const externalId = this.getAttendanceExternalId(attendance.subjectNomor, history.key, history.date);
        idsForSubject.push(externalId);

        await tx.attendance.upsert({
          where: {
            subjectId_externalId: {
              subjectId,
              externalId,
            },
          },
          create: {
            externalId,
            subjectId,
            tahun: attendance.tahun,
            semester: attendance.semester,
            date: this.parseEtholDateOrNow(history.date),
            dateDisplay: history.date,
            key: history.key,
            totalSessions: attendance.totalSessions,
            attendedSessions: attendance.attendedSessions,
            attendanceRate: attendance.attendanceRate,
          },
          update: {
            tahun: attendance.tahun,
            semester: attendance.semester,
            date: this.parseEtholDateOrNow(history.date),
            dateDisplay: history.date,
            key: history.key,
            totalSessions: attendance.totalSessions,
            attendedSessions: attendance.attendedSessions,
            attendanceRate: attendance.attendanceRate,
            deletedAt: null,
          },
        });
      }

      activeAttendanceIds.set(subjectId, idsForSubject);
    }

    for (const subjectId of subjectIdMap.values()) {
      const externalIds = activeAttendanceIds.get(subjectId) ?? [];

      if (externalIds.length === 0) {
        await tx.attendance.updateMany({
          where: { subjectId, deletedAt: null },
          data: { deletedAt: new Date() },
        });
        continue;
      }

      await tx.attendance.updateMany({
        where: {
          subjectId,
          deletedAt: null,
          externalId: { notIn: externalIds },
        },
        data: { deletedAt: new Date() },
      });
    }
  }

  private mapHomeworkStatusFromUnknown(value: unknown): HomeworkItem['status'] {
    if (value === 'on_time' || value === 1 || value === '1') return 'on_time';
    if (value === 'late' || value === 2 || value === '2') return 'late';
    return 'not_submitted';
  }

  private buildSubjectDrafts(
    schedules: CourseSchedule[],
    homeworks: HomeworkItem[],
    attendances: AttendanceItem[],
  ): Map<number, SubjectDraft> {
    const subjects = new Map<number, SubjectDraft>();

    for (const schedule of schedules) {
      subjects.set(schedule.id, {
        externalId: schedule.id,
        subjectName: schedule.subjectName,
        dosen: schedule.dosen,
        gelarDpn: null,
        gelarBlk: null,
        nipDosen: null,
        nomorDosen: null,
        kodeKelas: schedule.kodeKelas,
        pararel: schedule.pararel,
        kuliahAsal: schedule.id,
        jenisSchema: 0,
      });
    }

    for (const homework of homeworks) {
      const existing = subjects.get(homework.subjectNomor);
      if (existing) {
        if (!existing.subjectName) existing.subjectName = homework.subjectName;
        continue;
      }

      subjects.set(homework.subjectNomor, {
        externalId: homework.subjectNomor,
        subjectName: homework.subjectName,
        dosen: null,
        gelarDpn: null,
        gelarBlk: null,
        nipDosen: null,
        nomorDosen: null,
        kodeKelas: '-',
        pararel: '-',
        kuliahAsal: homework.subjectNomor,
        jenisSchema: 0,
      });
    }

    for (const attendance of attendances) {
      const existing = subjects.get(attendance.subjectNomor);
      if (existing) {
        if (!existing.subjectName) existing.subjectName = attendance.subjectName;
        continue;
      }

      subjects.set(attendance.subjectNomor, {
        externalId: attendance.subjectNomor,
        subjectName: attendance.subjectName,
        dosen: null,
        gelarDpn: null,
        gelarBlk: null,
        nipDosen: null,
        nomorDosen: null,
        kodeKelas: '-',
        pararel: '-',
        kuliahAsal: attendance.subjectNomor,
        jenisSchema: 0,
      });
    }

    return subjects;
  }

  private mapHomeworkStatus(status: HomeworkItem['status']): 'not_submitted' | 'on_time' | 'late' {
    if (status === 'on_time') return 'on_time';
    if (status === 'late') return 'late';
    return 'not_submitted';
  }

  private parseDateOrNull(value: string | null): Date | null {
    if (!value) return null;

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private parseDateOrNow(value: string): Date {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
    return new Date();
  }

  private parseEtholDateOrNow(value: string): Date {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;

    const match = value.match(/^\s*[^,]+,\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s+-\s+(\d{2}):(\d{2})(?::(\d{2}))?\s*$/);
    if (!match) {
      return new Date();
    }

    const [, day, monthNameRaw, year, hour, minute, second = '00'] = match;
    const month = INDONESIAN_MONTHS[monthNameRaw.toLowerCase()];
    if (month === undefined) {
      return new Date();
    }

    return new Date(
      Number.parseInt(year, 10),
      month,
      Number.parseInt(day, 10),
      Number.parseInt(hour, 10),
      Number.parseInt(minute, 10),
      Number.parseInt(second, 10),
    );
  }

  private parseIntOrNull(value: number | string | undefined): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
      const parsed = Number.parseInt(value, 10);
      return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
  }

  private parseUnknownInt(value: unknown): number | null {
    if (typeof value === 'number' || typeof value === 'string') {
      return this.parseIntOrNull(value);
    }

    return null;
  }

  private extractDataTerkait(notificationData: unknown): unknown {
    if (typeof notificationData !== 'object' || notificationData === null) {
      return notificationData;
    }

    const record = notificationData as Record<string, unknown>;
    return (
      record.dataTerkait ??
      record.nomorTugas ??
      record.idTugas ??
      record.nomor ??
      record.id ??
      notificationData
    );
  }

  private extractNotificationItems(payload: unknown): Record<string, unknown>[] {
    if (Array.isArray(payload)) {
      return payload.filter(
        (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
      );
    }

    if (typeof payload !== 'object' || payload === null) {
      return [];
    }

    const record = payload as Record<string, unknown>;
    if ('idNotifikasi' in record) {
      return [record];
    }

    for (const value of Object.values(record)) {
      if (Array.isArray(value)) {
        return value.filter(
          (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
        );
      }
    }

    return [];
  }

  private extractSubjectNomorFromDataTerkait(value: unknown): number | null {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }

    if (typeof value === 'string') {
      const firstSegment = value.split('-')[0]?.trim();
      if (!firstSegment) return null;

      const parsed = Number.parseInt(firstSegment, 10);
      return Number.isNaN(parsed) ? null : parsed;
    }

    if (typeof value !== 'object' || value === null) {
      return null;
    }

    const record = value as Record<string, unknown>;
    return this.extractSubjectNomorFromDataTerkait(
      record.dataTerkait ?? record.subjectNomor ?? record.nomorKuliah ?? record.nomor,
    );
  }

  private parseNotificationCreatedAt(record: Record<string, unknown>): Date {
    const candidates = [
      record.createdAt,
      record.created_at,
      record.waktu,
      record.waktuNotifikasi,
      record.waktu_notifikasi,
    ];

    for (const candidate of candidates) {
      if (typeof candidate !== 'string') continue;

      const isoDate = this.parseDateOrNull(candidate);
      if (isoDate) return isoDate;

      const parsedIndonesian = this.parseEtholDateOrNow(candidate);
      if (!Number.isNaN(parsedIndonesian.getTime())) {
        return parsedIndonesian;
      }
    }

    return new Date();
  }

  private parsePresensiNotificationPayload(notificationData: unknown): PresensiNotificationPayload | null {
    if (typeof notificationData !== 'object' || notificationData === null) {
      return null;
    }

    const record = notificationData as Record<string, unknown>;
    const idNotifikasi = record.idNotifikasi;
    if (typeof idNotifikasi !== 'string' && typeof idNotifikasi !== 'number') {
      return null;
    }

    const externalId = String(idNotifikasi).trim();
    if (!externalId) {
      return null;
    }

    const subjectNomor = this.extractSubjectNomorFromDataTerkait(record.dataTerkait);
    if (subjectNomor === null) {
      return null;
    }

    return {
      externalId,
      subjectNomor,
      createdAt: this.parseNotificationCreatedAt(record),
    };
  }

  private async syncPresensiSessionsFromNotifications(
    tx: Prisma.TransactionClient,
    student: StudentRecord,
    notifications: Record<string, unknown>[],
  ): Promise<void> {
    for (const record of notifications) {
      const payload = this.parsePresensiNotificationPayload(record);
      if (!payload) {
        continue;
      }

      await this.upsertPresensiSession(tx, student, payload);
    }
  }

  private async upsertPresensiSession(
    tx: Prisma.TransactionClient,
    student: StudentRecord,
    payload: PresensiNotificationPayload,
  ): Promise<void> {
    const subject = await this.findOrCreateSubject(tx, student, {
      externalId: payload.subjectNomor,
      subjectName: 'Unknown Subject',
      dosen: null,
      gelarDpn: null,
      gelarBlk: null,
      nipDosen: null,
      nomorDosen: null,
      kodeKelas: '-',
      pararel: '-',
      kuliahAsal: payload.subjectNomor,
      jenisSchema: 0,
    });

    const presensiSessionDelegate = (
      tx as unknown as {
        presensiSession?: {
          upsert: (args: {
            where: { externalId: string };
            create: { externalId: string; subjectId: number; createdAt: Date };
            update: { subjectId: number; createdAt: Date };
          }) => Promise<unknown>;
        };
      }
    ).presensiSession;

    if (presensiSessionDelegate) {
      await presensiSessionDelegate.upsert({
        where: { externalId: payload.externalId },
        create: {
          externalId: payload.externalId,
          subjectId: subject.id,
          createdAt: payload.createdAt,
        },
        update: {
          subjectId: subject.id,
          createdAt: payload.createdAt,
        },
      });
      return;
    }

    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "presensi_sessions" ("external_id", "subject_id", "created_at")
      VALUES (${payload.externalId}, ${subject.id}, ${payload.createdAt})
      ON CONFLICT ("external_id") DO UPDATE
      SET "subject_id" = EXCLUDED."subject_id",
          "created_at" = EXCLUDED."created_at"
    `);
  }

  private getAttendanceExternalId(subjectNomor: number, key: string, date: string): number {
    const fromKey = Number.parseInt(key, 10);
    if (!Number.isNaN(fromKey) && fromKey > 0) return fromKey;

    const source = `${subjectNomor}|${key}|${date}`;
    let hash = 0;
    for (let i = 0; i < source.length; i += 1) {
      hash = (hash * 31 + source.charCodeAt(i)) | 0;
    }

    return Math.abs(hash) + 1;
  }
}

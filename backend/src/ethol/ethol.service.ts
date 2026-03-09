import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import type { Prisma } from '@prisma/client';
import type { Subject, ScheduleEntry, CourseSchedule, TugasRaw, HomeworkItem, PresensiRaw, AttendanceItem } from '../types';
import { PrismaService } from '../prisma/prisma.service';

const AUTH_FILE = process.env.AUTH_FILE_PATH || path.join(process.cwd(), 'auth.json');
const BASE_URL = 'https://ethol.pens.ac.id';
const MIS_BASE_URL = 'https://mis.pens.ac.id';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MAX_REDIRECTS = 15;

type ScheduleWithSubject = Prisma.ScheduleGetPayload<{ include: { subject: true } }>;
type HomeworkWithSubject = Prisma.HomeworkGetPayload<{ include: { subject: true } }>;
type AttendanceWithSubject = Prisma.AttendanceGetPayload<{ include: { subject: true } }>;
type PresensiSessionSubject = Prisma.SubjectGetPayload<Record<string, never>>;

// ── Auth persistence ──────────────────────────────────────────────

interface AuthData {
  token: string;
  cookies: string;
}

// ── Redirect-aware fetch types ────────────────────────────────────

interface FollowResult {
  response: Response;
  cookies: string[];
  finalUrl: string;
}

@Injectable()
export class EtholService {
  private readonly logger = new Logger(EtholService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Auth persistence ──────────────────────────────────────────

  private saveAuth(auth: AuthData): void {
    fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2));
  }

  private loadAuth(): AuthData | null {
    if (!fs.existsSync(AUTH_FILE)) return null;
    try {
      return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
    } catch {
      return null;
    }
  }

  clearAuth(): void {
    if (fs.existsSync(AUTH_FILE)) fs.unlinkSync(AUTH_FILE);
  }

  // ── Cookie helpers ────────────────────────────────────────────

  private extractSetCookies(response: Response): string[] {
    const results: string[] = [];
    if (typeof response.headers.getSetCookie === 'function') {
      for (const raw of response.headers.getSetCookie()) {
        const nameValue = raw.split(';')[0].trim();
        if (nameValue) results.push(nameValue);
      }
    }
    return results;
  }

  private mergeCookies(existing: string[], incoming: string[]): string[] {
    const map = new Map<string, string>();
    for (const c of [...existing, ...incoming]) {
      const name = c.split('=')[0];
      map.set(name, c);
    }
    return Array.from(map.values());
  }

  // ── Redirect-aware fetch ──────────────────────────────────────

  private async fetchWithRedirects(
    url: string,
    cookies: string[],
    init?: { method?: string; contentType?: string; body?: string },
  ): Promise<FollowResult> {
    let currentUrl = url;
    let currentCookies = [...cookies];
    let method = init?.method ?? 'GET';
    let body: string | undefined = init?.body;
    let contentType: string | undefined = init?.contentType;

    for (let i = 0; i < MAX_REDIRECTS; i++) {
      const headers: Record<string, string> = {
        'User-Agent': USER_AGENT,
        Cookie: currentCookies.join('; '),
      };
      if (contentType && method === 'POST') {
        headers['Content-Type'] = contentType;
      }

      const res = await fetch(currentUrl, {
        method,
        headers,
        body: method === 'POST' ? body : undefined,
        redirect: 'manual',
        cache: 'no-store',
      });

      currentCookies = this.mergeCookies(
        currentCookies,
        this.extractSetCookies(res),
      );

      const status = res.status;
      if (status >= 300 && status < 400) {
        const location = res.headers.get('location');
        if (!location) {
          return {
            response: res,
            cookies: currentCookies,
            finalUrl: currentUrl,
          };
        }
        currentUrl = new URL(location, currentUrl).href;
        // POST → redirect → GET (302/303). Preserve method only for 307/308.
        if (status !== 307 && status !== 308) {
          method = 'GET';
          body = undefined;
          contentType = undefined;
        }
        continue;
      }

      return {
        response: res,
        cookies: currentCookies,
        finalUrl: currentUrl,
      };
    }

    throw new Error('Too many redirects');
  }

  // ── Public API ────────────────────────────────────────────────

  isLoggedIn(): boolean {
    return this.loadAuth() !== null;
  }

  getCurrentAcademicPeriod(): { tahun: number; semester: number } {
    return this.getActiveAcademicPeriod();
  }

  async login(email: string, password: string): Promise<void> {
    // 1. GET /cas → redirects through CAS → lands on CAS login page
    const {
      response: casPageRes,
      cookies: casCookies,
      finalUrl: casLoginUrl,
    } = await this.fetchWithRedirects(`${BASE_URL}/cas`, []);

    if (!casPageRes.ok) {
      throw new Error(
        `Failed to reach CAS login page (status ${casPageRes.status})`,
      );
    }

    const casHtml = await casPageRes.text();

    // 2. Parse hidden form fields from the CAS login form
    const ltMatch = casHtml.match(/name="lt"\s+value="([^"]+)"/);
    const executionMatch = casHtml.match(
      /name="execution"\s+value="([^"]+)"/,
    );

    const params = new URLSearchParams();
    params.append('username', email);
    params.append('password', password);
    if (ltMatch) params.append('lt', ltMatch[1]);
    if (executionMatch) params.append('execution', executionMatch[1]);
    params.append('_eventId', 'submit');

    // 3. POST credentials → follow redirects back to ETHOL
    const {
      response: postRes,
      cookies: postCookies,
      finalUrl,
    } = await this.fetchWithRedirects(casLoginUrl, casCookies, {
      method: 'POST',
      contentType: 'application/x-www-form-urlencoded',
      body: params.toString(),
    });

    const html = await postRes.text();

    // Still on CAS login page → bad credentials
    if (
      finalUrl.includes('login.pens.ac.id') ||
      html.includes('class="errors"') ||
      html.includes('Invalid credentials')
    ) {
      throw new Error(
        'Invalid credentials. Please check your username and password.',
      );
    }

    // 4. Extract JWT token
    //    ETHOL sets it via: localStorage.setItem('token', 'eyJ...')
    let token = '';

    const localStorageMatch = html.match(
      /localStorage\.setItem\(['"]token['"]\s*,\s*['"]([A-Za-z0-9._-]+)['"]\)/,
    );
    if (localStorageMatch) {
      token = localStorageMatch[1];
    }

    if (!token) {
      throw new Error(
        'Login succeeded but could not extract auth token from ETHOL response.',
      );
    }

    const cookieString = postCookies.join('; ');

    // 5. Verify API access before persisting
    const activePeriod = this.getActiveAcademicPeriod();
    const verifyRes = await fetch(
      `${BASE_URL}/api/kuliah?tahun=${activePeriod.tahun}&semester=${activePeriod.semester}`,
      {
        headers: { 'User-Agent': USER_AGENT, token },
        redirect: 'manual',
        cache: 'no-store',
      },
    );

    const verifyText = await verifyRes.text();

    try {
      const verifyJson = JSON.parse(verifyText);
      if (verifyJson.sukses === false) {
        throw new Error(
          `ETHOL API rejected auth: ${verifyJson.pesan || 'unknown error'}`,
        );
      }
      if (!Array.isArray(verifyJson)) {
        throw new Error('ETHOL API did not return expected data.');
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('ETHOL API')) throw e;
      throw new Error(
        'ETHOL API returned non-JSON response — auth may not be valid.',
      );
    }

    this.saveAuth({ token, cookies: cookieString });
    this.logger.log('Login successful, auth saved.');
  }

  async fetchScheduleData(): Promise<CourseSchedule[]> {
    const auth = this.loadAuth();
    if (!auth) {
      throw new Error('Not logged in. Please login first.');
    }

    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      token: auth.token,
    };
    const activePeriod = this.getActiveAcademicPeriod();

    // Step 1: Fetch subjects
    const subjectsRes = await fetch(
      `${BASE_URL}/api/kuliah?tahun=${activePeriod.tahun}&semester=${activePeriod.semester}`,
      { headers, redirect: 'manual', cache: 'no-store' },
    );

    if (!subjectsRes.ok) {
      this.clearAuth();
      throw new Error(
        'Could not fetch subjects. Session may have expired — please login again.',
      );
    }

    const subjects: Subject[] = await subjectsRes.json();

    if (!Array.isArray(subjects) || subjects.length === 0) {
      throw new Error(
        'Could not fetch subjects. Session may have expired — please login again.',
      );
    }

    // Step 2: POST kuliah IDs to get schedule entries
    //   ETHOL expects: {kuliahs: [{nomor, jenisSchema}, ...], tahun, semester}
    const kuliahs = subjects.map((s) => ({
      nomor: s.nomor,
      jenisSchema: s.jenisSchema,
    }));

    const schedulesRes = await fetch(
      `${BASE_URL}/api/kuliah/hari-kuliah-in`,
      {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ kuliahs, tahun: activePeriod.tahun, semester: activePeriod.semester }),
        redirect: 'manual',
        cache: 'no-store',
      },
    );

    if (!schedulesRes.ok) {
      throw new Error(
        'Could not fetch schedule entries. Please try again.',
      );
    }

    const schedules: ScheduleEntry[] = await schedulesRes.json();

    // Step 3: Build lookup map and combine
    const subjectMap = new Map<number, Subject>();
    for (const subject of subjects) {
      subjectMap.set(subject.nomor, subject);
    }

    const courseSchedules: CourseSchedule[] = schedules
      .map((entry) => {
        const subject = subjectMap.get(entry.kuliah);
        if (!subject) return null;

        const dosenParts: string[] = [];
        if (subject.gelar_dpn) dosenParts.push(subject.gelar_dpn);
        if (subject.dosen) dosenParts.push(subject.dosen);
        if (subject.gelar_blk) dosenParts.push(subject.gelar_blk);
        const dosenTitle = dosenParts.join(' ').trim();

        return {
          id: entry.kuliah,
          subjectName: subject.matakuliah.nama,
          dosen: subject.dosen,
          dosenTitle: dosenTitle || '-',
          kodeKelas: subject.kode_kelas,
          pararel: subject.pararel,
          hari: entry.hari,
          jamAwal: entry.jam_awal,
          jamAkhir: entry.jam_akhir,
          nomorHari: entry.nomor_hari,
          ruang: entry.ruang,
        };
      })
      .filter((item): item is CourseSchedule => item !== null);

    return courseSchedules;
  }

  // ── Homework API ─────────────────────────────────────────────

  private async fetchSubjectsForSemester(
    tahun: number,
    semester: number,
    headers: Record<string, string>,
  ): Promise<Subject[]> {
    try {
      const res = await fetch(
        `${BASE_URL}/api/kuliah?tahun=${tahun}&semester=${semester}`,
        { headers, redirect: 'manual', cache: 'no-store' },
      );
      if (!res.ok) return [];
      const data = await res.json();
      if (!Array.isArray(data)) return [];
      return data;
    } catch {
      return [];
    }
  }

  private async fetchTugasForSubject(
    kuliah: number,
    jenisSchema: number,
    headers: Record<string, string>,
  ): Promise<TugasRaw[]> {
    try {
      const res = await fetch(
        `${BASE_URL}/api/tugas?kuliah=${kuliah}&jenisSchema=${jenisSchema}`,
        { headers, redirect: 'manual', cache: 'no-store' },
      );
      if (!res.ok) return [];
      const data = await res.json();
      if (!Array.isArray(data)) return [];
      return data;
    } catch {
      return [];
    }
  }

  async fetchAllHomework(): Promise<HomeworkItem[]> {
    const auth = this.loadAuth();
    if (!auth) {
      throw new Error('Not logged in. Please login first.');
    }

    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      token: auth.token,
    };

    // Fetch subjects across multiple academic years/semesters
    const currentYear = new Date().getFullYear();
    const semesters: { tahun: number; semester: number }[] = [];
    for (let y = currentYear - 2; y <= currentYear; y++) {
      semesters.push({ tahun: y, semester: 1 });
      semesters.push({ tahun: y, semester: 2 });
    }

    // Fetch all subjects in parallel
    const subjectResults = await Promise.all(
      semesters.map((s) =>
        this.fetchSubjectsForSemester(s.tahun, s.semester, headers).then(
          (subjects) => ({ ...s, subjects }),
        ),
      ),
    );

    // Fetch tugas for each subject in parallel
    const homeworkPromises: Promise<HomeworkItem[]>[] = [];

    for (const { tahun, semester, subjects } of subjectResults) {
      for (const subject of subjects) {
        homeworkPromises.push(
          this.fetchTugasForSubject(
            subject.nomor,
            subject.jenisSchema,
            headers,
          ).then((tugasList) =>
            tugasList.map((tugas): HomeworkItem => {
              let status: HomeworkItem['status'] = 'not_submitted';
              if (tugas.submission_time) {
                const deadline = new Date(tugas.deadline).getTime();
                const submitted = new Date(tugas.submission_time).getTime();
                status = submitted > deadline ? 'late' : 'on_time';
              }
              return {
                id: tugas.id,
                title: tugas.title,
                description: tugas.description,
                deadline: tugas.deadline,
                deadlineIndonesia: tugas.deadline_indonesia,
                submissionTime: tugas.submission_time,
                submissionTimeIndonesia: tugas.submission_time_indonesia,
                status,
                subjectName: subject.matakuliah.nama,
                subjectNomor: subject.nomor,
                tahun,
                semester,
                fileCount: tugas.file?.length ?? 0,
              };
            }),
          ),
        );
      }
    }

    const results = await Promise.all(homeworkPromises);
    const allHomework = results.flat();

    // Sort by deadline descending (newest first)
    allHomework.sort(
      (a, b) =>
        new Date(b.deadline).getTime() - new Date(a.deadline).getTime(),
    );

    this.logger.log(`Fetched ${allHomework.length} homework items total`);
    return allHomework;
  }

  // ── Attendance (Presensi) API ────────────────────────────────

  private getUserNomorFromToken(token: string): number | null {
    const payload = this.decodeTokenPayload(token);
    const nomor = payload?.nomor ?? payload?.sub;
    return typeof nomor === 'number' ? nomor : typeof nomor === 'string' ? Number.parseInt(nomor, 10) || null : null;
  }

  private decodeTokenPayload(token: string): Record<string, unknown> | null {
    try {
      const payload = token.split('.')[1];
      if (!payload) return null;

      const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
      const decoded = Buffer.from(padded, 'base64').toString('utf-8');

      return JSON.parse(decoded) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private getCurrentNimFromSession(): string {
    const auth = this.loadAuth();
    if (!auth) {
      throw new Error('Not logged in. Please login first.');
    }

    const payload = this.decodeTokenPayload(auth.token);
    const nimRaw = payload?.nipnrp ?? payload?.nomor ?? payload?.sub;

    if (typeof nimRaw === 'string' || typeof nimRaw === 'number') {
      const nim = String(nimRaw).trim();
      if (nim) return nim;
    }

    throw new Error('Could not determine user nim from token.');
  }

  private toIsoOrNull(value: Date | null): string | null {
    return value ? value.toISOString() : null;
  }

  private buildDosenTitle(
    gelarDpn: string | null,
    dosen: string | null,
    gelarBlk: string | null,
  ): string {
    const parts: string[] = [];
    if (gelarDpn) parts.push(gelarDpn);
    if (dosen) parts.push(dosen);
    if (gelarBlk) parts.push(gelarBlk);
    return parts.join(' ').trim() || '-';
  }

  private getActiveAcademicPeriod(date = new Date()): { tahun: number; semester: number } {
    const month = date.getMonth() + 1;

    if (month >= 8) {
      return { tahun: date.getFullYear(), semester: 1 };
    }

    return { tahun: date.getFullYear() - 1, semester: 2 };
  }

  private formatAttendanceDisplayDate(value: Date): string {
    const formatter = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    const parts = formatter.formatToParts(value);
    const weekday = parts.find((part) => part.type === 'weekday')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const year = parts.find((part) => part.type === 'year')?.value;
    const hour = parts.find((part) => part.type === 'hour')?.value;
    const minute = parts.find((part) => part.type === 'minute')?.value;
    const second = parts.find((part) => part.type === 'second')?.value;

    if (!weekday || !day || !month || !year || !hour || !minute || !second) {
      return value.toISOString();
    }

    return `${weekday}, ${day} ${month} ${year} - ${hour}:${minute}:${second}`;
  }

  async getScheduleDataFromDb(): Promise<CourseSchedule[]> {
    const nim = this.getCurrentNimFromSession();

    const schedules = await this.prisma.schedule.findMany({
      where: {
        subject: {
          student: { nim },
        },
      },
      include: {
        subject: true,
      },
      orderBy: [{ nomorHari: 'asc' }, { jamAwal: 'asc' }],
    });

    return schedules.map((schedule: ScheduleWithSubject): CourseSchedule => ({
      id: schedule.externalId ?? schedule.subject.externalId,
      subjectName: schedule.subject.subjectName,
      dosen: schedule.subject.dosen,
      dosenTitle: this.buildDosenTitle(
        schedule.subject.gelarDpn,
        schedule.subject.dosen,
        schedule.subject.gelarBlk,
      ),
      kodeKelas: schedule.subject.kodeKelas,
      pararel: schedule.subject.pararel,
      hari: schedule.hari,
      jamAwal: schedule.jamAwal,
      jamAkhir: schedule.jamAkhir,
      nomorHari: schedule.nomorHari,
      ruang: schedule.ruang,
    }));
  }

  async getScheduleData(): Promise<CourseSchedule[]> {
    try {
      const schedules = await this.getScheduleDataFromDb();
      if (schedules.length > 0) {
        return schedules;
      }
    } catch (error) {
      this.logger.warn(
        `Schedule DB fallback triggered: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }

    return this.fetchScheduleData();
  }

  async getHomeworkFromDb(): Promise<HomeworkItem[]> {
    const nim = this.getCurrentNimFromSession();

    const homeworks = await this.prisma.homework.findMany({
      where: {
        deletedAt: null,
        subject: {
          student: { nim },
        },
      },
      include: {
        subject: true,
      },
      orderBy: {
        deadline: 'desc',
      },
    });

    return homeworks.map((homework: HomeworkWithSubject): HomeworkItem => ({
      id: homework.externalId,
      title: homework.title,
      description: homework.description,
      deadline: homework.deadline.toISOString(),
      deadlineIndonesia: homework.deadlineIndonesia,
      submissionTime: this.toIsoOrNull(homework.submissionTime),
      submissionTimeIndonesia: homework.submissionTimeIndonesia,
      status: homework.status,
      subjectName: homework.subject.subjectName,
      subjectNomor: homework.subject.externalId,
      tahun: homework.tahun,
      semester: homework.semester,
      fileCount: homework.fileCount,
    }));
  }

  async getHomeworkData(): Promise<HomeworkItem[]> {
    try {
      const homework = await this.getHomeworkFromDb();
      if (homework.length > 0) {
        return homework;
      }
    } catch (error) {
      this.logger.warn(
        `Homework DB fallback triggered: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }

    return this.fetchAllHomework();
  }

  async getAttendanceFromDb(): Promise<AttendanceItem[]> {
    const nim = this.getCurrentNimFromSession();
    const jakartaDateFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const toJakartaDateKey = (value: Date): string => {
      const parts = jakartaDateFormatter.formatToParts(value);
      const day = parts.find((part) => part.type === 'day')?.value;
      const month = parts.find((part) => part.type === 'month')?.value;
      const year = parts.find((part) => part.type === 'year')?.value;
      if (!day || !month || !year) return value.toISOString().slice(0, 10);
      return `${year}-${month}-${day}`;
    };

    const attendances = await this.prisma.attendance.findMany({
      where: {
        deletedAt: null,
        subject: {
          student: { nim },
        },
      },
      include: {
        subject: true,
      },
      orderBy: [{ tahun: 'desc' }, { semester: 'desc' }, { date: 'desc' }],
    });

    const presensiSessions = await this.prisma.presensiSession.findMany({
      where: {
        subject: {
          student: { nim },
        },
      },
      include: {
        subject: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    type AttendanceGroup = {
      subject: AttendanceWithSubject['subject'] | PresensiSessionSubject;
      tahun: number;
      semester: number;
      attendanceRows: AttendanceWithSubject[];
      attendedDates: Set<string>;
      openedDates: Set<string>;
      latestPresensiAt: Date | null;
    };

    const grouped = new Map<string, AttendanceGroup>();
    const ensureGroup = (
      key: string,
      subject: AttendanceWithSubject['subject'] | PresensiSessionSubject,
      tahun: number,
      semester: number,
    ): AttendanceGroup => {
      const existing = grouped.get(key);
      if (existing) {
        return existing;
      }

      const created: AttendanceGroup = {
        subject,
        tahun,
        semester,
        attendanceRows: [],
        attendedDates: new Set<string>(),
        openedDates: new Set<string>(),
        latestPresensiAt: null,
      };
      grouped.set(key, created);
      return created;
    };

    for (const attendance of attendances) {
      const key = `${attendance.subject.externalId}:${attendance.tahun}:${attendance.semester}`;
      const group = ensureGroup(key, attendance.subject, attendance.tahun, attendance.semester);
      group.attendanceRows.push(attendance);
      const attendedDateKey = toJakartaDateKey(new Date(attendance.date));
      group.attendedDates.add(attendedDateKey);
    }

    for (const session of presensiSessions) {
      const period =
        session.tahun && session.semester
          ? { tahun: session.tahun, semester: session.semester }
          : this.getActiveAcademicPeriod(session.createdAt);
      const key = `${session.subject.externalId}:${period.tahun}:${period.semester}`;
      const group = ensureGroup(key, session.subject, period.tahun, period.semester);
      group.openedDates.add(toJakartaDateKey(new Date(session.createdAt)));
      if (!group.latestPresensiAt || session.createdAt > group.latestPresensiAt) {
        group.latestPresensiAt = session.createdAt;
      }
    }

    const result: AttendanceItem[] = [];
    for (const group of grouped.values()) {
      group.attendanceRows.sort((a, b) => b.date.getTime() - a.date.getTime());

      const first = group.attendanceRows[0] ?? null;
      const totalSessionDates = new Set(group.attendedDates);
      for (const dateKey of group.openedDates) {
        totalSessionDates.add(dateKey);
      }

      const attendedSessions = group.attendedDates.size;
      const totalSessions = totalSessionDates.size;
      const attendanceRate =
        totalSessions === 0 ? 0 : (attendedSessions / totalSessions) * 100;
      const representativeDate = first
        ? first.dateDisplay ?? first.date.toISOString()
        : group.latestPresensiAt
          ? this.formatAttendanceDisplayDate(group.latestPresensiAt)
          : '';

      result.push({
        subjectName: group.subject.subjectName,
        subjectNomor: group.subject.externalId,
        tahun: group.tahun,
        semester: group.semester,
        date: representativeDate,
        totalSessions,
        attendedSessions,
        attendanceRate,
        history: group.attendanceRows.map((row) => ({
          date: row.dateDisplay ?? row.date.toISOString(),
          key: row.key,
        })),
      });
    }

    result.sort((a, b) => {
      if (b.tahun !== a.tahun) return b.tahun - a.tahun;
      if (b.semester !== a.semester) return b.semester - a.semester;
      return a.subjectName.localeCompare(b.subjectName);
    });

    return result;
  }

  async getAttendanceData(): Promise<AttendanceItem[]> {
    try {
      const attendance = await this.getAttendanceFromDb();
      if (attendance.length > 0) {
        return attendance;
      }
    } catch (error) {
      this.logger.warn(
        `Attendance DB fallback triggered: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }

    return this.fetchAllAttendance();
  }

  private async fetchPresensiForSubject(
    kuliah: number,
    jenisSchema: number,
    userNomor: number,
    headers: Record<string, string>,
  ): Promise<PresensiRaw[]> {
    try {
      const res = await fetch(
        `${BASE_URL}/api/presensi/riwayat?kuliah=${kuliah}&jenis_schema=${jenisSchema}&nomor=${userNomor}`,
        { headers, redirect: 'manual', cache: 'no-store' },
      );
      if (!res.ok) return [];
      const data = await res.json();
      if (!Array.isArray(data)) return [];
      return data;
    } catch {
      return [];
    }
  }

  async fetchAllAttendance(): Promise<AttendanceItem[]> {
    const auth = this.loadAuth();
    if (!auth) {
      throw new Error('Not logged in. Please login first.');
    }

    const userNomor = this.getUserNomorFromToken(auth.token);
    if (!userNomor) {
      throw new Error('Could not determine user ID from token.');
    }

    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      token: auth.token,
    };

    // Fetch subjects across multiple academic years/semesters
    const currentYear = new Date().getFullYear();
    const semesters: { tahun: number; semester: number }[] = [];
    for (let y = currentYear - 2; y <= currentYear; y++) {
      semesters.push({ tahun: y, semester: 1 });
      semesters.push({ tahun: y, semester: 2 });
    }

    // Fetch all subjects in parallel
    const subjectResults = await Promise.all(
      semesters.map((s) =>
        this.fetchSubjectsForSemester(s.tahun, s.semester, headers).then(
          (subjects) => ({ ...s, subjects }),
        ),
      ),
    );

    // Fetch presensi for each subject in parallel
    const attendancePromises: Promise<AttendanceItem | null>[] = [];

    for (const { tahun, semester, subjects } of subjectResults) {
      for (const subject of subjects) {
        attendancePromises.push(
          this.fetchPresensiForSubject(
            subject.nomor,
            subject.jenisSchema,
            userNomor,
            headers,
          ).then((presensiList): AttendanceItem | null => {
            // Only include subjects that have at least one presensi session
            if (presensiList.length === 0) return null;

            return {
              subjectName: subject.matakuliah.nama,
              subjectNomor: subject.nomor,
              tahun,
              semester,
              date: presensiList[0]?.waktu_indonesia ?? '',
              totalSessions: presensiList.length,
              attendedSessions: presensiList.length,
              attendanceRate: 100,
              history: presensiList.map((p) => ({
                date: p.waktu_indonesia,
                key: p.key,
              })),
            };
          }),
        );
      }
    }

    const results = await Promise.all(attendancePromises);
    const allAttendance = results.filter(
      (item): item is AttendanceItem => item !== null,
    );

    // Sort by year desc, then semester desc, then subject name
    allAttendance.sort((a, b) => {
      if (b.tahun !== a.tahun) return b.tahun - a.tahun;
      if (b.semester !== a.semester) return b.semester - a.semester;
      return a.subjectName.localeCompare(b.subjectName);
    });

    this.logger.log(
      `Fetched attendance for ${allAttendance.length} subjects total`,
    );
    return allAttendance;
  }

  // ── Generic ETHOL Proxy ──────────────────────────────────────

  async proxyRequest(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    query?: Record<string, string>,
    body?: unknown,
  ): Promise<unknown> {
    const auth = this.loadAuth();
    if (!auth) {
      throw new Error('Not logged in. Please login first.');
    }

    const url = new URL(`${BASE_URL}/api/${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }

    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      token: auth.token,
    };

    const fetchOpts: RequestInit = {
      method,
      headers,
      redirect: 'manual',
      cache: 'no-store',
    };

    if (body && (method === 'POST' || method === 'PUT')) {
      headers['Content-Type'] = 'application/json';
      fetchOpts.body = JSON.stringify(body);
    }

    this.logger.log(`Proxy ${method} /api/${path}`);

    const res = await fetch(url.toString(), fetchOpts);
    const text = await res.text();

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  async getMisSchedule(tahun?: number, semester?: number): Promise<unknown> {
    const auth = this.loadAuth();
    if (!auth) {
      throw new Error('Not logged in. Please login first.');
    }

    const activePeriod = this.getActiveAcademicPeriod();
    const resolvedTahun = tahun ?? activePeriod.tahun;
    const resolvedSemester = semester ?? activePeriod.semester;

    const url = new URL(`${MIS_BASE_URL}/jadwal_kul.php`);
    url.searchParams.set('valTahun', String(resolvedTahun));
    url.searchParams.set('valSemester', String(resolvedSemester));

    const res = await fetch(url.toString(), {
      headers: {
        'User-Agent': USER_AGENT,
        token: auth.token,
        Referer: BASE_URL,
        Origin: BASE_URL,
      },
      redirect: 'manual',
      cache: 'no-store',
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`MIS schedule request failed with status ${res.status}`);
    }

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  getAuthToken(): string | null {
    const auth = this.loadAuth();
    return auth?.token ?? null;
  }
}

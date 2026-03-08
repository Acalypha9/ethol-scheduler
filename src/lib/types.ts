export interface Matakuliah {
  nomor: number;
  nama: string;
  jenisSchemaMk: number;
}

export interface Subject {
  nomor: number;
  kuliah_asal: number;
  jenisSchema: number;
  matakuliah: Matakuliah;
  dosen: string | null;
  gelar_dpn: string | null;
  gelar_blk: string | null;
  nip_dosen: string | null;
  nomor_dosen: number | null;
  kode_kelas: string;
  pararel: string;
}

export interface ScheduleEntry {
  kuliah: number;
  hari: string;
  jam_awal: string;
  jam_akhir: string;
  nomor_hari: number;
  nomor_ruang: number | null;
  ruang: string | null;
}

export interface CourseSchedule {
  id: number;
  subjectName: string;
  dosen: string | null;
  dosenTitle: string;
  kodeKelas: string;
  pararel: string;
  hari: string;
  jamAwal: string;
  jamAkhir: string;
  nomorHari: number;
  ruang: string | null;
}

export interface HomeworkItem {
  id: number;
  title: string;
  description: string;
  deadline: string;
  deadlineIndonesia: string;
  submissionTime: string | null;
  submissionTimeIndonesia: string | null;
  status: 'not_submitted' | 'on_time' | 'late';
  subjectName: string;
  subjectNomor: number;
  tahun: number;
  semester: number;
  fileCount: number;
}

export interface AttendanceItem {
  subjectName: string;
  subjectNomor: number;
  tahun: number;
  semester: number;
  totalSessions: number;
  attendedSessions: number;
  attendanceRate: number;
  history: { date: string; key: string }[];
}

// ── Notification types ────────────────────────────────────────────

export interface NotificationItem {
  type: 'presensi' | 'tugas' | 'materi' | 'video';
  data: unknown;
}

export interface WsMessage {
  type: string;
  data?: unknown;
  timestamp: string;
}

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

// ── Homework (Tugas) types ────────────────────────────────────────

export interface TugasFile {
  id: number;
  file: string;
  nama: string;
}

export interface TugasRaw {
  id: number;
  title: string;
  description: string;
  deadline: string;
  deadline_indonesia: string;
  submission_time: string | null;
  submission_time_indonesia: string | null;
  file: TugasFile[];
  status_pengumpulan?: number;
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

// ── Attendance (Presensi) types ───────────────────────────────────

export interface PresensiRaw {
  nomor: number;
  waktu_indonesia: string;
  key: string;
}

export interface AttendanceItem {
  subjectName: string;
  subjectNomor: number;
  tahun: number;
  semester: number;
  date: string;
  totalSessions: number;
  attendedSessions: number;
  attendanceRate: number;
  history: { date: string; key: string }[];
}


export interface NotificationItem {
  id: number;
  type: 'presensi' | 'tugas' | 'materi' | 'video';
  message: string;
  timestamp: string;
  read: boolean;
  data?: unknown;
}

export interface WsMessage {
  type: string;
  data?: unknown;
  timestamp: string;
}

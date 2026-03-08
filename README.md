# ETHOL Scheduler

ETHOL Scheduler is a local multi-service project for viewing ETHOL schedule, homework, attendance, and notifications from a web dashboard and a WhatsApp bot.

## Services

### Frontend

- Stack: Next.js 16 + React 19
- Location: `src/`
- Default dev URL: `http://localhost:3000`
- Browser requests to `/api/*` are rewritten to the Nest backend.

### Backend

- Stack: NestJS
- Location: `backend/`
- Default URL: `http://localhost:4000`
- Global API prefix: `/api`
- WebSocket endpoint: `ws://localhost:4000/ws/notifications`

### WhatsApp Bot

- Stack: Node.js + `whatsapp-web.js`
- Location: `wa-bot/`
- Webhook receiver: `http://localhost:3005/webhook`
- Default mode: headless Chrome

## Project Flow

1. Frontend calls `/api/*`
2. Next.js rewrites requests to `http://localhost:4000/api/*`
3. Nest backend serves DB-backed endpoints and ETHOL proxy endpoints
4. WhatsApp bot consumes backend REST and WebSocket notifications

## Frontend Behavior

The main dashboard in `src/app/page.tsx` uses these backend routes:

- `POST /api/login`
- `POST /api/logout`
- `GET /api/schedule`
- `GET /api/homework`
- `GET /api/attendance`
- `GET /api/token`

Tabs currently shown in the UI:

- Schedule
- Homework
- Attendance
- Notifications

## Backend HTTP Endpoints

Implemented in `backend/src/ethol/ethol.controller.ts`.

### Session

- `POST /api/login`
- `POST /api/logout`
- `GET /api/token`

### Dashboard Data

- `GET /api/schedule`
- `GET /api/homework`
- `GET /api/attendance`

### Generic ETHOL Proxy

- `GET /api/proxy/*path`
- `POST /api/proxy/*path`
- `PUT /api/proxy/*path`
- `DELETE /api/proxy/*path`

These proxy routes forward requests to:

- `https://ethol.pens.ac.id/api/{path}`

They use the saved ETHOL session from `auth.json` on the backend side.

### MIS Endpoint

- `GET /api/mis-schedule?tahun=<number>&semester=<number>`

This route forwards to the legacy MIS upstream:

- `https://mis.pens.ac.id/jadwal_kul.php?valTahun=...&valSemester=...`

## WebSocket

Backend WebSocket endpoint:

- `ws://localhost:4000/ws/notifications?token=<jwt>`

Frontend notification panel uses this socket and handles events like:

- `connected`
- `notifications`
- `ethol_message`
- `ethol_ws_connected`
- `upstream_ws_unavailable`
- `refresh_complete`
- `error`

The backend gives the ETHOL upstream socket 5 seconds to open. If it does not respond in time, the session switches to polling-only updates every 5-8 seconds.

Client refresh request:

```json
{ "type": "refresh" }
```

## WhatsApp Bot

Main file:

- `wa-bot/whatsapp-bot.js`

Bot features:

- Receives notifications from backend WebSocket
- Calls backend REST endpoints
- Sends updates to a configured WhatsApp chat
- Exposes webhook receiver on port `3005`

Active commands:

- `/help`
- `/today`
- `/schedule`
- `/task`
- `/task y{N} s{N}`
- `/materi`

## Local Development

### Frontend

Run from project root:

```bash
npm install
npm run dev
```

### Backend

Run from `backend/`:

```bash
npm install
npm run start:dev
```

### WhatsApp Bot

Run from `wa-bot/`:

```bash
npm install
node whatsapp-bot.js
```

## Environment and Local Files

Common local files used by the project:

- `.env`
- `auth.json`
- `wa-bot/.wwebjs_auth/`
- `wa-bot/.wwebjs_cache/`

Notes:

- `auth.json` is used by the backend ETHOL session flow
- WhatsApp bot session files are stored under `wa-bot/.wwebjs_auth/`
- The bot runs headless by default unless `WA_HEADLESS=false`

## Important Files

- `next.config.ts`
- `src/app/page.tsx`
- `src/components/LoginForm.tsx`
- `src/components/NotificationPanel.tsx`
- `backend/src/main.ts`
- `backend/src/ethol/ethol.controller.ts`
- `backend/src/ethol/ethol.service.ts`
- `wa-bot/whatsapp-bot.js`

## Current Verification Status

Latest verified commands:

- `npm run lint`
- `npm run build`
- `backend/npm run build`

All of those passed in the current workspace state.

---

## Detailed ETHOL API Reference

The sections below preserve the reverse-engineered ETHOL API notes that were already in this repository.

> **Enterprise Technology Hybrid Online Learning — Politeknik Elektronika Negeri Surabaya (PENS)**
>
> Base URL: `https://ethol.pens.ac.id`
>
> Reverse-engineered from Nuxt.js frontend chunks (246 chunks analyzed).
>
> Last updated: February 26, 2026

---

## Table of Contents

- [Authentication](#authentication)
- [Kuliah (Courses)](#kuliah-courses)
- [Tugas (Assignments)](#tugas-assignments)
- [Presensi (Attendance)](#presensi-attendance)
- [Quiz (Student Quiz)](#quiz-student-quiz)
- [Dosen Quiz (Lecturer Quiz Management)](#dosen-quiz-lecturer-quiz-management)
- [Ujian (Exams)](#ujian-exams)
- [Forum](#forum)
- [Materi (Course Materials)](#materi-course-materials)
- [Video](#video)
- [Pengumuman (Announcements)](#pengumuman-announcements)
- [Notifikasi (Notifications)](#notifikasi-notifications)
- [Presensi Management (Lecturer/Admin)](#presensi-management-lectureradmin)
- [Support (Help Desk)](#support-help-desk)
- [Jadwal (Schedule Management)](#jadwal-schedule-management)
- [Conference / Meeting Rooms](#conference--meeting-rooms)
- [MIS (Master Data)](#mis-master-data)
- [Pegawai (Staff)](#pegawai-staff)
- [Survei (Survey)](#survei-survey)
- [Libur (Holidays)](#libur-holidays)
- [Hari (Days)](#hari-days)
- [Frontend Routes (Nuxt Pages)](#frontend-routes-nuxt-pages)
- [Authentication Flow](#authentication-flow)
- [Common Patterns](#common-patterns)

---

## Authentication

ETHOL uses **CAS (Central Authentication Service)** via `login.pens.ac.id`.

### Auth Header

All API requests require the JWT token in a custom header:

```
token: <raw_jwt>
```

> **NOT** `Authorization: Bearer <token>`. The header name is literally `token`.

The token is set via an Axios interceptor in the Nuxt app:

```javascript
$axios.setHeader("token", store.state.auth.token)
```

### Token Storage

- **Frontend (ETHOL):** `localStorage.setItem('token', 'eyJ...')`
- **Our backend:** Saved to `auth.json` file

### JWT Payload

The JWT contains user information including:
- `nomor` — Student/staff ID number
- `sub` — Subject (fallback for user ID)

### Error Response Pattern

Auth failures return HTTP 200 with:

```json
{
  "sukses": false,
  "pesan": "error message"
}
```

---

## Kuliah (Courses)

### List Courses (Subjects)

```
GET /api/kuliah?tahun={year}&semester={semester}
```

| Param      | Type   | Description                        |
| ---------- | ------ | ---------------------------------- |
| `tahun`    | number | Academic year (e.g., 2025)         |
| `semester` | number | 1 = Ganjil (odd), 2 = Genap (even) |

**Response:** `Subject[]`

```json
[
  {
    "nomor": 218868,
    "jenisSchema": 1,
    "kode_kelas": "TI-3A",
    "pararel": "A",
    "dosen": "John Doe",
    "gelar_dpn": "Dr.",
    "gelar_blk": "S.T., M.T.",
    "nomor_dosen": 12345,
    "kuliah_asal": 218868,
    "matakuliah": {
      "nomor": 100,
      "nama": "Bahasa Indonesia"
    }
  }
]
```

### Get Course Schedule (Batch)

```
POST /api/kuliah/hari-kuliah-in
```

**Request Body:**

```json
{
  "kuliahs": [
    { "nomor": 218868, "jenisSchema": 1 },
    { "nomor": 219111, "jenisSchema": 1 }
  ],
  "tahun": 2025,
  "semester": 2
}
```

**Response:** `ScheduleEntry[]`

```json
[
  {
    "kuliah": 218868,
    "hari": "Senin",
    "jam_awal": "07:00",
    "jam_akhir": "09:30",
    "nomor_hari": 1,
    "ruang": "TB-301"
  }
]
```

### Get Course by Kuliah ID

```
GET /api/kuliah/by-kuliah-js?kuliah={nomor}&jenisSchema={jenisSchema}
```

| Param         | Type   | Description   |
| ------------- | ------ | ------------- |
| `kuliah`      | number | Course number |
| `jenisSchema` | number | Schema type   |

### Get Course Participants

```
GET /api/kuliah/peserta-kuliah?kuliah={nomor}&jenis_schema={jenisSchema}
```

| Param          | Type   | Description   |
| -------------- | ------ | ------------- |
| `kuliah`       | number | Course number |
| `jenis_schema` | number | Schema type   |

---

## Tugas (Assignments)

### List Assignments for Course

```
GET /api/tugas?kuliah={nomor}&jenisSchema={jenisSchema}
```

| Param         | Type   | Description   |
| ------------- | ------ | ------------- |
| `kuliah`      | number | Course number |
| `jenisSchema` | number | Schema type   |

**Response:** `TugasRaw[]`

```json
[
  {
    "id": 12345,
    "title": "Tugas 1 - Introduction",
    "description": "...",
    "deadline": "2025-03-15T23:59:00",
    "deadline_indonesia": "Sabtu, 15 Maret 2025 - 23:59:00",
    "submission_time": "2025-03-14T10:30:00",
    "submission_time_indonesia": "Jumat, 14 Maret 2025 - 10:30:00",
    "file": []
  }
]
```

### Get Assignment by ID

```
GET /api/tugas/by-nomor?nomorTugas={id}
```

### Get Student's Submission

```
GET /api/tugas/jawaban-mahasiswa-by-id?id_tugas={id}
```

### Get Student's Work

```
GET /api/tugas/pekerjaan-mahasiswa?id_tugas={id}
```

### Submit Assignment

```
POST /api/tugas/submit
```

**Request Body:** `FormData` (multipart)

### Update Assignment Submission

```
PUT /api/tugas/submit
```

**Request Body:** `FormData` (multipart)

### Create Assignment (Lecturer)

```
POST /api/tugas
```

**Request Body:** Assignment data object

### Update Assignment (Lecturer)

```
PUT /api/tugas
```

### Update Grade & Notes (Lecturer)

```
PUT /api/tugas/update-catatan-nilai
```

**Request Body:**

```json
{
  "nomorTugas": 12345,
  "judulTugas": "Tugas 1",
  "mahasiswa": 67890,
  "nomor_tugas_mahasiswa": 111,
  "catatanDosen": "Good work",
  "nilai": 85
}
```

### Assignment Detail for BAAK

```
GET /api/tugas/detail-tugas/baak?kuliah={nomor}&jenisSchema={schema}&tahun={year}&bulan={month}
```

---

## Presensi (Attendance)

### Get Attendance History (Student)

```
GET /api/presensi/riwayat?kuliah={nomor}&jenis_schema={jenisSchema}&nomor={userNomor}
```

| Param          | Type   | Description                         |
| -------------- | ------ | ----------------------------------- |
| `kuliah`       | number | Course number                       |
| `jenis_schema` | number | Schema type                         |
| `nomor`        | number | Student ID (from JWT `nomor` field) |

**Response:** `PresensiRaw[]`

```json
[
  {
    "nomor": 1,
    "waktu_indonesia": "Selasa, 24 Februari 2026 - 11:23:32",
    "key": "nK2Akauivn"
  }
]
```

> **Note:** This endpoint only returns sessions the student **attended**. There is no student-facing API to get total available sessions (including missed ones).

### Get Latest Session

```
GET /api/presensi/terakhir-kuliah?kuliah={nomor}&jenis_schema={jenisSchema}
```

**Response:**

```json
{
  "ditemukan": 1,
  "open": true,
  "key": "abc123",
  "tanggal_format": "Senin, 24 Februari 2026"
}
```

### Check Active Attendance Session

```
GET /api/presensi/aktif-kuliah?kuliah={nomor}&jenis_schema={jenisSchema}
```

### Submit Attendance (Student)

```
POST /api/presensi/mahasiswa
```

**Request Body:**

```json
{
  "kuliah": 218868,
  "mahasiswa": 12345,
  "jenis_schema": 1,
  "kuliah_asal": 218868,
  "key": "nK2Akauivn"
}
```

---

## Quiz (Student Quiz)

### List Quizzes for Course

```
GET /api/quiz?kuliah={nomor}&jenisSchema={jenisSchema}
```

### Show Quiz Details

```
GET /api/quiz/show?kuis_id={id}&mahasiswa={studentNomor}
```

### Get Quiz Time

```
GET /api/quiz/waktu?kuis_id={id}&mahasiswa={studentNomor}
```

### Submit Quiz Answer

```
POST /api/quiz/answer
```

**Request Body:**

```json
{
  "kuis_hasil_id": 123,
  "kuis_soal_id": 456,
  "jawaban_dipilih": [{ "id": 1, "selected": true }]
}
```

### Finish Quiz

```
POST /api/quiz/finish
```

**Request Body:**

```json
{
  "kuis_id": 123,
  "mahasiswa": 12345,
  "kuis_hasil_id": 789
}
```

### Review Quiz Results

```
GET /api/quiz/review?kuis_hasil_id={id}
```

---

## Dosen Quiz (Lecturer Quiz Management)

### Create Quiz

```
POST /api/dosen-quiz
```

**Request Body:**

```json
{
  "kuliah": 218868,
  "jenisSchema": 1,
  "judul": "Quiz 1",
  "tgl_start": "2025-03-01T08:00:00",
  "tgl_end": "2025-03-01T10:00:00",
  "soal_random": "true",
  "durasi": 60,
  "tipe": "multiple_choice"
}
```

### Update Quiz

```
PUT /api/dosen-quiz
```

### Update Quiz Status

```
PUT /api/dosen-quiz/{id}/status
```

**Request Body:**

```json
{
  "status": "1"
}
```

### Get Quiz Detail

```
GET /api/dosen-quiz/soal/{id}/detail
```

### CRUD Quiz Questions

```
POST   /api/dosen-quiz/soal          — Create question
PUT    /api/dosen-quiz/soal          — Update question
DELETE /api/dosen-quiz/soal/{id}     — Delete question
```

### CRUD Quiz Answers

```
POST   /api/dosen-quiz/jawaban       — Create answer
PUT    /api/dosen-quiz/jawaban       — Update answer
DELETE /api/dosen-quiz/jawaban/{id}  — Delete answer
```

### CRUD Quiz Attachments

```
POST   /api/dosen-quiz/lampiran      — Upload attachment
DELETE /api/dosen-quiz/lampiran/{id} — Delete attachment
```

### Question Bank

```
GET    /api/dosen-quiz/banks                 — List question banks
POST   /api/dosen-quiz/banks                 — Create bank
PUT    /api/dosen-quiz/banks                 — Update bank
GET    /api/dosen-quiz/bank/soal/{id}/detail — Get bank question detail
POST   /api/dosen-quiz/bank/soal             — Create bank question
PUT    /api/dosen-quiz/bank/soal             — Update bank question
DELETE /api/dosen-quiz/bank/soal/{id}        — Delete bank question
POST   /api/dosen-quiz/bank/jawaban          — Create bank answer
PUT    /api/dosen-quiz/bank/jawaban          — Update bank answer
DELETE /api/dosen-quiz/bank/jawaban/{id}     — Delete bank answer
POST   /api/dosen-quiz/bank/lampiran         — Upload bank attachment
DELETE /api/dosen-quiz/bank/lampiran/{id}    — Delete bank attachment
POST   /api/dosen-quiz/bank/import           — Import questions to quiz
POST   /api/dosen-quiz/bank/insert           — Insert selected questions
```

---

## Ujian (Exams)

### List Exams

```
GET /api/ujian/daftar-ujian?tahun={year}&semester={semester}&jenis={type}
```

| Param      | Type   | Description                                |
| ---------- | ------ | ------------------------------------------ |
| `tahun`    | number | Academic year                              |
| `semester` | number | 1 or 2                                     |
| `jenis`    | string | `"1"` = UTS (midterm), `"2"` = UAS (final) |

### Get Single Exam

```
GET /api/ujian/daftar-ujian-single?tahun={year}&semester={semester}&jenis={type}&nomorUjian={id}
```

### Get Exam Detail

```
GET /api/ujian/detail-ujian?jenis={type}&kuliah={nomor}&jenisSchema={schema}
```

### Get Exam Answers

```
GET /api/ujian/jawaban?nomor={examNomor}
```

### Check Exam Questions

```
POST /api/ujian/cek-soal
POST /api/ujian/cek-soal-agama
POST /api/ujian/cek-soal-dosen
```

**Request Body:**

```json
{
  "nomor": 12345
}
```

### Submit Exam

```
POST /api/ujian/submit
```

**Request Body:** `FormData`

### Update Exam Schedule (Lecturer)

```
PUT /api/ujian/jadwal-dosen
```

**Request Body:**

```json
{
  "tanggalSelesai": "2025-06-15T12:00:00",
  "nomorUjian": 12345
}
```

### Update Exam Grade & Notes (Lecturer)

```
PUT /api/ujian/update-catatan-nilai
```

**Request Body:**

```json
{
  "nomor_ujian_mahasiswa": 111,
  "catatanDosen": "Review needed",
  "nilai": 75
}
```

---

## Forum

### List Forum Posts

```
GET /api/forum?kuliah={nomor}&jenisSchema={jenisSchema}
```

### Create Post

```
POST /api/forum
```

**Request Body:**

```json
{
  "narasi": "Post content...",
  "lampiran": [],
  "kuliah": 218868,
  "jenisSchema": 1,
  "tipeAkses": "mahasiswa"
}
```

### Update Post

```
PUT /api/forum
```

**Request Body:**

```json
{
  "narasi": "Updated content...",
  "lampiran": [],
  "idForum": 123
}
```

### Delete Post

```
DELETE /api/forum/{id}
```

### Add Comment

```
POST /api/forum/komentar
```

**Request Body:**

```json
{
  "idForum": 123,
  "narasi": "Comment text...",
  "tipeAkses": "mahasiswa"
}
```

### Delete Comment

```
DELETE /api/forum/komentar/{id}
```

---

## Materi (Course Materials)

### List Materials for Course

```
GET /api/materi?matakuliah={matakuliahNomor}&dosen={dosenNomor}
```

### Get Material by ID

```
GET /api/materi/by-nomor?nomorMateri={id}
```

### List Materials Catalog

```
GET /api/materi/daftar?program={programId}&jurusan={jurusanId}
```

### Get Related Subject Materials

```
GET /api/materi/matkul-sejenis?matakuliah={matakuliahNomor}&dosen={dosenNomor}
```

### Upload Material (Lecturer)

```
POST /api/materi
```

**Request Body:** `FormData`

### Copy Material to Related Subject

```
POST /api/materi/matkul-sejenis
```

**Request Body:**

```json
{
  "judul": "Material Title",
  "idMatakuliah": 100,
  "nomorDosen": 12345,
  "pathFile": "/path/to/file",
  "tahun": 2025,
  "semester": 2
}
```

---

## Video

### List Videos for Course

```
GET /api/video?kuliah={nomor}&jenis_schema={jenisSchema}
```

### Get Video by ID

```
GET /api/video/by-nomor?nomorVideo={id}
```

### Create Video (Lecturer)

```
POST /api/video
```

**Request Body:**

```json
{
  "judul": "Video Title",
  "url": "https://youtube.com/watch?v=...",
  "kuliah": 218868,
  "jenis_schema": 1,
  "namaMk": "Bahasa Indonesia"
}
```

### Update Video (Lecturer)

```
PUT /api/video
```

**Request Body:**

```json
{
  "judul": "Updated Title",
  "url": "https://youtube.com/watch?v=...",
  "nomor": 123
}
```

---

## Pengumuman (Announcements)

### List Announcements for Course

```
GET /api/pengumuman?kuliah={nomor}&jenis_schema={jenisSchema}
```

### Get Latest Announcement

```
GET /api/pengumuman/terbaru?kuliah={nomor}&jenis_schema={jenisSchema}
```

### Create Announcement (Lecturer)

```
POST /api/pengumuman
```

**Request Body:**

```json
{
  "judul": "Announcement Title",
  "isi_pengumuman": "Content...",
  "kuliah": 218868,
  "jenis_schema": 1
}
```

### Update Announcement (Lecturer)

```
PUT /api/pengumuman
```

**Request Body:**

```json
{
  "judul": "Updated Title",
  "isi_pengumuman": "Updated content...",
  "nomor": 123
}
```

### BAAK Announcement

```
POST /api/pengumuman/baak
PUT  /api/pengumuman/baak
```

---

## Notifikasi (Notifications)

### Get Student Notifications (Verified)

```
GET /api/notifikasi/mahasiswa?filterNotif={FILTER}
```

**Filter values:** `PRESENSI`, `TUGAS`, `MATERI`, `VIDEO`

**Response (array of notification objects):**

```json
[
  {
    "idNotifikasi": "uuid-26220",
    "keterangan": "Dosen telah melakukan presensi untuk matakuliah Kecerdasan Buatan",
    "status": "2",
    "urlWeb": "/notifikasi/presensi/uuid-26220",
    "kodeNotifikasi": "PRESENSI-KULIAH",
    "dataTerkait": "218872-4",
    "createdAt": "2026-03-05T01:15:13.000Z",
    "waktuNotifikasi": "23 jam yang lalu",
    "createdAtIndonesia": "Kamis, 05 Maret 2026 - 08:15"
  }
]
```

**Known `kodeNotifikasi` values:**
- `PRESENSI-KULIAH` - Attendance opened by lecturer
- `TUGAS-BARU` - New assignment posted
- `MATERI-BARU` - New material uploaded

### Get Student Unread Count (Verified)

```
GET /api/notifikasi/mahasiswa-belum-baca
```

**Response:**

```json
{
  "jumlah": 0
}
```

### Mark Student Notification as Read (Verified)

```
PUT /api/notifikasi/mahasiswa-baca-notif
```

**Request Body:**

```json
{
  "idNotifikasi": "uuid-string"
}
```

### Get Lecturer Notifications

```
GET /api/notifikasi/dosen?filterNotif={FILTER}
```

### Get Lecturer Unread Count

```
GET /api/notifikasi/dosen-belum-baca
```

### Mark Lecturer Notification as Read

```
PUT /api/notifikasi/dosen-baca-notif
```

**Request Body:**

```json
{
  "idNotifikasi": "uuid-string"
}
```

**Frontend route paths for notification detail pages:**
- `/mahasiswa/notifikasi/presensi/{id}` - Attendance notification
- `/mahasiswa/notifikasi/tugas/{id}` - Assignment notification
- `/mahasiswa/notifikasi/materi/{id}` - Material notification
- `/mahasiswa/notifikasi/video/{id}` - Video notification
- `/dosen/notifikasi/presensi/{id}` - Lecturer attendance notification
- `/dosen/notifikasi/tugas/{id}` - Lecturer assignment notification
---

## Presensi Management (Lecturer/Admin)

### Open Attendance Session (Lecturer)

```
POST /api/presensi/buka
```

**Request Body:**

```json
{
  "kuliah": 218868,
  "dosen": 12345,
  "jenis_schema": 1,
  "key": "randomKey123"
}
```

### Close Attendance Session (Lecturer)

```
PUT /api/presensi/tutup
```

**Request Body:**

```json
{
  "nomor": 456
}
```

### Cancel Attendance Session (Lecturer)

```
PUT /api/presensi/batalkan
```

**Request Body:**

```json
{
  "kuliah": 218868,
  "jenis_schema": 1,
  "key": "randomKey123"
}
```

### Get Attendance Dates per Month (Admin/BAAK)

```
GET /api/presensi/get-tanggal-presensi-dosen-per-bulan?tahun={year}&bulan={month}&dosen={dosenNomor}&kuliah={kuliahNomor}
```

### Get Attendance Dates per Semester (Admin/BAAK)

```
GET /api/presensi/get-tanggal-presensi-dosen-per-semester?dosen={dosenNomor}&kuliah={kuliahNomor}&tahun={year}&semester={semester}
```

### Get Student Count per Course

```
GET /api/presensi/jumlah-mahasiswa-per-kuliah?kuliah={nomor}&jenis_schema={jenisSchema}
```

### List Students Present

```
GET /api/presensi/daftar-mahasiswa-hadir-kuliah?key={presensiKey}
```

### List Students Absent

```
GET /api/presensi/daftar-mahasiswa-tidak-hadir-kuliah?key={presensiKey}&kuliah={nomor}&jenis_schema={jenisSchema}
```

### Manual Attendance Entry (Admin/Lecturer)

```
POST /api/presensi/{type}
```

**Request Body:**

```json
{
  "kuliah": 218868,
  "jenis_schema": 1,
  "kuliah_asal": 218868,
  "mahasiswa": 12345,
  "key": "randomKey123",
  "waktuPresensi": "2025-03-01 08:00:00"
}
```

---

## Support (Help Desk)

### List Support Tickets

```
GET /api/support?hakAkses={role}
```

### Create Support Ticket

```
POST /api/support
```

**Request Body:**

```json
{
  "judul": "Ticket Title",
  "lampiran": [],
  "deskripsi": "Description...",
  "tipeAkses": "mahasiswa"
}
```

### Delete Support Ticket

```
DELETE /api/support/{nomor}
```

### Get Support Details

```
GET /api/support/nama?nomor={ticketNomor}
GET /api/support/lampiran?nomor={ticketNomor}
```

### Support Replies

```
GET  /api/support/balas?nomor={ticketNomor}
POST /api/support/balas
```

**POST Request Body:**

```json
{
  "lampiran": [],
  "deskripsi": "Reply text...",
  "tipeAkses": "mahasiswa",
  "nomorSupport": 123
}
```

### Mark Ticket as Resolved

```
POST /api/support/tandai-selesai
```

**Request Body:**

```json
{
  "nomorSupport": 123
}
```

### BAAK Support Account Management

```
GET    /api/support/akun-baak
POST   /api/support/akun-baak       — (implied, same pattern)
DELETE /api/support/akun-baak/{nomor}
GET    /api/support/list-admin
GET    /api/support/list-baak
POST   /api/support/add-baak
GET    /api/support/daftar-baak-yang-ikut?nomor={supportNomor}
```

**POST `/support/add-baak` Body:**

```json
{
  "nomorSupport": 123,
  "baak": 456
}
```

---

## Jadwal (Schedule Management)

### Get Schedule (Admin)

```
GET /api/jadwal?program={programId}&jurusan={jurusanId}&tahun={year}&semester={semester}
```

### Generate Schedule (Admin)

```
POST /api/jadwal/proses-generate-jadwal
```

**Request Body:**

```json
{
  "tahun": 2025,
  "semester": 2
}
```

---

## Conference / Meeting Rooms

### List Room Conferences

```
GET /api/room-conference
GET /api/room-conference/umum
```

### Get Room Conference Detail

```
GET /api/room-conference/detail?nomor={id}
```

### Create Room Conference

```
POST /api/room-conference
```

**Request Body:**

```json
{
  "nomor": 1,
  "nama": "Room A",
  "server": "jitsi-server-1"
}
```

### Update Room Conference

```
PUT /api/room-conference
```

**Request Body:**

```json
{
  "nama": "Room A Updated",
  "server": "jitsi-server-2",
  "nomor": 1,
  "nomorAsli": 1
}
```

### Other Conferences

```
GET  /api/conference-lainnya?dosen={dosenNomor}
POST /api/conference-lainnya           — Body: { url: "..." }
PUT  /api/conference-lainnya           — Body: { url: "...", nomor: 1 }
```

### Server Conference (Admin)

```
POST /api/server-conference            — Body: { nama: "...", url: "..." }
PUT  /api/server-conference            — Body: { nama: "...", url: "...", nomor: 1 }
```

> **Jitsi Integration:** Conference links follow the format `https://js.meetings.pens.ac.id/{roomjitsi}`

---

## MIS (Master Data)

```
GET /api/mis/hari            — List of days
GET /api/mis/jenis-schema    — List of schema types
GET /api/mis/jurusan         — List of departments
GET /api/mis/program         — List of programs
```

---

## Pegawai (Staff)

### Get Lecturer Email

```
GET /api/pegawai/dosenemailpens?nomor={dosenNomor}
```

### List Lecturers

```
GET /api/pegawai/dosen-pens
```

---

## Program & Jurusan (Reference Data)

```
GET /api/program                       — List academic programs
GET /api/program/detail?nomor={id}     — Program detail
GET /api/jurusan                       — List departments
GET /api/jurusan/detail?nomor={id}     — Department detail
```

---

## Survei (Survey)

### Submit Survey

```
POST /api/survei-penilaian
```

**Request Body:**

```json
{
  "fitur": "conference",
  "tipeConference": "jitsi",
  "ratingKepuasan": 5,
  "saranMasukan": "Great feature!"
}
```

---

## Libur (Holidays)

### Create Holiday (Admin)

```
POST /api/libur
```

**Request Body:**

```json
{
  "tanggal": "2025-12-25"
}
```

---

## Hari (Days)

### Get Current Day

```
GET /api/hari/today
```

---

## Frontend Routes (Nuxt Pages)

### Mahasiswa (Student)

| Route                                         | Description                         |
| --------------------------------------------- | ----------------------------------- |
| `/mahasiswa/beranda`                          | Student dashboard                   |
| `/mahasiswa/jadwal-online`                    | Online schedule                     |
| `/mahasiswa/matakuliah`                       | Course list                         |
| `/mahasiswa/praktikum`                        | Lab courses                         |
| `/mahasiswa/tugas-online`                     | Online assignments                  |
| `/mahasiswa/kuliah/detail`                    | Course detail (includes attendance) |
| `/mahasiswa/kuliah/forum`                     | Course forum                        |
| `/mahasiswa/kuliah/kuis`                      | Course quizzes                      |
| `/mahasiswa/kuliah/kuis/test`                 | Take quiz                           |
| `/mahasiswa/kuliah/kuis/result`               | Quiz results                        |
| `/mahasiswa/kuliah/kuis/review/{id}`          | Review quiz                         |
| `/mahasiswa/kuliah/mahasiswa`                 | Classmate list                      |
| `/mahasiswa/kuliah/materi`                    | Course materials                    |
| `/mahasiswa/kuliah/pengumuman`                | Course announcements                |
| `/mahasiswa/kuliah/tugas`                     | Course assignments                  |
| `/mahasiswa/kuliah/video`                     | Course videos                       |
| `/mahasiswa/materi-perkuliahan`               | All course materials                |
| `/mahasiswa/materi-perkuliahan/daftar-materi` | Materials catalog                   |
| `/mahasiswa/notifikasi/presensi/{id}`         | Attendance notification             |
| `/mahasiswa/notifikasi/tugas/{id}`            | Assignment notification             |
| `/mahasiswa/notifikasi/materi/{id}`           | Material notification               |
| `/mahasiswa/notifikasi/video/{id}`            | Video notification                  |
| `/mahasiswa/support`                          | Help desk                           |
| `/mahasiswa/support/buat`                     | Create ticket                       |
| `/mahasiswa/support/detail`                   | Ticket detail                       |
| `/mahasiswa/uts`                              | Midterm exams                       |
| `/mahasiswa/uts/detail`                       | Midterm detail                      |
| `/mahasiswa/uts/detail-ujian`                 | Midterm exam page                   |
| `/mahasiswa/uas`                              | Final exams                         |
| `/mahasiswa/uas/detail`                       | Final detail                        |
| `/mahasiswa/uas/detail-ujian`                 | Final exam page                     |

### Dosen (Lecturer)

| Route                                     | Description             |
| ----------------------------------------- | ----------------------- |
| `/dosen/beranda`                          | Lecturer dashboard      |
| `/dosen/jadwal-online`                    | Online schedule         |
| `/dosen/matakuliah`                       | Course list             |
| `/dosen/praktikum`                        | Lab courses             |
| `/dosen/tugas-online`                     | Online assignments      |
| `/dosen/materi-perkuliahan`               | Course materials        |
| `/dosen/materi-perkuliahan/daftar-materi` | Materials catalog       |
| `/dosen/kuliah/detail`                    | Course detail           |
| `/dosen/kuliah/forum`                     | Course forum            |
| `/dosen/kuliah/kuis`                      | Quiz management         |
| `/dosen/kuliah/kuis/bank`                 | Question bank           |
| `/dosen/kuliah/kuis/detail`               | Quiz detail             |
| `/dosen/kuliah/kuis/hasil/{id}`           | Quiz results by student |
| `/dosen/kuliah/mahasiswa`                 | Student list            |
| `/dosen/kuliah/materi`                    | Course materials        |
| `/dosen/kuliah/pengumuman`                | Announcements           |
| `/dosen/kuliah/tugas`                     | Assignment management   |
| `/dosen/kuliah/rekap-nilai-tugas`         | Assignment grade recap  |
| `/dosen/kuliah/rekap-nilai-uts`           | Midterm grade recap     |
| `/dosen/kuliah/rekap-nilai-uas`           | Final grade recap       |
| `/dosen/kuliah/video`                     | Video management        |
| `/dosen/rekap-presensi`                   | Attendance recap        |
| `/dosen/rekap-presensi/detail`            | Attendance detail       |
| `/dosen/notifikasi/presensi/{id}`         | Attendance notification |
| `/dosen/notifikasi/tugas/{id}`            | Assignment notification |
| `/dosen/support`                          | Help desk               |
| `/dosen/support/buat`                     | Create ticket           |
| `/dosen/support/detail`                   | Ticket detail           |
| `/dosen/uts`                              | Midterm management      |
| `/dosen/uts/detail`                       | Midterm detail          |
| `/dosen/uas`                              | Final management        |
| `/dosen/uas/detail`                       | Final detail            |

### Admin

| Route                                      | Description              |
| ------------------------------------------ | ------------------------ |
| `/admin/beranda`                           | Admin dashboard          |
| `/admin/jadwal-kuliah`                     | Schedule management      |
| `/admin/rekap-presensi`                    | Attendance recap         |
| `/admin/rekap-presensi/detail`             | Attendance detail        |
| `/admin/support`                           | Support management       |
| `/admin/support/detail`                    | Support detail           |
| `/admin/pengaturan-tanggal-libur`          | Holiday settings         |
| `/admin/bantuan-generate-token`            | Token generation help    |
| `/admin/fcm-example`                       | FCM notification example |
| `/admin/ujian-uts`                         | Midterm management       |
| `/admin/ujian-uas`                         | Final management         |
| `/admin/master/mis`                        | Master data management   |
| `/admin/master/mis/agama`                  | Religion master          |
| `/admin/master/mis/hari`                   | Day master               |
| `/admin/master/mis/jam`                    | Time slot master         |
| `/admin/master/mis/jam-pjj`                | PJJ time slots           |
| `/admin/master/mis/jam-psdku`              | PSDKU time slots         |
| `/admin/master/mis/jam-reguler`            | Regular time slots       |
| `/admin/master/mis/jurusan`                | Department master        |
| `/admin/master/mis/kelas`                  | Class master             |
| `/admin/master/mis/kuliah`                 | Course master            |
| `/admin/master/mis/kuliah-agama`           | Religion course master   |
| `/admin/master/mis/kuliah-agama-mahasiswa` | Student religion course  |
| `/admin/master/mis/kuliah-pararel`         | Parallel course master   |
| `/admin/master/mis/mahasiswa`              | Student master           |
| `/admin/master/mis/mahasiswa-semester`     | Student semester         |
| `/admin/master/mis/matakuliah`             | Subject master           |
| `/admin/master/mis/pegawai`                | Staff master             |
| `/admin/master/mis/program`                | Program master           |
| `/admin/master/mis/ruang-kuliah`           | Classroom master         |
| `/admin/master/mis/skema`                  | Schema master            |
| `/admin/master/mis/soal`                   | Question master          |
| `/admin/master/mis/soal-agama`             | Religion question master |
| `/admin/master/room-meeting`               | Meeting room master      |
| `/admin/master/server-conference`          | Conference server master |

### BAAK (Academic Administration)

| Route                         | Description         |
| ----------------------------- | ------------------- |
| `/baak/beranda`               | BAAK dashboard      |
| `/baak/jadwal-kuliah`         | Schedule management |
| `/baak/pengumuman`            | Announcements       |
| `/baak/rekap-presensi`        | Attendance recap    |
| `/baak/rekap-presensi/detail` | Attendance detail   |
| `/baak/rekap-tugas`           | Assignment recap    |
| `/baak/rekap-tugas/detail`    | Assignment detail   |
| `/baak/support`               | Support management  |
| `/baak/support/detail`        | Support detail      |
| `/baak/ujian-uts`             | Midterm management  |
| `/baak/ujian-uas`             | Final management    |

### Kaprodi (Head of Study Program)

| Route                     | Description       |
| ------------------------- | ----------------- |
| `/kaprodi/beranda`        | Kaprodi dashboard |
| `/kaprodi/rekap/materi`   | Material recap    |
| `/kaprodi/rekap/presensi` | Attendance recap  |
| `/kaprodi/rekap/tugas`    | Assignment recap  |
| `/kaprodi/rekap/video`    | Video recap       |

### Auth

| Route            | Description                      |
| ---------------- | -------------------------------- |
| `/auth/dosen-lb` | External lecturer authentication |

### Public Links

| Route           | Description            |
| --------------- | ---------------------- |
| `/links/materi` | Public material link   |
| `/links/tugas`  | Public assignment link |
| `/links/video`  | Public video link      |

---

## Authentication Flow

```
1. Client → GET https://ethol.pens.ac.id/cas
   ↓ Redirects through CAS SSO
2. Client → lands on https://login.pens.ac.id/cas/login?service=...
   ↓ Parse hidden form fields (lt, execution)
3. Client → POST credentials to CAS login URL
   ↓ Follow redirects back to ETHOL
4. ETHOL response contains: localStorage.setItem('token', 'eyJ...')
   ↓ Extract JWT token
5. Client → GET /api/kuliah?tahun=2025&semester=2 (with token header)
   ↓ Verify token works
6. Save token for subsequent API calls
```

---

## Common Patterns

### Request Headers

```
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...
token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json (for POST/PUT)
```

### Pagination

ETHOL API does not use standard pagination. Most endpoints return full datasets filtered by query parameters (tahun, semester, kuliah, etc.).

### File Downloads

File downloads use blob response type:

```javascript
$axios({ url: fileUrl, method: "GET", responseType: "blob" })
```

### Error Handling

```json
// Success (array response)
[{ "nomor": 1, ... }, ...]

// Success (object response)
{ "sukses": true, "data": ... }

// Error
{ "sukses": false, "pesan": "Error message" }
```

### WebSocket (Real-Time Notifications)

ETHOL uses **raw WebSocket** (NOT Socket.io) for real-time notifications via `vue-native-socket`.

**ETHOL WebSocket URL:**

```
wss://chat.ethol.pens.ac.id/socket
```

**Configuration (from Nuxt.js source):**

```javascript
Vue.use(VueNativeSocket, "wss://chat.ethol.pens.ac.id/socket", {
  store: store,
  format: "json",
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 3000,
});
```

**Vuex Store Mutations:**

| Mutation                 | Description                      |
| ------------------------ | -------------------------------- |
| `SOCKET_ONOPEN`          | WebSocket connection established |
| `SOCKET_ONCLOSE`         | WebSocket connection closed      |
| `SOCKET_ONERROR`         | WebSocket error occurred         |
| `SOCKET_ONMESSAGE`       | Message received from server     |
| `SOCKET_RECONNECT`       | Reconnection attempt             |
| `SOCKET_RECONNECT_ERROR` | Reconnection failed              |

**Environment Constants:**

```javascript
{
  SOCKET_URL: "wss://chat.ethol.pens.ac.id/socket",
  APP_URL: "https://ethol.pens.ac.id",
  FCM_SERVER_KEY: "AAAAylpBWHY:APA91b..."  // Firebase Cloud Messaging
}
```

> **Note:** ETHOL also uses **FCM (Firebase Cloud Messaging)** for push notifications (visible at `/admin/fcm-example`). The WebSocket is used for real-time attendance session notifications — when a lecturer opens attendance, connected students receive an instant notification.

### Academic Year Iteration

To fetch data across all academic years:

```javascript
const currentYear = new Date().getFullYear();
for (let y = currentYear - 2; y <= currentYear; y++) {
  for (let semester of [1, 2]) {
    // GET /api/kuliah?tahun={y}&semester={semester}
  }
}
```

---

## Endpoint Summary

| Domain             | GET    | POST   | PUT    | DELETE | Total   |
| ------------------ | ------ | ------ | ------ | ------ | ------- |
| Kuliah             | 3      | 1      | 0      | 0      | **4**   |
| Tugas              | 4      | 2      | 3      | 0      | **9**   |
| Presensi (Student) | 3      | 1      | 0      | 0      | **4**   |
| Presensi (Admin)   | 5      | 1      | 2      | 0      | **8**   |
| Quiz (Student)     | 3      | 2      | 0      | 0      | **5**   |
| Dosen Quiz         | 3      | 8      | 6      | 6      | **23**  |
| Ujian              | 4      | 4      | 3      | 0      | **11**  |
| Forum              | 1      | 2      | 1      | 2      | **6**   |
| Materi             | 4      | 2      | 0      | 0      | **6**   |
| Video              | 2      | 1      | 1      | 0      | **4**   |
| Pengumuman         | 2      | 2      | 2      | 0      | **6**   |
| Notifikasi         | 4      | 0      | 2      | 0      | **6**   |
| Support            | 8      | 4      | 0      | 2      | **14**  |
| Jadwal             | 1      | 1      | 0      | 0      | **2**   |
| Conference         | 4      | 3      | 3      | 0      | **10**  |
| MIS/Reference      | 6      | 0      | 0      | 0      | **6**   |
| Other              | 2      | 2      | 0      | 0      | **4**   |
| **Total**          | **56** | **35** | **23** | **10** | **124** |

---

## Generic ETHOL Proxy (Our Backend)

Our NestJS backend exposes a generic proxy that forwards any request to the ETHOL API. This allows you to call **any** of the 124 endpoints above without implementing dedicated backend routes.

### Base URL

```
http://localhost:4000/api/proxy/{ethol_path}
```

Where `{ethol_path}` is the ETHOL API path **without** the `/api/` prefix.

### Available Methods

```
GET    /api/proxy/{path}   → GET    https://ethol.pens.ac.id/api/{path}
POST   /api/proxy/{path}   → POST   https://ethol.pens.ac.id/api/{path}
PUT    /api/proxy/{path}   → PUT    https://ethol.pens.ac.id/api/{path}
DELETE /api/proxy/{path}   → DELETE https://ethol.pens.ac.id/api/{path}
```

### Authentication

You must be logged in first via `POST /api/login`. The proxy automatically attaches the stored JWT token to all forwarded requests.

### Token Endpoint

```
GET /api/token
```

Returns the raw JWT token for use in external tools (e.g., Postman, curl).

**Response:**

```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### Examples

#### List academic programs

```bash
curl http://localhost:4000/api/proxy/program
```

#### Get today's day info

```bash
curl http://localhost:4000/api/proxy/hari/today
```

#### Get course participants

```bash
curl "http://localhost:4000/api/proxy/kuliah/peserta-kuliah?kuliah=218868&jenis_schema=1"
```

#### Open attendance session (Lecturer)

```bash
curl -X POST http://localhost:4000/api/proxy/presensi/buka \
  -H "Content-Type: application/json" \
  -d '{"kuliah": 218868, "dosen": 12345, "jenis_schema": 1, "key": "randomKey123"}'
```

#### Close attendance session (Lecturer)

```bash
curl -X PUT http://localhost:4000/api/proxy/presensi/tutup \
  -H "Content-Type: application/json" \
  -d '{"nomor": 456}'
```

#### Delete a forum post

```bash
curl -X DELETE http://localhost:4000/api/proxy/forum/123
```

### Query Parameters

Query parameters are passed through as-is:

```bash
# ETHOL: GET /api/kuliah?tahun=2025&semester=2
curl "http://localhost:4000/api/proxy/kuliah?tahun=2025&semester=2"
```

### Response Format

All proxy responses are wrapped:

```json
{
  "success": true,
  "data": { ... }  // Raw ETHOL API response
}
```

### Error Responses

```json
// Not logged in
{
  "success": false,
  "error": "Not logged in. Please login first."
}

// Session expired
{
  "success": false,
  "error": "Session expired. Please login again."
}

// ETHOL API error (forwarded as-is in data)
{
  "success": false,
  "error": "Proxy request failed",
  "statusCode": 403
}
```

---

## WebSocket Notification Gateway (Our Backend)

Our NestJS backend provides a raw WebSocket gateway that connects to ETHOL's upstream WebSocket and polls the REST notification API, forwarding all data to connected clients in real time.

### Connection

```
ws://localhost:4000/ws/notifications?token={JWT}
```

The `token` parameter is the raw JWT obtained from `GET /api/token` or from the login response.

### Get Your Token

```bash
curl http://localhost:4000/api/token
```

### Event Types

| Event                | Direction        | Description                                      |
| -------------------- | ---------------- | ------------------------------------------------ |
| `connected`          | Server to Client | Connection established, welcome message          |
| `notifications`      | Server to Client | Polled notification list (initial + every 30s)   |
| `ethol_message`      | Server to Client | Real-time message forwarded from ETHOL WebSocket |
| `ethol_ws_connected` | Server to Client | Upstream ETHOL WebSocket connection established  |
| `error`              | Server to Client | Error message (e.g., missing token)              |

### Notification Payload

The `notifications` event contains grouped arrays for each type: `presensi`, `tugas`, `materi`, `video`, plus an `unread_count` object.

Each notification item has: `idNotifikasi`, `keterangan` (description), `status`, `urlWeb`, `kodeNotifikasi`, `dataTerkait`, `createdAt`, `waktuNotifikasi` (relative time), `createdAtIndonesia` (formatted date).

### Bot Example (Node.js)

```javascript
const WebSocket = require('ws');
const res = await fetch('http://localhost:4000/api/token');
const { token } = await res.json();
const ws = new WebSocket(
  'ws://localhost:4000/ws/notifications?token=' + token
);
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === 'notifications') {
    for (const group of msg.data) {
      if (group.type === 'unread_count') continue;
      for (const item of group.data) {
        console.log('[' + group.type + '] ' + item.keterangan);
      }
    }
  }
});
```

### Bot Example (Python)

```python
import asyncio, json, aiohttp, websockets

async def main():
    async with aiohttp.ClientSession() as session:
        async with session.get('http://localhost:4000/api/token') as resp:
            data = await resp.json()
            token = data['token']
    uri = f'ws://localhost:4000/ws/notifications?token={token}'
    async with websockets.connect(uri) as ws:
        async for raw in ws:
            msg = json.loads(raw)
            if msg['type'] == 'notifications':
                for group in msg['data']:
                    if group['type'] == 'unread_count':
                        continue
                    for item in group['data']:
                        print(f'[{group["type"]}] {item["keterangan"]}')

asyncio.run(main())
```

### Connection Lifecycle

1. Client connects with `?token=JWT`
2. Server validates token, sends `connected` welcome message
3. Server connects to upstream ETHOL WebSocket (`wss://chat.ethol.pens.ac.id/socket`)
4. Server fetches initial notifications from REST API and sends `notifications` event
5. Server polls REST API every 30 seconds, sends updated `notifications`
6. Any real-time ETHOL WebSocket messages are forwarded as `ethol_message`
7. On disconnect, server cleans up upstream connection when no clients remain
8. Upstream WebSocket reconnects up to 5 times with 3-second delay

---

> **Disclaimer:** This documentation was reverse-engineered from ETHOL's Nuxt.js frontend JavaScript bundles. Request/response schemas are inferred from client-side code and may not be 100% complete. Some admin-only endpoints may have additional parameters not visible in the frontend code. The notification endpoints and WebSocket gateway have been verified with real credentials.

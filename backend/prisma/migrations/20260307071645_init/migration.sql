-- CreateEnum
CREATE TYPE "HomeworkStatus" AS ENUM ('not_submitted', 'on_time', 'late');

-- CreateTable
CREATE TABLE "students" (
    "id" SERIAL NOT NULL,
    "external_id" INTEGER,
    "nim" TEXT NOT NULL,
    "name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subjects" (
    "id" SERIAL NOT NULL,
    "external_id" INTEGER NOT NULL,
    "student_id" INTEGER NOT NULL,
    "kuliah_asal" INTEGER NOT NULL,
    "jenis_schema" INTEGER NOT NULL,
    "subject_name" TEXT NOT NULL,
    "dosen" TEXT,
    "gelar_dpn" TEXT,
    "gelar_blk" TEXT,
    "nip_dosen" TEXT,
    "nomor_dosen" INTEGER,
    "kode_kelas" TEXT NOT NULL,
    "pararel" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedules" (
    "id" SERIAL NOT NULL,
    "external_id" INTEGER,
    "subject_id" INTEGER NOT NULL,
    "hari" TEXT NOT NULL,
    "jam_awal" TEXT NOT NULL,
    "jam_akhir" TEXT NOT NULL,
    "nomor_hari" INTEGER NOT NULL,
    "nomor_ruang" INTEGER,
    "ruang" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "homeworks" (
    "id" SERIAL NOT NULL,
    "external_id" INTEGER NOT NULL,
    "subject_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "deadline_indonesia" TEXT NOT NULL,
    "submission_time" TIMESTAMP(3),
    "submission_time_indonesia" TEXT,
    "status" "HomeworkStatus" NOT NULL DEFAULT 'not_submitted',
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "homeworks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendances" (
    "id" SERIAL NOT NULL,
    "external_id" INTEGER NOT NULL,
    "subject_id" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "key" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "students_nim_key" ON "students"("nim");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_student_id_external_id_key" ON "subjects"("student_id", "external_id");

-- CreateIndex
CREATE INDEX "schedules_subject_id_idx" ON "schedules"("subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "schedules_subject_id_hari_jam_awal_jam_akhir_nomor_hari_key" ON "schedules"("subject_id", "hari", "jam_awal", "jam_akhir", "nomor_hari");

-- CreateIndex
CREATE INDEX "homeworks_subject_id_idx" ON "homeworks"("subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "homeworks_subject_id_external_id_key" ON "homeworks"("subject_id", "external_id");

-- CreateIndex
CREATE INDEX "attendances_subject_id_idx" ON "attendances"("subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendances_subject_id_external_id_key" ON "attendances"("subject_id", "external_id");

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homeworks" ADD CONSTRAINT "homeworks_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

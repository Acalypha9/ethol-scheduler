function parseIndexArg(args, prefix) {
  if (!Array.isArray(args)) {
    return null;
  }

  const regex = new RegExp(`^${prefix}(\\d+)$`, "i");
  for (const value of args) {
    const text = String(value || "").trim();
    const match = text.match(regex);
    if (match) {
      return Number(match[1]);
    }
  }

  return null;
}

function getTaskUsageMessage() {
  return [
    "Format /task:",
    "- /task -> tampilkan tugas yang deadline-nya belum lewat",
    "- /task y{nomor} s{nomor} -> tampilkan riwayat tugas berdasarkan urutan tahun dan semester",
    "",
    "Contoh:",
    "- /task",
    "- /task y2 s1",
    "",
    "Catatan: argumen y{} dan s{} harus dipakai bersama.",
  ].join("\n");
}

function validateTaskArgs(args) {
  const tokens = Array.isArray(args)
    ? args
      .slice(1)
      .map((value) => String(value || "").trim())
      .filter((value) => value.length > 0)
    : [];

  if (tokens.length === 0) {
    return {
      isValid: true,
      useHistoryFilter: false,
      yearIndex: null,
      semesterIndex: null,
    };
  }

  if (tokens.length !== 2) {
    return {
      isValid: false,
      message: getTaskUsageMessage(),
    };
  }

  const yearIndex = parseIndexArg(tokens, "y");
  const semesterIndex = parseIndexArg(tokens, "s");

  if (yearIndex === null || semesterIndex === null) {
    return {
      isValid: false,
      message: getTaskUsageMessage(),
    };
  }

  const hasOnlyValidTokens = tokens.every((token) => /^y\d+$/i.test(token) || /^s\d+$/i.test(token));
  if (!hasOnlyValidTokens) {
    return {
      isValid: false,
      message: getTaskUsageMessage(),
    };
  }

  return {
    isValid: true,
    useHistoryFilter: true,
    yearIndex,
    semesterIndex,
  };
}

function toNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function getDeadlineDate(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const candidates = [
    item.deadline,
    item.tanggalDeadline,
    item.dueDate,
    item.batasWaktu,
  ];

  for (const value of candidates) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

function hasUpcomingDeadline(item, now = Date.now()) {
  const deadline = getDeadlineDate(item);
  if (!deadline) {
    return false;
  }

  return deadline.getTime() > now;
}

function getTaskTitle(item) {
  if (!item || typeof item !== "object") {
    return "Tugas tanpa judul";
  }

  return (
    item.judul ||
    item.title ||
    item.namaTugas ||
    item.tugas ||
    "Tugas tanpa judul"
  );
}

function getTaskSubjectName(item) {
  if (!item || typeof item !== "object") {
    return "";
  }

  const rawSubject =
    item.subjectName ||
    item.subject ||
    item.namaMatakuliah ||
    item.namaMatkul ||
    item.mataKuliah ||
    item.matkul ||
    item.matakuliah?.nama ||
    "";

  return typeof rawSubject === "string" ? rawSubject.trim() : "";
}

function isPendingTask(item) {
  if (!item || typeof item !== "object") {
    return false;
  }

  if (typeof item.not_submitted === "boolean") {
    return item.not_submitted;
  }

  if (typeof item.isDone === "boolean") {
    return !item.isDone;
  }

  if (typeof item.submitted === "boolean") {
    return !item.submitted;
  }

  const status = String(item.status || "").trim().toLowerCase();
  if (!status) {
    return true;
  }

  return status !== "done" && status !== "completed";
}

function pickIndexedValue(values, index) {
  if (!Number.isInteger(index) || index < 1) {
    return null;
  }

  const uniqueSorted = [...new Set(values)]
    .map((value) => toNumber(value))
    .filter((value) => value !== null)
    .sort((a, b) => a - b);

  return uniqueSorted[index - 1] ?? null;
}

function getIsoWeek(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }

  const jakartaDate = getJakartaCalendarDate(date);
  if (!jakartaDate) {
    return null;
  }

  const day = jakartaDate.getUTCDay() || 7;
  jakartaDate.setUTCDate(jakartaDate.getUTCDate() + 4 - day);

  const yearStart = new Date(Date.UTC(jakartaDate.getUTCFullYear(), 0, 1));
  return Math.ceil(((jakartaDate - yearStart) / 86400000 + 1) / 7);
}

function getAcademicYear(item) {
  return toNumber(item && typeof item === "object" ? item.tahun : null);
}

function getAcademicSemester(item) {
  return toNumber(
    item && typeof item === "object"
      ? item.semester ?? item.smt ?? item.semesterKe
      : null
  );
}

function getSemesterGroupKey(item) {
  const tahun = getAcademicYear(item);
  const semester = getAcademicSemester(item);

  if (tahun === null || semester === null) {
    return null;
  }

  return `${tahun}:${semester}`;
}

function getWeekStartUtcTimestamp(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }

  const jakartaDate = getJakartaCalendarDate(date);
  if (!jakartaDate) {
    return null;
  }

  const day = jakartaDate.getUTCDay() || 7;
  jakartaDate.setUTCDate(jakartaDate.getUTCDate() - day + 1);
  jakartaDate.setUTCHours(0, 0, 0, 0);

  return jakartaDate.getTime();
}

function buildSemesterWeekMaps(tasks) {
  const rawBuckets = new Map();

  for (const item of tasks) {
    const deadline = getDeadlineDate(item);
    const semesterKey = getSemesterGroupKey(item);
    const weekStart = deadline ? getWeekStartUtcTimestamp(deadline) : null;

    if (!semesterKey || weekStart === null) {
      continue;
    }

    if (!rawBuckets.has(semesterKey)) {
      rawBuckets.set(semesterKey, new Set());
    }

    rawBuckets.get(semesterKey).add(weekStart);
  }

  const weekMaps = new Map();

  for (const [semesterKey, bucketSet] of rawBuckets.entries()) {
    const weekMap = new Map();
    const sortedBuckets = [...bucketSet].sort((a, b) => a - b);

    sortedBuckets.forEach((bucket, index) => {
      weekMap.set(bucket, index + 1);
    });

    weekMaps.set(semesterKey, weekMap);
  }

  return weekMaps;
}

const INDONESIAN_MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

const INDONESIAN_WEEKDAYS = [
  "Minggu",
  "Senin",
  "Selasa",
  "Rabu",
  "Kamis",
  "Jumat",
  "Sabtu",
];

function pad2(value) {
  return String(value).padStart(2, "0");
}

function getJakartaCalendarDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);

  if (!year || !month || !day) {
    return null;
  }

  return new Date(Date.UTC(year, month - 1, day));
}

function getJakartaTimeParts(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }

  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;

  if (!hour || !minute) {
    return null;
  }

  return { hour, minute };
}

function formatIndonesianDateUTC(date) {
  const jakartaDate = getJakartaCalendarDate(date);
  if (!jakartaDate) {
    return "🗓️ Tanpa Deadline";
  }

  const weekdayName = INDONESIAN_WEEKDAYS[jakartaDate.getUTCDay()] || "";
  const day = pad2(jakartaDate.getUTCDate());
  const monthName = INDONESIAN_MONTHS[jakartaDate.getUTCMonth()] || "";
  const year = jakartaDate.getUTCFullYear();
  return `🗓️ ${weekdayName}, ${day} ${monthName} ${year}`.trim();
}

function formatTimeUTC(date) {
  const timeParts = getJakartaTimeParts(date);
  if (!timeParts) {
    return "Tidak tersedia";
  }

  return `${timeParts.hour}:${timeParts.minute}`;
}

function buildGroupedOutput(tasks, options = {}) {
  const emptyMessage =
    typeof options.emptyMessage === "string" && options.emptyMessage.trim()
      ? options.emptyMessage
      : "📝 Tidak ada tugas yang cocok.";

  if (!tasks.length) {
    return emptyMessage;
  }

  const useSemesterWeekNumbering = Boolean(options.useSemesterWeekNumbering);

  const sortedTasks = [...tasks].sort((a, b) => {
    const aDate = getDeadlineDate(a);
    const bDate = getDeadlineDate(b);
    const aTime = aDate ? aDate.getTime() : Number.POSITIVE_INFINITY;
    const bTime = bDate ? bDate.getTime() : Number.POSITIVE_INFINITY;

    if (aTime !== bTime) {
      return bTime - aTime;
    }

    return String(getTaskTitle(a)).localeCompare(String(getTaskTitle(b)));
  });

  const lines = [];
  let currentWeekKey = "";
  let currentDateKey = "";
  const semesterWeekMaps = useSemesterWeekNumbering
    ? buildSemesterWeekMaps(sortedTasks)
    : new Map();

  for (const item of sortedTasks) {
    const deadline = getDeadlineDate(item);
    const semesterKey = getSemesterGroupKey(item);
    const weekNumber = (() => {
      if (!deadline) {
        return null;
      }

      if (!useSemesterWeekNumbering || !semesterKey) {
        return getIsoWeek(deadline);
      }

      const weekStart = getWeekStartUtcTimestamp(deadline);
      const semesterWeekMap = semesterWeekMaps.get(semesterKey);

      if (weekStart === null || !semesterWeekMap) {
        return getIsoWeek(deadline);
      }

      return semesterWeekMap.get(weekStart) ?? getIsoWeek(deadline);
    })();
    const weekKey = weekNumber === null ? "WEEK-TANPA-DEADLINE" : `WEEK-${weekNumber}`;
    const dateKey = deadline ? formatIndonesianDateUTC(deadline) : "🗓️ Tanpa Deadline";

    if (weekKey !== currentWeekKey) {
      if (lines.length) {
        lines.push("");
      }
      lines.push(weekKey);
      currentWeekKey = weekKey;
      currentDateKey = "";
    }

    if (dateKey !== currentDateKey) {
      lines.push(dateKey);
      currentDateKey = dateKey;
    }

    const timeText = deadline ? formatTimeUTC(deadline) : "Tidak tersedia";
    const taskTitle = getTaskTitle(item);
    const subjectName = getTaskSubjectName(item);
    const displayTitle = subjectName
      ? `${taskTitle} (${subjectName})`
      : taskTitle;

    lines.push(`- ${displayTitle} - ${timeText}`);
  }

  return lines.join("\n");
}

function processTaskCommand(homeworkList, args) {
  const list = Array.isArray(homeworkList) ? homeworkList : [];
  const validation = validateTaskArgs(args);

  if (!validation.isValid) {
    return validation.message;
  }

  const { yearIndex, semesterIndex, useHistoryFilter } = validation;

  let filtered = [...list];

  if (yearIndex !== null) {
    const selectedYear = pickIndexedValue(
      filtered.map((item) => (item && typeof item === "object" ? item.tahun : null)),
      yearIndex
    );

    if (selectedYear === null) {
      return "📝 Tidak ada tugas yang cocok.";
    }

    filtered = filtered.filter((item) => {
      const year = toNumber(item && typeof item === "object" ? item.tahun : null);
      return year === selectedYear;
    });
  }

  if (semesterIndex !== null) {
    const selectedSemester = pickIndexedValue(
      filtered.map((item) =>
        item && typeof item === "object"
          ? item.semester ?? item.smt ?? item.semesterKe
          : null
      ),
      semesterIndex
    );

    if (selectedSemester === null) {
      return "📝 Tidak ada tugas yang cocok.";
    }

    filtered = filtered.filter((item) => {
      const semester = toNumber(
        item && typeof item === "object"
          ? item.semester ?? item.smt ?? item.semesterKe
          : null
      );
      return semester === selectedSemester;
    });
  }

  if (!useHistoryFilter) {
    filtered = filtered.filter((item) => {
      return hasUpcomingDeadline(item) && isPendingTask(item);
    });
  }

  filtered.sort((a, b) => {
    const aDate = getDeadlineDate(a);
    const bDate = getDeadlineDate(b);
    const aTime = aDate ? aDate.getTime() : Number.POSITIVE_INFINITY;
    const bTime = bDate ? bDate.getTime() : Number.POSITIVE_INFINITY;
    return bTime - aTime;
  });

  return buildGroupedOutput(filtered, {
    emptyMessage: useHistoryFilter
      ? "📝 Tidak ada tugas yang cocok."
      : "📝 Tidak ada tugas tersedia.",
    useSemesterWeekNumbering: true,
  });
}

module.exports = {
  getTaskUsageMessage,
  processTaskCommand,
  validateTaskArgs,
};

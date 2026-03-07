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

  const utcDate = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);

  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  return Math.ceil(((utcDate - yearStart) / 86400000 + 1) / 7);
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

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatIndonesianDateUTC(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "🗓️ Tanpa Deadline";
  }

  const day = pad2(date.getUTCDate());
  const monthName = INDONESIAN_MONTHS[date.getUTCMonth()] || "";
  const year = date.getUTCFullYear();
  return `🗓️ ${day} ${monthName} ${year}`.trim();
}

function formatTimeUTC(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "Tidak tersedia";
  }

  const hour = pad2(date.getUTCHours());
  const minute = pad2(date.getUTCMinutes());
  return `${hour}:${minute}`;
}

function buildGroupedOutput(tasks) {
  if (!tasks.length) {
    return "📝 Tidak ada tugas yang cocok.";
  }

  const sortedTasks = [...tasks].sort((a, b) => {
    const aDate = getDeadlineDate(a);
    const bDate = getDeadlineDate(b);
    const aTime = aDate ? aDate.getTime() : Number.POSITIVE_INFINITY;
    const bTime = bDate ? bDate.getTime() : Number.POSITIVE_INFINITY;

    if (aTime !== bTime) {
      return aTime - bTime;
    }

    return String(getTaskTitle(a)).localeCompare(String(getTaskTitle(b)));
  });

  const lines = [];
  let currentWeekKey = "";
  let currentDateKey = "";

  for (const item of sortedTasks) {
    const deadline = getDeadlineDate(item);
    const weekNumber = deadline ? getIsoWeek(deadline) : null;
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
    lines.push(`- ${getTaskTitle(item)} - ${timeText}`);
  }

  return lines.join("\n");
}

function processTaskCommand(homeworkList, args) {
  const list = Array.isArray(homeworkList) ? homeworkList : [];

  const yearIndex = parseIndexArg(args, "y");
  const semesterIndex = parseIndexArg(args, "s");
  const useHistoryFilter = yearIndex !== null || semesterIndex !== null;

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
      const deadline = getDeadlineDate(item);
      return Boolean(deadline) && isPendingTask(item);
    });
  }

  filtered.sort((a, b) => {
    const aDate = getDeadlineDate(a);
    const bDate = getDeadlineDate(b);
    const aTime = aDate ? aDate.getTime() : Number.POSITIVE_INFINITY;
    const bTime = bDate ? bDate.getTime() : Number.POSITIVE_INFINITY;
    return aTime - bTime;
  });

  return buildGroupedOutput(filtered);
}

module.exports = {
  processTaskCommand,
};

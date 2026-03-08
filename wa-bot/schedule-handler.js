const DAY_ID_TO_NAME = {
  1: "Senin",
  2: "Selasa",
  3: "Rabu",
  4: "Kamis",
  5: "Jumat",
  6: "Sabtu",
  7: "Minggu",
};

const DAY_NAME_ALIASES = {
  senin: "Senin",
  selasa: "Selasa",
  rabu: "Rabu",
  kamis: "Kamis",
  jumat: "Jumat",
  "jum'at": "Jumat",
  sabtu: "Sabtu",
  minggu: "Minggu",
  monday: "Senin",
  tuesday: "Selasa",
  wednesday: "Rabu",
  thursday: "Kamis",
  friday: "Jumat",
  saturday: "Sabtu",
  sunday: "Minggu",
};

const ORDERED_DAYS = [
  "Senin",
  "Selasa",
  "Rabu",
  "Kamis",
  "Jumat",
  "Sabtu",
  "Minggu",
  "Lainnya",
];

const DAY_NAME_TO_ID = Object.fromEntries(
  Object.entries(DAY_ID_TO_NAME).map(([id, name]) => [name, Number(id)]),
);

function normalizeDayName(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return DAY_NAME_ALIASES[normalized] || value;
}

function getDayNameFromSchedule(item) {
  if (!item || typeof item !== "object") {
    return "Lainnya";
  }

  const candidates = [item.hari, item.hariNama, item.dayName, item.day];
  for (const candidate of candidates) {
    const normalized = normalizeDayName(candidate);
    if (normalized) {
      return normalized;
    }
  }

  const dayIdRaw = item.hariId ?? item.dayId;
  const dayId = Number(dayIdRaw);
  if (!Number.isNaN(dayId) && DAY_ID_TO_NAME[dayId]) {
    return DAY_ID_TO_NAME[dayId];
  }

  return "Lainnya";
}

function getCurrentJakartaContext(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const dayName = normalizeDayName(weekday) || "Lainnya";

  return {
    dayName,
    dayId: DAY_NAME_TO_ID[dayName] ?? null,
    currentMinutes:
      Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null,
  };
}

function getTodayInfo(now = new Date()) {
  const context = getCurrentJakartaContext(now);

  return {
    dayId: context.dayId,
    dayName: context.dayName,
  };
}

function parseTimeText(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const match = value.match(/(\d{1,2}):(\d{2})/);
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }

  return {
    text: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    minutes: hour * 60 + minute,
  };
}

function getScheduleTimeRange(item) {
  const rawStart = item?.jamMulai || item?.jamAwal || item?.startTime || item?.mulai || null;
  const rawEnd = item?.jamSelesai || item?.jamAkhir || item?.endTime || item?.selesai || null;

  const parsedStart = parseTimeText(rawStart);
  const parsedEnd = parseTimeText(rawEnd);
  if (parsedStart && parsedEnd) {
    return {
      startText: parsedStart.text,
      endText: parsedEnd.text,
      startMinutes: parsedStart.minutes,
      endMinutes: parsedEnd.minutes,
    };
  }

  const waktu = typeof item?.waktu === "string" ? item.waktu : null;
  if (waktu) {
    const matches = waktu.match(/(\d{1,2}:\d{2})/g) || [];
    const fallbackStart = parseTimeText(matches[0] || null);
    const fallbackEnd = parseTimeText(matches[1] || null);
    if (fallbackStart && fallbackEnd) {
      return {
        startText: fallbackStart.text,
        endText: fallbackEnd.text,
        startMinutes: fallbackStart.minutes,
        endMinutes: fallbackEnd.minutes,
      };
    }
  }

  return {
    startText: null,
    endText: null,
    startMinutes: null,
    endMinutes: null,
  };
}

function getScheduleSubject(item) {
  return (
    item?.subjectName ||
    item?.subject ||
    item?.namaMatkul ||
    item?.mataKuliah ||
    item?.matkul ||
    item?.nama ||
    "Mata kuliah tidak diketahui"
  );
}

function getScheduleRoom(item) {
  return item?.ruangan || item?.ruang || item?.kelas || item?.room || "-";
}

function isScheduleOngoing(item, currentContext) {
  if (!currentContext || currentContext.currentMinutes === null) {
    return false;
  }

  if (getDayNameFromSchedule(item) !== currentContext.dayName) {
    return false;
  }

  const { startMinutes, endMinutes } = getScheduleTimeRange(item);
  if (startMinutes === null || endMinutes === null) {
    return false;
  }

  return currentContext.currentMinutes >= startMinutes && currentContext.currentMinutes < endMinutes;
}

function compareScheduleItems(a, b) {
  const aTime = getScheduleTimeRange(a);
  const bTime = getScheduleTimeRange(b);

  if (aTime.startMinutes !== null && bTime.startMinutes !== null && aTime.startMinutes !== bTime.startMinutes) {
    return aTime.startMinutes - bTime.startMinutes;
  }

  if (aTime.startMinutes !== null) {
    return -1;
  }

  if (bTime.startMinutes !== null) {
    return 1;
  }

  return String(getScheduleSubject(a)).localeCompare(String(getScheduleSubject(b)));
}

function formatScheduleEntry(item, index, currentContext) {
  const subject = getScheduleSubject(item);
  const room = getScheduleRoom(item);
  const { startText, endText } = getScheduleTimeRange(item);
  const timeLabel = startText && endText ? `${startText} - ${endText}` : "Tidak tersedia";
  const active = isScheduleOngoing(item, currentContext);

  return [
    `${index}. ${subject} - ${room}`,
    `${active ? "🟢" : "*"} ${timeLabel}${active ? " - BERLANGSUNG" : ""}`,
  ];
}

function buildDayScheduleLines(dayName, items, currentContext) {
  const lines = [`🗓️ ${dayName}`];
  const sortedItems = [...items].sort(compareScheduleItems);

  sortedItems.forEach((item, index) => {
    lines.push(...formatScheduleEntry(item, index + 1, currentContext));
  });

  return lines;
}

function buildWeeklyScheduleReply(scheduleList, now = new Date()) {
  const grouped = new Map();

  for (const item of scheduleList) {
    const dayName = getDayNameFromSchedule(item);
    if (!grouped.has(dayName)) {
      grouped.set(dayName, []);
    }
    grouped.get(dayName).push(item);
  }

  const currentContext = getCurrentJakartaContext(now);
  const sections = [];

  for (const dayName of ORDERED_DAYS) {
    const items = grouped.get(dayName);
    if (!items || items.length === 0) {
      continue;
    }

    sections.push(buildDayScheduleLines(dayName, items, currentContext).join("\n"));
  }

  return sections.join("\n\n");
}

function buildTodayScheduleReply(scheduleList, now = new Date()) {
  const today = getTodayInfo(now);
  const todaySchedule = scheduleList.filter((item) => {
    const dayId = Number(item?.hariId ?? item?.dayId);
    if (!Number.isNaN(dayId) && today.dayId !== null) {
      return dayId === today.dayId;
    }

    return getDayNameFromSchedule(item) === today.dayName;
  });

  if (todaySchedule.length === 0) {
    return `🗓️ Tidak ada jadwal untuk hari ini (${today.dayName}).`;
  }

  return buildDayScheduleLines(today.dayName, todaySchedule, getCurrentJakartaContext(now)).join("\n");
}

module.exports = {
  buildTodayScheduleReply,
  buildWeeklyScheduleReply,
  getDayNameFromSchedule,
  getTodayInfo,
};

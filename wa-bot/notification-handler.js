function extractNotificationPayload(data) {
  return data && typeof data === "object" ? data : {};
}

function getNotificationMessageText(data) {
  const payload = extractNotificationPayload(data);

  return (
    payload.keterangan ||
    payload.message ||
    payload.pesan ||
    (typeof data === "string" ? data : "(no message)")
  );
}

function getNotificationTimeText(data) {
  const payload = extractNotificationPayload(data);
  return payload.waktuNotifikasi || payload.createdAtIndonesia || payload.createdAt || "baru saja";
}

function getNotificationSubjectText(data) {
  const payload = extractNotificationPayload(data);
  return payload.dataTerkait || payload.subjectName || payload.nomor || "-";
}

function getMentionTargetIds(participants, selfId) {
  if (!Array.isArray(participants)) {
    return [];
  }

  const selfIds = new Set();
  if (typeof selfId === "string" && selfId.trim()) {
    selfIds.add(selfId);
    selfIds.add(`${selfId.split("@")[0]}@c.us`);
  }

  const seen = new Set();
  const ids = [];

  for (const participant of participants) {
    const serializedId =
      typeof participant === "string"
        ? participant
        : participant?.id?._serialized || null;
    const userId =
      typeof participant === "object" && participant !== null
        ? participant?.id?.user || participant?.user || null
        : null;
    const mentionId =
      typeof serializedId === "string" && serializedId.endsWith("@c.us")
        ? serializedId
        : typeof userId === "string" && userId.trim()
          ? `${userId}@c.us`
          : null;

    if (!mentionId) {
      continue;
    }

    if (selfIds.has(mentionId) || seen.has(mentionId)) {
      continue;
    }

    seen.add(mentionId);
    ids.push(mentionId);
  }

  return ids;
}

function formatMentionHandle(serializedId) {
  if (typeof serializedId !== "string" || !serializedId.trim()) {
    return "user";
  }

  return serializedId.split("@")[0] || "user";
}

function buildMentionPrefix(mentionIds) {
  if (!Array.isArray(mentionIds) || mentionIds.length === 0) {
    return "";
  }

  return mentionIds.map((id) => `@${formatMentionHandle(id)}`).join(" ");
}

function shouldMentionAll(type) {
  return String(type || "").trim().toLowerCase() === "presensi";
}

function buildNotificationBody(eventName, type, data) {
  const notificationType = String(type || "unknown").toLowerCase();
  const isTaskReminder = notificationType === "tugas";
  const title = isTaskReminder
    ? "⏰ Reminder Tugas Hampir Deadline"
    : eventName === "realtime_notification"
      ? "ETHOL Realtime Notification"
      : "ETHOL Notification";

  const lines = [title, ""];

  if (isTaskReminder) {
    lines.push("Segera cek /task sebelum deadline terlewat.");
    lines.push("");
  }

  lines.push(`Type: ${notificationType}`);
  lines.push(`Message: ${getNotificationMessageText(data)}`);
  lines.push(`Time: ${getNotificationTimeText(data)}`);
  lines.push(`Mata Kuliah: ${getNotificationSubjectText(data)}`);

  return lines.join("\n");
}

function buildNotificationText(eventName, type, data, mentionIds = []) {
  const mentionPrefix = shouldMentionAll(type) ? buildMentionPrefix(mentionIds) : "";
  const body = buildNotificationBody(eventName, type, data);

  return mentionPrefix ? `${mentionPrefix}\n\n${body}` : body;
}

module.exports = {
  buildNotificationBody,
  buildNotificationText,
  getMentionTargetIds,
  shouldMentionAll,
};

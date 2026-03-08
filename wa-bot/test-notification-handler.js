const assert = require("node:assert/strict");
const {
  buildNotificationBody,
  buildNotificationText,
  getMentionTargetIds,
  shouldMentionAll,
} = require("./notification-handler");

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

runTest("task notifications are formatted as deadline reminders", () => {
  const output = buildNotificationBody("new_notification", "tugas", {
    keterangan: "Deadline tugas minggu 3 segera berakhir",
    waktuNotifikasi: "5 menit lalu",
    subjectName: "Bahasa Indonesia",
  });

  assert.match(output, /⏰ Reminder Tugas Hampir Deadline/);
  assert.match(output, /Segera cek \/task sebelum deadline terlewat\./);
  assert.match(output, /Type: tugas/);
  assert.match(output, /Message: Deadline tugas minggu 3 segera berakhir/);
  assert.match(output, /Time: 5 menit lalu/);
  assert.match(output, /Mata Kuliah: Bahasa Indonesia/);
});

runTest("mention target list excludes self invalid entries and duplicates", () => {
  const mentionIds = getMentionTargetIds(
    [
      { id: { _serialized: "6281111111111@c.us", user: "6281111111111" } },
      { id: { _serialized: "6281111111111@c.us", user: "6281111111111" } },
      { id: { _serialized: "6282222222222@c.us", user: "6282222222222" } },
      { id: { _serialized: "120363000000000000@g.us" } },
      { id: { _serialized: "6283333333333@lid", user: "6283333333333" } },
    ],
    "6282222222222@lid"
  );

  assert.deepEqual(mentionIds, [
    "6281111111111@c.us",
    "6283333333333@c.us",
  ]);
});

runTest("attendance notifications include visible mentions when targets are provided", () => {
  const output = buildNotificationText(
    "new_notification",
    "presensi",
    {
      keterangan: "Presensi dibuka untuk kelas hari ini",
      createdAtIndonesia: "Selasa, 03 Maret 2026 - 22:00:00",
      dataTerkait: "Bahasa Indonesia",
    },
    ["6281111111111@c.us", "6282222222222@c.us"]
  );

  assert.match(output, /^@6281111111111 @6282222222222/m);
  assert.match(output, /ETHOL Notification/);
  assert.match(output, /Message: Presensi dibuka untuk kelas hari ini/);
});

runTest("task reminder notifications do not include visible mentions", () => {
  const output = buildNotificationText(
    "new_notification",
    "tugas",
    {
      keterangan: "Deadline tugas hampir habis",
      createdAtIndonesia: "Selasa, 03 Maret 2026 - 22:00:00",
      subjectName: "Bahasa Indonesia",
    },
    ["6281111111111@c.us", "6282222222222@c.us"]
  );

  assert.doesNotMatch(output, /^@6281111111111 @6282222222222/m);
  assert.match(output, /⏰ Reminder Tugas Hampir Deadline/);
  assert.match(output, /Message: Deadline tugas hampir habis/);
});

runTest("mention helper only enables @all for attendance notifications", () => {
  assert.equal(shouldMentionAll("presensi"), true);
  assert.equal(shouldMentionAll("PRESENSI"), true);
  assert.equal(shouldMentionAll("tugas"), false);
  assert.equal(shouldMentionAll("materi"), false);
});

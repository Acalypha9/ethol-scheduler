const assert = require("node:assert/strict");
const {
  buildTodayScheduleReply,
  buildWeeklyScheduleReply,
} = require("./schedule-handler");

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

const scheduleList = [
  {
    subjectName: "Workshop Pemrograman Perangkat Bergerak",
    ruang: "C 206",
    jamMulai: "08:00",
    jamSelesai: "10:00",
    hari: "Senin",
  },
  {
    subjectName: "Praktek Kecerdasan Buatan",
    ruang: "C 203",
    jamMulai: "10:30",
    jamSelesai: "12:30",
    hari: "Senin",
  },
  {
    subjectName: "Workshop Aplikasi dan Komputasi Awan",
    ruang: "C 303",
    jamMulai: "13:50",
    jamSelesai: "15:50",
    hari: "Senin",
  },
  {
    subjectName: "Bahasa Indonesia",
    ruang: "B 303",
    jamMulai: "11:20",
    jamSelesai: "12:40",
    hari: "Selasa",
  },
];

runTest("weekly schedule uses numbered format and room", () => {
  const output = buildWeeklyScheduleReply(scheduleList, new Date("2026-03-09T00:00:00Z"));

  assert.match(output, /🗓️ Senin/);
  assert.match(output, /1\. Workshop Pemrograman Perangkat Bergerak - C 206/);
  assert.match(output, /\* 08:00 - 10:00/);
  assert.match(output, /2\. Praktek Kecerdasan Buatan - C 203/);
  assert.match(output, /3\. Workshop Aplikasi dan Komputasi Awan - C 303/);
  assert.match(output, /🗓️ Selasa/);
});

runTest("active class is marked as berlangsung only during the class", () => {
  const activeOutput = buildWeeklyScheduleReply(scheduleList, new Date("2026-03-09T07:10:00Z"));
  const inactiveOutput = buildWeeklyScheduleReply(scheduleList, new Date("2026-03-09T09:55:00Z"));

  assert.match(activeOutput, /3\. Workshop Aplikasi dan Komputasi Awan - C 303\n🟢 13:50 - 15:50 - BERLANGSUNG/);
  assert.doesNotMatch(inactiveOutput, /BERLANGSUNG/);
  assert.match(inactiveOutput, /3\. Workshop Aplikasi dan Komputasi Awan - C 303\n\* 13:50 - 15:50/);
});

runTest("today schedule shows the same format for the active day only", () => {
  const output = buildTodayScheduleReply(scheduleList, new Date("2026-03-09T02:00:00Z"));

  assert.match(output, /^🗓️ Senin/m);
  assert.match(output, /1\. Workshop Pemrograman Perangkat Bergerak - C 206/);
  assert.doesNotMatch(output, /Bahasa Indonesia/);
});

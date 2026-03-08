const assert = require("node:assert/strict");
const {
  getTaskUsageMessage,
  processTaskCommand,
  validateTaskArgs,
} = require("./task-handler");

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

const homeworkList = [
  {
    judul: "Algebra Worksheet",
    deadline: "2026-01-15T09:00:00Z",
    status: "in_progress",
    subjectName: "Bahasa Indonesia",
    tahun: 2023,
    semester: 1,
  },
  {
    title: "Physics Lab",
    tanggalDeadline: "2026-01-15T13:00:00Z",
    not_submitted: true,
    subjectName: "Fisika Terapan",
    tahun: 2024,
    semester: 1,
  },
  {
    namaTugas: "History Essay",
    dueDate: "2026-01-16T08:00:00Z",
    isDone: false,
    subjectName: "Sejarah Indonesia",
    tahun: 2024,
    semester: 2,
  },
  {
    tugas: "Legacy Completed",
    batasWaktu: "2026-01-14T08:00:00Z",
    status: "completed",
    subjectName: "Algoritma",
    tahun: 2024,
    semester: 1,
  },
  {
    judul: "Old Pending",
    deadline: "2025-12-20T08:00:00Z",
    status: "pending",
    subjectName: "Basis Data",
    tahun: 2024,
    semester: 1,
  },
  {
    judul: "No Deadline Archive",
    deadline: null,
    status: "pending",
    tahun: 2024,
    semester: 1,
  },
  {
    judul: "Submitted Final",
    deadline: "2026-01-17T08:00:00Z",
    submitted: true,
    subjectName: "Kimia",
    tahun: 2025,
    semester: 1,
  },
  {
    judul: "Done By Flag",
    deadline: "2026-01-18T08:00:00Z",
    isDone: true,
    subjectName: "Biologi",
    tahun: 2025,
    semester: 2,
  },
  {
    judul: "not_submitted false",
    deadline: "2026-01-19T08:00:00Z",
    not_submitted: false,
    subjectName: "Ekonomi",
    tahun: 2025,
    semester: 2,
  },
  {
    tugas: "Calculus Project",
    deadline: "2026-01-13T08:00:00Z",
    status: "",
    subjectName: "Matematika Diskrit",
    tahun: 2025,
    semester: 1,
  },
];

const realNow = Date.now;
Date.now = () => new Date("2026-01-10T00:00:00Z").getTime();

try {
  runTest("default view shows only pending future tasks", () => {
    const output = processTaskCommand(homeworkList, ["/task"]);

    assert.match(output, /WEEK-\d+/);
    assert.match(output, /🗓️ Jumat, 16 Januari 2026/);
    assert.match(output, /🗓️ Kamis, 15 Januari 2026/);
    assert.match(output, /🗓️ Selasa, 13 Januari 2026/);
    assert.match(output, /Calculus Project \(Matematika Diskrit\) - 15:00/);
    assert.match(output, /Algebra Worksheet \(Bahasa Indonesia\) - 16:00/);
    assert.match(output, /Physics Lab \(Fisika Terapan\) - 20:00/);
    assert.match(output, /History Essay \(Sejarah Indonesia\) - 15:00/);
    assert.doesNotMatch(output, /Old Pending/);
    assert.doesNotMatch(output, /Legacy Completed/);
    assert.doesNotMatch(output, /No Deadline Archive/);
    assert.doesNotMatch(output, /Submitted Final/);
  });

  runTest("expired pending tasks are hidden from default view", () => {
    const output = processTaskCommand(
      [
        { judul: "Expired", deadline: "2026-01-09T23:59:00Z", status: "pending" },
        { judul: "Upcoming", deadline: "2026-01-10T00:01:00Z", status: "pending" },
      ],
      ["/task"],
    );

    assert.doesNotMatch(output, /Expired/);
    assert.match(output, /Upcoming/);
  });

  runTest("default view uses available-message when no active task remains", () => {
    const output = processTaskCommand(
      [{ judul: "Expired", deadline: "2026-01-09T23:59:00Z", status: "pending" }],
      ["/task"]
    );

    assert.equal(output, "📝 Tidak ada tugas tersedia.");
  });

  runTest("history view still allows archived tasks by indexed filters", () => {
    const output = processTaskCommand(homeworkList, ["/task", "y2", "s1"]);

    assert.match(output, /^WEEK-2/m);
    assert.match(output, /WEEK-1/);
    assert.match(output, /Old Pending/);
    assert.match(output, /Legacy Completed/);
    assert.match(output, /No Deadline Archive/);
    assert.ok(output.indexOf("Physics Lab") < output.indexOf("Old Pending"));
  });

  runTest("semester week numbering resets when switching semesters", () => {
    const output = processTaskCommand(
      [
        { judul: "Semester 1 - Week 1", deadline: "2026-01-05T08:00:00Z", status: "pending", tahun: 2024, semester: 1 },
        { judul: "Semester 1 - Week 2", deadline: "2026-01-12T08:00:00Z", status: "pending", tahun: 2024, semester: 1 },
        { judul: "Semester 2 - Week 1", deadline: "2026-02-02T08:00:00Z", status: "pending", tahun: 2024, semester: 2 },
      ],
      ["/task", "y1", "s2"],
    );

    assert.match(output, /^WEEK-1/m);
    assert.doesNotMatch(output, /WEEK-2/);
    assert.match(output, /Semester 2 - Week 1/);
  });

  runTest("incomplete single history arg returns usage help", () => {
    const output = processTaskCommand(homeworkList, ["/task", "y10"]);
    assert.equal(output, getTaskUsageMessage());
  });

  runTest("out-of-range full history filter returns no-match message", () => {
    const output = processTaskCommand(homeworkList, ["/task", "y10", "s1"]);
    assert.equal(output, "📝 Tidak ada tugas yang cocok.");
  });

  runTest("incomplete history args return usage help", () => {
    const output = processTaskCommand(homeworkList, ["/task", "y2"]);
    assert.equal(output, getTaskUsageMessage());
  });

  runTest("malformed history args return usage help", () => {
    const output = processTaskCommand(homeworkList, ["/task", "semester1", "y2"]);
    assert.equal(output, getTaskUsageMessage());
  });

  runTest("task args validator accepts default and strict history formats only", () => {
    assert.deepEqual(validateTaskArgs(["/task"]), {
      isValid: true,
      useHistoryFilter: false,
      yearIndex: null,
      semesterIndex: null,
    });

    assert.deepEqual(validateTaskArgs(["/task", "y2", "s1"]), {
      isValid: true,
      useHistoryFilter: true,
      yearIndex: 2,
      semesterIndex: 1,
    });

    assert.equal(validateTaskArgs(["/task", "y2"]).isValid, false);
  });
} finally {
  Date.now = realNow;
}

const assert = require("node:assert/strict");
const { formatMaterialReply } = require("./material-handler");

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

runTest("formats latest material notifications in descending order", () => {
  const output = formatMaterialReply([
    {
      keterangan: "Materi Week 1 uploaded",
      createdAt: "2026-03-01T07:00:00Z",
      createdAtIndonesia: "Minggu, 01 Maret 2026 - 14:00:00",
      dataTerkait: "218872-4",
    },
    {
      keterangan: "Materi Week 2 uploaded",
      createdAt: "2026-03-02T07:00:00Z",
      waktuNotifikasi: "2 jam lalu",
      urlWeb: "/materi/2",
    },
  ]);

  assert.match(output, /^📚 Materi Terbaru/m);
  assert.ok(output.indexOf("Materi Week 2 uploaded") < output.indexOf("Materi Week 1 uploaded"));
  assert.match(output, /🕒 2 jam lalu/);
  assert.doesNotMatch(output, /🔖/);
  assert.doesNotMatch(output, /🔗/);
});

runTest("returns empty-state message when no material is available", () => {
  assert.equal(formatMaterialReply([]), "📚 Materi belum tersedia.");
});

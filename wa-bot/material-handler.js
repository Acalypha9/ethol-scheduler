function getMaterialTimestamp(item) {
  if (!item || typeof item !== "object") {
    return 0;
  }

  const candidates = [item.createdAt, item.created_at, item.tanggal, item.updatedAt];
  for (const value of candidates) {
    const timestamp = new Date(value).getTime();
    if (!Number.isNaN(timestamp)) {
      return timestamp;
    }
  }

  return 0;
}

function getMaterialTitle(item) {
  if (!item || typeof item !== "object") {
    return "Materi tanpa keterangan";
  }

  return item.keterangan || item.title || item.nama || "Materi tanpa keterangan";
}

function getMaterialTimeLabel(item) {
  if (!item || typeof item !== "object") {
    return "Waktu tidak tersedia";
  }

  return item.createdAtIndonesia || item.waktuNotifikasi || item.createdAt || "Waktu tidak tersedia";
}

function formatMaterialReply(items, options = {}) {
  const list = Array.isArray(items) ? items.filter((item) => item && typeof item === "object") : [];
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 10;

  if (!list.length) {
    return "📚 Materi belum tersedia.";
  }

  const lines = ["📚 Materi Terbaru", ""];
  const sortedItems = [...list]
    .sort((a, b) => getMaterialTimestamp(b) - getMaterialTimestamp(a))
    .slice(0, limit);

  sortedItems.forEach((item, index) => {
    lines.push(`${index + 1}. ${getMaterialTitle(item)}`);
    lines.push(`   🕒 ${getMaterialTimeLabel(item)}`);

    if (index < sortedItems.length - 1) {
      lines.push("");
    }
  });

  return lines.join("\n");
}

module.exports = {
  formatMaterialReply,
};

const express = require("express");
const qrcode = require("qrcode-terminal");
const { Client, LocalAuth } = require("whatsapp-web.js");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const {
  buildNotificationText,
  getMentionTargetIds,
  shouldMentionAll,
} = require("./notification-handler");
const {
  getTaskUsageMessage,
  processTaskCommand,
  validateTaskArgs,
} = require("./task-handler");
const { formatMaterialReply } = require("./material-handler");
const {
  buildTodayScheduleReply,
  buildWeeklyScheduleReply,
} = require("./schedule-handler");

for (const envPath of [
  path.resolve(__dirname, "..", ".env"),
  path.resolve(__dirname, ".env"),
]) {
  if (fs.existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const WA_AUTH_DATA_PATH = path.resolve(__dirname, ".wwebjs_auth");

const app = express();
const port = Number(process.env.BOT_PORT || "3005");
const TARGET_CHAT_ID = process.env.TARGET_CHAT_ID || "6281295698121@c.us";
const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:4000";
const NOTIFICATION_WS_BASE = process.env.NOTIFICATION_WS_URL || "ws://127.0.0.1:4000/ws/notifications";
const NOTIFICATION_WS_RECONNECT_MS = 5000;
const RECENT_NOTIFICATION_TTL_MS = 60_000;
const MAX_SEEN_NOTIFICATION_IDS = 5000;
const GROUP_MENTION_CACHE_TTL_MS = 300_000;
const MAX_PENDING_MESSAGES = 500;
const BOT_PUBLIC_BASE_URL = process.env.BOT_PUBLIC_BASE_URL || `http://localhost:${port}`;
const WA_HEADLESS = !["0", "false", "no", "off"].includes(
  String(process.env.WA_HEADLESS || "true").trim().toLowerCase()
);

function extractData(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!payload || typeof payload !== "object") {
    return [];
  }
  if (Array.isArray(payload.data)) {
    return payload.data;
  }
  if (Array.isArray(payload.result)) {
    return payload.result;
  }
  if (Array.isArray(payload.items)) {
    return payload.items;
  }
  return [];
}

async function fetchJson(endpoint) {
  try {
    const response = await axios.get(`${API_BASE_URL}${endpoint}`);
    return response.data;
  } catch (error) {
    throw new Error(`Request failed: ${error.response?.status || error.message}`);
  }
}

function formatTaskItem(item) {
  if (!item || typeof item !== "object") {
    return `- ${JSON.stringify(item)}`;
  }
  const title =
    item.judul || item.title || item.namaTugas || item.tugas || "Tugas tanpa judul";
  const deadlineRaw =
    item.deadline || item.tanggalDeadline || item.dueDate || item.batasWaktu;
  const deadline = deadlineRaw ? String(deadlineRaw) : "Tidak tersedia";
  return `📝 ${title}\n📅 Deadline: ${deadline}`;
}

function getAttendancePercentage(item) {
  if (!item || typeof item !== "object") {
    return "-";
  }
  const raw =
    item.persentase ??
    item.attendancePercentage ??
    item.attendanceRate ??
    item.presentase;
  if (typeof raw === "number") {
    return `${raw}%`;
  }
  if (typeof raw === "string") {
    return raw.includes("%") ? raw : `${raw}%`;
  }

  const hadir = Number(item.hadir ?? item.totalHadir);
  const total = Number(item.totalPertemuan ?? item.total);
  if (!Number.isNaN(hadir) && !Number.isNaN(total) && total > 0) {
    const value = ((hadir / total) * 100).toFixed(1);
    return `${value}%`;
  }

  return "-";
}

function getChromePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function extractNotificationItems(payload) {
  if (Array.isArray(payload)) {
    return payload.filter((item) => item && typeof item === "object");
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  if (Array.isArray(payload.data)) {
    return payload.data.filter((item) => item && typeof item === "object");
  }

  return [];
}

function getNotificationKey(type, data) {
  if (data && typeof data === "object") {
    if (data.idNotifikasi) {
      return `${type}:${data.idNotifikasi}`;
    }

    if (data.createdAt && data.keterangan) {
      return `${type}:${data.createdAt}:${data.keterangan}`;
    }
  }

  return `${type}:${JSON.stringify(data)}`;
}

function pruneRecentNotificationKeys(cache) {
  const now = Date.now();

  for (const [key, timestamp] of cache.entries()) {
    if (now - timestamp > RECENT_NOTIFICATION_TTL_MS) {
      cache.delete(key);
    }
  }
}

function rememberSeenNotification(key) {
  if (seenNotificationIds.has(key)) {
    return;
  }

  seenNotificationIds.add(key);

  while (seenNotificationIds.size > MAX_SEEN_NOTIFICATION_IDS) {
    const oldestKey = seenNotificationIds.values().next().value;
    if (!oldestKey) {
      break;
    }
    seenNotificationIds.delete(oldestKey);
  }
}

function buildHelpMessage() {
  return [
    "🤴🏿 SULISBOT ETHOL Bot Commands",
    "",
    "🗓️ /today - tampilkan jadwal hari ini",
    "📚 /schedule - tampilkan semua jadwal",
    "📝 /task - tampilkan list tugas",
    "📝 /task y{} s{} - tampilkan riwayat tugas (/task y2 s1)",
    "📚 /materi - tampilkan materi terbaru",
    "🆘 /help - tampilkan daftar perintah",
    // "📊 /absensi - tampilkan ringkasan absensi",
    "",
    "REMINDER NOTIFAKASI AKTIF 24/7"
  ].join("\n");
}

const chromePath = getChromePath();

if (!chromePath) {
  console.error("Chrome not found.");
  console.error("Install Google Chrome first, then run this script again.");
  process.exit(1);
}

console.log("Using Chrome at:", chromePath);
console.log(`WhatsApp browser mode: ${WA_HEADLESS ? "headless" : "visible"}`);

app.use(express.json());

let waReady = false;
let notificationWs = null;
let notificationReconnectTimer = null;
let notificationSeeded = false;
let notificationConnecting = false;
const seenNotificationIds = new Set();
const recentNotificationKeys = new Map();
const pendingMessages = [];
let mentionCache = {
  chatId: "",
  mentionIds: [],
  expiresAt: 0,
};

async function getNotificationMentionIds() {
  if (!waReady) {
    return [];
  }

  if (
    mentionCache.chatId === TARGET_CHAT_ID &&
    mentionCache.expiresAt > Date.now() &&
    Array.isArray(mentionCache.mentionIds)
  ) {
    return mentionCache.mentionIds;
  }

  try {
    const chat = await waClient.getChatById(TARGET_CHAT_ID);
    if (!chat?.isGroup || !Array.isArray(chat.participants)) {
      mentionCache = {
        chatId: TARGET_CHAT_ID,
        mentionIds: [],
        expiresAt: Date.now() + GROUP_MENTION_CACHE_TTL_MS,
      };
      return [];
    }

    const selfId = waClient.info?.wid?._serialized || "";
    const mentionIds = getMentionTargetIds(chat.participants, selfId);
    mentionCache = {
      chatId: TARGET_CHAT_ID,
      mentionIds,
      expiresAt: Date.now() + GROUP_MENTION_CACHE_TTL_MS,
    };
    return mentionIds;
  } catch (error) {
    console.error("[Bot WA] Failed to resolve mention targets:", error.message || error);
    return [];
  }
}

async function sendPreparedMessage(payload) {
  if (typeof payload === "string") {
    await waClient.sendMessage(TARGET_CHAT_ID, payload);
    return;
  }

  if (payload && payload.kind === "notification") {
    const mentionIds = shouldMentionAll(payload.type)
      ? await getNotificationMentionIds()
      : [];
    const text = buildNotificationText(
      payload.eventName,
      payload.type,
      payload.data,
      mentionIds
    );
    const options = mentionIds.length > 0 ? { mentions: mentionIds } : undefined;
    await waClient.sendMessage(TARGET_CHAT_ID, text, options);
    return;
  }

  if (payload && typeof payload === "object" && typeof payload.text === "string") {
    await waClient.sendMessage(TARGET_CHAT_ID, payload.text, payload.options);
    return;
  }

  throw new Error("Unsupported outbound message payload");
}

async function sendOrQueueMessage(message) {
  if (!waReady) {
    pendingMessages.push(message);
    while (pendingMessages.length > MAX_PENDING_MESSAGES) {
      pendingMessages.shift();
    }
    return;
  }

  await sendPreparedMessage(message);
}

async function flushPendingMessages() {
  const failedMessages = [];

  while (pendingMessages.length > 0) {
    const message = pendingMessages.shift();
    if (!message) {
      continue;
    }

    try {
      await sendPreparedMessage(message);
    } catch (error) {
      console.error("[Bot WA] Failed to flush queued message:", error.message || error);
      failedMessages.push(message);
    }
  }

  if (failedMessages.length > 0) {
    pendingMessages.unshift(...failedMessages);
  }
}

async function deliverNotification(eventName, type, data) {
  pruneRecentNotificationKeys(recentNotificationKeys);

  const key = getNotificationKey(type, data);
  if (recentNotificationKeys.has(key)) {
    return false;
  }

  await sendOrQueueMessage({
    kind: "notification",
    eventName,
    type,
    data,
  });
  rememberSeenNotification(key);
  recentNotificationKeys.set(key, Date.now());
  return true;
}

async function getBackendToken() {
  const payload = await fetchJson("/api/token");
  if (!payload || typeof payload !== "object" || !payload.token) {
    throw new Error("Token endpoint did not return a usable token");
  }

  return String(payload.token);
}

function scheduleNotificationReconnect() {
  if (notificationReconnectTimer) {
    return;
  }

  notificationReconnectTimer = setTimeout(() => {
    notificationReconnectTimer = null;
    void connectNotificationStream();
  }, NOTIFICATION_WS_RECONNECT_MS);
}

async function handleNotificationSnapshot(payload) {
  const groups = Array.isArray(payload) ? payload : [];
  const freshNotifications = [];
  const pendingKeys = new Set();

  for (const group of groups) {
    if (!group || typeof group !== "object") {
      continue;
    }

    if (!Array.isArray(group.data) || !group.type || group.type === "unread_count") {
      continue;
    }

    for (const item of extractNotificationItems(group.data)) {
      const itemType = String(group.type);
      const key = getNotificationKey(itemType, item);

      if (!notificationSeeded) {
        rememberSeenNotification(key);
        continue;
      }

      if (seenNotificationIds.has(key)) {
        continue;
      }

      if (pendingKeys.has(key)) {
        continue;
      }

      pendingKeys.add(key);
      freshNotifications.push({ key, type: itemType, data: item });
    }
  }

  if (!notificationSeeded) {
    notificationSeeded = true;
    console.log(`[Bot WS] Seeded ${seenNotificationIds.size} notification IDs from initial snapshot`);
    return;
  }

  for (const notification of freshNotifications) {
    try {
      const sent = await deliverNotification("new_notification", notification.type, notification.data);
      if (sent) {
        console.log(`[Bot WS] Sent ${notification.type}: ${notification.data.keterangan || "(no message)"}`);
      }
    } catch (error) {
      console.error(
        `[Bot WS] Failed to send ${notification.type}:`,
        error.message || error
      );
    }
  }
}

async function connectNotificationStream() {
  if (notificationConnecting) {
    return;
  }

  try {
    if (notificationWs && (notificationWs.readyState === WebSocket.OPEN || notificationWs.readyState === WebSocket.CONNECTING)) {
      return;
    }

    notificationConnecting = true;

    const token = await getBackendToken();
    const wsUrl = new URL(NOTIFICATION_WS_BASE);
    wsUrl.searchParams.set("token", token);

    notificationWs = new WebSocket(wsUrl);

    notificationWs.onopen = () => {
      notificationConnecting = false;
      console.log(`[Bot WS] Connected to notification stream at ${wsUrl.origin}${wsUrl.pathname}`);
    };

    notificationWs.onmessage = (event) => {
      void (async () => {
        try {
          const message = JSON.parse(event.data.toString());

          if (message.type === "notifications" && Array.isArray(message.data)) {
            await handleNotificationSnapshot(message.data);
          }
        } catch (error) {
          console.error("[Bot WS] Failed to process message:", error);
        }
      })();
    };

    notificationWs.onerror = (error) => {
      console.error("[Bot WS] Error:", error.message || error);
    };

    notificationWs.onclose = () => {
      notificationConnecting = false;
      notificationWs = null;
      console.log("[Bot WS] Connection closed, scheduling reconnect");
      scheduleNotificationReconnect();
    };
  } catch (error) {
    notificationConnecting = false;
    console.error("[Bot WS] Failed to connect:", error.message || error);
    scheduleNotificationReconnect();
  }
}

const waClient = new Client({
  authStrategy: new LocalAuth({
    dataPath: WA_AUTH_DATA_PATH,
  }),
  puppeteer: {
    headless: WA_HEADLESS,
    executablePath: chromePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

waClient.on("qr", (qr) => {
  console.log("Scan this QR with WhatsApp on your phone:");
  qrcode.generate(qr, { small: true });
});

waClient.on("ready", () => {
  console.log("WhatsApp client ready");
  waReady = true;
  void flushPendingMessages();
  void connectNotificationStream();
});

waClient.on("authenticated", () => {
  console.log("WhatsApp authenticated");
});

waClient.on("auth_failure", (msg) => {
  console.error("Auth failure:", msg);
});

waClient.on("disconnected", (reason) => {
  console.log("WhatsApp disconnected:", reason);
  waReady = false;
  mentionCache = {
    chatId: "",
    mentionIds: [],
    expiresAt: 0,
  };
});

waClient.on("message", async (msg) => {
  // console.log(msg)
  try {
    // if (msg.from !== TARGET_CHAT_ID) {
    //   console.log("eror chat_id")
    //   return;
    // }
    if (!msg.body || typeof msg.body !== "string") {
      console.log("eror")
      return;
    }

    const args = msg.body.trim().toLowerCase().split(/\s+/);
    const command = args[0];

    if (!command || !command.startsWith("/")) {
      return;
    }

    switch (command) {
      case "/help":
        await msg.reply(buildHelpMessage());
        break;

      case "/schedule":
        console.log("[Command] /schedule requested");
        try {
          const payload = await fetchJson("/api/schedule");
          const scheduleList = extractData(payload);

          if (!scheduleList.length) {
            await msg.reply("📚 Jadwal tidak tersedia.");
            break;
          }

          await msg.reply(buildWeeklyScheduleReply(scheduleList));
        } catch (error) {
          console.error("Failed to fetch /schedule:", error);
          await msg.reply("❌ Error fetching data");
        }
        break;

      case "/today":
        console.log("[Command] /today requested");
        try {
          const payload = await fetchJson("/api/schedule");
          const scheduleList = extractData(payload);
          await msg.reply(buildTodayScheduleReply(scheduleList));
        } catch (error) {
          console.error("Failed to fetch /today:", error);
          await msg.reply("❌ Error fetching data");
        }
        break;

      case "/task":
        console.log("[Command] /task requested");
        try {
          const validation = validateTaskArgs(args);
          if (!validation.isValid) {
            await msg.reply(getTaskUsageMessage());
            break;
          }

          const payload = await fetchJson("/api/homework");
          const homeworkList = extractData(payload);

          if (!homeworkList.length) {
            await msg.reply("📝 Tidak ada tugas tersedia.");
            break;
          }

          await msg.reply(
            "List Tugas:\n\n" + processTaskCommand(homeworkList, args)
          );
        } catch (error) {
          console.error("Failed to fetch /task:", error);
          await msg.reply("❌ Error fetching data");
        }
        break;

      case "/materi":
        console.log("[Command] /materi requested");
        try {
          const payload = await fetchJson(
            "/api/proxy/notifikasi/mahasiswa?filterNotif=MATERI"
          );
          const materialItems = extractData(payload);
          await msg.reply(formatMaterialReply(materialItems));
        } catch (error) {
          console.error("Failed to fetch /materi:", error);
          await msg.reply("❌ Error fetching data");
        }
        break;

      // case "/absensi":
      //   console.log("[Command] /absensi requested");
      //   try {
      //     const payload = await fetchJson("/api/attendance");
      //     const attendanceList = extractData(payload);

      //     if (!attendanceList.length) {
      //       await msg.reply("📊 Data absensi tidak tersedia.");
      //       break;
      //     }

      //     const lines = ["📊 Ringkasan Absensi", ""];
      //     for (const item of attendanceList) {
      //       const subject =
      //         item?.subjectName ||
      //         item?.subject ||
      //         item?.namaMatkul ||
      //         item?.mataKuliah ||
      //         item?.matkul ||
      //         "Mata kuliah tidak diketahui";
      //       const percentage = getAttendancePercentage(item);
      //       lines.push(`📊 ${subject}: ${percentage} attended`);
      //     }

      //     await msg.reply(lines.join("\n"));
      //   } catch (error) {
      //     console.error("Failed to fetch /absensi:", error);
      //     await msg.reply("❌ Error fetching data");
      //   }
      //   break;

      default:
        console.log(`[Command] Unknown command: ${command}`);
    }
  } catch (error) {
    console.error("Failed to handle WhatsApp command:", error);
    await msg.reply("⚠️ Failed to process command. Please try again.");
  }
});

app.post("/webhook", async (req, res) => {
  try {
    const payload = req.body;

    if (!payload || (payload.event !== "new_notification" && payload.event !== "realtime_notification")) {
      return res.status(400).json({ ok: false, error: "Invalid payload" });
    }

    const { event, type, data } = payload;
    const sent = await deliverNotification(String(event), String(type || "unknown"), data);
    console.log(`[Webhook] ${sent ? "Sent" : "Skipped duplicate"} ${type}: ${data?.keterangan || "(no message)"}`);

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Failed to send WhatsApp message:", error);
    return res.status(500).json({ ok: false, error: "Failed to send message" });
  }
});

app.listen(port, () => {
  console.log(`Webhook receiver listening on ${BOT_PUBLIC_BASE_URL}/webhook`);
});

waClient.initialize();

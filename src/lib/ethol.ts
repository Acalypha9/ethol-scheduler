import fs from "fs";
import path from "path";
import type { Subject, ScheduleEntry, CourseSchedule } from "./types";

const AUTH_FILE = path.join(process.cwd(), "auth.json");
const BASE_URL = "https://ethol.pens.ac.id";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const MAX_REDIRECTS = 15;

// ── Auth persistence ──────────────────────────────────────────────

interface AuthData {
  token: string;
  cookies: string;
}

function saveAuth(auth: AuthData): void {
  fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2));
}

function loadAuth(): AuthData | null {
  if (!fs.existsSync(AUTH_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function clearAuth(): void {
  if (fs.existsSync(AUTH_FILE)) fs.unlinkSync(AUTH_FILE);
}

// ── Cookie helpers ────────────────────────────────────────────────

function extractSetCookies(response: Response): string[] {
  const results: string[] = [];
  if (typeof response.headers.getSetCookie === "function") {
    for (const raw of response.headers.getSetCookie()) {
      const nameValue = raw.split(";")[0].trim();
      if (nameValue) results.push(nameValue);
    }
  }
  return results;
}

function mergeCookies(existing: string[], incoming: string[]): string[] {
  const map = new Map<string, string>();
  for (const c of [...existing, ...incoming]) {
    const name = c.split("=")[0];
    map.set(name, c);
  }
  return Array.from(map.values());
}

// ── Redirect-aware fetch ──────────────────────────────────────────

interface FollowResult {
  response: Response;
  cookies: string[];
  finalUrl: string;
}

async function fetchWithRedirects(
  url: string,
  cookies: string[],
  init?: { method?: string; contentType?: string; body?: string }
): Promise<FollowResult> {
  let currentUrl = url;
  let currentCookies = [...cookies];
  let method = init?.method ?? "GET";
  let body: string | undefined = init?.body;
  let contentType: string | undefined = init?.contentType;

  for (let i = 0; i < MAX_REDIRECTS; i++) {
    const headers: Record<string, string> = {
      "User-Agent": USER_AGENT,
      Cookie: currentCookies.join("; "),
    };
    if (contentType && method === "POST") {
      headers["Content-Type"] = contentType;
    }

    const res = await fetch(currentUrl, {
      method,
      headers,
      body: method === "POST" ? body : undefined,
      redirect: "manual",
      cache: "no-store",
    });

    currentCookies = mergeCookies(currentCookies, extractSetCookies(res));

    const status = res.status;
    if (status >= 300 && status < 400) {
      const location = res.headers.get("location");
      if (!location) {
        return { response: res, cookies: currentCookies, finalUrl: currentUrl };
      }
      currentUrl = new URL(location, currentUrl).href;
      // POST → redirect → GET (302/303). Preserve method only for 307/308.
      if (status !== 307 && status !== 308) {
        method = "GET";
        body = undefined;
        contentType = undefined;
      }
      continue;
    }

    return { response: res, cookies: currentCookies, finalUrl: currentUrl };
  }

  throw new Error("Too many redirects");
}

// ── Public API ────────────────────────────────────────────────────

export async function login(
  email: string,
  password: string
): Promise<void> {
  // 1. GET /cas → redirects through CAS → lands on CAS login page
  const {
    response: casPageRes,
    cookies: casCookies,
    finalUrl: casLoginUrl,
  } = await fetchWithRedirects(`${BASE_URL}/cas`, []);

  if (!casPageRes.ok) {
    throw new Error(
      `Failed to reach CAS login page (status ${casPageRes.status})`
    );
  }

  const casHtml = await casPageRes.text();

  // 2. Parse hidden form fields from the CAS login form
  const ltMatch = casHtml.match(/name="lt"\s+value="([^"]+)"/);
  const executionMatch = casHtml.match(
    /name="execution"\s+value="([^"]+)"/
  );

  const params = new URLSearchParams();
  params.append("username", email);
  params.append("password", password);
  if (ltMatch) params.append("lt", ltMatch[1]);
  if (executionMatch) params.append("execution", executionMatch[1]);
  params.append("_eventId", "submit");

  // 3. POST credentials → follow redirects back to ETHOL
  const {
    response: postRes,
    cookies: postCookies,
    finalUrl,
  } = await fetchWithRedirects(casLoginUrl, casCookies, {
    method: "POST",
    contentType: "application/x-www-form-urlencoded",
    body: params.toString(),
  });

  const html = await postRes.text();

  // Still on CAS login page → bad credentials
  if (
    finalUrl.includes("login.pens.ac.id") ||
    html.includes('class="errors"') ||
    html.includes("Invalid credentials")
  ) {
    throw new Error(
      "Invalid credentials. Please check your username and password."
    );
  }

  // 4. Extract JWT token
  //    ETHOL sets it via: localStorage.setItem('token', 'eyJ...')
  let token = "";

  const localStorageMatch = html.match(
    /localStorage\.setItem\(['"]token['"]\s*,\s*['"]([A-Za-z0-9._-]+)['"]\)/
  );
  if (localStorageMatch) {
    token = localStorageMatch[1];
  }

  if (!token) {
    throw new Error(
      "Login succeeded but could not extract auth token from ETHOL response."
    );
  }

  const cookieString = postCookies.join("; ");

  // 5. Verify API access before persisting
  const verifyRes = await fetch(
    `${BASE_URL}/api/kuliah?tahun=2025&semester=2`,
    {
      headers: { "User-Agent": USER_AGENT, token },
      redirect: "manual",
      cache: "no-store",
    }
  );

  const verifyText = await verifyRes.text();

  try {
    const verifyJson = JSON.parse(verifyText);
    if (verifyJson.sukses === false) {
      throw new Error(
        `ETHOL API rejected auth: ${verifyJson.pesan || "unknown error"}`
      );
    }
    if (!Array.isArray(verifyJson)) {
      throw new Error("ETHOL API did not return expected data.");
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("ETHOL API")) throw e;
    throw new Error(
      "ETHOL API returned non-JSON response — auth may not be valid."
    );
  }

  saveAuth({ token, cookies: cookieString });
}

export function isLoggedIn(): boolean {
  return loadAuth() !== null;
}

export async function fetchScheduleData(): Promise<CourseSchedule[]> {
  const auth = loadAuth();
  if (!auth) {
    throw new Error("Not logged in. Please login first.");
  }

  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    token: auth.token,
  };

  // Step 1: Fetch subjects
  const subjectsRes = await fetch(
    `${BASE_URL}/api/kuliah?tahun=2025&semester=2`,
    { headers, redirect: "manual", cache: "no-store" }
  );

  if (!subjectsRes.ok) {
    clearAuth();
    throw new Error(
      "Could not fetch subjects. Session may have expired — please login again."
    );
  }

  const subjects: Subject[] = await subjectsRes.json();

  if (!Array.isArray(subjects) || subjects.length === 0) {
    throw new Error(
      "Could not fetch subjects. Session may have expired — please login again."
    );
  }

  // Step 2: POST kuliah IDs to get schedule entries
  //   ETHOL expects: {kuliahs: [{nomor, jenisSchema}, ...], tahun, semester}
  const kuliahs = subjects.map((s) => ({
    nomor: s.nomor,
    jenisSchema: s.jenisSchema,
  }));

  const schedulesRes = await fetch(
    `${BASE_URL}/api/kuliah/hari-kuliah-in`,
    {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ kuliahs, tahun: 2025, semester: 2 }),
      redirect: "manual",
      cache: "no-store",
    }
  );

  if (!schedulesRes.ok) {
    throw new Error(
      "Could not fetch schedule entries. Please try again."
    );
  }

  const schedules: ScheduleEntry[] = await schedulesRes.json();

  // Step 3: Build lookup map and combine
  const subjectMap = new Map<number, Subject>();
  for (const subject of subjects) {
    subjectMap.set(subject.nomor, subject);
  }

  const courseSchedules: CourseSchedule[] = schedules
    .map((entry) => {
      const subject = subjectMap.get(entry.kuliah);
      if (!subject) return null;

      const dosenParts: string[] = [];
      if (subject.gelar_dpn) dosenParts.push(subject.gelar_dpn);
      if (subject.dosen) dosenParts.push(subject.dosen);
      if (subject.gelar_blk) dosenParts.push(subject.gelar_blk);
      const dosenTitle = dosenParts.join(" ").trim();

      return {
        id: entry.kuliah,
        subjectName: subject.matakuliah.nama,
        dosen: subject.dosen,
        dosenTitle: dosenTitle || "-",
        kodeKelas: subject.kode_kelas,
        pararel: subject.pararel,
        hari: entry.hari,
        jamAwal: entry.jam_awal,
        jamAkhir: entry.jam_akhir,
        nomorHari: entry.nomor_hari,
        ruang: entry.ruang,
      };
    })
    .filter((item): item is CourseSchedule => item !== null);

  return courseSchedules;
}

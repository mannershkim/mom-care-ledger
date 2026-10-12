const CATEGORIES = ["컨디션", "식사", "수면", "통증", "낙상·안전", "약", "기분", "외출", "기타"];
const SEVERITIES = ["기록", "살펴보기", "병원 상담"];
const STATUSES = ["예정", "다녀옴", "변경", "취소"];
const BLOOD_TYPES = ["", "A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-", "모름"];
const GENDERS = ["", "여", "남"];
const GLUCOSE_TIMINGS = ["공복", "아침 식전", "아침 식후", "점심 식전", "점심 식후", "저녁 식전", "저녁 식후", "취침", "기타"];

const localMode = ["127.0.0.1", "localhost"].includes(location.hostname);
const REPO = "mannershkim/mom-care-ledger";
const LEDGER_PATH = "data/ledger.json";

function githubToken() {
  try {
    return (localStorage.getItem("mom-ledger-github-token") || "").trim();
  } catch {
    return "";
  }
}

function canWrite() {
  return localMode || Boolean(githubToken());
}

function contentsUrl() {
  return `https://api.github.com/repos/${REPO}/contents/${LEDGER_PATH}`;
}

function githubHeaders(raw) {
  const headers = {
    Accept: raw ? "application/vnd.github.raw" : "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  const token = githubToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const KDF_ITERATIONS = 120000;

let state = null;
let vault = null;
let familyPassword = "";
let familyKey = null;
let pendingPlain = null;
let gateMode = null;
let serverReady = false;
let newerBackup = null;
let tab = "home";
let selectedDate = "";
let calendarYear = null;
let calendarMonth = null;
let editingEventId = null;
let editingAppointmentId = null;
let composingEvent = false;
let composingAppointment = false;
let composingGlucose = false;
let editingGlucoseId = null;
let eventCategory = "전체";
let eventSeverity = "전체";
let eventQuery = "";
let summaryDays = 30;
let formError = "";

const PROFILE_FIELDS = [
  "name", "birthDate", "gender", "bloodType", "phone", "address",
  "allergies", "conditions", "usualHospital", "usualDoctor", "insurance",
  "tellDoctor", "note"
];

document.addEventListener("click", onClick);
document.addEventListener("submit", onSubmit);
document.addEventListener("change", onChange);
document.addEventListener("input", onInput);

boot();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

async function boot() {
  if (localMode) {
    try {
      const res = await fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(1500) });
      serverReady = res.ok;
    } catch {
      serverReady = false;
    }
  }
  try {
    const raw = await fetchRawLedger();
    if (isLockedEnvelope(raw)) {
      vault = raw;
      const saved = rememberedPassword();
      const opened = saved ? await decryptEnvelope(saved, vault) : null;
      if (opened) {
        state = opened.state;
        familyKey = opened.key;
        familyPassword = saved;
        gateMode = null;
        render();
        return;
      } else {
        gateMode = "unlock";
        renderGate();
        return;
      }
    } else {
      pendingPlain = normalize(raw);
      gateMode = "setup";
      renderGate();
      return;
    }
  } catch {
    document.getElementById("app").innerHTML = `
      <div class="wrap"><div class="card">
        <h2>장부 파일을 열지 못했습니다</h2>
        <p>폴더 안의 <strong>start-ledger.bat</strong> 을 더블클릭해 열어 주세요.</p>
      </div></div>`;
    return;
  }
}

function blank() {
  return normalize({
    format: 1,
    demo: false,
    updatedAt: null,
    updatedBy: "",
    shareUrl: "",
    profile: { medications: [], contacts: [] },
    events: [],
    appointments: [],
    glucose: []
  });
}

function normalize(data) {
  const profile = { ...(data.profile || {}) };
  for (const key of PROFILE_FIELDS) {
    if (profile[key] == null) profile[key] = "";
  }
  profile.medications = Array.isArray(profile.medications) ? profile.medications : [];
  profile.contacts = Array.isArray(profile.contacts) ? profile.contacts : [];
  return {
    format: 1,
    demo: Boolean(data.demo),
    updatedAt: data.updatedAt || null,
    updatedBy: data.updatedBy || "",
    shareUrl: data.shareUrl || "",
    profile,
    events: Array.isArray(data.events) ? data.events : [],
    appointments: Array.isArray(data.appointments) ? data.appointments : [],
    glucose: Array.isArray(data.glucose) ? data.glucose : []
  };
}

function readBackup() {
  try {
    const backup = JSON.parse(localStorage.getItem("mom-ledger-backup") || "null");
    if (backup && backup.updatedAt && (!state.updatedAt || backup.updatedAt > state.updatedAt)) {
      newerBackup = normalize(backup);
    }
  } catch {
    newerBackup = null;
  }
}

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[ch]));
}

function textOf(value) {
  return esc(value).replace(/\n/g, "<br>");
}

function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 3400);
}

async function fetchRawLedger() {
  if (!localMode) {
    try {
      const res = await fetch(contentsUrl(), { headers: githubHeaders(true), cache: "no-store" });
      if (res.ok) return await res.json();
    } catch { /* 페이지에 포함된 파일을 대신 읽습니다. */ }
  }
  const res = await fetch("data/ledger.json?t=" + Date.now(), { cache: "no-store" });
  if (!res.ok) throw new Error("missing");
  return await res.json();
}

function isLockedEnvelope(data) {
  return Boolean(data && data.locked === true && data.format === 2 && data.salt && data.iv && data.data);
}

function rememberedPassword() {
  try {
    return localStorage.getItem("mom-ledger-pass") || "";
  } catch {
    return "";
  }
}

function rememberPassword(password, remember) {
  try {
    if (remember) localStorage.setItem("mom-ledger-pass", password);
    else localStorage.removeItem("mom-ledger-pass");
  } catch { /* 휴대폰에 암호를 기억하지 못해도 이번 화면에서는 열립니다. */ }
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function deriveKey(password, salt, iterations) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function decryptEnvelope(password, envelope) {
  try {
    const salt = base64ToBytes(envelope.salt);
    const iv = base64ToBytes(envelope.iv);
    const key = await deriveKey(password, salt, envelope.iterations || KDF_ITERATIONS);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      base64ToBytes(envelope.data)
    );
    return { state: normalize(JSON.parse(new TextDecoder().decode(plain))), key };
  } catch {
    return null;
  }
}

async function sealState(freshSalt) {
  if (!familyPassword) throw new Error("password");
  const salt = !freshSalt && vault && vault.salt
    ? base64ToBytes(vault.salt)
    : crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  if (freshSalt) familyKey = null;
  const key = familyKey || await deriveKey(familyPassword, salt, KDF_ITERATIONS);
  familyKey = key;
  const cipher = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(state))
  ));
  vault = {
    format: 2,
    locked: true,
    kdf: "PBKDF2",
    iterations: KDF_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(cipher)
  };
}

async function fetchLedger() {
  return fetchRawLedger();
}

async function commitLedger() {
  const headers = githubHeaders(false);
  const metaRes = await fetch(contentsUrl(), { headers, cache: "no-store" });
  if (metaRes.status === 401) throw new Error("token");
  if (!metaRes.ok) throw new Error("save failed");
  const meta = await metaRes.json();
  const put = await fetch(contentsUrl(), {
    method: "PUT",
    headers,
    body: JSON.stringify({
      message: state.updatedBy ? `기록 갱신 · ${state.updatedBy}` : "기록 갱신",
      content: toBase64(JSON.stringify(vault, null, 2) + "\n"),
      sha: meta.sha,
      branch: "main"
    })
  });
  if (put.status === 401) throw new Error("token");
  if (put.status === 409) throw new Error("conflict");
  if (!put.ok) throw new Error("save failed");
}

function saveErrorMessage(error) {
  if (error && error.message === "password") return "가족 암호가 없어 저장하지 못했습니다.";
  if (error && error.message === "needkey") return "기록을 남기려면 가족 키가 필요합니다. 보기만 할 때는 가족 암호만 있으면 됩니다.";
  if (error && error.message === "token") return "가족 키가 맞지 않습니다. github_pat_ 로 시작하는 키 전체를 다시 넣어 주세요.";
  if (error && error.message === "conflict") return "다른 사람이 방금 저장했습니다. 새로고침한 뒤 다시 남겨 주세요.";
  if (localMode) return "저장하지 못했습니다. 장부 창이 켜져 있는지 확인해 주세요.";
  return "GitHub 장부에 저장하지 못했습니다. 가족 키를 확인해 주세요.";
}

async function persist() {
  state.updatedAt = new Date().toISOString();
  state.updatedBy = localStorage.getItem("mom-ledger-author") || state.updatedBy || "";
  await sealState(false);
  try {
    localStorage.removeItem("mom-ledger-backup");
  } catch { /* 예전 기록이 없어도 됩니다. */ }
  newerBackup = null;
  if (serverReady) {
    const res = await fetch("/api/ledger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(vault)
    });
    if (!res.ok) throw new Error("save failed");
  }
  if (githubToken()) {
    await commitLedger();
    toast(serverReady ? "이 컴퓨터와 GitHub 장부에 저장했습니다." : "GitHub 장부에 저장했습니다. 형제 화면은 새로고침하면 보입니다.");
    return;
  }
  if (serverReady) {
    toast("이 컴퓨터 장부 파일에 저장했습니다.");
    return;
  }
  if (localMode) {
    downloadLedger();
    toast("장부 파일을 내려받았습니다. data 폴더의 ledger.json 과 바꾸면 됩니다.");
    return;
  }
  throw new Error("needkey");
}

function downloadLedger() {
  const payload = vault || state;
  const blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "ledger.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1500);
}

function formatWhen(value) {
  if (!value) return "";
  const [datePart, timePart] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  if (!year || !month || !day) return value;
  const date = new Date(year, month - 1, day);
  const week = "일월화수목금토"[date.getDay()];
  let time = "";
  if (timePart) {
    const [hh, mm] = timePart.split(":");
    const hour = Number(hh);
    const ap = hour < 12 ? "오전" : "오후";
    time = ` ${ap}\u00A0${hour % 12 || 12}:${mm}`;
  }
  return `${year}년 ${month}월 ${day}일 (${week})${time}`;
}

function formatStamp(iso) {
  if (!iso) return "아직 저장된 시각이 없습니다";
  const date = new Date(iso);
  const dateText = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(date);
  const timeText = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(date);
  const week = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", weekday: "short" }).format(date);
  return `${dateText} (${week}) ${timeText}`;
}

function ageFrom(birth) {
  if (!birth) return "";
  const [year, month, day] = birth.split("-").map(Number);
  if (!year) return "";
  const now = new Date();
  let age = now.getFullYear() - year;
  const todayMd = (now.getMonth() + 1) * 100 + now.getDate();
  if (todayMd < month * 100 + day) age -= 1;
  return age >= 0 ? `만 ${age}세` : "";
}

function dayDiff(value) {
  if (!value) return null;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const target = new Date(year, month - 1, day);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86400000);
}

function relativeDay(value) {
  const diff = dayDiff(value);
  if (diff == null || Number.isNaN(diff)) return "";
  if (diff === 0) return "오늘";
  if (diff === 1) return "내일";
  if (diff === -1) return "어제";
  if (diff > 1) return `${diff}일 뒤`;
  return `${Math.abs(diff)}일 전`;
}

function nowLocalValue() {
  const now = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T${p(now.getHours())}:${p(now.getMinutes())}`;
}

function brief(text, size = 48) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  return flat.length > size ? flat.slice(0, size) + "…" : flat;
}

function titleOf(event) {
  return event.title || brief(event.whatHappened, 36) || "기록";
}

function badgeClass(severity) {
  if (severity === "병원 상담") return "doctor";
  if (severity === "살펴보기") return "watch";
  return "";
}

function statusClass(status) {
  if (status === "다녀옴") return "done";
  if (status === "취소") return "";
  return "watch";
}

function byNewest(a, b) {
  return a.at < b.at ? 1 : a.at > b.at ? -1 : 0;
}

function bySoonest(a, b) {
  return a.at < b.at ? -1 : a.at > b.at ? 1 : 0;
}

function upcomingAppointments() {
  return state.appointments
    .filter((item) => item.status === "예정" || item.status === "변경")
    .slice()
    .sort(bySoonest);
}

function filteredEvents() {
  const query = eventQuery.trim();
  return state.events
    .filter((event) => eventCategory === "전체" || event.category === eventCategory)
    .filter((event) => eventSeverity === "전체" || event.severity === eventSeverity)
    .filter((event) => {
      if (!query) return true;
      const haystack = [event.title, event.whatHappened, event.actionTaken, event.recordedBy, event.category].join(" ");
      return haystack.includes(query);
    })
    .slice()
    .sort(byNewest);
}

function doctorEvents() {
  return state.events
    .filter((event) => event.showDoctor)
    .filter((event) => {
      if (!summaryDays) return true;
      const diff = dayDiff(event.at);
      return diff != null && diff <= 0 && diff >= -summaryDays;
    })
    .slice()
    .sort(byNewest);
}

function rememberAuthor(name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return;
  try {
    localStorage.setItem("mom-ledger-author", trimmed);
  } catch { /* 이름 기억은 실패해도 기록 저장은 계속됩니다. */ }
}

function authorOptions() {
  const names = new Set(state.events.map((event) => event.recordedBy).filter(Boolean));
  const saved = localStorage.getItem("mom-ledger-author");
  if (saved) names.add(saved);
  return [...names];
}

function isBlank(book) {
  const profile = book.profile;
  return !profile.name && !profile.birthDate && book.events.length === 0
    && book.appointments.length === 0 && book.glucose.length === 0 && profile.medications.length === 0;
}

function renderGate() {
  document.title = "어머니 돌봄 장부";
  const setup = gateMode === "setup";
  document.getElementById("app").innerHTML = `
    <div class="wrap">
      <header class="mast">
        <div class="seal" aria-hidden="true">돌봄</div>
        <div>
          <p class="eyebrow">가족 기록</p>
          <h1>어머니 돌봄 장부</h1>
          <p class="sub">가족 암호를 아는 사람만 내용을 볼 수 있습니다.</p>
        </div>
      </header>
      <form class="card" data-form="${setup ? "create-pass" : "unlock"}" autocomplete="off">
        <h2>${setup ? "가족 암호 만들기" : "가족 암호"}</h2>
        <p class="hint">${setup
          ? "암호를 정하면 장부 글이 잠깁니다. 암호를 잊으면 기록을 다시 열 수 없습니다."
          : "형제끼리 정한 암호를 넣으면 장부가 열립니다."}</p>
        <label style="margin-top:12px">가족 암호
          <input name="password" type="password" autocomplete="${setup ? "new-password" : "current-password"}" required>
        </label>
        ${setup ? `<label>암호 다시 입력<input name="again" type="password" autocomplete="new-password" required></label>` : ""}
        <label class="check">
          <input type="checkbox" name="remember" checked>
          이 휴대폰에 암호 기억하기
        </label>
        <div class="actions" style="margin-top:12px">
          <button class="btn" type="submit">${setup ? "암호로 잠그기" : "장부 열기"}</button>
        </div>
        ${setup && !canWrite() ? `<p class="hint">암호로 잠그려면 먼저 아래 가족 키를 넣습니다.</p>` : ""}
      </form>
      ${setup && !localMode ? renderFamilyKey() : ""}
    </div>`;
}

function render(options = {}) {
  const keepScroll = options.keepScroll ? window.scrollY : 0;
  const name = state.profile.name ? `${state.profile.name} 님` : "어머니";
  document.title = state.profile.name ? `${state.profile.name} 돌봄 장부` : "어머니 돌봄 장부";
  document.getElementById("app").innerHTML = `
    <div class="wrap">
      <header class="mast">
        <div class="seal" aria-hidden="true">돌봄</div>
        <div>
          <p class="eyebrow">가족 기록</p>
          <h1>${esc(name)}의 돌봄 장부</h1>
          <p class="sub">평소와 다른 일, 혈당, 병원 약속, 진료 때 전할 말을 한곳에 둡니다.</p>
          <p class="meta">마지막 기록 ${esc(formatStamp(state.updatedAt))}${state.updatedBy ? " · " + esc(state.updatedBy) : ""}</p>
        </div>
      </header>
      ${renderBanners()}
      <nav class="tabs no-print" role="tablist" aria-label="장부 메뉴">
        ${tabButton("home", "오늘", "오늘")}
        ${tabButton("glucose", "혈당", "혈당")}
        ${tabButton("events", "기록", "특이사항")}
        ${tabButton("appointments", "병원", "병원 일정")}
        ${tabButton("profile", "정보", "기본 정보")}
        ${tabButton("summary", "요약", "진료 요약")}
      </nav>
      ${renderPanel()}
      <footer class="footer no-print">
        <p>가족 암호를 아는 사람만 장부 내용을 볼 수 있습니다. 주민등록번호와 계좌번호는 적지 않습니다.</p>
        ${localMode ? "<p>기록 파일은 이 폴더의 data/ledger.json 입니다. 형제 화면은 GitHub에 올린 뒤에 바뀝니다.</p>" : ""}
      </footer>
    </div>`;
  if (options.keepScroll) window.scrollTo(0, keepScroll);
  restoreSearchFocus();
}

let searchCaret = null;

function restoreSearchFocus() {
  if (searchCaret == null) return;
  const box = document.getElementById("event-search");
  if (!box) return;
  box.focus();
  box.setSelectionRange(searchCaret, searchCaret);
  searchCaret = null;
}

function renderFamilyKey() {
  if (githubToken()) return "";
  return `<form class="banner no-print" data-form="token" autocomplete="off">
    <p>기록을 남길 때만 가족 키가 필요합니다. 가족 암호와는 다른 글이고, github_pat_ 로 시작합니다. 보기만 할 때는 넣지 않아도 됩니다.</p>
    <label style="margin-top:10px">가족 키
      <input name="token" type="password" placeholder="github_pat_..." autocomplete="off">
    </label>
    <div class="row"><button class="btn" type="submit">키 저장</button></div>
    <details style="margin-top:10px">
      <summary>가족 키 만드는 방법</summary>
      <ol class="steps">
        <li>GitHub 오른쪽 위 프로필 사진 → Settings</li>
        <li>맨 아래 Developer settings → Fine-grained tokens → Generate new token</li>
        <li>Repository access에서 mom-care-ledger 만 고릅니다.</li>
        <li>Permissions의 Contents를 Read and write로 고릅니다.</li>
        <li>만들어진 키를 형제 카카오톡으로 보내고, 각자 이 칸에 한 번 넣습니다.</li>
      </ol>
    </details>
  </form>`;
}

function tabButton(id, short, long) {
  return `<button type="button" role="tab" data-action="tab" data-tab="${id}" aria-selected="${tab === id}" aria-label="${long}"><span class="tab-short">${short}</span><span class="tab-long">${long}</span></button>`;
}

function renderBanners() {
  const blocks = [];
  if (!localMode) blocks.push(renderFamilyKey());
  if (localMode && !serverReady) {
    blocks.push(`<div class="banner warn no-print"><p>저장 창이 꺼져 있습니다. start-ledger.bat 으로 열면 기록이 파일에 바로 저장됩니다.</p></div>`);
  }
  if (state.demo) {
    blocks.push(`<div class="banner no-print"><p>지금 보이는 ${esc(state.profile.name || "홍길순")} 님 기록은 사용법을 보여 주는 예시입니다.</p>
      ${canWrite() ? `<div class="row"><button type="button" class="btn" data-action="clear-demo">예시 지우기</button></div>` : ""}
    </div>`);
  }
  if (canWrite() && isBlank(state)) {
    blocks.push(`<div class="banner no-print"><p>빈 장부입니다. 사용법이 보고 싶으면 예시를 다시 불러올 수 있습니다.</p>
      <div class="row"><button type="button" class="btn-ghost" data-action="restore-sample">예시 다시 불러오기</button></div>
    </div>`);
  }
  if (localMode && newerBackup) {
    blocks.push(`<div class="banner warn no-print"><p>이 브라우저에 파일보다 최근인 기록이 있습니다.</p>
      <div class="row">
        <button type="button" class="btn" data-action="restore-backup">그 기록 불러오기</button>
        <button type="button" class="btn-ghost" data-action="drop-backup">그냥 두기</button>
      </div>
    </div>`);
  }
  return blocks.join("");
}

function renderPanel() {
  if (tab === "home") return `<section class="panel">${renderHome()}</section>`;
  if (tab === "events") return `<section class="panel">${renderEvents()}</section>`;
  if (tab === "glucose") return `<section class="panel">${renderGlucose()}</section>`;
  if (tab === "appointments") return `<section class="panel">${renderAppointments()}</section>`;
  if (tab === "profile") return `<section class="panel">${renderProfile()}</section>`;
  return `<section class="panel summary">${renderSummary()}</section>`;
}

function pad2(number) {
  return String(number).padStart(2, "0");
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function ensureCalendar() {
  if (!selectedDate) selectedDate = todayKey();
  if (calendarYear == null || calendarMonth == null) {
    const [year, month] = selectedDate.split("-").map(Number);
    calendarYear = year;
    calendarMonth = month - 1;
  }
}

function shiftCalendar(delta) {
  ensureCalendar();
  const date = new Date(calendarYear, calendarMonth + delta, 1);
  calendarYear = date.getFullYear();
  calendarMonth = date.getMonth();
}

function itemsOnDate(key) {
  const match = (item) => String(item.at || "").slice(0, 10) === key;
  return {
    events: state.events.filter(match).slice().sort(bySoonest),
    appointments: state.appointments.filter(match).slice().sort(bySoonest),
    glucose: state.glucose.filter(match).slice().sort(bySoonest)
  };
}

function clockOf(value) {
  const timePart = String(value || "").split("T")[1];
  if (!timePart) return "";
  const [hh, mm] = timePart.split(":");
  const hour = Number(hh);
  if (Number.isNaN(hour) || !mm) return "";
  const ap = hour < 12 ? "오전" : "오후";
  return `${ap}\u00A0${hour % 12 || 12}:${mm}`;
}

function renderCalendar() {
  ensureCalendar();
  const year = calendarYear;
  const month = calendarMonth;
  const startPad = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = todayKey();
  const week = ["일", "월", "화", "수", "목", "금", "토"];
  const heads = week.map((name, index) => `<div class="cal-dow${index === 0 ? " sun" : ""}">${name}</div>`).join("");
  const cells = [];
  for (let index = 0; index < startPad; index += 1) cells.push(`<span class="cal-day blank"></span>`);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = `${year}-${pad2(month + 1)}-${pad2(day)}`;
    const found = itemsOnDate(key);
    const marks = [];
    if (found.events.length) marks.push(`<span class="cal-mark event"></span>`);
    if (found.appointments.length) marks.push(`<span class="cal-mark hospital"></span>`);
    if (found.glucose.length) marks.push(`<span class="cal-mark sugar"></span>`);
    const label = [
      `${month + 1}월 ${day}일`,
      key === today ? "오늘" : "",
      found.events.length ? `특이사항 ${found.events.length}건` : "",
      found.appointments.length ? `병원 ${found.appointments.length}건` : "",
      found.glucose.length ? `혈당 ${found.glucose.length}건` : ""
    ].filter(Boolean).join(", ");
    const sunday = new Date(year, month, day).getDay() === 0;
    cells.push(`<button type="button" class="cal-day${key === today ? " today" : ""}${sunday ? " sun" : ""}" data-action="cal-day" data-date="${key}" aria-pressed="${key === selectedDate}" aria-label="${esc(label)}"><span class="cal-num">${day}</span><span class="cal-marks">${marks.join("")}</span></button>`);
  }
  return `
    <div class="cal-head">
      <h2>${year}년 ${month + 1}월</h2>
      <div class="cal-nav">
        <button type="button" class="btn-ghost" data-action="cal-prev" aria-label="이전 달">‹</button>
        <button type="button" class="btn-ghost" data-action="cal-today">오늘</button>
        <button type="button" class="btn-ghost" data-action="cal-next" aria-label="다음 달">›</button>
      </div>
    </div>
    <div class="cal-grid" role="grid" aria-label="${year}년 ${month + 1}월 달력">
      ${heads}${cells.join("")}
    </div>
    <div class="cal-legend">
      <span><i class="cal-mark event"></i> 특이사항</span>
      <span><i class="cal-mark hospital"></i> 병원</span>
      <span><i class="cal-mark sugar"></i> 혈당</span>
    </div>`;
}

function renderDaySchedule() {
  ensureCalendar();
  const found = itemsOnDate(selectedDate);
  const rows = [
    ...found.appointments.map((item) => ({ at: item.at, kind: "appointment", item })),
    ...found.events.map((item) => ({ at: item.at, kind: "event", item })),
    ...found.glucose.map((item) => ({ at: item.at, kind: "glucose", item }))
  ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const heading = relativeDay(selectedDate) === "오늘" ? "오늘 일정" : "이 날의 일정";
  const body = rows.length ? `<ul class="list">${rows.map((row) => `<li class="item">${renderDayRow(row)}</li>`).join("")}</ul>` : `<p class="empty">이 날에는 적힌 일정과 기록이 없습니다.</p>`;
  return `
    <div id="day-detail" class="day-detail">
      <p class="kicker">${heading}</p>
      <p class="big-date">${esc(formatWhen(selectedDate))}</p>
      ${body}
    </div>`;
}

function renderDayRow(row) {
  const time = clockOf(row.at);
  if (row.kind === "glucose") {
    const item = row.item;
    return `
      <p class="when">${time ? esc(time) + " · " : ""}혈당</p>
      <div class="badges"><span class="badge sugar">${esc(item.timing || "혈당")}</span></div>
      <h3 class="sugar-num">${esc(item.value)} <span>mg/dL</span></h3>
      ${item.note ? `<p>${textOf(item.note)}</p>` : ""}`;
  }
  if (row.kind === "appointment") {
    const item = row.item;
    return `
      <p class="when">${time ? esc(time) + " · " : ""}병원</p>
      <div class="badges"><span class="badge ${statusClass(item.status)}">${esc(item.status || "일정")}</span></div>
      <h3>${esc(item.hospital || "병원")}${item.department ? " · " + esc(item.department) : ""}</h3>
      ${item.doctor ? `<p>선생님 ${esc(item.doctor)}</p>` : ""}
      ${item.purpose ? `<p>${textOf(item.purpose)}</p>` : ""}
      ${item.prepare ? `<p><strong>준비</strong> ${esc(item.prepare)}</p>` : ""}
      ${item.companion ? `<p><strong>같이 가는 사람</strong> ${esc(item.companion)}</p>` : ""}
      ${item.visitNote ? `<p class="muted-box"><strong>다녀온 뒤</strong><br>${textOf(item.visitNote)}</p>` : ""}`;
  }
  const event = row.item;
  return `
    <p class="when">${time ? esc(time) + " · " : ""}특이사항</p>
    <div class="badges">
      <span class="badge">${esc(event.category)}</span>
      <span class="badge ${badgeClass(event.severity)}">${esc(event.severity)}</span>
    </div>
    <h3>${esc(titleOf(event))}</h3>
    <p>${textOf(event.whatHappened)}</p>
    ${event.actionTaken ? `<p><strong>어떻게 했나</strong> ${textOf(event.actionTaken)}</p>` : ""}`;
}

function renderUpcomingHospitals() {
  ensureCalendar();
  const items = upcomingAppointments().filter((item) => String(item.at || "").slice(0, 10) !== selectedDate);
  if (!items.length) return "";
  const groups = [];
  for (const item of items) {
    const key = String(item.at || "").slice(0, 10);
    const last = groups[groups.length - 1];
    if (!last || last.key !== key) groups.push({ key, items: [item] });
    else last.items.push(item);
  }
  return groups.map((group) => `
    <section class="upcoming-day">
      <p class="big-date">${esc(formatWhen(group.key))}</p>
      <p class="meta">${esc(relativeDay(group.key))}</p>
      <ul class="list">${group.items.map((item) => `<li class="item">${renderDayRow({ at: item.at, kind: "appointment", item })}</li>`).join("")}</ul>
    </section>`).join("");
}

function renderGlucose() {
  const editing = state.glucose.find((item) => item.id === editingGlucoseId) || null;
  const showForm = canWrite() && (composingGlucose || editing);
  const readings = state.glucose.slice().sort(byNewest);
  const groups = [];
  for (const item of readings) {
    const key = String(item.at || "").slice(0, 10);
    const last = groups[groups.length - 1];
    if (!last || last.key !== key) groups.push({ key, items: [item] });
    else last.items.push(item);
  }
  for (const group of groups) group.items.sort(bySoonest);
  return `
    <div class="stack">
      <div class="card no-print">
        <h2>혈당</h2>
        <p class="hint">하루에도 여러 번 잴 수 있습니다. 단위는 mg/dL입니다.</p>
        ${canWrite() && !showForm ? `<div class="actions" style="margin-top:12px"><button type="button" class="btn" data-action="compose-glucose">혈당 남기기</button></div>` : ""}
      </div>
      ${showForm ? renderGlucoseForm(editing) : ""}
      ${groups.length ? groups.map((group) => `
        <article class="card">
          <p class="big-date">${esc(formatWhen(group.key))}</p>
          <p class="meta">${esc(relativeDay(group.key))}</p>
          <ul class="list">${group.items.map((item) => `<li class="item">${renderDayRow({ at: item.at, kind: "glucose", item })}${canWrite() ? `<div class="actions no-print">
            <button type="button" class="btn-ghost" data-action="edit-glucose" data-id="${esc(item.id)}">고치기</button>
            <button type="button" class="btn-ghost" data-action="delete-glucose" data-id="${esc(item.id)}">지우기</button>
          </div>` : ""}</li>`).join("")}</ul>
        </article>`).join("") : `<article class="card"><p class="empty">아직 적힌 혈당이 없습니다.</p></article>`}
    </div>`;
}

function renderGlucoseForm(item) {
  const value = item || {
    id: "",
    at: nowLocalValue(),
    value: "",
    timing: "공복",
    note: ""
  };
  return `
    <form class="card" id="glucose-form" data-form="glucose" autocomplete="off">
      <h2>${item ? "혈당 고치기" : "혈당 남기기"}</h2>
      <input type="hidden" name="id" value="${esc(value.id)}">
      <div class="grid-2">
        <label>언제 쟀나<input type="datetime-local" name="at" value="${esc(value.at)}" required></label>
        <label>수치 (mg/dL)<input name="value" inputmode="numeric" value="${esc(value.value)}" required placeholder="예: 128"></label>
        <label>어떤 때<select name="timing">${options(GLUCOSE_TIMINGS, value.timing)}</select></label>
      </div>
      <label style="margin-top:12px">메모
        <input name="note" value="${esc(value.note)}" placeholder="예: 아침을 조금 드신 뒤">
      </label>
      ${formError ? `<p class="form-error">${esc(formError)}</p>` : ""}
      <div class="actions" style="margin-top:12px">
        <button class="btn" type="submit">${item ? "고친 내용 저장" : "혈당 저장"}</button>
        <button class="btn-ghost" type="button" data-action="cancel-form">취소</button>
      </div>
    </form>`;
}

function recentGlucose() {
  return state.glucose
    .filter((item) => {
      if (!summaryDays) return true;
      const diff = dayDiff(item.at);
      return diff != null && diff <= 0 && diff >= -summaryDays;
    })
    .slice()
    .sort(byNewest);
}

function renderHome() {
  const notable = state.events.filter((event) => event.showDoctor).slice().sort(byNewest).slice(0, 3);
  const meds = state.profile.medications.filter((item) => item.name);
  const upcoming = renderUpcomingHospitals();
  const showNext = Boolean(upcoming) || upcomingAppointments().length === 0;
  return `
    <div class="home-grid">
      <div class="stack">
        <article class="card calendar-card">
          ${renderCalendar()}
          ${renderDaySchedule()}
        </article>
        ${showNext ? `<article class="card">
          <p class="kicker">다음 병원</p>
          ${upcoming || `<p class="empty">예정된 병원이 없습니다.</p>`}
          ${canWrite() ? `<div class="actions" style="margin-top:12px"><button type="button" class="btn" data-action="compose-appointment">병원 일정 남기기</button></div>` : ""}
        </article>` : ""}
        <article class="card">
          <p class="kicker">진료 때 말할 최근 일</p>
          ${notable.length ? `<ul class="list">${notable.map((event) => `<li class="item">${renderEventItem(event)}</li>`).join("")}</ul>` : `<p class="empty">보여 주기로 한 특이사항이 없습니다.</p>`}
          ${canWrite() ? `<div class="actions" style="margin-top:12px"><button type="button" class="btn pine" data-action="compose-event">특이사항 남기기</button></div>` : ""}
        </article>
      </div>
      <div class="stack">
        <article class="card">
          <p class="kicker">알아둘 것</p>
          <p>${esc(state.profile.name || "이름 아직 없음")}${state.profile.gender ? " · " + esc(state.profile.gender) : ""}${ageFrom(state.profile.birthDate) ? " · " + esc(ageFrom(state.profile.birthDate)) : ""}</p>
          <p class="${state.profile.allergies ? "allergy" : "muted-box"}">알레르기 ${esc(state.profile.allergies || "아직 적지 않음")}</p>
          <p>지병 ${esc(state.profile.conditions || "아직 적지 않음")}</p>
          ${meds.length ? `<ul class="list">${meds.map((item) => `<li class="item"><strong>${esc(item.name)}</strong> ${esc(item.dose)} ${esc(item.when)}</li>`).join("")}</ul>` : `<p class="empty">복용약이 아직 없습니다.</p>`}
        </article>
        ${renderShareCard()}
      </div>
    </div>`;
}

function renderShareCard() {
  if (!localMode) return "";
  return `
    <article class="card no-print">
      <p class="kicker">형제에게 보내는 주소</p>
      <ol class="steps">
        <li>이 컴퓨터에서 기록을 남기면 data/ledger.json 에 저장됩니다.</li>
        <li>개인 GitHub에 올리면 형제용 주소가 생깁니다.</li>
        <li>형제 휴대폰에서는 가족 키를 한 번 넣은 뒤 기록을 남깁니다.</li>
      </ol>
      <form data-form="share" style="margin-top:12px">
        <label>형제에게 보낼 주소
          <input name="shareUrl" value="${esc(state.shareUrl)}" placeholder="https://아이디.github.io/mom-care-ledger/">
        </label>
        <div class="actions" style="margin-top:10px">
          <button class="btn" type="submit">주소 기억하기</button>
          ${state.shareUrl ? `<button type="button" class="btn-ghost" data-action="copy-url">주소 복사</button>` : ""}
          <button type="button" class="btn-ghost" data-action="download">파일로 백업</button>
        </div>
      </form>
    </article>`;
}

function renderEvents() {
  const editing = state.events.find((event) => event.id === editingEventId) || null;
  const showForm = canWrite() && (composingEvent || editing);
  const events = filteredEvents();
  return `
    <div class="stack">
      <div class="card no-print">
        <h2>특이사항</h2>
        <p class="hint">평소와 달랐던 일을 남겨 두면, 병원에서도 형제들과도 같은 이야기를 할 수 있습니다.</p>
        <div class="filters" style="margin-top:12px">
          <label>분류
            <select data-filter="category">${options(["전체", ...CATEGORIES], eventCategory)}</select>
          </label>
          <label>중요도
            <select data-filter="severity">${options(["전체", ...SEVERITIES], eventSeverity)}</select>
          </label>
          <label>찾기
            <input id="event-search" data-filter="query" value="${esc(eventQuery)}" placeholder="증상, 이름, 내용">
          </label>
        </div>
        ${canWrite() && !showForm ? `<div class="actions" style="margin-top:12px"><button type="button" class="btn" data-action="compose-event">새 특이사항</button></div>` : ""}
      </div>
      ${showForm ? renderEventForm(editing) : ""}
      <div class="card">
        ${events.length ? `<div class="timeline">${events.map(renderTimeline).join("")}</div>` : `<p class="empty">이 조건에 맞는 특이사항이 없습니다.</p>`}
      </div>
    </div>`;
}

function renderEventForm(event) {
  const value = event || {
    id: "",
    at: nowLocalValue(),
    category: "컨디션",
    severity: "살펴보기",
    title: "",
    whatHappened: "",
    actionTaken: "",
    recordedBy: localStorage.getItem("mom-ledger-author") || "",
    showDoctor: true
  };
  return `
    <form class="card" id="event-form" data-form="event" autocomplete="off">
      <h2>${event ? "특이사항 고치기" : "특이사항 남기기"}</h2>
      <input type="hidden" name="id" value="${esc(value.id)}">
      <div class="grid-2">
        <label>언제<input type="datetime-local" name="at" value="${esc(value.at)}" required></label>
        <label>분류<select name="category">${options(CATEGORIES, value.category)}</select></label>
        <label>얼마나 신경 쓸지<select name="severity" id="severity">${options(SEVERITIES, value.severity)}</select></label>
        <label>한 줄 제목<input name="title" value="${esc(value.title)}" placeholder="예: 아침을 거의 드시지 않음"></label>
      </div>
      <label style="margin-top:12px">무슨 일이 있었나
        <textarea name="whatHappened" required placeholder="본 그대로, 들은 그대로 적습니다.">${esc(value.whatHappened)}</textarea>
      </label>
      <label>그 뒤에 어떻게 했나
        <textarea name="actionTaken" placeholder="물을 권함, 약을 드심, 병원 예약을 잡음">${esc(value.actionTaken)}</textarea>
      </label>
      <div class="grid-2">
        <label>누가 적나
          <input name="recordedBy" list="authors" value="${esc(value.recordedBy)}" placeholder="예: 큰딸">
        </label>
        <label class="check" style="align-self:end">
          <input type="checkbox" name="showDoctor" id="showDoctor" ${value.showDoctor ? "checked" : ""}>
          진료 때 이 기록 보여 주기
        </label>
      </div>
      <datalist id="authors">${authorOptions().map((name) => `<option value="${esc(name)}"></option>`).join("")}</datalist>
      ${formError ? `<p class="form-error">${esc(formError)}</p>` : ""}
      <div class="actions" style="margin-top:12px">
        <button class="btn" type="submit">${event ? "고친 내용 저장" : "기록 저장"}</button>
        <button class="btn-ghost" type="button" data-action="cancel-form">취소</button>
      </div>
    </form>`;
}

function renderTimeline(event) {
  return `
    <article>
      <div class="rail"><div class="dot ${badgeClass(event.severity)}"></div></div>
      <div class="item">${renderEventItem(event, true)}</div>
    </article>`;
}

function renderEventItem(event, withActions = false) {
  return `
    <p class="when">${esc(formatWhen(event.at))} · ${esc(relativeDay(event.at))}</p>
    <div class="badges">
      <span class="badge">${esc(event.category)}</span>
      <span class="badge ${badgeClass(event.severity)}">${esc(event.severity)}</span>
      ${event.showDoctor ? `<span class="badge doctor">진료 때 보여 줌</span>` : ""}
    </div>
    <h3>${esc(titleOf(event))}</h3>
    <p>${textOf(event.whatHappened)}</p>
    ${event.actionTaken ? `<p><strong>어떻게 했나</strong> ${textOf(event.actionTaken)}</p>` : ""}
    ${event.recordedBy ? `<p class="meta">기록 ${esc(event.recordedBy)}</p>` : ""}
    ${withActions && canWrite() ? `<div class="actions no-print">
      <button type="button" class="btn-ghost" data-action="edit-event" data-id="${esc(event.id)}">고치기</button>
      <button type="button" class="btn-ghost" data-action="delete-event" data-id="${esc(event.id)}">지우기</button>
    </div>` : ""}`;
}

function renderAppointments() {
  const editing = state.appointments.find((item) => item.id === editingAppointmentId) || null;
  const showForm = canWrite() && (composingAppointment || editing);
  const upcoming = upcomingAppointments();
  const past = state.appointments.filter((item) => item.status !== "예정" && item.status !== "변경").slice().sort(byNewest);
  return `
    <div class="stack">
      <div class="card no-print">
        <h2>병원 일정</h2>
        <p class="hint">예약과, 다녀온 뒤의 이야기를 같이 적습니다.</p>
        ${canWrite() && !showForm ? `<div class="actions" style="margin-top:12px"><button type="button" class="btn" data-action="compose-appointment">새 병원 일정</button></div>` : ""}
      </div>
      ${showForm ? renderAppointmentForm(editing) : ""}
      <article class="card">
        <h3>앞으로의 일정</h3>
        ${upcoming.length ? `<div class="list">${upcoming.map((item) => `<div class="item">${renderAppointmentBody(item, true)}</div>`).join("")}</div>` : `<p class="empty">예정된 일정이 없습니다.</p>`}
      </article>
      <article class="card">
        <h3>다녀온 기록</h3>
        ${past.length ? `<div class="list">${past.map((item) => `<div class="item">${renderAppointmentBody(item, true)}</div>`).join("")}</div>` : `<p class="empty">다녀온 기록이 없습니다.</p>`}
      </article>
    </div>`;
}

function renderAppointmentForm(item) {
  const value = item || {
    id: "",
    at: nowLocalValue(),
    hospital: state.profile.usualHospital || "",
    department: "",
    doctor: "",
    purpose: "",
    prepare: "보험증, 복용약, 최근 특이사항",
    companion: localStorage.getItem("mom-ledger-author") || "",
    status: "예정",
    visitNote: ""
  };
  return `
    <form class="card" id="appointment-form" data-form="appointment" autocomplete="off">
      <h2>${item ? "일정 고치기" : "병원 일정 남기기"}</h2>
      <input type="hidden" name="id" value="${esc(value.id)}">
      <div class="grid-2">
        <label>언제<input type="datetime-local" name="at" value="${esc(value.at)}" required></label>
        <label>상태<select name="status">${options(STATUSES, value.status)}</select></label>
        <label>병원<input name="hospital" value="${esc(value.hospital)}" required placeholder="병원 이름"></label>
        <label>진료과<input name="department" value="${esc(value.department)}" placeholder="예: 정형외과"></label>
        <label>선생님<input name="doctor" value="${esc(value.doctor)}"></label>
        <label>같이 가는 사람<input name="companion" value="${esc(value.companion)}" placeholder="예: 큰딸"></label>
      </div>
      <label style="margin-top:12px">가는 이유
        <textarea name="purpose" placeholder="오른쪽 무릎이 걸을 때 아파서">${esc(value.purpose)}</textarea>
      </label>
      <label>준비물<input name="prepare" value="${esc(value.prepare)}"></label>
      <label>다녀온 뒤 이야기
        <textarea name="visitNote" placeholder="무슨 말씀을 들으셨는지, 약이 바뀌었는지">${esc(value.visitNote)}</textarea>
      </label>
      ${formError ? `<p class="form-error">${esc(formError)}</p>` : ""}
      <div class="actions" style="margin-top:12px">
        <button class="btn" type="submit">${item ? "고친 내용 저장" : "일정 저장"}</button>
        <button class="btn-ghost" type="button" data-action="cancel-form">취소</button>
      </div>
    </form>`;
}

function renderAppointmentBody(item, withActions = false) {
  const late = (item.status === "예정" || item.status === "변경") && dayDiff(item.at) < 0;
  return `
    <p class="big-date">${esc(formatWhen(item.at))}</p>
    <div class="badges">
      <span class="badge ${statusClass(item.status)}">${esc(item.status)}</span>
      <span class="badge">${esc(relativeDay(item.at))}</span>
      ${late ? `<span class="badge late">예정일이 지났습니다</span>` : ""}
    </div>
    <h3>${esc(item.hospital || "병원")}${item.department ? " · " + esc(item.department) : ""}</h3>
    ${item.doctor ? `<p>선생님 ${esc(item.doctor)}</p>` : ""}
    ${item.purpose ? `<p>${textOf(item.purpose)}</p>` : ""}
    ${item.prepare ? `<p><strong>준비</strong> ${esc(item.prepare)}</p>` : ""}
    ${item.companion ? `<p><strong>같이 가는 사람</strong> ${esc(item.companion)}</p>` : ""}
    ${item.visitNote ? `<p class="muted-box"><strong>다녀온 뒤</strong><br>${textOf(item.visitNote)}</p>` : ""}
    ${withActions && canWrite() ? `<div class="actions no-print">
      <button type="button" class="btn-ghost" data-action="edit-appointment" data-id="${esc(item.id)}">고치기</button>
      <button type="button" class="btn-ghost" data-action="delete-appointment" data-id="${esc(item.id)}">지우기</button>
    </div>` : ""}`;
}

function renderProfile() {
  if (!canWrite()) return `<article class="card">${renderProfileRead()}</article>`;
  const profile = state.profile;
  return `
    <form class="card" id="profile-form" data-form="profile" autocomplete="off">
      <h2>기본 정보</h2>
      <p class="hint">병원 갈 때 같이 보는 내용입니다. 주민등록번호 칸은 없습니다.</p>
      <div class="grid-2" style="margin-top:12px">
        ${field("이름", "name", profile.name, "어머니 성함")}
        ${field("생년월일", "birthDate", profile.birthDate, "", "date")}
        <label>성별<select name="gender">${options(GENDERS, profile.gender, { "": "적지 않음" })}</select></label>
        <label>혈액형<select name="bloodType">${options(BLOOD_TYPES, profile.bloodType, { "": "적지 않음" })}</select></label>
        ${field("전화", "phone", profile.phone, "010-0000-0000", "tel")}
        ${field("사는 곳", "address", profile.address, "동까지만 적어도 됩니다")}
        ${field("자주 가는 병원", "usualHospital", profile.usualHospital)}
        ${field("주치 진료과", "usualDoctor", profile.usualDoctor, "예: 내과")}
        ${field("보험", "insurance", profile.insurance, "예: 건강보험")}
      </div>
      <label style="margin-top:12px">알레르기
        <input name="allergies" value="${esc(profile.allergies)}" placeholder="없으면 없음. 아직 모르면 비워 둡니다.">
      </label>
      <label>지병·진단<textarea name="conditions">${esc(profile.conditions)}</textarea></label>
      <label>진료 때 꼭 전할 말<textarea name="tellDoctor">${esc(profile.tellDoctor)}</textarea></label>
      <label>평소 생활에서 알아둘 것<textarea name="note" placeholder="청력, 보행, 식성, 저녁에 더 잘 듣는 이야기">${esc(profile.note)}</textarea></label>
      <h3 style="margin-top:18px">복용약</h3>
      ${profile.medications.map(medRow).join("") || `<p class="empty">아직 적힌 약이 없습니다.</p>`}
      <button type="button" class="btn-ghost" data-action="add-med">약 추가</button>
      <h3 style="margin-top:18px">가족 연락처</h3>
      ${profile.contacts.map(contactRow).join("") || `<p class="empty">아직 적힌 연락처가 없습니다.</p>`}
      <button type="button" class="btn-ghost" data-action="add-contact">연락처 추가</button>
      ${formError ? `<p class="form-error">${esc(formError)}</p>` : ""}
      <div class="actions" style="margin-top:14px">
        <button class="btn" type="submit">기본 정보 저장</button>
      </div>
    </form>`;
}

function renderProfileRead() {
  const profile = state.profile;
  const rows = [
    ["이름", profile.name],
    ["생년월일", [formatWhen(profile.birthDate), ageFrom(profile.birthDate)].filter(Boolean).join(" · ")],
    ["성별", profile.gender],
    ["혈액형", profile.bloodType],
    ["전화", profile.phone],
    ["사는 곳", profile.address],
    ["알레르기", profile.allergies || "아직 적지 않음"],
    ["지병", profile.conditions || "아직 적지 않음"],
    ["병원", [profile.usualHospital, profile.usualDoctor].filter(Boolean).join(" · ")],
    ["보험", profile.insurance],
    ["꼭 전할 말", profile.tellDoctor],
    ["알아둘 것", profile.note]
  ];
  return `
    <h2>기본 정보</h2>
    <table>${rows.filter((row) => row[1]).map((row) => `<tr><th>${esc(row[0])}</th><td>${textOf(row[1])}</td></tr>`).join("")}</table>
    <h3>복용약</h3>
    ${profile.medications.length ? profile.medications.map((item) => `<p><strong>${esc(item.name)}</strong> ${esc(item.dose)} ${esc(item.when)} ${esc(item.note)}</p>`).join("") : `<p class="empty">아직 적힌 약이 없습니다.</p>`}
    <h3>가족 연락처</h3>
    ${profile.contacts.length ? profile.contacts.map((item) => `<p>${esc(item.relation)} ${esc(item.name)} ${esc(item.phone)}</p>`).join("") : `<p class="empty">아직 적힌 연락처가 없습니다.</p>`}`;
}

function field(label, name, value, placeholder = "", type = "text") {
  return `<label>${label}<input type="${type}" name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}"></label>`;
}

function medRow(item) {
  return `
    <div class="row-card" data-med="${esc(item.id)}">
      <div class="grid-2">
        <label>약 이름<input data-f="name" value="${esc(item.name)}" placeholder="예: 혈압약"></label>
        <label>용량<input data-f="dose" value="${esc(item.dose)}" placeholder="예: 5mg 1정"></label>
        <label>언제<input data-f="when" value="${esc(item.when)}" placeholder="예: 아침 식후"></label>
        <label>메모<input data-f="note" value="${esc(item.note)}"></label>
      </div>
      <button type="button" class="btn-ghost" data-action="remove-med" data-id="${esc(item.id)}">이 약 빼기</button>
    </div>`;
}

function contactRow(item) {
  return `
    <div class="row-card" data-contact="${esc(item.id)}">
      <div class="grid-3">
        <label>관계<input data-f="relation" value="${esc(item.relation)}" placeholder="예: 큰딸"></label>
        <label>이름<input data-f="name" value="${esc(item.name)}"></label>
        <label>전화<input data-f="phone" value="${esc(item.phone)}"></label>
      </div>
      <button type="button" class="btn-ghost" data-action="remove-contact" data-id="${esc(item.id)}">이 연락처 빼기</button>
    </div>`;
}

function renderSummary() {
  const profile = state.profile;
  const events = doctorEvents();
  const upcoming = upcomingAppointments();
  const meds = profile.medications.filter((item) => item.name);
  return `
    <article class="card summary-sheet">
      <div class="actions no-print" style="margin-bottom:12px">
        <label>기간
          <select data-filter="summary-days">
            ${options([["14", "최근 2주"], ["30", "최근 1개월"], ["90", "최근 3개월"], ["0", "전체"]], String(summaryDays))}
          </select>
        </label>
        <button type="button" class="btn" data-action="print-summary">인쇄</button>
        <button type="button" class="btn pine" data-action="copy-summary">글 복사</button>
      </div>
      <p class="kicker">진료 참고 기록</p>
      <h2>${esc(profile.name || "어머니")} 돌봄 장부</h2>
      <p class="meta">출력 ${esc(formatStamp(new Date().toISOString()))}</p>
      <table>
        ${summaryRow("이름", [profile.name, profile.gender, ageFrom(profile.birthDate)].filter(Boolean).join(" · "))}
        ${summaryRow("생년월일", profile.birthDate ? formatWhen(profile.birthDate) : "")}
        ${summaryRow("혈액형", profile.bloodType)}
        ${summaryRow("전화", profile.phone)}
        ${summaryRow("알레르기", profile.allergies || "아직 적지 않음")}
        ${summaryRow("지병", profile.conditions || "아직 적지 않음")}
        ${summaryRow("보험", profile.insurance)}
        ${summaryRow("꼭 전할 말", profile.tellDoctor)}
        ${summaryRow("평소 알아둘 것", profile.note)}
      </table>
      <h3>복용약</h3>
      ${meds.length ? `<ul>${meds.map((item) => `<li>${esc(item.name)} ${esc(item.dose)} ${esc(item.when)} ${esc(item.note)}</li>`).join("")}</ul>` : `<p>아직 적힌 약이 없습니다.</p>`}
      <h3>최근 특이사항</h3>
      ${events.length ? events.map((event) => `
        <p><strong>${esc(formatWhen(event.at))} · ${esc(event.severity)} · ${esc(titleOf(event))}</strong></p>
        <p>${textOf(event.whatHappened)}</p>
        ${event.actionTaken ? `<p>조치: ${textOf(event.actionTaken)}</p>` : ""}
        ${event.recordedBy ? `<p class="meta">기록 ${esc(event.recordedBy)}</p>` : ""}
      `).join("") : `<p>이 기간에 진료 때 보여 줄 특이사항이 없습니다.</p>`}
      <h3>혈당</h3>
      ${recentGlucose().length ? recentGlucose().map((item) => `<p>${esc(formatWhen(item.at))} ${esc(item.timing)} ${esc(item.value)} mg/dL${item.note ? " · " + esc(item.note) : ""}</p>`).join("") : `<p>이 기간에 적힌 혈당이 없습니다.</p>`}
      <h3>병원 일정</h3>
      ${upcoming.length ? upcoming.map((item) => `<p>${esc(formatWhen(item.at))} ${esc(item.hospital)} ${esc(item.department)} ${esc(item.purpose)}</p>`).join("") : `<p>예정된 병원이 없습니다.</p>`}
      <h3>가족 연락처</h3>
      ${profile.contacts.length ? profile.contacts.map((item) => `<p>${esc(item.relation)} ${esc(item.name)} ${esc(item.phone)}</p>`).join("") : `<p>아직 적힌 연락처가 없습니다.</p>`}
    </article>`;
}

function summaryRow(label, value) {
  if (!value) return "";
  return `<tr><th>${esc(label)}</th><td>${textOf(value)}</td></tr>`;
}

function options(list, current, labels = {}) {
  return list.map((item) => {
    const value = Array.isArray(item) ? item[0] : item;
    const label = Array.isArray(item) ? item[1] : (labels[item] ?? item);
    const shown = label === "" ? "적지 않음" : label;
    return `<option value="${esc(value)}" ${value === current ? "selected" : ""}>${esc(shown)}</option>`;
  }).join("");
}

function summaryPlain() {
  const profile = state.profile;
  const events = doctorEvents();
  const upcoming = upcomingAppointments();
  const lines = [
    `[어머니 돌봄 장부] 진료 참고`,
    `이름: ${[profile.name, profile.gender, ageFrom(profile.birthDate)].filter(Boolean).join(" · ") || "아직 적지 않음"}`,
    `생년월일: ${profile.birthDate ? formatWhen(profile.birthDate) : "아직 적지 않음"}`,
    `혈액형: ${profile.bloodType || "아직 적지 않음"}`,
    `알레르기: ${profile.allergies || "아직 적지 않음"}`,
    `지병: ${profile.conditions || "아직 적지 않음"}`,
    `꼭 전할 말: ${profile.tellDoctor || "없음"}`,
    "",
    "복용약:"
  ];
  const meds = profile.medications.filter((item) => item.name);
  if (!meds.length) lines.push("- 아직 적힌 약이 없습니다.");
  for (const item of meds) lines.push(`- ${item.name} ${item.dose} ${item.when} ${item.note}`.trim());
  lines.push("", "최근 특이사항:");
  if (!events.length) lines.push("- 이 기간에 보여 줄 기록이 없습니다.");
  for (const event of events) {
    lines.push(`- ${formatWhen(event.at)} ${event.severity} | ${titleOf(event)}`);
    lines.push(`  무슨 일: ${event.whatHappened}`);
    if (event.actionTaken) lines.push(`  어떻게 함: ${event.actionTaken}`);
    if (event.recordedBy) lines.push(`  기록: ${event.recordedBy}`);
  }
  lines.push("", "혈당:");
  const sugars = recentGlucose();
  if (!sugars.length) lines.push("- 이 기간에 적힌 혈당이 없습니다.");
  for (const item of sugars) lines.push(`- ${formatWhen(item.at)} ${item.timing} ${item.value} mg/dL${item.note ? " " + item.note : ""}`);
  lines.push("", "다음 병원:");
  if (!upcoming.length) lines.push("- 예정된 병원이 없습니다.");
  for (const item of upcoming) lines.push(`- ${formatWhen(item.at)} ${item.hospital} ${item.department} ${item.purpose}`.trim());
  return lines.join("\n");
}

function onClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  const id = button.dataset.id;
  if (action === "tab") {
    tab = button.dataset.tab;
    formError = "";
    render();
    return;
  }
  if (action === "cal-prev" || action === "cal-next") {
    shiftCalendar(action === "cal-prev" ? -1 : 1);
    render({ keepScroll: true });
    return;
  }
  if (action === "cal-today") {
    selectedDate = todayKey();
    const [year, month] = selectedDate.split("-").map(Number);
    calendarYear = year;
    calendarMonth = month - 1;
    render({ keepScroll: true });
    document.getElementById("day-detail")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return;
  }
  if (action === "cal-day") {
    selectedDate = button.dataset.date || selectedDate;
    render({ keepScroll: true });
    document.getElementById("day-detail")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return;
  }
  if (action === "compose-event") {
    tab = "events";
    composingEvent = true;
    editingEventId = null;
    formError = "";
    render();
    document.getElementById("event-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (action === "compose-glucose") {
    tab = "glucose";
    composingGlucose = true;
    editingGlucoseId = null;
    formError = "";
    render();
    document.getElementById("glucose-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (action === "edit-glucose") {
    tab = "glucose";
    editingGlucoseId = id;
    composingGlucose = false;
    formError = "";
    render();
    document.getElementById("glucose-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (action === "compose-appointment") {
    tab = "appointments";
    composingAppointment = true;
    editingAppointmentId = null;
    formError = "";
    render();
    document.getElementById("appointment-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (action === "edit-event") {
    tab = "events";
    editingEventId = id;
    composingEvent = false;
    formError = "";
    render();
    return;
  }
  if (action === "edit-appointment") {
    tab = "appointments";
    editingAppointmentId = id;
    composingAppointment = false;
    formError = "";
    render();
    return;
  }
  if (action === "cancel-form") {
    composingEvent = false;
    composingAppointment = false;
    composingGlucose = false;
    editingEventId = null;
    editingAppointmentId = null;
    editingGlucoseId = null;
    formError = "";
    render();
    return;
  }
  if (action === "delete-event") {
    const found = state.events.find((item) => item.id === id);
    if (!found || !confirm(`이 기록을 지울까요?\n${titleOf(found)}`)) return;
    state.events = state.events.filter((item) => item.id !== id);
    saveAndRender();
    return;
  }
  if (action === "delete-glucose") {
    const found = state.glucose.find((item) => item.id === id);
    if (!found || !confirm(`이 혈당 기록을 지울까요?\n${found.value} mg/dL`)) return;
    state.glucose = state.glucose.filter((item) => item.id !== id);
    saveAndRender();
    return;
  }
  if (action === "delete-appointment") {
    const found = state.appointments.find((item) => item.id === id);
    if (!found || !confirm(`이 일정을 지울까요?\n${found.hospital || "병원"}`)) return;
    state.appointments = state.appointments.filter((item) => item.id !== id);
    saveAndRender();
    return;
  }
  if (action === "add-med" || action === "remove-med" || action === "add-contact" || action === "remove-contact") {
    const profile = readProfileFromDom();
    if (action === "add-med") profile.medications.push({ id: uid(), name: "", dose: "", when: "", note: "" });
    if (action === "remove-med") profile.medications = profile.medications.filter((item) => item.id !== id);
    if (action === "add-contact") profile.contacts.push({ id: uid(), name: "", relation: "", phone: "" });
    if (action === "remove-contact") profile.contacts = profile.contacts.filter((item) => item.id !== id);
    state.profile = profile;
    render();
    return;
  }
  if (action === "clear-demo") {
    if (!confirm("예시 기록을 지우고 빈 장부로 시작할까요?")) return;
    state = blank();
    newerBackup = null;
    saveAndRender();
    return;
  }
  if (action === "restore-sample") {
    restoreSample();
    return;
  }
  if (action === "restore-backup") {
    if (!newerBackup) return;
    state = newerBackup;
    newerBackup = null;
    saveAndRender();
    return;
  }
  if (action === "drop-backup") {
    newerBackup = null;
    try { localStorage.removeItem("mom-ledger-backup"); } catch { /* 없어도 됩니다. */ }
    render();
    return;
  }
  if (action === "forget-key") {
    try { localStorage.removeItem("mom-ledger-github-token"); } catch { /* 없어도 됩니다. */ }
    toast("이 휴대폰에서 가족 키를 지웠습니다.");
    render();
    return;
  }
  if (action === "forget-pass") {
    try { localStorage.removeItem("mom-ledger-pass"); } catch { /* 없어도 됩니다. */ }
    familyPassword = "";
    familyKey = null;
    state = null;
    gateMode = vault ? "unlock" : "setup";
    toast("이 휴대폰에서 가족 암호를 지웠습니다.");
    renderGate();
    return;
  }
  if (action === "download") {
    downloadLedger();
    return;
  }
  if (action === "copy-url") {
    copyText(state.shareUrl, "형제에게 보낼 주소를 복사했습니다.");
    return;
  }
  if (action === "copy-summary") {
    copyText(summaryPlain(), "진료 참고 글을 복사했습니다. 카카오톡에 붙여 넣을 수 있습니다.");
    return;
  }
  if (action === "print-summary") {
    tab = "summary";
    render();
    setTimeout(() => window.print(), 60);
  }
}

function onChange(event) {
  const filter = event.target.dataset.filter;
  if (!filter) return;
  if (filter === "category") eventCategory = event.target.value;
  if (filter === "severity") eventSeverity = event.target.value;
  if (filter === "summary-days") summaryDays = Number(event.target.value);
  if (filter !== "query") render();
}

function onInput(event) {
  if (event.target.dataset.filter !== "query") return;
  eventQuery = event.target.value;
  searchCaret = event.target.selectionStart;
  render();
}

async function onSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.dataset.form) return;
  event.preventDefault();
  formError = "";
  try {
    if (form.dataset.form === "token") {
      const token = cleanToken(new FormData(form).get("token").toString());
      const result = await checkToken(token);
      if (result === "not-token") {
        toast("가족 암호는 암호 칸에 넣습니다. 가족 키는 github_pat_ 로 시작하는 긴 글입니다.");
        return;
      }
      if (result === "network") {
        toast("키를 확인하지 못했습니다. 카카오톡 안이 아니라 사파리나 크롬에서 열어 주세요.");
        return;
      }
      if (result !== "ok") {
        toast("가족 키가 맞지 않습니다. 키 전체를 한 줄로 다시 넣어 주세요.");
        return;
      }
      localStorage.setItem("mom-ledger-github-token", token);
      toast("이 휴대폰에 가족 키를 저장했습니다. 이제 기록을 남길 수 있습니다.");
      if (gateMode) renderGate();
      else render();
      return;
    }
    if (form.dataset.form === "create-pass") {
      const data = new FormData(form);
      const password = data.get("password").toString();
      const again = data.get("again").toString();
      if (password.length < 4) {
        toast("암호는 네 글자 이상으로 정해 주세요.");
        return;
      }
      if (password !== again) {
        toast("암호가 서로 다릅니다.");
        return;
      }
      if (!canWrite()) {
        toast("먼저 가족 키를 넣어 주세요.");
        return;
      }
      state = pendingPlain;
      familyPassword = password;
      familyKey = null;
      vault = null;
      rememberPassword(password, form.elements.remember.checked);
      await persist();
      pendingPlain = null;
      gateMode = null;
      toast("가족 암호로 장부를 잠갔습니다.");
      render();
      return;
    }
    if (form.dataset.form === "unlock") {
      const data = new FormData(form);
      const password = data.get("password").toString();
      const opened = await decryptEnvelope(password, vault);
      if (!opened) {
        toast("암호가 맞지 않습니다.");
        return;
      }
      state = opened.state;
      familyKey = opened.key;
      familyPassword = password;
      rememberPassword(password, form.elements.remember.checked);
      gateMode = null;
      render();
      return;
    }
    if (form.dataset.form === "event") saveEvent(form);
    else if (form.dataset.form === "glucose") saveGlucose(form);
    else if (form.dataset.form === "appointment") saveAppointment(form);
    else if (form.dataset.form === "profile") saveProfile();
    else if (form.dataset.form === "share") {
      state.shareUrl = new FormData(form).get("shareUrl").toString().trim();
    }
    if (formError) {
      render();
      return;
    }
    await persist();
    render();
  } catch (error) {
    toast(saveErrorMessage(error));
  }
}

function saveEvent(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  if (!data.whatHappened.trim()) {
    formError = "무슨 일이 있었는지 적어 주세요.";
    return;
  }
  const record = {
    id: data.id || uid(),
    at: data.at,
    category: data.category,
    severity: data.severity,
    title: data.title.trim(),
    whatHappened: data.whatHappened.trim(),
    actionTaken: data.actionTaken.trim(),
    recordedBy: data.recordedBy.trim(),
    showDoctor: form.elements.showDoctor.checked
  };
  rememberAuthor(record.recordedBy);
  const index = state.events.findIndex((item) => item.id === record.id);
  if (index >= 0) state.events[index] = record;
  else state.events.push(record);
  composingEvent = false;
  editingEventId = null;
}

function saveGlucose(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  const value = Number(String(data.value || "").replace(/,/g, "").trim());
  if (!data.at || !Number.isFinite(value) || value < 20 || value > 600) {
    formError = "혈당은 20에서 600 사이 숫자로 적어 주세요. 단위는 mg/dL입니다.";
    return;
  }
  const record = {
    id: data.id || uid(),
    at: data.at,
    value: Math.round(value),
    timing: data.timing || "기타",
    note: data.note.trim()
  };
  const index = state.glucose.findIndex((item) => item.id === record.id);
  if (index >= 0) state.glucose[index] = record;
  else state.glucose.push(record);
  composingGlucose = false;
  editingGlucoseId = null;
}

function saveAppointment(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  if (!data.at || !data.hospital.trim()) {
    formError = "병원과 시간을 적어 주세요.";
    return;
  }
  const record = {
    id: data.id || uid(),
    at: data.at,
    hospital: data.hospital.trim(),
    department: data.department.trim(),
    doctor: data.doctor.trim(),
    purpose: data.purpose.trim(),
    prepare: data.prepare.trim(),
    companion: data.companion.trim(),
    status: data.status,
    visitNote: data.visitNote.trim()
  };
  rememberAuthor(record.companion);
  const index = state.appointments.findIndex((item) => item.id === record.id);
  if (index >= 0) state.appointments[index] = record;
  else state.appointments.push(record);
  composingAppointment = false;
  editingAppointmentId = null;
}

function saveProfile() {
  state.profile = readProfileFromDom(true);
}

function readProfileFromDom(dropEmpty = false) {
  const form = document.getElementById("profile-form");
  const data = Object.fromEntries(new FormData(form).entries());
  const profile = { ...state.profile };
  for (const key of PROFILE_FIELDS) profile[key] = (data[key] || "").toString().trim();
  profile.medications = readRows("[data-med]", ["name", "dose", "when", "note"], "med");
  profile.contacts = readRows("[data-contact]", ["relation", "name", "phone"], "contact");
  if (dropEmpty) {
    profile.medications = profile.medications.filter((item) => item.name || item.dose || item.when || item.note);
    profile.contacts = profile.contacts.filter((item) => item.name || item.relation || item.phone);
  }
  return profile;
}

function readRows(selector, fields, attr) {
  return [...document.querySelectorAll(selector)].map((row) => {
    const item = { id: row.dataset[attr] || uid() };
    for (const fieldName of fields) {
      item[fieldName] = row.querySelector(`[data-f="${fieldName}"]`)?.value.trim() || "";
    }
    return item;
  });
}

async function saveAndRender() {
  try {
    await persist();
  } catch (error) {
    toast(saveErrorMessage(error));
  }
  render();
}

function cleanToken(value) {
  return String(value || "").replace(/[\s\u200b\u200c\u200d\ufeff'"]/g, "");
}

function looksLikeToken(token) {
  return /^github_pat_[A-Za-z0-9_]+$/.test(token) || /^ghp_[A-Za-z0-9]+$/.test(token);
}

async function checkToken(token) {
  if (!token) return "empty";
  if (!looksLikeToken(token)) return "not-token";
  try {
    const res = await fetch(contentsUrl(), {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28"
      },
      cache: "no-store"
    });
    return res.ok ? "ok" : "bad";
  } catch {
    return "network";
  }
}

async function restoreSample() {
  if (!confirm("예시 기록을 다시 불러올까요?")) return;
  const res = await fetch("data/sample.json?t=" + Date.now(), { cache: "no-store" });
  state = normalize(await res.json());
  state.demo = true;
  await saveAndRender();
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    toast(message);
  }
}

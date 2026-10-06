const STORAGE_KEY = "bts-lift-v1";
const ICONS = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v13.72L19.26 12 8 5.14z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M5 12.5l4.2 4.2L19 7.5"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M4.6 15.2l1.6-.5m11.6-5.4l1.6-.5M8.4 4.8l.5 1.6m5.4 11.6l.5 1.6M4.8 8.4l1.6.5m11.6 5.4l1.6.5M15.2 4.6l-.5 1.6m-5.4 11.6l-.5 1.6"/></svg>',
};

let PROGRAM = null;
let PROGRAMS = {};
let PAIN = null;
let state = null;
let wakeLock = null;
let searchTimer = null;

const timer = {
  remaining: 0,
  total: 0,
  label: "",
  id: null,
  ringing: false,
  deadline: 0,
  start(sec, label) {
    this.stopTick();
    this.remaining = sec;
    this.total = sec;
    this.label = label;
    this.ringing = false;
    this.deadline = Date.now() + sec * 1000;
    this.id = setInterval(() => {
      this.remaining = Math.max(0, Math.ceil((this.deadline - Date.now()) / 1000));
      if (this.remaining <= 0) {
        this.remaining = 0;
        this.stopTick();
        this.ringing = true;
        buzz([180, 80, 180, 80, 320]);
      }
      paintTimer();
    }, 1000);
    paintTimer();
  },
  add(sec) {
    if (!this.total && !this.remaining) return;
    this.remaining += sec;
    this.total += sec;
    this.deadline += sec * 1000;
    this.ringing = false;
    if (!this.id && this.remaining > 0) this.start(this.remaining, this.label);
    paintTimer();
  },
  stopTick() {
    if (this.id) clearInterval(this.id);
    this.id = null;
  },
  skip() {
    this.stopTick();
    this.remaining = 0;
    this.total = 0;
    this.ringing = false;
    paintTimer();
  },
};

function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }
function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function allWeeks() {
  return PROGRAM.blocks.flatMap((b) => b.weeks.map((w) => ({ ...w, block: b.name })));
}
function weekByNumber(n) {
  return allWeeks().find((w) => w.number === Number(n));
}
function dayShort(name) {
  if (name === "Rest Day") return "Hviledag";
  return name
    .replace(" (Strength Focus)", " · styrke")
    .replace(" (Hypertrophy Focus)", " · hypertrophy");
}
function setCount(ex) {
  const n = parseInt(String(ex.workingSets || "2"), 10);
  const base = Number.isFinite(n) && n > 0 ? n : 2;
  const logged = (ex.sheetLogs || []).length;
  return Math.max(base, logged);
}
function logKey(week, dayIdx, exIdx) {
  return ProgramState.key(state.activeProgram, week, dayIdx, exIdx);
}
function nameKey(name) {
  return String(name || "").trim().toLowerCase();
}

function defaultWeek() {
  return 1;
}

function defaultPrefs() {
  return { keepAwake: true, vibrate: true, restBias: "low", cloudId: "", lastPcSync: "", lastCloudSync: "" };
}

function loadState() {
  let st = { week: 1, logs: {}, dismissedInstall: false, sheetImport: 0, prefs: defaultPrefs(), openKey: null, comeback: 0 };
  let fresh = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      fresh = false;
      const parsed = JSON.parse(raw);
      st = { ...st, ...parsed };
      if (!parsed.schemaVersion && !localStorage.getItem(`${STORAGE_KEY}-before-programs`)) {
        try { localStorage.setItem(`${STORAGE_KEY}-before-programs`, raw); } catch {}
      }
    }
  } catch {}
  st.prefs = { ...defaultPrefs(), ...(st.prefs || {}) };
  return ProgramState.normalize(st, fresh);
}
let saveTimer = null;
function saveState() {
  state.programWeeks[state.activeProgram] = state.week;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  try { navigator.storage?.persist?.(); } catch {}
  clearTimeout(saveTimer);
  saveTimer = setTimeout(pushBackup, 1200);
}

function backupPayload() {
  return JSON.stringify({ ...state, savedAt: new Date().toISOString() });
}

async function pushBackup() {
  const payload = backupPayload();
  try {
    const r = await fetch("/api/backup", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload });
    if (r.ok || r.status === 204) {
      state.prefs.lastPcSync = new Date().toISOString();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  } catch {}
  try {
    const id = state.prefs.cloudId;
    const url = id
      ? `https://jsonblob.com/api/jsonBlob/${id}`
      : "https://jsonblob.com/api/jsonBlob";
    const r = await fetch(url, {
      method: id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: payload,
    });
    if (!r.ok && r.status !== 201) return;
    const loc = r.headers.get("Location") || "";
    const newId = loc.split("/").filter(Boolean).pop() || id;
    if (newId) state.prefs.cloudId = newId;
    state.prefs.lastCloudSync = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

async function pullBackup() {
  let remote = null;
  try {
    const r = await fetch("/api/backup");
    if (r.ok) remote = await r.json();
  } catch {}
  if (!remote && state.prefs.cloudId) {
    try {
      const r = await fetch(`https://jsonblob.com/api/jsonBlob/${state.prefs.cloudId}`);
      if (r.ok) remote = await r.json();
    } catch {}
  }
  if (!remote || typeof remote !== "object" || !remote.logs) return false;
  try { state = ProgramState.mergeBackup(state, remote); } catch { return false; }
  PROGRAM = PROGRAMS[state.activeProgram];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  return true;
}

function hasUserProgress() {
  return Object.values(state.logs || {}).some((l) => l && l.done && l.source !== "sheet" && l.source !== "prefill");
}

function getLog(week, dayIdx, exIdx) {
  return state.logs[logKey(week, dayIdx, exIdx)] || null;
}
function patchLog(week, dayIdx, exIdx, patch) {
  const key = logKey(week, dayIdx, exIdx);
  state.logs[key] = { ...(state.logs[key] || {}), ...patch, updatedAt: new Date().toISOString() };
  saveState();
}

function sheetSets(ex) {
  const n = setCount(ex);
  const targetReps = ex.rir ? "" : ex.reps || "";
  const sets = Array.from({ length: n }, () => ({ weight: "", reps: targetReps, done: false }));
  (ex.sheetLogs || []).forEach((s) => {
    const i = (s.set || 1) - 1;
    if (i >= 0 && i < n) {
      sets[i].weight = s.value || "";
      sets[i].reps = s.reps || targetReps;
    }
  });
  return sets;
}

function currentSets(week, dayIdx, exIdx, ex) {
  const n = setCount(ex);
  const log = getLog(week, dayIdx, exIdx);
  const last = lastForExercise(ex.name, week, dayIdx, ex.repLabel);
  const base = log?.sets?.length
    ? Array.from({ length: n }, (_, i) => ({
      weight: log.sets[i]?.weight || "",
      reps: log.sets[i]?.reps || "",
      done: Boolean(log.sets[i]?.done),
    }))
    : sheetSets(ex);
  return base.map((s, i) => ({
    weight: s.weight || last?.sets?.[i]?.weight || last?.sets?.find((x) => x.weight)?.weight || "",
    reps: s.reps || (ex.rir ? "" : ex.reps) || "",
    done: Boolean(s.done),
  }));
}

function lastForExercise(name, week, dayIdx, repLabel) {
  const target = nameKey(name);
  let best = null;
  let sheetHistory = null;
  for (const w of allWeeks()) {
    w.days.forEach((d, di) => {
      d.exercises.forEach((ex, ei) => {
        if ((ex.repLabel || "") !== (repLabel || "")) return;
        const earlier = w.number < week || (w.number === week && di < dayIdx);
        if (!earlier) return;
        const user = getLog(w.number, di, ei);
        const alts = altsOf(ex);
        const selectedName = user?.name || alts[Number(user?.alt || 0)]?.name || ex.name;
        const candidates = [
          { ...user, name: selectedName },
          ...Object.entries(user?.variants || {}).filter(([alt]) => Number(alt) !== Number(user?.alt || 0))
            .map(([alt, log]) => ({ ...log, name: alts[Number(alt)]?.name })),
        ];
        for (const log of candidates) {
          if (nameKey(log.name) !== target || !Array.isArray(log.sets)) continue;
          if ((log.source === "prefill" || log.source === "sheet") && !log.done && !log.sets.some((s) => s.done)) continue;
          if (!log.sets.some((s) => String(s.weight ?? "").trim() || /^\d+(?:[.,]\d+)?$/.test(String(s.reps ?? "").trim()))) continue;
          if (!best || w.number > best.week || (w.number === best.week && di >= best.dayIdx)) {
            best = { week: w.number, dayIdx: di, day: dayShort(d.name), sets: log.sets, name: log.name, source: "user" };
          }
        }
        if (nameKey(ex.name) === target && (ex.sheetLogs || []).some((s) => s.value)) {
          sheetHistory = { week: w.number, dayIdx: di, day: dayShort(d.name), sets: sheetSets(ex), name: ex.name, source: "sheet" };
        }
      });
    });
  }
  return best || sheetHistory;
}

function beforeBreak(name, week) {
  const target = nameKey(name);
  let best = null;
  for (const w of allWeeks()) {
    if (w.number <= week) continue;
    w.days.forEach((d, di) => {
      d.exercises.forEach((ex) => {
        if (nameKey(ex.name) !== target) return;
        const sets = sheetSets(ex);
        if (!sets.some((s) => s.weight)) return;
        if (!best || w.number > best.week) best = { week: w.number, sets };
      });
    });
  }
  return best;
}

function historyFor(name, week, dayIdx, limit = 4) {
  const target = nameKey(name);
  const rows = [];
  for (const w of allWeeks()) {
    w.days.forEach((d, di) => {
      d.exercises.forEach((ex, ei) => {
        if (nameKey(ex.name) !== target) return;
        const earlier = w.number < week || (w.number === week && di < dayIdx);
        if (!earlier) return;
        const user = getLog(w.number, di, ei);
        const sets = user?.sets?.some((s) => s.weight) ? user.sets : sheetSets(ex);
        if (!sets.some((s) => s.weight)) return;
        rows.push({ week: w.number, day: dayShort(d.name), sets });
      });
    });
  }
  return rows.slice(-limit).reverse();
}

function formatSets(sets) {
  const parts = (sets || []).filter((s) => s.weight);
  if (!parts.length) return "";
  return parts.map((s) => (s.reps ? `${s.weight} × ${s.reps}` : s.weight)).join("  →  ");
}

function parseKg(str) {
  if (!str) return null;
  const nums = [...String(str).replace(",", ".").matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => parseFloat(m[0]));
  return nums.length ? nums[nums.length - 1] : null;
}

function bumpWeight(str, delta) {
  const raw = String(str || "").replace(",", ".");
  const m = raw.match(/-?\d+(?:\.\d+)?/g);
  if (!m) return delta > 0 ? String(delta) : "";
  const last = m[m.length - 1];
  const idx = raw.lastIndexOf(last);
  const next = Math.round((parseFloat(last) + delta) * 4) / 4;
  const txt = Number.isInteger(next) ? String(next) : String(next);
  return raw.slice(0, idx) + txt + raw.slice(idx + last.length);
}

function formatKg(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 4) / 4);
}

function compareLast(sets, lastSets) {
  if (!lastSets?.length) return null;
  const now = parseKg(sets[sets.length - 1]?.weight);
  const prev = parseKg(lastSets[lastSets.length - 1]?.weight);
  if (now == null || prev == null) return null;
  const diff = Math.round((now - prev) * 4) / 4;
  if (diff > 0) return { dir: "up", text: `+${formatKg(diff)} kg vs sidst` };
  if (diff < 0) return { dir: "down", text: `${formatKg(diff)} kg vs sidst` };
  return { dir: "same", text: "Samme kg som sidst" };
}

function warmupLoads(ex, working) {
  const kg = parseKg(working);
  if (kg == null) return [];
  const n = parseInt(String(ex.warmupSets || "1").split("-").pop(), 10) || 1;
  const plans = {
    1: [0.6],
    2: [0.5, 0.7],
    3: [0.45, 0.65, 0.85],
    4: [0.45, 0.6, 0.75, 0.85],
  };
  const pcts = plans[Math.min(4, Math.max(1, n))] || plans[1];
  const prefix = String(working).match(/2\s*x/i) ? "2x " : "";
  return pcts.map((p, i) => `WU ${i + 1}: ${prefix}${formatKg(Math.round((kg * p) * 4) / 4)} kg`);
}

function restSeconds(rest) {
  return ProgramState.restSeconds(rest, state.prefs.restBias);
}

function dayProgress(week, dayIdx, day) {
  if (day.type === "rest") {
    const done = Boolean(state.logs[logKey(week, dayIdx, "rest")]?.done);
    return { done: done ? 1 : 0, total: 1, rest: true };
  }
  const total = day.exercises.filter((ex) => !ex.optional).length;
  const done = day.exercises.filter((ex, i) => !ex.optional && getLog(week, dayIdx, i)?.done).length;
  return { done, total, rest: false };
}

function weekProgress(weekObj) {
  let done = 0;
  let total = 0;
  weekObj.days.forEach((d, i) => {
    if (d.type === "rest" || d.optional) return;
    const p = dayProgress(weekObj.number, i, d);
    done += p.done;
    total += p.total;
  });
  return { done, total };
}

function lastStartedWeek() {
  let n = 1;
  for (const w of allWeeks()) {
    const started = w.days.some((d, di) =>
      !d.optional && d.exercises.some((_, ei) => Boolean(getLog(w.number, di, ei)?.done))
    );
    if (started) n = w.number;
  }
  return n;
}

function nextIncomplete() {
  const start = lastStartedWeek();
  for (const w of allWeeks()) {
    if (w.number < start) continue;
    for (let i = 0; i < w.days.length; i++) {
      const d = w.days[i];
      if (d.type === "rest" || d.optional) continue;
      const p = dayProgress(w.number, i, d);
      if (p.done < p.total) return { week: w, day: d, dayIdx: i, progress: p };
    }
  }
  return null;
}

function heavierCount() {
  const latest = new Map();
  for (const w of allWeeks()) {
    w.days.forEach((d, di) => {
      d.exercises.forEach((ex, ei) => {
        const log = getLog(w.number, di, ei);
        if (!log?.sets?.some((s) => s.weight)) return;
        const key = nameKey(ex.name);
        const prev = latest.get(key);
        if (!prev || w.number > prev.week || (w.number === prev.week && di >= prev.dayIdx)) {
          latest.set(key, { week: w.number, dayIdx: di, sets: log.sets, name: ex.name });
        }
      });
    });
  }
  let n = 0;
  for (const row of latest.values()) {
    const last = lastForExercise(row.name, row.week, row.dayIdx);
    if (compareLast(row.sets, last?.sets)?.dir === "up") n += 1;
  }
  return n;
}

function ytSearch(q) {
  return "https://www.youtube.com/results?search_query=" + encodeURIComponent(q);
}

const ABS = [
  { name: "Dragon fly", youtube: ytSearch("dragon flag abs"), role: "lower", reps: "5-8" },
  { name: "Weighted sit up", youtube: ytSearch("weighted sit up"), role: "flex", reps: "10-15" },
  { name: "Weighted leg raises", youtube: ytSearch("weighted lying leg raise"), role: "lower", reps: "10-15" },
  { name: "Butterfly", youtube: ytSearch("butterfly sit up"), role: "flex", reps: "12-15" },
  { name: "Atomic situp", youtube: ytSearch("atomic sit up"), role: "flex", reps: "8-12" },
  { name: "Rullemarie", youtube: ytSearch("ab wheel rollout"), role: "anti", reps: "8-12" },
  { name: "Cable Crunch", youtube: "https://youtu.be/epBrpaGHMcg", role: "flex", reps: "12-15" },
  { name: "Toe toucher", youtube: ytSearch("toe touch crunch"), role: "flex", reps: "12-15" },
  { name: "Side jackknife", youtube: ytSearch("side jackknife abs"), role: "side", reps: "10-12" },
  { name: "Jackknife", youtube: ytSearch("jackknife abs exercise"), role: "lower", reps: "10-12" },
  { name: "Rulle Rundt", youtube: ytSearch("windshield wipers abs"), role: "side", reps: "8-12" },
  { name: "Bottoms up", youtube: ytSearch("bottoms up reverse crunch"), role: "lower", reps: "10-15" },
  { name: "Situp + leg raises med bold", youtube: ytSearch("sit up leg raise medicine ball"), role: "flex", reps: "10-12" },
  { name: "Skrå bænk mave", youtube: ytSearch("decline sit up"), role: "flex", reps: "12-15" },
  { name: "Sit up", youtube: ytSearch("sit up exercise"), role: "flex", reps: "12-15" },
  { name: "Dumbell Side Bend", youtube: ytSearch("dumbbell side bend"), role: "side", reps: "12-15" },
  { name: "Bold Side", youtube: ytSearch("medicine ball side crunch"), role: "side", reps: "12-15" },
  { name: "Hanging leg Raises", youtube: "https://youtu.be/rGqwkinWqYI", role: "lower", reps: "8-12" },
  { name: "Side sit up", youtube: ytSearch("side sit up oblique"), role: "side", reps: "10-15" },
  { name: "Plank", youtube: ytSearch("plank exercise"), role: "anti", reps: "30-45s" },
  { name: "Leg raises over obstacle", youtube: ytSearch("lying leg raise over bench"), role: "lower", reps: "10-12" },
  { name: "Hanging leg side raises", youtube: ytSearch("hanging oblique knee raise"), role: "side", reps: "8-12" },
  { name: "L-sit", youtube: ytSearch("L sit hold"), role: "anti", reps: "15-30s" },
  { name: "Nedre Side Vægt", youtube: ytSearch("side lying weighted oblique crunch"), role: "side", reps: "12-15" },
  { name: "Nedre Side Kabel", youtube: ytSearch("cable side crunch"), role: "side", reps: "12-15" },
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function makeAbsWod() {
  const roles = ["flex", "lower", "side", "anti"];
  const used = new Set();
  return roles.map((role) => {
    const pool = ABS.filter((a) => a.role === role && !used.has(a.name));
    const a = pick(pool);
    used.add(a.name);
    return { name: a.name, youtube: a.youtube, reps: a.reps, sets: 3, done: false };
  });
}

function bumpReps(str, delta) {
  const raw = String(str || "").trim();
  const m = raw.match(/-?\d+/);
  if (!m) return String(Math.max(1, 8 + delta));
  const n = Math.max(1, parseInt(m[0], 10) + delta);
  if (raw.includes("-") || raw.includes("s")) return String(n);
  return raw.slice(0, m.index) + n + raw.slice(m.index + m[0].length);
}

function altsOf(ex) {
  const list = [{ name: ex.name, youtube: ex.youtube }];
  if (ex.sub1?.name) list.push({ name: ex.sub1.name, youtube: ex.sub1.youtube });
  if (ex.sub2?.name) list.push({ name: ex.sub2.name, youtube: ex.sub2.youtube });
  return list;
}

function chosenOf(week, dayIdx, exIdx, ex) {
  const alts = altsOf(ex);
  const i = Number(getLog(week, dayIdx, exIdx)?.alt || 0);
  return alts[((i % alts.length) + alts.length) % alts.length];
}

function parseHash() {
  const h = (location.hash || "#/").replace(/^#/, "");
  const parts = h.split("/").filter(Boolean);
  if (parts[0] === "p") {
    const id = parts[1];
    if (PROGRAMS[id] && id !== state.activeProgram) selectProgram(id, false);
    parts.splice(0, 2);
  }
  if (parts[0] === "warmup") return { view: "warmup" };
  if (parts[0] === "settings") return { view: "settings" };
  if (parts[0] === "abs" && parts[1] === "wod") return { view: "wod" };
  if (parts[0] === "abs") return { view: "abs" };
  if (parts[0] === "pain" && parts[1] === "d") return { view: "pain-day", day: Number(parts[2]) };
  if (parts[0] === "pain") return { view: "pain" };
  if (parts[0] === "w" && parts[2] === "d") {
    let open = null;
    if (parts[4] === "e") {
      if (parts[5] === "x") open = -1;
      else if (parts[5] != null && parts[5] !== "") open = Number(parts[5]);
    }
    return { view: "workout", week: Number(parts[1]), day: Number(parts[3]), open };
  }
  if (parts[0] === "w") return { view: "home", week: Number(parts[1]) };
  return { view: "home", week: state.week };
}

function go(path) {
  const next = String(path || "").replace(/^#/, "");
  const pathPart = next.startsWith("/") ? next : `/${next}`;
  const normalized = pathPart.startsWith("/p/") ? pathPart : `/p/${state.activeProgram}${pathPart}`;
  if (location.hash === `#${normalized}`) {
    render();
    return;
  }
  location.hash = normalized;
}

function selectProgram(id, navigate = true) {
  if (!PROGRAMS[id]) return;
  state.programWeeks[state.activeProgram] = state.week;
  state.activeProgram = id;
  PROGRAM = PROGRAMS[id];
  state.week = state.programWeeks[id] || 1;
  state.openKey = null;
  timer.skip();
  saveState();
  if (navigate) go(`/w/${state.week}`);
}

function programPicker() {
  const box = el(`<section class="program-picker">
    <label for="program-select">Træningsprogram</label>
    <select id="program-select" aria-label="Træningsprogram">${Object.entries(PROGRAMS).map(([id, p]) => `<option value="${id}" ${state.activeProgram === id ? "selected" : ""}>${escapeHtml(p.shortTitle)}</option>`).join("")}</select>
    <p>${escapeHtml(PROGRAM.description)}</p>
    <small>Hvert program husker dine vægte og din uge.</small>
  </section>`);
  $("select", box).addEventListener("change", (e) => selectProgram(e.target.value));
  return box;
}

function toast(msg) {
  let t = $(".toast");
  if (!t) {
    t = el('<div class="toast"></div>');
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._id);
  toast._id = setTimeout(() => t.classList.remove("show"), 1800);
}

function buzz(pattern) {
  if (!state.prefs.vibrate) return;
  try { navigator.vibrate?.(pattern); } catch {}
}

async function setWake(on) {
  if (!state.prefs.keepAwake) on = false;
  try {
    if (on && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");
    } else {
      await wakeLock?.release();
      wakeLock = null;
    }
  } catch {}
}

function paintTimer() {
  let dock = $(".timer-dock");
  if (!dock) {
    dock = el(`<div class="timer-dock">
      <div class="timer-time">0:00</div>
      <div class="timer-lab"><div class="a">Pause</div><div class="b"></div></div>
      <div class="timer-acts">
        <button data-plus>+30s</button>
        <button data-skip>Skip</button>
      </div>
    </div>`);
    document.body.appendChild(dock);
    $("[data-plus]", dock).addEventListener("click", () => timer.add(30));
    $("[data-skip]", dock).addEventListener("click", () => timer.skip());
  }
  const active = timer.total > 0 || timer.remaining > 0 || timer.ringing;
  dock.classList.toggle("on", active);
  dock.classList.toggle("done", timer.ringing);
  document.body.classList.toggle("has-timer", active);
  const mm = Math.floor(timer.remaining / 60);
  const ss = String(timer.remaining % 60).padStart(2, "0");
  $(".timer-time", dock).textContent = timer.ringing ? "Nu" : `${mm}:${ss}`;
  $(".timer-lab .a", dock).textContent = timer.ringing ? "Pause færdig" : "Pause";
  $(".timer-lab .b", dock).textContent = timer.label || "";
}

function render() {
  const route = parseHash();
  if (route.week && weekByNumber(route.week)) {
    state.week = route.week;
    saveState();
  }
  const y = window.scrollY;
  const root = $("#app");
  if (route.view === "warmup") {
    setWake(false);
    root.replaceChildren(viewWarmup());
  } else if (route.view === "settings") {
    setWake(false);
    root.replaceChildren(viewSettings());
  } else if (route.view === "abs") {
    setWake(false);
    root.replaceChildren(viewAbs());
  } else if (route.view === "wod") {
    setWake(true);
    root.replaceChildren(viewAbsWod());
  } else if (route.view === "pain") {
    setWake(false);
    root.replaceChildren(viewPain());
  } else if (route.view === "pain-day") {
    setWake(true);
    root.replaceChildren(viewPainDay(route.day));
  } else if (route.view === "workout") {
    setWake(true);
    root.replaceChildren(viewWorkout(route.week, route.day, route.open));
  } else {
    setWake(false);
    root.replaceChildren(viewHome(route.week || state.week));
  }
  paintTimer();
  $$(".tabbar").forEach((n) => n.remove());
  if (route.view !== "settings") {
    const tab = (route.view === "abs" || route.view === "wod") ? "abs" : "train";
    document.body.appendChild(bottomNav(tab));
  }
  if (route.view === "workout") {
    const open = $(".ex-card.open");
    if (open) open.scrollIntoView({ block: "nearest", behavior: "auto" });
    else window.scrollTo(0, y);
  } else window.scrollTo(0, 0);
}

function bottomNav(active) {
  const week = state?.week || 1;
  const bar = el(`<nav class="tabbar">
    <button type="button" data-tab="train" class="${active === "train" ? "on" : ""}">Træning</button>
    <button type="button" data-tab="abs" class="${active === "abs" ? "on" : ""}">Mave</button>
  </nav>`);
  $("[data-tab=train]", bar).addEventListener("click", () => go(`/w/${week}`));
  $("[data-tab=abs]", bar).addEventListener("click", () => go("/abs"));
  return bar;
}

function topbar(title, backHash) {
  const bar = el(`<header class="topbar">
    ${backHash ? `<button class="icon-btn" data-back aria-label="Tilbage">${ICONS.back}</button>` : `<img src="icon-192.png" alt="" width="42" height="42" style="border-radius:12px">`}
    <h1>${escapeHtml(title)}</h1>
    <button class="icon-btn" data-set aria-label="Indstillinger">${ICONS.gear}</button>
  </header>`);
  bar.querySelector("[data-back]")?.addEventListener("click", () => go(backHash));
  bar.querySelector("[data-set]").addEventListener("click", () => go("/settings"));
  return bar;
}

function viewHome(weekNum) {
  const week = weekByNumber(weekNum) || allWeeks()[0];
  const wrap = el(`<div>
    <div class="page">
      <button class="day-card now" type="button" data-abs>
        <div class="day-mark">M</div>
        <div>
          <div class="title">Mave</div>
          <div class="sub">Øvelser + WOD</div>
        </div>
        <div class="chev">›</div>
      </button>
      <div class="week-pills"></div>
      <h2 class="week-title">Uge ${week.number}${week.phase ? ` · ${escapeHtml(week.phase)}` : ""}</h2>
      <div class="day-list"></div>
    </div>
  </div>`);
  wrap.prepend(topbar("Træning"));
  $(".page", wrap).prepend(programPicker());
  const progress = weekProgress(week);
  $(".week-title", wrap).after(el(`<p class="program-progress">${progress.done}/${progress.total} øvelser i hovedprogrammet · ${escapeHtml(week.block)}</p>`));
  const guidance = el(`<details class="program-guide"><summary>Programguide og opvarmning</summary>
    ${(PROGRAM.guide || []).map((text) => `<p>${escapeHtml(text)}</p>`).join("")}
    <button class="btn" data-warmup>Se opvarmning</button></details>`);
  $("[data-warmup]", guidance).addEventListener("click", () => go("/warmup"));
  $(".week-pills", wrap).before(guidance);
  $("[data-abs]", wrap).addEventListener("click", () => go("/abs"));

  const pills = $(".week-pills", wrap);
  allWeeks().forEach((w) => {
    const b = el(`<button class="week-pill ${w.number === week.number ? "on" : ""}" type="button">${w.number}</button>`);
    b.addEventListener("click", (e) => {
      e.preventDefault();
      go(`/w/${w.number}`);
    });
    pills.appendChild(b);
  });

  const list = $(".day-list", wrap);
  let workoutNo = 0;
  week.days.forEach((day, i) => {
    if (day.type !== "rest") workoutNo += 1;
    const p = dayProgress(week.number, i, day);
    const complete = p.done === p.total && p.total > 0;
    const card = el(`<button class="day-card ${complete ? "done" : ""} ${day.type === "rest" ? "rest" : ""}" type="button">
      <div class="day-mark">${day.type === "rest" ? "R" : workoutNo}</div>
      <div>
        <div class="title">${escapeHtml(dayShort(day.name))}${day.optional ? " · valgfri" : ""}</div>
        <div class="sub">${day.type === "rest" ? escapeHtml(day.note || "Hvile") : `${p.done}/${p.total} øvelser`}</div>
      </div>
      <div class="chev">›</div>
    </button>`);
    card.addEventListener("click", () => go(`/w/${week.number}/d/${i}`));
    list.appendChild(card);
  });
  return wrap;
}

function renderSearch(q, box) {
  const query = q.trim().toLowerCase();
  box.replaceChildren();
  if (query.length < 2) {
    box.hidden = true;
    return;
  }
  const hits = [];
  for (const w of [...allWeeks()].reverse()) {
    w.days.forEach((d, di) => {
      d.exercises.forEach((ex, ei) => {
        if (!ex.name.toLowerCase().includes(query)) return;
        hits.push({ w, d, di, ei, ex });
      });
    });
  }
  const uniq = [];
  const seen = new Set();
  for (const h of hits) {
    const k = `${h.ex.name}|${h.w.number}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(h);
    if (uniq.length >= 8) break;
  }
  box.hidden = uniq.length === 0;
  uniq.forEach((h) => {
    const last = lastForExercise(h.ex.name, 99, 99);
    const btn = el(`<button class="search-hit">
      <div class="t">${escapeHtml(h.ex.name)}</div>
      <div class="s">Uge ${h.w.number} · ${escapeHtml(dayShort(h.d.name))}${last ? " · sidst " + escapeHtml(formatSets(last.sets)) : ""}</div>
    </button>`);
    btn.addEventListener("click", () => go(`/w/${h.w.number}/d/${h.di}/e/${h.ei}`));
    box.appendChild(btn);
  });
}

function advanceAfterExercise(week, dayIdx, exIdx) {
  const w = weekByNumber(week);
  const day = w?.days[dayIdx];
  if (day?.optional && dayProgress(week, dayIdx, day).done === dayProgress(week, dayIdx, day).total) {
    toast("Ekstra pas færdigt");
    go(`/w/${week}`);
    return;
  }
  if (day && exIdx + 1 < day.exercises.length) {
    go(`/w/${week}/d/${dayIdx}/e/${exIdx + 1}`);
    return;
  }
  const nxt = nextIncomplete();
  if (!nxt) {
    toast("Programmet er færdigt");
    go(`/w/${week}`);
    return;
  }
  if (nxt.week.number === week && nxt.dayIdx === dayIdx) {
    go(`/w/${week}/d/${dayIdx}`);
    return;
  }
  toast("Pas færdigt");
  go(`/w/${nxt.week.number}/d/${nxt.dayIdx}`);
}

function viewWorkout(weekNum, dayIdx, openIdx) {
  const week = weekByNumber(weekNum);
  const day = week?.days[dayIdx];
  if (!week || !day) return viewHome(weekNum);

  if (day.type === "rest") {
    const done = Boolean(state.logs[logKey(weekNum, dayIdx, "rest")]?.done);
    const wrap = el(`<div>
      <div class="page rest-page">
        <div class="day-mark" style="margin:0 auto 12px;width:64px;height:64px;font-size:22px">R</div>
        <h2>Hvile</h2>
        <p>${escapeHtml(day.note || "")}</p>
        <button class="btn ${done ? "" : "primary"}" data-rest>${done ? "Fjern" : "Færdig"}</button>
      </div>
    </div>`);
    wrap.prepend(topbar(week.name, `/w/${weekNum}`));
    $("[data-rest]", wrap).addEventListener("click", () => {
      patchLog(weekNum, dayIdx, "rest", { done: !done });
      render();
    });
    return wrap;
  }

  const p = dayProgress(weekNum, dayIdx, day);
  let open = openIdx;
  if (open === -1) {
    open = -1;
  } else if (open == null || Number.isNaN(open)) {
    open = day.exercises.findIndex((_, i) => !getLog(weekNum, dayIdx, i)?.done);
    if (open < 0) open = 0;
    open = Math.max(0, Math.min(day.exercises.length - 1, open));
  } else {
    open = Math.max(0, Math.min(day.exercises.length - 1, open));
  }
  state.openKey = open < 0 ? null : logKey(weekNum, dayIdx, open);

  const wrap = el(`<div>
    <div class="page workout">
      <div class="progress-wrap">
        <p class="program-caption">${escapeHtml(PROGRAM.shortTitle)}${week.phase ? ` · ${escapeHtml(week.phase)}` : ""}</p>
        <div class="progress-meta"><span>${escapeHtml(dayShort(day.name))}</span><span>${p.done}/${p.total}</span></div>
        <div class="bar"><span style="width:${p.total ? (p.done / p.total) * 100 : 0}%"></span></div>
      </div>
      ${day.note ? `<p class="session-note">${escapeHtml(day.note)}</p>` : ""}
      <div class="ex-list"></div>
    </div>
  </div>`);
  wrap.prepend(topbar(week.name, `/w/${weekNum}`));
  const list = $(".ex-list", wrap);
  day.exercises.forEach((ex, i) => list.appendChild(exerciseCard(weekNum, dayIdx, i, ex, i === open)));
  return wrap;
}

function lastShort(sets) {
  const parts = (sets || []).map((s) => s.weight).filter(Boolean);
  return parts.length ? parts.join(" → ") : "";
}

function previousSetText(set, ex) {
  if (ex.unit === "sek") return set.reps ? `${set.reps} sekunder` : "Ingen tid registreret";
  const weight = String(set.weight ?? "").trim();
  const reps = String(set.reps ?? "").trim();
  if (!weight && !reps) return "Ikke registreret";
  return `${weight ? `${weight} kg` : "Vægt ikke registreret"}${reps ? ` × ${reps} reps` : " · reps ikke registreret"}`;
}

function previousSession(last, ex) {
  if (!last) return '<section class="previous-session empty"><p>Ingen tidligere registrering af denne øvelse endnu.</p></section>';
  const title = last.source === "sheet" ? "Fra dit gamle Excel-ark" : "Sidst registreret";
  const recorded = last.sets.filter((set) => String(set.weight ?? "").trim() || String(set.reps ?? "").trim()).length;
  const count = recorded === last.sets.length ? `${recorded} sæt` : `${recorded} af ${last.sets.length} sæt registreret`;
  return `<section class="previous-session" aria-label="Tidligere træning">
    <p class="previous-title">${title} · uge ${last.week} · ${escapeHtml(last.day)}</p>
    <p class="previous-count">${count}</p>
    <ol>${last.sets.map((set, i) => `<li><span>Sæt ${i + 1}</span><b>${escapeHtml(previousSetText(set, ex))}</b></li>`).join("")}</ol>
  </section>`;
}

function abbreviationHelp(ex, chosen) {
  const text = [chosen.name, ex.cue, ex.intensity, ex.reps].join(" ");
  const terms = [["Reps", "Gentagelser. 4–6 reps betyder 4 til 6 gentagelser i hvert sæt."]];
  if (ex.rir) {
    let definition = "Gentagelser i reserve: 0 = ingen tilbage, 1 = én tilbage, 2 = to tilbage, 3 = tre tilbage. Stop, når du vurderer, at det angivne antal gentagelser er tilbage.";
    if (/hack squat|smith machine bench press/i.test(chosen.name)) definition += " Ved denne øvelse skal du ved RIR 0 stoppe uden at forsøge og fejle næste gentagelse.";
    terms.push(["RIR", definition]);
  }
  else terms.push(["RPE", "Hvor krævende sættet er på en skala til 10. RPE 10 = ingen gentagelser tilbage, 9 = cirka én tilbage, 8 = cirka to tilbage."]);
  const definitions = [
    [/\bDB\b/i, "DB", "Håndvægte (dumbbell)."],
    [/\bBB\b/i, "BB", "Vægtstang (barbell)."],
    [/\bEZ[- ]?Bar\b/i, "EZ-Bar", "Den bøjede vægtstang."],
    [/\bRDL\b/i, "RDL", "Rumænsk dødløft. Se øvelsens video for udførelsen."],
    [/\bROM\b/i, "ROM", "Bevægelsesudslag: hvor langt du bevæger vægten. Full ROM betyder hele det viste bevægelsesudslag."],
    [/\bLLPs?\b|lengthened partials/i, "LLPs", "Delvise gentagelser i den del af bevægelsen, hvor musklen er strakt. Brug dem kun, når programmet angiver det."],
    [/high[- ]rep/i, "High-rep set", "Et særskilt sæt med flere gentagelser og normalt lettere vægt. Log det separat fra de tunge sæt."],
    [/\bWU\b/i, "WU", "Opvarmningssæt. De tæller ikke med som arbejdssæt."],
    [/failure/i, "Failure", "Du kan ikke gennemføre endnu en hel gentagelse."],
    [/~/, "~", "Cirka. Fx ~8–9 betyder omkring 8 til 9."],
  ];
  for (const [pattern, term, definition] of definitions) if (pattern.test(text)) terms.push([term, definition]);
  if (ex.superset) terms.push([ex.superset, `Superset nr. ${ex.superset.replace(/\D/g, "")}: lav ét sæt af hver øvelse i parret, derefter pause. Gentag parret.`]);
  return `<details class="abbreviation-help"><summary>Forkortelser i denne øvelse</summary><dl>${terms.map(([term, definition]) => `<dt>${escapeHtml(term)}</dt><dd>${escapeHtml(definition)}</dd>`).join("")}</dl></details>`;
}

function supersetHelp(week, dayIdx, ex) {
  if (!ex.superset) return "";
  const pairs = weekByNumber(week).days[dayIdx].exercises
    .map((item, i) => ({ item, name: chosenOf(week, dayIdx, i, item).name }))
    .filter(({ item }) => item.superset === ex.superset);
  const rest = pairs.map(({ item }) => item.rest).find((value) => value && value !== "-");
  return `<p class="technique">${escapeHtml(ex.superset)} = superset: ét sæt ${pairs.map(({ name }) => escapeHtml(name)).join(" → ét sæt ")} → ${escapeHtml(rest || "den angivne")} pause. Gentag parret.</p>`;
}

function exerciseCard(week, dayIdx, exIdx, ex, isOpen) {
  const log = getLog(week, dayIdx, exIdx);
  const done = Boolean(log?.done);
  const chosen = chosenOf(week, dayIdx, exIdx, ex);
  const alts = altsOf(ex);
  const sets = currentSets(week, dayIdx, exIdx, { ...ex, name: chosen.name });
  const last = lastForExercise(chosen.name, week, dayIdx, ex.repLabel);
  const sidst = last?.sets.map((set, i) => ({ set, i }))
    .filter(({ set }) => String(set.weight ?? "").trim() || String(set.reps ?? "").trim())
    .map(({ set, i }) => `Sæt ${i + 1}: ${previousSetText(set, ex)}`).join(" · ");

  const card = el(`<article class="ex-card ${done ? "done" : ""} ${isOpen ? "open" : ""}" data-key="${logKey(week, dayIdx, exIdx)}">
    <div class="ex-head">
      <button class="check" data-check aria-label="Markér lavet">${ICONS.check}</button>
      <button class="ex-toggle" style="flex:1;min-width:0;text-align:left;background:none;border:0;padding:0;color:inherit">
        <div class="ex-name">${escapeHtml(chosen.name)}</div>
        <div class="ex-meta">${sets.length} × ${escapeHtml(ex.reps)}</div>
        ${sidst ? `<div class="last">${last.source === "sheet" ? "Ark" : "Sidst"} · uge ${last.week}: ${escapeHtml(sidst)}</div>` : ""}
      </button>
      ${alts.length > 1 ? `<button class="alt-btn" data-swap type="button" aria-label="Byt øvelse">⇄</button>` : ""}
      ${chosen.youtube ? `<a class="yt" href="${escapeHtml(chosen.youtube)}" target="_blank" rel="noopener" aria-label="Video">${ICONS.play}</a>` : ""}
    </div>
    <div class="ex-body">
      <div class="exercise-plan">
        ${ex.repLabel ? `<p class="rep-label">${escapeHtml(ex.repLabel)}</p>` : ""}
        <p>Opvarmning: <b>${escapeHtml(ex.warmupSets || "0")} sæt</b> · Pause: <b>${ex.rest === "-" ? "direkte til næste øvelse" : escapeHtml(ex.rest)}</b></p>
        ${supersetHelp(week, dayIdx, ex)}
        ${ex.intensity ? `<p class="technique">Teknik på sidste sæt: <b>${escapeHtml(ex.intensity)}</b></p>` : ""}
        ${ex.rir ? '<p class="rir-help">RIR = gentagelser i reserve. 0 = ingen tilbage, 1 = én tilbage, 2 = to tilbage.</p>' : `<p class="rir-help">RPE = hvor krævende sættet er (op til 10). 10 = ingen reps tilbage, 9 = én tilbage, 8 = to tilbage.</p><p>RPE-mål: ${escapeHtml(ex.earlyRpe)} → ${escapeHtml(ex.lastRpe)}</p>`}
        ${techniqueGuide(ex.intensity)}
        ${abbreviationHelp(ex, chosen)}
        ${ex.cue ? `<details><summary>Teknik og vejledning</summary><p>${escapeHtml(ex.cue)}</p></details>` : ""}
      </div>
      ${previousSession(last, ex)}
      <div class="sets"></div>
    </div>
  </article>`);

  const setsBox = $(".sets", card);
  sets.forEach((s, i) => {
    const row = el(`<div class="set-row ${s.done ? "done" : ""}">
      <div class="set-top">
        <button class="set-check ${s.done ? "on" : ""}" data-sd="${i}" aria-label="Sæt lavet">${ICONS.check}</button>
        <div class="set-lab">Sæt ${i + 1}${ex.rir?.[i] != null ? ` · RIR ${escapeHtml(ex.rir[i])}` : ""}${ex.intensity && i === sets.length - 1 ? " · + teknik" : ""}</div>
      </div>
      <div class="set-grid">
        <div class="step">
          <span>Kg</span>
          <input class="field" aria-label="Kg, sæt ${i + 1}" inputmode="decimal" value="${escapeHtml(s.weight)}" data-w="${i}" />
          <div class="step-row">
            <button class="nudge" data-b="${i}" data-d="-1.25">−</button>
            <button class="nudge" data-b="${i}" data-d="1.25">+</button>
          </div>
        </div>
        <div class="step">
          <span>${ex.unit === "sek" ? "Sekunder" : "Reps"}</span>
          <input class="field" aria-label="${ex.unit === "sek" ? "Sekunder" : "Reps"}, sæt ${i + 1}" inputmode="decimal" placeholder="${escapeHtml(ex.reps || "")}" value="${escapeHtml(s.reps)}" data-r="${i}" />
          <div class="step-row">
            <button class="nudge" data-rb="${i}" data-d="-1">−</button>
            <button class="nudge" data-rb="${i}" data-d="1">+</button>
          </div>
        </div>
      </div>
    </div>`);
    setsBox.appendChild(row);
  });

  const persist = (userInput = true) => {
    const next = $$("[data-w]", setsBox).map((wEl, i) => ({
      weight: wEl.value.trim(),
      reps: setsBox.querySelector(`[data-r="${i}"]`)?.value.trim() || "",
      done: setsBox.querySelector(`[data-sd="${i}"]`)?.classList.contains("on") || false,
    }));
    const allDone = next.length > 0 && next.every((s) => s.done);
    const source = userInput === false ? getLog(week, dayIdx, exIdx)?.source || "prefill" : "user";
    patchLog(week, dayIdx, exIdx, { name: chosen.name, sets: next, done: allDone, alt: Number(log?.alt || 0), source });
    card.classList.toggle("done", allDone);
    const day = weekByNumber(week)?.days[dayIdx];
    if (day) {
      const p = dayProgress(week, dayIdx, day);
      const meta = $(".progress-meta");
      if (meta) meta.lastElementChild.textContent = `${p.done}/${p.total}`;
      const bar = $(".progress-wrap .bar > span");
      if (bar && p.total) bar.style.width = `${(p.done / p.total) * 100}%`;
    }
    return next;
  };

  setsBox.addEventListener("input", persist);

  $$("[data-b]", card).forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.b);
      const input = setsBox.querySelector(`[data-w="${i}"]`);
      input.value = bumpWeight(input.value, Number(btn.dataset.d));
      persist();
    });
  });
  $$("[data-rb]", card).forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.rb);
      const input = setsBox.querySelector(`[data-r="${i}"]`);
      input.value = bumpReps(input.value || ex.reps, Number(btn.dataset.d));
      persist();
    });
  });
  $("[data-swap]", card)?.addEventListener("click", (e) => {
    e.stopPropagation();
    const nextAlt = ((Number(log?.alt || 0) + 1) % alts.length);
    persist(false);
    const current = getLog(week, dayIdx, exIdx);
    const variants = { ...(current.variants || {}), [Number(log?.alt || 0)]: { sets: current.sets, done: current.done, source: current.source } };
    const restored = variants[nextAlt] || { sets: sheetSets(ex).map((s) => ({ ...s, weight: "", done: false })), done: false };
    patchLog(week, dayIdx, exIdx, { ...restored, variants, alt: nextAlt, name: alts[nextAlt].name });
    render();
  });

  $$("[data-sd]", card).forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.classList.toggle("on");
      btn.closest(".set-row").classList.toggle("done", btn.classList.contains("on"));
      const next = persist();
      if (btn.classList.contains("on")) {
        buzz(40);
        const seconds = restSeconds(ex.rest);
        if (seconds > 0) timer.start(seconds, chosen.name);
        else timer.skip();
        if (ex.superset) {
          const day = weekByNumber(week).days[dayIdx];
          const pair = day.exercises.map((e, index) => ({ e, index })).filter(({ e }) => e.superset === ex.superset);
          const other = pair.find(({ index }) => index !== exIdx);
          if (other && !getLog(week, dayIdx, other.index)?.sets?.[Number(btn.dataset.sd)]?.done) {
            go(`/w/${week}/d/${dayIdx}/e/${other.index}`);
            return;
          }
          const pending = pair.find(({ index }) => !getLog(week, dayIdx, index)?.done);
          if (pending) { go(`/w/${week}/d/${dayIdx}/e/${pending.index}`); return; }
        }
      }
      if (next.every((s) => s.done)) {
        toast("Øvelse færdig");
        advanceAfterExercise(week, dayIdx, exIdx);
      }
    });
  });

  $("[data-check]", card).addEventListener("click", (e) => {
    e.stopPropagation();
    persist();
    const now = !getLog(week, dayIdx, exIdx)?.done;
    const next = currentSets(week, dayIdx, exIdx, { ...ex, name: chosen.name }).map((s) => ({ ...s, done: now }));
    patchLog(week, dayIdx, exIdx, { done: now, name: chosen.name, sets: next, source: "user" });
    buzz(now ? 50 : 20);
    if (now) {
      toast("Øvelse streget af");
      advanceAfterExercise(week, dayIdx, exIdx);
    } else {
      render();
    }
  });

  $(".ex-toggle", card).addEventListener("click", () => {
    go(isOpen ? `/w/${week}/d/${dayIdx}/e/x` : `/w/${week}/d/${dayIdx}/e/${exIdx}`);
  });

  if (!log && sets.some((s) => s.weight || s.reps)) {
    patchLog(week, dayIdx, exIdx, { name: ex.name, sets, done: false, source: "prefill" });
  }

  return card;
}

function techniqueGuide(technique) {
  const t = String(technique || "").toLowerCase();
  let text = "";
  if (t.includes("llp") || t.includes("lengthened partial")) text = "Failure = ingen hele gentagelser tilbage. LLPs = fortsæt derefter med delvise gentagelser i musklens strakte position.";
  else if (t.includes("drop")) text = "Drop set = efter sættet sænkes vægten ca. 25%. Fortsæt og gentag vægtreduktionen én gang mere (3 dele i alt).";
  else if (t.includes("myo")) text = "Myo-reps = når du ikke kan tage endnu en hel gentagelse, hvil 5 sekunder og forsøg 2 ekstra reps. Gentag, indtil du ikke kan gennemføre 2 hele reps.";
  else if (t.includes("static")) text = "Statisk hold/stræk = efter sidste sæt holdes den nederste position under spænding i 30 sekunder.";
  else if (t.includes("failure")) text = "Failure = du kan ikke gennemføre endnu en hel gentagelse.";
  else if (t === "n/a") text = "N/A = ingen ekstra intensitetsteknik i dette sæt.";
  return text ? `<p>${escapeHtml(text)}</p>` : "";
}

function viewPain() {
  const wrap = el(`<div><div class="page"><div class="day-list"></div></div></div>`);
  wrap.prepend(topbar("Book of Pain"));
  const list = $(".day-list", wrap);
  (PAIN?.days || []).forEach((day, i) => {
    const card = el(`<button class="day-card" type="button">
      <div class="day-mark">${i + 1}</div>
      <div>
        <div class="title">${escapeHtml(day.name)}</div>
        <div class="sub">${escapeHtml(day.groups.join(" · "))}</div>
      </div>
      <div class="chev">›</div>
    </button>`);
    card.addEventListener("click", () => go(`/pain/d/${i}`));
    list.appendChild(card);
  });
  return wrap;
}

function viewPainDay(dayIdx) {
  const day = PAIN?.days?.[dayIdx];
  if (!day) return viewPain();
  const wrap = el(`<div><div class="page workout"><div class="ex-list"></div></div></div>`);
  wrap.prepend(topbar(day.name, "/pain"));
  const list = $(".ex-list", wrap);
  day.groups.forEach((gName) => {
    list.appendChild(el(`<h2 class="week-title">${escapeHtml(gName)}</h2>`));
    (PAIN.groups[gName] || []).forEach((ex, i) => {
      const key = `pain|${dayIdx}|${gName}|${i}`;
      const done = Boolean(state.logs[key]?.done);
      const q = ytSearch(ex.name + " exercise");
      const card = el(`<article class="ex-card ${done ? "done" : ""}">
        <div class="ex-head">
          <button class="check" data-k="${escapeHtml(key)}">${ICONS.check}</button>
          <div style="flex:1;min-width:0">
            <div class="ex-name">${escapeHtml(ex.name)}</div>
            <div class="ex-meta">${escapeHtml([ex.reps, ex.weight].filter(Boolean).join(" · "))}</div>
          </div>
          <a class="yt" href="${escapeHtml(q)}" target="_blank" rel="noopener">${ICONS.play}</a>
        </div>
      </article>`);
      $("[data-k]", card).addEventListener("click", () => {
        state.logs[key] = { ...(state.logs[key] || {}), done: !done };
        saveState();
        render();
      });
      list.appendChild(card);
    });
  });
  return wrap;
}

function viewAbs() {
  const wrap = el(`<div>
    <div class="page">
      <button class="cta full" type="button" data-wod>
        <div>
          <div class="k">Mave</div>
          <div class="t">WOD</div>
          <div class="s">3 øvelser · flex + ben + anti-extension</div>
        </div>
        <div class="go">›</div>
      </button>
      <h2 class="week-title">Øvelser</h2>
      <div class="ex-list"></div>
    </div>
  </div>`);
  wrap.prepend(topbar("Mave", `/w/${state.week || 1}`));
  $("[data-wod]", wrap).addEventListener("click", () => {
    state.wod = { items: makeAbsWod(), at: Date.now() };
    saveState();
    go("/abs/wod");
  });
  const list = $(".ex-list", wrap);
  ABS.forEach((a) => {
    list.appendChild(el(`<div class="ex-card">
      <div class="ex-head">
        <div style="flex:1;min-width:0">
          <div class="ex-name">${escapeHtml(a.name)}</div>
          <div class="ex-meta">${escapeHtml(a.reps)}</div>
        </div>
        <a class="yt" href="${escapeHtml(a.youtube)}" target="_blank" rel="noopener" aria-label="Video">${ICONS.play}</a>
      </div>
    </div>`));
  });
  return wrap;
}

function viewAbsWod() {
  if (!state.wod?.items?.length) {
    state.wod = { items: makeAbsWod(), at: Date.now() };
    saveState();
  }
  const wrap = el(`<div>
    <div class="page workout">
      <button class="btn full" type="button" data-again>Ny WOD</button>
      <div class="ex-list" style="margin-top:12px"></div>
    </div>
  </div>`);
  wrap.prepend(topbar("Mave WOD", "/abs"));
  $("[data-again]", wrap).addEventListener("click", () => {
    state.wod = { items: makeAbsWod(), at: Date.now() };
    saveState();
    render();
  });
  const list = $(".ex-list", wrap);
  state.wod.items.forEach((item, i) => {
    const card = el(`<article class="ex-card ${item.done ? "done" : ""} open">
      <div class="ex-head">
        <button class="check" data-check>${ICONS.check}</button>
        <div style="flex:1;min-width:0">
          <div class="ex-name">${escapeHtml(item.name)}</div>
          <div class="ex-meta">3 × ${escapeHtml(item.reps)}</div>
        </div>
        ${item.youtube ? `<a class="yt" href="${escapeHtml(item.youtube)}" target="_blank" rel="noopener">${ICONS.play}</a>` : ""}
      </div>
    </article>`);
    $("[data-check]", card).addEventListener("click", () => {
      state.wod.items[i].done = !state.wod.items[i].done;
      saveState();
      render();
    });
    list.appendChild(card);
  });
  return wrap;
}

function viewWarmup() {
  const wrap = el(`<div><div class="page warmup">
    <h2>Generel opvarmning</h2>
    <p class="cue">5–10 min før hver pas.</p>
    <ul></ul>
    <h2>Øvelsesspecifik</h2>
    <div class="ex-list" id="spec"></div>
  </div></div>`);
  wrap.prepend(topbar("Opvarmning", `/w/${state.week}`));
  const ul = $("ul", wrap);
  PROGRAM.warmup.general.forEach((g) => {
    const li = document.createElement("li");
    if (g.youtube) {
      li.innerHTML = `<a href="${escapeHtml(g.youtube)}" target="_blank" rel="noopener">${escapeHtml(g.name)}</a> — ${escapeHtml(g.detail)}`;
    } else {
      li.textContent = `${g.name} — ${g.detail}`;
    }
    ul.appendChild(li);
  });
  PROGRAM.warmup.specific.forEach((s) => {
    $("#spec", wrap).appendChild(el(`<div class="ex-card open"><div class="ex-head"><div><div class="ex-name">${escapeHtml(s.sets)} warm-up sæt</div><div class="ex-meta">${escapeHtml(s.text)}</div></div></div></div>`));
  });
  return wrap;
}

function viewSettings() {
  const p = state.prefs;
  const wrap = el(`<div><div class="page settings">
    <h2>I centret</h2>
    <label class="toggle"><div>Skærm tændt under pas<span>Så telefonen ikke slukker i pausen</span></div><input type="checkbox" data-awake ${p.keepAwake ? "checked" : ""}></label>
    <label class="toggle"><div>Vibration<span>Når et sæt eller pausen er færdig</span></div><input type="checkbox" data-vib ${p.vibrate ? "checked" : ""}></label>
    <p>Pause-ur starter på:</p>
    <div class="seg">
      <button data-bias="low" class="${p.restBias === "low" ? "on" : ""}">Kort</button>
      <button data-bias="mid" class="${p.restBias === "mid" ? "on" : ""}">Midt</button>
      <button data-bias="high" class="${p.restBias === "high" ? "on" : ""}">Lang</button>
    </div>
    <p>Kort = 1 min ved “1–2 min”, lang = 2 min.</p>
    <h2>Backup</h2>
    <p>Begge programmer gemmes automatisk på denne enhed. Filbackup indeholder al historik. Skybackup forsøges, når du er online; computerbackup kræver den lokale server.</p>
    <p>${p.lastPcSync ? "Computer: " + p.lastPcSync.slice(0, 16).replace("T", " ") : "Computer: venter på første gem"}</p>
    <p>${p.lastCloudSync ? "Sky: " + p.lastCloudSync.slice(0, 16).replace("T", " ") : "Sky: venter på første gem"}</p>
    ${p.cloudId ? `<p>Kode: <b>${escapeHtml(p.cloudId)}</b></p>` : ""}
    <div class="actions">
      <button class="btn primary" data-ex>Fil</button>
      <label class="btn file-btn">Hent fil<input type="file" accept="application/json"></label>
    </div>
    <button class="btn full" data-cloud style="margin-top:8px">Gendan fra sky / computer</button>
    <h2>Data</h2>
    <button class="btn full" data-reset style="margin-top:8px">Nulstil kun ${escapeHtml(PROGRAM.shortTitle)}</button>
  </div></div>`);
  wrap.prepend(topbar("Indstillinger", `/w/${state.week}`));
  $(".page", wrap).prepend(programPicker());
  $("[data-awake]", wrap).addEventListener("change", (e) => {
    state.prefs.keepAwake = e.target.checked;
    saveState();
  });
  $("[data-vib]", wrap).addEventListener("change", (e) => {
    state.prefs.vibrate = e.target.checked;
    saveState();
  });
  $$("[data-bias]", wrap).forEach((b) => {
    b.addEventListener("click", () => {
      state.prefs.restBias = b.dataset.bias;
      saveState();
      render();
    });
  });
  $("[data-ex]", wrap).addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `bts-lift-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $("input[type=file]", wrap).addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || typeof data !== "object" || !data.logs) throw new Error("Ugyldig fil");
      state = ProgramState.mergeBackup(state, data);
      PROGRAM = PROGRAMS[state.activeProgram];
      saveState();
      toast("Backup indlæst");
      go("/settings");
    } catch {
      toast("Kunne ikke læse filen");
    }
  });
  $("[data-cloud]", wrap).addEventListener("click", async () => {
    const ok = await pullBackup();
    toast(ok ? "Gendannet" : "Ingen backup fundet");
    if (ok) { saveState(); go("/settings"); }
  });
  $("[data-reset]", wrap).addEventListener("click", () => {
    if (!confirm(`Nulstil logs i ${PROGRAM.shortTitle}? Det andet program bevares. Gem gerne en filbackup først.`)) return;
    state.logs = Object.fromEntries(Object.entries(state.logs).filter(([key]) => !ProgramState.belongsTo(key, state.activeProgram)));
    state.week = 1;
    saveState();
    toast("Nulstillet. Du starter i uge 1.");
    go("/w/1");
  });
  return wrap;
}

let deferredPrompt = null;
function setupInstall(root) {
  const box = $("#installBox", root);
  const btn = $("#installBtn", root);
  if (!box) return;
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (standalone || state.dismissedInstall) return;
  box.hidden = false;
  btn.addEventListener("click", async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      box.hidden = true;
    } else {
      toast("Brug Chrome-menuen → Installer app");
    }
  });
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && parseHash().view === "workout") setWake(true);
});

async function boot() {
  try {
    const [legacy, phase2] = await Promise.all(["program.json", "program-min-max-phase2.json"].map(async (file) => {
      const response = await fetch(file);
      if (!response.ok) throw new Error(file);
      return response.json();
    }));
    PROGRAMS = {
      bts: { ...legacy, id: "bts", shortTitle: "BTS · dit gamle program", description: "12 uger · dit eksisterende træningsprogram" },
      "min-max-phase-2": phase2,
    };
    try { PAIN = await (await fetch("pain.json")).json(); } catch { PAIN = { days: [], groups: {} }; }
  } catch {
    $("#app").innerHTML = '<div class="boot">Kunne ikke indlæse programmerne. Åbn appen online og prøv igen.</div>';
    return;
  }
  state = loadState();
  PROGRAM = PROGRAMS[state.activeProgram];
  window.addEventListener("hashchange", render);
  if (!location.hash) {
    go(`/w/${state.week}`);
  } else {
    render();
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").then((reg) => reg.update()).catch(() => {});
  }
}

boot();

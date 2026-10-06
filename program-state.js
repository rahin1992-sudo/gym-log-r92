(function (root) {
  "use strict";
  const LEGACY = "bts";
  const CURRENT = "min-max-phase-2";
  const ids = [LEGACY, CURRENT];
  const record = (value) => value && typeof value === "object" && !Array.isArray(value);

  function normalize(data = {}, fresh = false) {
    if (!record(data) || (data.logs !== undefined && !record(data.logs))) throw new Error("Ugyldig backup");
    if (data.schemaVersion > 2) throw new Error("Backup kræver en nyere app");
    const activeProgram = ids.includes(data.activeProgram) ? data.activeProgram : fresh ? CURRENT : LEGACY;
    const programWeeks = {};
    for (const id of ids) {
      const week = Number(data.programWeeks?.[id] ?? (id === activeProgram ? data.week : 1));
      programWeeks[id] = Number.isInteger(week) && week >= 1 && week <= 12 ? week : 1;
    }
    return { ...data, schemaVersion: 2, activeProgram, programWeeks, week: programWeeks[activeProgram], logs: { ...(data.logs || {}) }, prefs: { ...(record(data.prefs) ? data.prefs : {}) } };
  }

  function key(id, week, day, exercise) {
    const legacyKey = `w${week}|d${day}|e${exercise}`;
    return id === LEGACY ? legacyKey : `${id}|${legacyKey}`;
  }

  function belongsTo(key, id) {
    return id === LEGACY ? /^w\d+\|d\d+\|e/.test(key) : key.startsWith(`${id}|w`);
  }

  function mergeBackup(current, incoming) {
    if (!record(incoming) || !record(incoming.logs)) throw new Error("Ugyldig backup");
    const restored = normalize(incoming);
    const logs = { ...current.logs };
    for (const [key, log] of Object.entries(restored.logs)) {
      if (!record(log) || (log.sets !== undefined && !Array.isArray(log.sets))) throw new Error("Ugyldig træningslog");
      const existing = logs[key];
      // A dated, newer local lift must not disappear when restoring an older backup.
      if (!existing || !existing.updatedAt || (log.updatedAt && log.updatedAt >= existing.updatedAt)) logs[key] = log;
    }
    return normalize({ ...current, ...restored, logs,
      programWeeks: { ...current.programWeeks, ...(incoming.programWeeks || {}), [restored.activeProgram]: restored.week },
      prefs: { ...current.prefs, ...(record(incoming.prefs) ? incoming.prefs : {}) } });
  }

  function restSeconds(rest, bias = "low") {
    const text = String(rest || "").replace(/[–—]/g, "-").replace(/,/g, ".");
    if (/^\s*[-–]\s*$/.test(text)) return 0;
    const match = text.match(/(\d+(?:\.\d+)?)\s*(?:-\s*(\d+(?:\.\d+)?))?/);
    if (!match) return 90;
    const scale = /sec|sek|\bs\b/i.test(text) ? 1 : 60;
    const low = Number(match[1]) * scale;
    const high = Number(match[2] || match[1]) * scale;
    return Math.round(bias === "high" ? high : bias === "mid" ? (low + high) / 2 : low);
  }

  const api = { LEGACY, CURRENT, normalize, key, belongsTo, mergeBackup, restSeconds };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ProgramState = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

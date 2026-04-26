const REMOTE_CFG_KEY = "athx_epicure_remote_cfg_v1";
const DEFAULT_SUPABASE_URL = "https://exxbcrbafrzkhcvwkffg.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "sb_publishable_TiwXEH-JopQejQ0I04r9MQ_ieo5y9Ko";
const DEFAULT_PROJECT_REF = "epicure-2026";
const COMPETITION_QUERY_KEY = "comp";
const AUTO_PUSH_DELAY_MS = 1200;
let autoPushTimer = null;
let cloudReady = false;
let cloudInitPromise = null;
let stateCache = null;

const defaultState = {
  config: {
    competitionName: "ATHX Epicure",
    location: "Epicure",
    date: "",
    startTime: "08:00",
    heatIntervalMinutes: 20,
    athletesPerHeat: 2,
    metconStaggerMinutes: 2,
  },
  teams: [],
  events: [
    { id: "ev_warmup",    name: "Warm-Up Zone",   zone: 1, order: 1, durationMinutes: 30, timeCapMinutes: 0,  scored: false, higherIsBetter: false, scoreFormat: "",                  scoreUnit: "",  notes: "Mobilité, activation et préparation articulaire encadrée. Non scorée." },
    { id: "ev_strength",  name: "Strength Zone",  zone: 2, order: 2, durationMinutes: 20, timeCapMinutes: 20, scored: true,  higherIsBetter: true,  scoreFormat: "poids total (kg)",   scoreUnit: "kg", notes: "ATHX 2026 : 0–6 min 1RM Strict Press | 6–12 min 3RM Back Squat | 12–20 min 5RM Deadlift. Score = charge totale (équipe = paire, solo = individuel). Voir https://athxgames.com/workouts/2026", subFields: [{key:"press",label:"Press 1RM",unit:"kg"},{key:"squat",label:"Squat 3RM",unit:"kg"},{key:"deadlift",label:"Deadlift 5RM",unit:"kg"}] },
    { id: "ev_refuel",    name: "Refuel Zone",    zone: 3, order: 3, durationMinutes: 10, timeCapMinutes: 0,  scored: false, higherIsBetter: false, scoreFormat: "",                  scoreUnit: "",  notes: "Récupération active, hydratation et recharge. Non scorée." },
    { id: "ev_endurance", name: "Endurance Zone", zone: 4, order: 4, durationMinutes: 30, timeCapMinutes: 22, scored: true,  higherIsBetter: true,  scoreFormat: "distance totale (m)", scoreUnit: "m",  notes: "ATHX 2026 : A. Run, B. Row, time cap 22 min, swap chaque tour complété. Distances / tour (run) LITE 500m · ATHX 750m · PRO 1km. Score = distance totale run+row. Voir https://athxgames.com/workouts/2026" },
    { id: "ev_recovery",  name: "Recovery Zone",  zone: 5, order: 5, durationMinutes: 30, timeCapMinutes: 0,  scored: false, higherIsBetter: false, scoreFormat: "",                  scoreUnit: "",  notes: "Récupération assistée (technologies de récupération). Non scorée." },
    { id: "ev_metcon",    name: "MetCon X Zone",  zone: 6, order: 6, durationMinutes: 25, timeCapMinutes: 25, scored: true,  higherIsBetter: false, scoreFormat: "temps ou reps (time cap)", scoreUnit: "s", timeCap: true, timeCapSeconds: 1500, notes: "Solo = ATHX ou PRO seulement (pas de LITE en individuel). 25 min cap, score = temps. 1) Ski 45/30 cal H/F — 2) 30 SA alt. GTOH 20/12,5 kg (PRO: 30 dual 22,5/15) — 3) 30 m sandbag 50/30 (PRO: 70/40) — 4) 30 BJO 24″/20″ (PRO: 30″/24″) — 5) 30 m dual DB lunges 20/12,5 (PRO: front rack 22,5/15) — 6) 30 m burpee BJ — 7) Ski 45/30 cal. LITE = paires/équipes (autre fiche) : https://athxgames.com/workouts/2026 — https://athxgames.com/movement-standards/2026" },
  ],
  scores: [],
  news: [],
  updatedAt: null,
};

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function loadState() {
  if (!stateCache) return structuredClone(defaultState);
  return structuredClone(stateCache);
}

function saveState(nextState) {
  const value = {
    ...nextState,
    updatedAt: new Date().toISOString(),
  };
  stateCache = normalizeState(value);
  scheduleAutoPush(value);
  return structuredClone(stateCache);
}

function getRemoteConfig() {
  const urlRef = getCompetitionRefFromUrl();
  try {
    const raw = localStorage.getItem(REMOTE_CFG_KEY);
    if (!raw) {
      return {
        provider: "supabase",
        url: DEFAULT_SUPABASE_URL,
        anonKey: DEFAULT_SUPABASE_ANON_KEY,
        projectRef: urlRef || DEFAULT_PROJECT_REF,
        autoSync: true,
      };
    }
    return {
      provider: "supabase",
      url: DEFAULT_SUPABASE_URL,
      anonKey: DEFAULT_SUPABASE_ANON_KEY,
      projectRef: urlRef || DEFAULT_PROJECT_REF,
      autoSync: true,
      ...JSON.parse(raw),
      // L'URL force toujours la compétition active si paramètre présent.
      ...(urlRef ? { projectRef: urlRef } : {}),
    };
  } catch {
    return {
      provider: "supabase",
      url: DEFAULT_SUPABASE_URL,
      anonKey: DEFAULT_SUPABASE_ANON_KEY,
      projectRef: urlRef || DEFAULT_PROJECT_REF,
      autoSync: true,
    };
  }
}

function setRemoteConfig(cfg) {
  const urlRef = getCompetitionRefFromUrl();
  const next = {
    provider: "supabase",
    url: String(cfg.url || DEFAULT_SUPABASE_URL).trim(),
    anonKey: String(cfg.anonKey || DEFAULT_SUPABASE_ANON_KEY).trim(),
    projectRef: String(urlRef || cfg.projectRef || DEFAULT_PROJECT_REF).trim() || DEFAULT_PROJECT_REF,
    autoSync: cfg.autoSync !== false,
  };
  localStorage.setItem(REMOTE_CFG_KEY, JSON.stringify(next));
  return next;
}

function sanitizeCompetitionRef(value) {
  const raw = String(value || "").trim().toLowerCase();
  const safe = raw.replace(/[^a-z0-9-_]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return safe || DEFAULT_PROJECT_REF;
}

function getCompetitionRefFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    const ref = params.get(COMPETITION_QUERY_KEY);
    if (!ref) return "";
    return sanitizeCompetitionRef(ref);
  } catch {
    return "";
  }
}

function buildCompetitionUrl(ref, absolute = false) {
  const safe = sanitizeCompetitionRef(ref);
  const current = new URL(window.location.href);
  current.searchParams.set(COMPETITION_QUERY_KEY, safe);
  return absolute ? current.toString() : `${current.pathname}${current.search}${current.hash}`;
}

function hasRemoteCredentials(cfg) {
  return Boolean(cfg && cfg.url && cfg.anonKey);
}

function notifySync(status, message) {
  window.dispatchEvent(
    new CustomEvent("athx:remote-sync", {
      detail: { status, message, at: new Date().toISOString() },
    })
  );
}

function scheduleAutoPush(stateSnapshot) {
  const cfg = getRemoteConfig();
  if (!hasRemoteCredentials(cfg)) return;
  if (autoPushTimer) clearTimeout(autoPushTimer);
  autoPushTimer = setTimeout(async () => {
    try {
      await whenCloudReady();
      notifySync("pending", "Synchronisation automatique...");
      await pushRemote(stateSnapshot);
      notifySync("success", "Synchronisation automatique OK.");
    } catch (err) {
      notifySync("error", `Erreur sync auto: ${err.message || err}`);
      console.error("Erreur sync auto", err);
    }
  }, AUTO_PUSH_DELAY_MS);
}

function normalizeState(rawState) {
  const state = {
    ...structuredClone(defaultState),
    ...(rawState || {}),
    // Les épreuves sont fixes : on ignore toujours ce qui vient du cloud/local.
    events: structuredClone(defaultState.events),
  };
  state.teams = (state.teams || []).map((team) => ({
    ...team,
    firstName: team.firstName || "",
    lastName: team.lastName || "",
    name: team.name || `${team.firstName || ""} ${team.lastName || ""}`.trim(),
    email: typeof team.email === "string" ? team.email.trim() : "",
    category: team.category || "ATHX",
    gender: team.gender || "",
    heatNumber: Number(team.heatNumber || 1),
  }));
  state.events = (state.events || []).map((event, index) => ({
    ...event,
    order: Number(event.order || index + 1),
    durationMinutes: Number(event.durationMinutes || 0),
    timeCapMinutes: Number(event.timeCapMinutes || 0),
    scoreFormat: event.scoreFormat || "",
    notes: event.notes || "",
  }));
  return state;
}

async function pushRemote(stateArg) {
  const cfg = getRemoteConfig();
  if (!cfg.url || !cfg.anonKey) {
    throw new Error("Config Supabase incomplète (URL/Anon key).");
  }
  const state = normalizeState(stateArg || stateCache || defaultState);
  const payload = {
    id: cfg.projectRef || "default",
    state: state,
    updated_at: new Date().toISOString(),
  };
  const res = await fetch(`${cfg.url}/rest/v1/competition_states?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: cfg.anonKey,
      Authorization: `Bearer ${cfg.anonKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Erreur push remote: ${res.status} ${txt}`);
  }
  const rows = await res.json();
  if (rows && rows[0] && rows[0].state) {
    stateCache = normalizeState(rows[0].state);
  } else {
    stateCache = state;
  }
  return rows;
}

async function pullRemote() {
  const cfg = getRemoteConfig();
  if (!cfg.url || !cfg.anonKey) {
    throw new Error("Config Supabase incomplète (URL/Anon key).");
  }
  const id = cfg.projectRef || "default";
  const res = await fetch(
    `${cfg.url}/rest/v1/competition_states?id=eq.${encodeURIComponent(id)}&select=state,updated_at&limit=1`,
    {
      method: "GET",
      headers: {
        apikey: cfg.anonKey,
        Authorization: `Bearer ${cfg.anonKey}`,
      },
    }
  );
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Erreur pull remote: ${res.status} ${txt}`);
  }
  const rows = await res.json();
  if (!rows.length) {
    const created = normalizeState(defaultState);
    await pushRemote(created);
    stateCache = created;
    return structuredClone(stateCache);
  }
  stateCache = normalizeState(rows[0].state || {});
  return structuredClone(stateCache);
}

async function listCompetitions() {
  const cfg = getRemoteConfig();
  if (!cfg.url || !cfg.anonKey) {
    throw new Error("Config Supabase incomplète (URL/Anon key).");
  }
  const res = await fetch(
    `${cfg.url}/rest/v1/competition_states?select=id,updated_at&order=updated_at.desc&limit=200`,
    {
      method: "GET",
      headers: {
        apikey: cfg.anonKey,
        Authorization: `Bearer ${cfg.anonKey}`,
      },
    }
  );
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Erreur liste compétitions: ${res.status} ${txt}`);
  }
  const rows = await res.json();
  return rows.map((r) => ({
    id: String(r.id || ""),
    updatedAt: r.updated_at || null,
  }));
}

async function whenCloudReady() {
  if (cloudReady) return;
  if (cloudInitPromise) return cloudInitPromise;
  cloudInitPromise = (async () => {
    notifySync("pending", "Connexion cloud...");
    await pullRemote();
    cloudReady = true;
    notifySync("success", "Cloud connecté.");
  })();
  return cloudInitPromise;
}

const CAT_ORDER_RANK  = { "Lite": 0, "ATHX": 1, "Pro": 2 };
const GEND_ORDER_RANK = { "Femme": 0, "Homme": 1 };

// Convertit mm:ss ou hh:mm:ss en secondes (ou retourne la valeur numérique brute).
function parseScoreValue(raw) {
  if (raw == null || raw === "" || raw === "DNF") return null;
  const s = String(raw).trim();
  if (/^\d+:\d{2}(:\d{2})?$/.test(s)) {
    const parts = s.split(":").map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return parts[0] * 60 + parts[1];
  }
  const n = parseFloat(s.replace(",", "."));
  return isNaN(n) ? null : n;
}

// Classement par rang (système ATHX) — 1 rang par zone scorée, somme des rangs,
// le total le plus bas gagne. Par catégorie × genre.
function getRanking(state) {
  const scoredEvents = state.events.filter((e) => e.scored);

  // Pour chaque athlète, calculer le rang par événement
  // Ranking se fait PAR catégorie+genre (les Lite Femme ne sont classées qu'entre elles, etc.)
  const groups = {};
  state.teams.forEach((team) => {
    const key = `${team.category || ""}|${team.gender || ""}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(team);
  });

  // rankMap[teamId][eventId] = rang numérique
  const rankMap = {};
  state.teams.forEach((t) => { rankMap[t.id] = {}; });

  Object.values(groups).forEach((athletes) => {
    scoredEvents.forEach((event) => {
      // Récupérer les scores de ce groupe pour cet event
      const withScore = athletes
        .map((a) => {
          const sc = state.scores.find((s) => s.teamId === a.id && s.eventId === event.id);
          // Pour les events timeCap : utiliser le rawValue encodé directement
          // (finished → secondes < timeCapSeconds ; time cap → 100000 - reps, toujours > timeCapSeconds)
          const val = sc ? parseScoreValue(sc.rawValue ?? sc.performance) : null;
          return { id: a.id, val, dnf: sc?.dnf || false };
        })
        .filter((x) => x.val !== null && !x.dnf);

      // Trier selon la direction du score
      // Pour MetCon timeCap : higherIsBetter=false donc on trie ASC → les temps (petits) devant, reps encodés (grands) derrière
      withScore.sort((a, b) =>
        event.higherIsBetter ? b.val - a.val : a.val - b.val
      );

      // Attribuer les rangs (ex-aequo → même rang)
      let rank = 1;
      withScore.forEach((entry, idx) => {
        if (idx > 0 && withScore[idx - 1].val !== entry.val) rank = idx + 1;
        rankMap[entry.id][event.id] = rank;
      });

      // DNF / absent → rang = participants + 1, SEULEMENT si au moins un score existe
      if (withScore.length > 0) {
        const worstRank = athletes.length + 1;
        athletes.forEach((a) => {
          if (rankMap[a.id][event.id] == null) rankMap[a.id][event.id] = worstRank;
        });
      }
    });
  });

  return state.teams
    .map((team) => {
      const eventRanks = scoredEvents.map((e) => ({
        eventId: e.id,
        eventName: e.name,
        rank: rankMap[team.id]?.[e.id] ?? null,
      }));
      const scored = eventRanks.filter((r) => r.rank != null);
      const total  = scored.reduce((sum, r) => sum + r.rank, 0);
      return { teamId: team.id, team, eventRanks, total, scoredCount: scored.length };
    })
    .sort((a, b) => {
      // Trier d'abord par catégorie/genre, puis par total de rangs
      const catA = CAT_ORDER_RANK[a.team?.category] ?? 99;
      const catB = CAT_ORDER_RANK[b.team?.category] ?? 99;
      if (catA !== catB) return catA - catB;
      const gA = GEND_ORDER_RANK[a.team?.gender] ?? 99;
      const gB = GEND_ORDER_RANK[b.team?.gender] ?? 99;
      if (gA !== gB) return gA - gB;
      if (a.scoredCount === 0 && b.scoredCount === 0) return 0;
      if (a.scoredCount === 0) return 1;
      if (b.scoredCount === 0) return -1;
      return a.total - b.total;
    });
}

function parseHmToMinutes(hm) {
  const [h, m] = String(hm || "08:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Retourne l'heure courante en minutes depuis minuit, en tenant compte de la date de compétition.
// - Pas de date configurée → heure réelle (comportement normal)
// - Date dans le futur     → -9999 (tout est "à venir")
// - Date dans le passé     → 99999 (tout est "terminé")
// - Date = aujourd'hui     → heure réelle
function effectiveNowMin(state) {
  const d = new Date();
  const realMin = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  const dateStr = state?.config?.date; // "YYYY-MM-DD"
  if (!dateStr) return realMin;
  const todayStr = d.toISOString().slice(0, 10);
  if (todayStr < dateStr) return -9999;   // compétition pas encore commencée
  if (todayStr > dateStr) return 99999;   // compétition terminée (jour passé)
  return realMin; // c'est le bon jour → heure réelle
}

function minutesToHm(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

const CAT_ORDER  = { "Lite": 0, "ATHX": 1, "Pro": 2 };
const GEND_ORDER = { "Femme": 0, "Homme": 1 };

function athleteSortKey(a) {
  const cat   = CAT_ORDER[a.category]  ?? 99;
  const gend  = GEND_ORDER[a.gender]   ?? 99;
  const order = a.sortOrder != null ? Number(a.sortOrder) : 9999;
  const last  = (a.lastName || a.name || "").toLowerCase();
  return [cat, gend, order, last];
}

function compareAthletes(a, b) {
  const ka = athleteSortKey(a);
  const kb = athleteSortKey(b);
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] < kb[i]) return -1;
    if (ka[i] > kb[i]) return 1;
  }
  return 0;
}

function buildHeatSchedule(state) {
  const perHeat = Number(state.config.athletesPerHeat || 2);
  // Tri global : Lite F → Lite H → ATHX F → ATHX H → Pro F → Pro H
  const sorted = [...state.teams].sort(compareAthletes);

  // Groupement dynamique par position dans le tableau trié
  const grouped = {};
  sorted.forEach((athlete, idx) => {
    const heat = Math.floor(idx / perHeat) + 1;
    if (!grouped[heat]) grouped[heat] = [];
    grouped[heat].push(athlete);
  });

  const startMinutes = parseHmToMinutes(state.config.startTime);
  const interval = Number(state.config.heatIntervalMinutes || 20);

  return Object.keys(grouped)
    .map(Number)
    .sort((a, b) => a - b)
    .map((heat) => ({
      heat,
      startTime: minutesToHm(startMinutes + (heat - 1) * interval),
      athletes: grouped[heat],
    }));
}

function normalizeTeamPayload(raw, state) {
  // Numéro d'ordre par défaut = dernier dans son groupe catégorie/genre
  let defaultOrder = 1;
  if (state && state.teams) {
    const siblings = state.teams.filter(
      (t) => t.category === (raw.category || "ATHX") && t.gender === (raw.gender || "")
    );
    const maxOrder = siblings.reduce((m, t) => Math.max(m, t.sortOrder ?? 0), 0);
    defaultOrder = maxOrder + 1;
  }
  return {
    id: raw.id || uid("ath"),
    firstName: raw.firstName || "",
    lastName: raw.lastName || "",
    name: raw.name || `${raw.firstName || ""} ${raw.lastName || ""}`.trim(),
    email: typeof raw.email === "string" ? raw.email.trim() : "",
    club: raw.club || "",
    category: raw.category || "ATHX",
    gender: raw.gender || "",
    sortOrder: raw.sortOrder != null ? Number(raw.sortOrder) : defaultOrder,
  };
}

function upsertScore(state, payload) {
  const idx = state.scores.findIndex(
    (s) => s.teamId === payload.teamId && s.eventId === payload.eventId
  );
  if (idx >= 0) state.scores[idx] = payload;
  else state.scores.push(payload);
}

function getAthx2026Preset() {
  return [
    {
      name: "Warm-Up Zone",
      zone: 1,
      order: 1,
      durationMinutes: 30,
      timeCapMinutes: 0,
      scored: false,
      higherIsBetter: false,
      scoreFormat: "",
      scoreUnit: "",
      notes: "Mobilité, activation et préparation articulaire encadrée. Non scorée.",
    },
    {
      name: "Strength Zone",
      zone: 2,
      order: 2,
      durationMinutes: 20,
      timeCapMinutes: 20,
      scored: true,
      higherIsBetter: true,
      scoreFormat: "poids total (kg)",
      scoreUnit: "kg",
      notes: "0–6 min : 1RM Strict Press | 6–12 min : 3RM Back Squat | 12–18 min : 5RM Deadlift. Score = somme des charges maximales.",
    },
    {
      name: "Refuel Zone",
      zone: 3,
      order: 3,
      durationMinutes: 10,
      timeCapMinutes: 0,
      scored: false,
      higherIsBetter: false,
      scoreFormat: "",
      scoreUnit: "",
      notes: "Récupération active, hydratation et recharge. Non scorée.",
    },
    {
      name: "Endurance Zone",
      zone: 4,
      order: 4,
      durationMinutes: 30,
      timeCapMinutes: 22,
      scored: true,
      higherIsBetter: true,
      scoreFormat: "distance totale (m)",
      scoreUnit: "m",
      notes: "Run + Row en alternance. LITE : 500m/tour | ATHX : 750m/tour | PRO : 1000m/tour. Score = distance totale cumulée.",
    },
    {
      name: "Recovery Zone",
      zone: 5,
      order: 5,
      durationMinutes: 30,
      timeCapMinutes: 0,
      scored: false,
      higherIsBetter: false,
      scoreFormat: "",
      scoreUnit: "",
      notes: "Récupération assistée (technologies de récupération). Non scorée.",
    },
    {
      name: "MetCon X Zone",
      zone: 6,
      order: 6,
      durationMinutes: 25,
      timeCapMinutes: 25,
      scored: true,
      higherIsBetter: false,
      scoreFormat: "temps ou reps (time cap)",
      scoreUnit: "s",
      timeCap: true,
      timeCapSeconds: 1500,
      notes: "7 stations : 60 cal Ski-Erg → GTOH → 60m Sandbag Carry → 60 Box Jump Overs → 60m DB Lunges → 60m Burpee Broad Jumps → 60 cal Ski-Erg. Time cap 25 min. Si time cap atteint : entrer le nombre de répétitions complétées.",
    },
  ];
}

window.AthxStore = {
  uid,
  loadState,
  saveState,
  getRanking,
  buildHeatSchedule,
  compareAthletes,
  normalizeTeamPayload,
  upsertScore,
  parseScoreValue,
  effectiveNowMin,
  getAthx2026Preset,
  getRemoteConfig,
  setRemoteConfig,
  pushRemote,
  pullRemote,
  whenCloudReady,
  listCompetitions,
  getCompetitionRefFromUrl,
  sanitizeCompetitionRef,
  buildCompetitionUrl,
  defaultState,
};

// Propagation automatique du paramètre ?comp= dans tous les liens de navigation.
(function patchNavLinks() {
  const ref = getCompetitionRefFromUrl();
  if (!ref) return;
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href");
      if (!href || href.startsWith("http") || href.startsWith("#") || href.startsWith("mailto")) return;
      try {
        const base = window.location.href;
        const url = new URL(href, base);
        if (url.hostname !== window.location.hostname) return;
        url.searchParams.set(COMPETITION_QUERY_KEY, ref);
        a.setAttribute("href", url.pathname + url.search + url.hash);
      } catch (_) {}
    });
  });
})();

// Initialisation cloud automatique (mode cloud strict).
whenCloudReady().catch((err) => {
  notifySync("error", `Cloud indisponible: ${err.message || err}`);
});

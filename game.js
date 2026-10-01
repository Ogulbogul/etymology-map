// Etymology Map: "Guess the journey" game (play.html).
//
// A round shows an English word. The player drops pins on the map where they
// think the word travelled (oldest place first); points come from the distance
// between each real stop and the closest unused pin, not from the country.
// Five words make a game (max 5,000). Everything runs in the browser; the only
// server call is /api/score, which adds one count to an anonymous score bucket
// and returns the percentile. No sign-in, cookies or IDs.

const W = 960;
const H = 500;
const ROUNDS = 5;
const MAX_ROUND = 1000;
const MAX_TOTAL = ROUNDS * MAX_ROUND;
const DECAY_KM = 1500; // score falls to 1/e of full marks at this distance
const STOP_SHARE = 900; // of 1000, split across the real stops
const ORDER_BONUS = 100;
const EXTRA_PIN_PENALTY = 60;
const DAILY_KEY = "etymap-daily";
const STREAK_KEY = "etymap-streak";
const SVGNS = "http://www.w3.org/2000/svg";

const $ = (id) => document.getElementById(id);
const svg = $("gmap");
const canvas = $("g-canvas");
const zoomLayer = $("g-zoomlayer");
const countriesLayer = $("g-countries");
const linesLayer = $("g-lines");
const marksLayer = $("g-marks");
marksLayer.style.pointerEvents = "none";

function el(tag, attrs, text) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  return e;
}

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    return null;
  }
}
function safeSet(key, val) {
  try {
    localStorage.setItem(key, val);
  } catch (err) {
    // Private mode: progress just is not remembered.
  }
}

// Same privacy rules as track.js: no recording on localhost or when the
// visitor sends Global Privacy Control / Do Not Track.
const recordScores = (() => {
  try {
    const host = location.hostname;
    if (!host || host === "localhost" || host === "127.0.0.1") return false;
    if (navigator.globalPrivacyControl === true) return false;
    if (navigator.doNotTrack === "1" || window.doNotTrack === "1") return false;
    return true;
  } catch (err) {
    return false;
  }
})();

// --- Geometry ---------------------------------------------------------------
function km(a, b) {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}
const EXACT_KM = 30; // anything this close counts as a perfect hit
const closeness = (d) => (d <= EXACT_KM ? 1 : Math.exp(-(d - EXACT_KM) / DECAY_KM));
const fmtKm = (d) => (d < 10 ? "under 10" : Math.round(d).toLocaleString("en-US")) + " km";

// --- Map --------------------------------------------------------------------
let projection = null;
let view = { x: 0, y: 0, k: 1 };
let markList = []; // { kind: "pin" | "truth", label, lon, lat }

function clampView(v) {
  const k = Math.min(14, Math.max(1, v.k));
  return { k, x: Math.min(0, Math.max(W - W * k, v.x)), y: Math.min(0, Math.max(H - H * k, v.y)) };
}

function setView(v) {
  view = clampView(v);
  zoomLayer.setAttribute("transform", `translate(${view.x} ${view.y}) scale(${view.k})`);
  drawMarks();
}

function drawMarks() {
  marksLayer.textContent = "";
  for (const m of markList) {
    const p = projection([m.lon, m.lat]);
    const x = view.x + view.k * p[0];
    const y = view.y + view.k * p[1];
    const g = el("g", { class: "g-mark " + m.kind, transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})` });
    g.appendChild(el("circle", { r: 11 }));
    g.appendChild(el("text", {}, m.label));
    marksLayer.appendChild(g);
  }
}

let anim = 0;
function animateTo(target, ms = 450) {
  const from = view;
  const to = clampView(target);
  const t0 = performance.now();
  const id = ++anim;
  function step(now) {
    if (id !== anim) return;
    const t = Math.min(1, (now - t0) / ms);
    const e = 1 - Math.pow(1 - t, 3);
    setView({ k: from.k + (to.k - from.k) * e, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e });
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function fitTo(points) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = 70;
  const k = Math.min(8, Math.max(1, Math.min(W / (maxX - minX + 2 * pad), H / (maxY - minY + 2 * pad))));
  animateTo({ k, x: W / 2 - ((minX + maxX) / 2) * k, y: H / 2 - ((minY + maxY) / 2) * k });
}

function svgPoint(clientX, clientY) {
  const r = svg.getBoundingClientRect();
  return { sx: ((clientX - r.left) / r.width) * W, sy: ((clientY - r.top) / r.height) * H, scale: W / r.width };
}

function zoomAt(clientX, clientY, factor) {
  anim++;
  const { sx, sy } = svgPoint(clientX, clientY);
  const wx = (sx - view.x) / view.k;
  const wy = (sy - view.y) / view.k;
  const k = Math.min(14, Math.max(1, view.k * factor));
  setView({ k, x: sx - wx * k, y: sy - wy * k });
}

function zoomCenter(factor) {
  const r = svg.getBoundingClientRect();
  zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
}

let onMapClick = null;
const ptrs = new Map();
let drag = null;
let pinch = null;

canvas.addEventListener("pointerdown", (e) => {
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch (err) {
    // Not an active pointer (rare); dragging still works while the cursor stays over the map.
  }
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  anim++;
  if (ptrs.size === 1) {
    drag = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
  } else if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, k0: view.k };
    if (drag) drag.moved = true;
  }
});

canvas.addEventListener("pointermove", (e) => {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 2 && pinch) {
    const [a, b] = [...ptrs.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const { sx, sy } = svgPoint(cx, cy);
    const wx = (sx - view.x) / view.k;
    const wy = (sy - view.y) / view.k;
    const k = Math.min(14, Math.max(1, (pinch.k0 * d) / pinch.d0));
    setView({ k, x: sx - wx * k, y: sy - wy * k });
    return;
  }
  if (ptrs.size === 1 && drag) {
    const dx = e.clientX - drag.sx;
    const dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) > 5) {
      drag.moved = true;
      canvas.classList.add("dragging");
    }
    if (drag.moved) {
      const { scale } = svgPoint(e.clientX, e.clientY);
      setView({ k: view.k, x: drag.vx + dx * scale, y: drag.vy + dy * scale });
    }
  }
});

function endPointer(e, cancelled) {
  if (!ptrs.has(e.pointerId)) return;
  const wasClick = ptrs.size === 1 && drag && !drag.moved && !cancelled;
  ptrs.delete(e.pointerId);
  if (ptrs.size < 2) pinch = null;
  if (ptrs.size === 0) {
    canvas.classList.remove("dragging");
    drag = null;
    if (wasClick && onMapClick && projection) {
      const { sx, sy } = svgPoint(e.clientX, e.clientY);
      const lonlat = projection.invert([(sx - view.x) / view.k, (sy - view.y) / view.k]);
      if (lonlat && Number.isFinite(lonlat[0]) && Math.abs(lonlat[1]) <= 90) onMapClick(lonlat[0], lonlat[1]);
    }
  } else if (ptrs.size === 1 && drag) {
    // One finger left after a pinch: never treat it as a tap.
    drag.moved = true;
    const rest = [...ptrs.values()][0];
    drag.sx = rest.x;
    drag.sy = rest.y;
    drag.vx = view.x;
    drag.vy = view.y;
  }
}
canvas.addEventListener("pointerup", (e) => endPointer(e, false));
canvas.addEventListener("pointercancel", (e) => endPointer(e, true));

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
  },
  { passive: false }
);
$("g-zoom-in").addEventListener("click", () => zoomCenter(1.6));
$("g-zoom-out").addEventListener("click", () => zoomCenter(1 / 1.6));
$("g-zoom-reset").addEventListener("click", () => animateTo({ k: 1, x: 0, y: 0 }));

// Country names show while hovering, but nothing lights up: scoring is by
// distance, and highlighting a country would suggest otherwise.
const countryLabel = $("g-country");
countriesLayer.addEventListener("mouseover", (e) => {
  const n = e.target && e.target.getAttribute ? e.target.getAttribute("data-n") : null;
  countryLabel.textContent = n || " ";
});
canvas.addEventListener("mouseleave", () => (countryLabel.textContent = " "));

async function loadMap() {
  const [d3geo, topo, resp] = await Promise.all([
    import("./vendor/d3-geo.js"),
    import("./vendor/topojson-client.js"),
    fetch("vendor/countries-110m.json"),
  ]);
  if (!resp.ok) throw new Error("countries fetch failed");
  const topology = await resp.json();
  const countries = topo.feature(topology, topology.objects.countries);
  projection = d3geo.geoEquirectangular().fitSize([W, H], countries);
  const path = d3geo.geoPath(projection);
  for (const f of countries.features) {
    const d = path(f);
    if (!d) continue;
    const p = el("path", { d, class: "g-land" });
    if (f.properties && f.properties.name) p.setAttribute("data-n", f.properties.name);
    countriesLayer.appendChild(p);
  }
  setView({ k: 1, x: 0, y: 0 });
}

// --- Words and scoring ------------------------------------------------------
const wordCache = new Map();
function loadWord(key) {
  if (!wordCache.has(key)) {
    wordCache.set(
      key,
      fetch(`data/words/${encodeURIComponent(key)}.json`)
        .then((r) => {
          if (!r.ok) throw new Error("word fetch failed");
          return r.json();
        })
        .then((d) => {
          const stops = d.stops;
          const truth = /^English/.test(stops[stops.length - 1].lang) ? stops.slice(0, -1) : stops;
          return { key, meaning: d.current_meaning, truth, all: stops };
        })
    );
  }
  return wordCache.get(key);
}

const slugOf = (w) => w.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// Best one-to-one match between real stops and pins (at most 7 pins and 6
// stops, so trying every assignment is instant), then points per stop, an
// order bonus and a small cost for surplus pins.
function scoreRound(pins, truth) {
  const nT = truth.length;
  const dist = pins.map((p) => truth.map((t) => km(p, t)));
  let best = { v: -1, m: null };
  const used = new Array(pins.length).fill(false);
  const cur = new Array(nT).fill(-1);
  (function rec(j, sum) {
    if (j === nT) {
      if (sum > best.v) best = { v: sum, m: cur.slice() };
      return;
    }
    cur[j] = -1;
    rec(j + 1, sum);
    for (let i = 0; i < pins.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      cur[j] = i;
      rec(j + 1, sum + closeness(dist[i][j]));
      used[i] = false;
    }
    cur[j] = -1;
  })(0, 0);

  const stops = truth.map((t, j) => {
    const i = best.m[j];
    if (i < 0) return { stop: t, pin: -1, km: null, pts: 0 };
    return { stop: t, pin: i, km: dist[i][j], pts: (STOP_SHARE / nT) * closeness(dist[i][j]) };
  });
  const close = stops.filter((s) => s.pin >= 0 && closeness(s.km) >= 0.15);
  let ordered = close.length >= 2;
  for (let n = 1; n < close.length; n++) if (close[n].pin <= close[n - 1].pin) ordered = false;
  const bonus = ordered ? Math.round((ORDER_BONUS * close.length) / nT) : 0;
  const extras = Math.max(0, pins.length - nT);
  const penalty = extras * EXTRA_PIN_PENALTY;
  const base = stops.reduce((a, s) => a + s.pts, 0);
  const total = Math.max(0, Math.min(MAX_ROUND, Math.round(base + bonus - penalty)));
  return { stops, bonus, extras, penalty, total };
}

// --- Daily word choice ------------------------------------------------------
// Everyone gets the same five words for a UTC day without any server: each
// pool word gets a hash of (date, word) and the five lowest win. Adding words
// to the pool later almost never changes the day's picks.
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  return h >>> 0;
}
function dailyWords(pool, day) {
  return pool
    .map((w) => [hash32(day + "|" + w), w])
    .sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : 1))
    .slice(0, ROUNDS)
    .map((x) => x[1]);
}
function practiceWords(pool) {
  const out = [];
  while (out.length < ROUNDS) {
    const w = pool[Math.floor(Math.random() * pool.length)];
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

// --- Game flow --------------------------------------------------------------
const screens = { start: $("screen-start"), play: $("screen-play"), end: $("screen-end") };
function show(name) {
  for (const k in screens) screens[k].hidden = k !== name;
  window.scrollTo(0, 0);
}

const todayUTC = new Date().toISOString().slice(0, 10);
let pool = [];
let game = null; // { mode, words, i, total, rounds: [{ key, pts }] }
let round = null; // { data, pins: [{lon,lat}], phase }

function fmtDate(day) {
  return new Date(day + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function startGame(mode) {
  const words = mode === "daily" ? dailyWords(pool, todayUTC) : practiceWords(pool);
  game = { mode, words, i: 0, total: 0, rounds: [] };
  show("play");
  loadRound();
}

async function loadRound() {
  const key = game.words[game.i];
  $("g-round").textContent = game.i + 1;
  $("g-score").textContent = game.total.toLocaleString("en-US");
  $("g-word").textContent = key;
  $("g-meaning").textContent = "Loading…";
  $("g-count").textContent = "";
  $("g-result").hidden = true;
  $("g-stage").classList.remove("reveal");
  $("g-pinbar").hidden = false;
  $("g-help").hidden = false;
  linesLayer.textContent = "";
  markList = [];
  onMapClick = null;
  animateTo({ k: 1, x: 0, y: 0 });
  drawMarks();
  let data;
  try {
    data = await loadWord(key);
  } catch (err) {
    $("g-meaning").textContent = "Could not load this word. Check your connection and reload the page.";
    return;
  }
  if (game.words[game.i] !== key) return;
  if (game.i + 1 < ROUNDS) loadWord(game.words[game.i + 1]).catch(() => {});
  round = { data, pins: [], phase: "guess", max: Math.min(7, data.truth.length + 2) };
  $("g-meaning").textContent = "Today it means: " + data.meaning;
  const n = data.truth.length;
  $("g-count").textContent = `This word made ${n} stops before it reached English. Place your pins in order, oldest first.`;
  onMapClick = placePin;
  paintPins();
}

function placePin(lon, lat) {
  if (!round || round.phase !== "guess" || round.pins.length >= round.max) return;
  round.pins.push({ lon, lat });
  paintPins();
}

function paintPins() {
  markList = round.pins.map((p, i) => ({ kind: "pin", label: String(i + 1), lon: p.lon, lat: p.lat }));
  drawMarks();
  const box = $("g-pins");
  box.textContent = "";
  if (!round.pins.length) {
    const s = document.createElement("span");
    s.className = "none";
    s.textContent = "Click the map to drop your first pin.";
    box.appendChild(s);
  }
  round.pins.forEach((p, i) => {
    const chip = document.createElement("span");
    chip.className = "g-chip";
    chip.appendChild(document.createTextNode("Pin " + (i + 1)));
    const x = document.createElement("button");
    x.type = "button";
    x.textContent = "×";
    x.setAttribute("aria-label", "Remove pin " + (i + 1));
    x.addEventListener("click", () => {
      if (round.phase !== "guess") return;
      round.pins.splice(i, 1);
      paintPins();
    });
    chip.appendChild(x);
    box.appendChild(chip);
  });
  if (round.pins.length >= round.max) {
    const s = document.createElement("span");
    s.className = "none";
    s.textContent = "That is the most pins for this word.";
    box.appendChild(s);
  }
  $("g-undo").disabled = !round.pins.length;
  $("g-reveal").disabled = !round.pins.length;
}

$("g-undo").addEventListener("click", () => {
  if (round && round.phase === "guess" && round.pins.length) {
    round.pins.pop();
    paintPins();
  }
});

$("g-reveal").addEventListener("click", reveal);

function reveal() {
  if (!round || round.phase !== "guess" || !round.pins.length) return;
  round.phase = "reveal";
  onMapClick = null;
  const { data, pins } = round;
  const res = scoreRound(pins, data.truth);
  game.total += res.total;
  game.rounds.push({ key: data.key, pts: res.total });
  $("g-score").textContent = game.total.toLocaleString("en-US");

  // Map: real route, links from matched pins, then numbered pins + lettered stops.
  linesLayer.textContent = "";
  const truthXY = data.truth.map((t) => projection([t.lon, t.lat]));
  linesLayer.appendChild(el("path", { class: "g-line-truth", d: "M" + truthXY.map((p) => p.join(" ")).join(" L") }));
  const pts = truthXY.slice();
  res.stops.forEach((s, j) => {
    if (s.pin < 0) return;
    const a = projection([pins[s.pin].lon, pins[s.pin].lat]);
    pts.push(a);
    linesLayer.appendChild(el("path", { class: "g-line-link", d: `M${a[0]} ${a[1]} L${truthXY[j][0]} ${truthXY[j][1]}` }));
  });
  pins.forEach((p) => pts.push(projection([p.lon, p.lat])));
  markList = pins
    .map((p, i) => ({ kind: "pin", label: String(i + 1), lon: p.lon, lat: p.lat }))
    .concat(data.truth.map((t, j) => ({ kind: "truth", label: String.fromCharCode(65 + j), lon: t.lon, lat: t.lat })));
  drawMarks();
  fitTo(pts);

  // Result panel.
  $("g-pinbar").hidden = true;
  $("g-help").hidden = true;
  $("g-count").textContent = `The real journey had ${data.truth.length} stops (lettered A, B, C… on the map). Your pins are numbered.`;
  $("g-stage").classList.add("reveal");
  $("g-result").hidden = false;
  $("g-roundpts").textContent = res.total.toLocaleString("en-US");
  const rows = $("g-rows");
  rows.textContent = "";
  res.stops.forEach((s, j) => {
    const li = document.createElement("li");
    const badge = document.createElement("span");
    badge.className = "g-badge";
    badge.textContent = String.fromCharCode(65 + j);
    const body = document.createElement("div");
    const b = document.createElement("b");
    b.textContent = s.stop.word;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = [s.stop.lang, s.stop.era].filter(Boolean).join(" · ");
    body.appendChild(b);
    body.appendChild(meta);
    if (s.stop.note) {
      const note = document.createElement("p");
      note.className = "note";
      note.textContent = s.stop.note;
      body.appendChild(note);
    }
    const pt = document.createElement("div");
    pt.className = "pts";
    pt.textContent = "+" + Math.round(s.pts);
    const small = document.createElement("small");
    small.textContent = s.pin < 0 ? "no pin used" : `pin ${s.pin + 1}: ${fmtKm(s.km)} away`;
    pt.appendChild(small);
    li.appendChild(badge);
    li.appendChild(body);
    li.appendChild(pt);
    rows.appendChild(li);
  });
  const extra = [];
  if (res.bonus) extra.push(`Order bonus +${res.bonus} for placing your pins in the right order.`);
  if (res.extras) extra.push(`${res.extras} extra pin${res.extras > 1 ? "s" : ""} −${res.penalty}.`);
  $("g-extras").textContent = extra.join(" ");
  $("g-storylink").href = "/words/" + slugOf(data.key);
  $("g-next").textContent = game.i + 1 < ROUNDS ? "Next word" : "See my result";
}

$("g-next").addEventListener("click", () => {
  if (game.i + 1 < ROUNDS) {
    game.i++;
    loadRound();
  } else {
    finish();
  }
});

// --- End screen -------------------------------------------------------------
const emojiFor = (pts) => (pts >= 800 ? "🟩" : pts >= 500 ? "🟨" : pts >= 250 ? "🟧" : "🟥");

function streakAfterDaily() {
  let s = null;
  try {
    s = JSON.parse(safeGet(STREAK_KEY) || "null");
  } catch (err) {
    s = null;
  }
  const yesterday = new Date(Date.parse(todayUTC + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
  let n = 1;
  if (s && s.last === todayUTC) n = s.n;
  else if (s && s.last === yesterday) n = s.n + 1;
  safeSet(STREAK_KEY, JSON.stringify({ last: todayUTC, n }));
  return n;
}

async function fetchPercentile(mode, score) {
  try {
    const r = await fetch("/api/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ m: mode === "daily" ? "d" : "p", s: score, r: recordScores ? 1 : 0 }),
    });
    return r.ok ? await r.json() : null;
  } catch (err) {
    return null;
  }
}

function pctText(mode, res) {
  if (!res) return "";
  if (res.pct == null) return "You are among the first players. Percentiles appear once 10 games are in.";
  return `You beat ${res.pct}% of players${mode === "daily" ? " today" : " recently"}.`;
}

function renderEnd(data) {
  show("end");
  $("e-label").textContent = data.mode === "daily" ? `Daily word · ${fmtDate(data.day)}` : "Practice game";
  $("e-score").textContent = data.score.toLocaleString("en-US");
  $("e-emoji").textContent = data.rounds.map((r) => emojiFor(r.pts)).join("");
  $("e-pct").textContent = pctText(data.mode, data.pct);
  const st = $("e-streak");
  st.hidden = !(data.streak && data.streak >= 2);
  if (!st.hidden) st.textContent = `🔥 ${data.streak}-day streak`;
  const list = $("e-rounds");
  list.textContent = "";
  for (const r of data.rounds) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = "/words/" + slugOf(r.key);
    a.textContent = r.key;
    const s = document.createElement("span");
    s.textContent = `${emojiFor(r.pts)} ${r.pts} / ${MAX_ROUND}`;
    li.appendChild(a);
    li.appendChild(s);
    list.appendChild(li);
  }
  $("e-status").hidden = true;
  currentEnd = data;
}
let currentEnd = null;

async function finish() {
  const data = {
    mode: game.mode,
    day: todayUTC,
    score: game.total,
    rounds: game.rounds,
    pct: null,
    streak: 0,
  };
  if (game.mode === "daily") data.streak = streakAfterDaily();
  renderEnd(data);
  const res = await fetchPercentile(game.mode, game.total);
  data.pct = res;
  if (currentEnd === data) $("e-pct").textContent = pctText(game.mode, res);
  if (game.mode === "daily") {
    safeSet(DAILY_KEY, JSON.stringify({ day: todayUTC, score: data.score, rounds: data.rounds, pct: res, streak: data.streak }));
  }
}

$("e-share").addEventListener("click", async () => {
  if (!currentEnd) return;
  const d = currentEnd;
  const lines = [
    `Etymology Map ${d.mode === "daily" ? "Daily " + fmtDate(d.day) : "Practice"}: ${d.score.toLocaleString("en-US")}/${MAX_TOTAL}`,
    d.rounds.map((r) => emojiFor(r.pts)).join(""),
  ];
  if (d.pct && d.pct.pct != null) lines.push(`Beat ${d.pct.pct}% of players`);
  const text = lines.join("\n");
  const url = "https://etymologymap.com/play";
  const status = $("e-status");
  try {
    if (navigator.share) {
      await navigator.share({ text, url });
      return;
    }
    await navigator.clipboard.writeText(text + "\n" + url);
    status.textContent = "Result copied. Paste it anywhere to share.";
  } catch (err) {
    if (err && err.name === "AbortError") return;
    status.textContent = "Could not copy automatically. Select and copy: " + text.replace(/\n/g, " ");
  }
  status.hidden = false;
});

$("e-practice").addEventListener("click", () => startGame("practice"));

// --- Start screen -----------------------------------------------------------
function readDaily() {
  try {
    const d = JSON.parse(safeGet(DAILY_KEY) || "null");
    return d && d.day === todayUTC && Array.isArray(d.rounds) ? d : null;
  } catch (err) {
    return null;
  }
}

function paintStart() {
  const done = readDaily();
  const box = $("daily-done");
  const btn = $("btn-daily");
  if (done) {
    box.hidden = false;
    box.textContent = "";
    const b = document.createElement("b");
    b.textContent = done.score.toLocaleString("en-US");
    box.appendChild(document.createTextNode("Today: "));
    box.appendChild(b);
    box.appendChild(document.createTextNode(` / ${MAX_TOTAL} ${done.rounds.map((r) => emojiFor(r.pts)).join("")}`));
    btn.textContent = "See today’s result";
    $("daily-sub").textContent = "You have played today. A new set of words arrives at midnight UTC.";
  }
  btn.disabled = false;
  $("btn-practice").disabled = false;
}

$("btn-daily").addEventListener("click", () => {
  const done = readDaily();
  if (done) renderEnd({ mode: "daily", day: done.day, score: done.score, rounds: done.rounds, pct: done.pct, streak: done.streak });
  else startGame("daily");
});
$("btn-practice").addEventListener("click", () => startGame("practice"));

(async function init() {
  $("btn-daily").disabled = true;
  $("btn-practice").disabled = true;
  try {
    const [poolRes] = await Promise.all([fetch("data/game-pool.json"), loadMap()]);
    if (!poolRes.ok) throw new Error("pool fetch failed");
    pool = await poolRes.json();
    if (!Array.isArray(pool) || pool.length < ROUNDS) throw new Error("pool empty");
    paintStart();
  } catch (err) {
    console.error(err);
    const p = document.createElement("p");
    p.className = "g-status";
    p.textContent = "The game could not load. Please reload the page.";
    $("screen-start").appendChild(p);
  }
})();

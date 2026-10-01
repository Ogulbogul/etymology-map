// Etymology Map: "Guess the journey" game (play.html).
//
// A round shows an English word. The player drops pins on the map where they
// think the word travelled (oldest place first); points come from the distance
// between each real stop and the closest unused pin, not from the country.
// Five words make a game (max 5,000). Everything runs in the browser; the only
// server call is /api/score, which adds one count to an anonymous score bucket
// and returns the percentile. No sign-in, cookies or IDs.

import { buildGameCard, tierFor } from "./gamecard.js";

const W = 960;
const H = 500;
const ROUNDS = 5;
const MAX_ROUND = 1000;
const MAX_TOTAL = ROUNDS * MAX_ROUND;
const DECAY_KM = 1500; // score falls to 1/e of full marks at this distance
const STOP_SHARE = 900; // of 1000, split across the real stops
const ORDER_BONUS = 100;
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
let countriesData = null;
let d3geoMod = null;
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

// After Reveal the map keeps its size and only changes zoom: it frames the real journey and
// widens for far-off pins only down to a floor, so a wild guess never shrinks the map to a speck.
function fitReveal(truthXY, pinXY) {
  const REVEAL_FLOOR = 2.4;
  const bounds = (pts) => {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  };
  const zoomFor = (b, pad) => Math.min(8, Math.max(1, Math.min(W / (b.maxX - b.minX + 2 * pad), H / (b.maxY - b.minY + 2 * pad))));
  const bt = bounds(truthXY);
  const ba = bounds(truthXY.concat(pinXY));
  const kTruth = zoomFor(bt, 90);
  const kAll = zoomFor(ba, 90);
  const k = Math.max(kAll, Math.min(kTruth, REVEAL_FLOOR));
  const b = k === kAll ? ba : bt;
  animateTo({ k, x: W / 2 - ((b.minX + b.maxX) / 2) * k, y: H / 2 - ((b.minY + b.maxY) / 2) * k });
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
  countriesData = countries;
  d3geoMod = d3geo;
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
  const base = stops.reduce((a, s) => a + s.pts, 0);
  const total = Math.max(0, Math.min(MAX_ROUND, Math.round(base + bonus)));
  return { stops, bonus, total };
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
let round = null; // { data, pins: [{lon,lat}], phase, max }

function fmtDate(day) {
  return new Date(day + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// How a score reads at a glance: the same four bands the share squares use.
const tierOf = tierFor;
const VERDICTS = { hi: "Spot on!", mid: "Getting warmer", low: "Not quite, now you know" };
const END_VERDICTS = { hi: "Etymology expert", mid: "Nicely travelled", low: "A good start" };

// A tiny bar chart of a game's five rounds, coloured by band (used instead of emoji squares).
function miniBars(rounds) {
  const wrap = document.createElement("span");
  wrap.className = "g-mini";
  wrap.setAttribute("role", "img");
  wrap.setAttribute("aria-label", "Round scores: " + rounds.map((r) => r.pts).join(", "));
  for (const r of rounds) {
    const bar = document.createElement("i");
    bar.className = "tier-" + tierOf(r.pts, MAX_ROUND);
    bar.style.height = Math.max(4, Math.round((r.pts / MAX_ROUND) * 22)) + "px";
    wrap.appendChild(bar);
  }
  return wrap;
}

// A score ring: the arc fills in to show the share of the maximum earned.
function ringSvg(frac, big, small, tier) {
  const R = 50;
  const C = 2 * Math.PI * R;
  const svg = el("svg", { viewBox: "0 0 120 120", class: "g-ring tier-" + tier, role: "img", "aria-label": `${big} ${small}` });
  svg.appendChild(el("circle", { cx: 60, cy: 60, r: R, class: "g-ring-track" }));
  const arc = el("circle", { cx: 60, cy: 60, r: R, class: "g-ring-arc", transform: "rotate(-90 60 60)" });
  arc.style.strokeDasharray = `0 ${C}`;
  svg.appendChild(arc);
  svg.appendChild(el("text", { x: 60, y: 61, class: "g-ring-big" }, big));
  svg.appendChild(el("text", { x: 60, y: 80, class: "g-ring-small" }, small));
  requestAnimationFrame(() => requestAnimationFrame(() => (arc.style.strokeDasharray = `${C * Math.max(0.004, Math.min(1, frac))} ${C}`)));
  return svg;
}

function startGame(mode) {
  const words = mode === "daily" ? dailyWords(pool, todayUTC) : practiceWords(pool);
  game = { mode, words, i: 0, total: 0, rounds: [] };
  show("play");
  loadRound();
}

function paintDots() {
  const ol = $("g-dots");
  ol.textContent = "";
  for (let i = 0; i < ROUNDS; i++) {
    const li = document.createElement("li");
    if (i < game.rounds.length) li.className = "done tier-" + tierOf(game.rounds[i].pts, MAX_ROUND);
    else if (i === game.i) li.className = "current";
    ol.appendChild(li);
  }
}

async function loadRound() {
  const key = game.words[game.i];
  $("g-round").textContent = game.i + 1;
  $("g-score").textContent = game.total.toLocaleString("en-US");
  $("g-word").textContent = key;
  $("g-meaning").textContent = "Loading…";
  $("g-slots").textContent = "";
  $("g-count").textContent = "";
  $("g-summary").hidden = true;
  $("g-rows").hidden = true;
  $("g-pinbar").hidden = false;
  $("g-help").hidden = false;
  paintDots();
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
  round = { data, pins: [], phase: "guess", max: data.truth.length };
  $("g-meaning").textContent = data.meaning;
  onMapClick = placePin;
  paintPins();
}

function placePin(lon, lat) {
  if (!round || round.phase !== "guess" || round.pins.length >= round.max) return;
  round.pins.push({ lon, lat });
  paintPins();
}

// One slot per stop to find: each fills with its pin number as you place it; tap a filled
// slot to take that pin back.
function paintPins() {
  markList = round.pins.map((p, i) => ({ kind: "pin", label: String(i + 1), lon: p.lon, lat: p.lat }));
  drawMarks();
  const box = $("g-slots");
  box.textContent = "";
  const n = round.data.truth.length;
  for (let i = 0; i < round.max; i++) {
    const placed = round.pins[i];
    const slot = document.createElement(placed ? "button" : "span");
    slot.className = "g-slot" + (placed ? " filled" : "") + (!placed && i === round.pins.length ? " next" : "");
    slot.textContent = String(i + 1);
    if (placed) {
      slot.type = "button";
      slot.title = `Take back pin ${i + 1}`;
      slot.setAttribute("aria-label", slot.title);
      slot.addEventListener("click", () => {
        if (round.phase !== "guess") return;
        round.pins.splice(i, 1);
        paintPins();
      });
    }
    box.appendChild(slot);
  }
  $("g-count").textContent =
    round.pins.length >= n ? "All placed. Reveal, or tap a number to take a pin back." : `Find ${n} stops, oldest first`;
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

function chip(text, kind) {
  const li = document.createElement("li");
  li.className = "g-chip2 " + kind;
  li.textContent = text;
  return li;
}

function reveal() {
  if (!round || round.phase !== "guess" || !round.pins.length) return;
  round.phase = "reveal";
  onMapClick = null;
  const { data, pins } = round;
  const res = scoreRound(pins, data.truth);
  game.total += res.total;
  game.rounds.push({ key: data.key, pts: res.total });
  $("g-score").textContent = game.total.toLocaleString("en-US");
  paintDots();

  // Map: the real route, links from matched pins, then numbered pins + lettered stops.
  linesLayer.textContent = "";
  const truthXY = data.truth.map((t) => projection([t.lon, t.lat]));
  linesLayer.appendChild(el("path", { class: "g-line-truth", d: "M" + truthXY.map((p) => p.join(" ")).join(" L") }));
  const pinXY = pins.map((p) => projection([p.lon, p.lat]));
  res.stops.forEach((s, j) => {
    if (s.pin < 0) return;
    const a = pinXY[s.pin];
    linesLayer.appendChild(el("path", { class: "g-line-link", d: `M${a[0]} ${a[1]} L${truthXY[j][0]} ${truthXY[j][1]}` }));
  });
  markList = pins
    .map((p, i) => ({ kind: "pin", label: String(i + 1), lon: p.lon, lat: p.lat }))
    .concat(data.truth.map((t, j) => ({ kind: "truth", label: String.fromCharCode(65 + j), lon: t.lon, lat: t.lat })));
  drawMarks();
  fitReveal(truthXY, pinXY);

  // Summary bar: score ring, verdict, bonus chips, buttons.
  const tier = tierOf(res.total, MAX_ROUND);
  $("g-summary").className = "g-summary tier-" + tier;
  $("g-pinbar").hidden = true;
  $("g-help").hidden = true;
  $("g-summary").hidden = false;
  const ringBox = $("g-ring");
  ringBox.textContent = "";
  ringBox.appendChild(ringSvg(res.total / MAX_ROUND, String(res.total), "/ 1000", tier));
  $("g-verdict").textContent = VERDICTS[tier];
  const chips = $("g-chips");
  chips.textContent = "";
  chips.appendChild(chip(`${res.stops.filter((s) => s.pin >= 0 && closeness(s.km) >= 0.15).length} of ${data.truth.length} stops found`, "neutral"));
  if (res.bonus) chips.appendChild(chip(`Right order +${res.bonus}`, "good"));
  $("g-storylink").href = "/words/" + slugOf(data.key);
  $("g-next").textContent = game.i + 1 < ROUNDS ? "Next word" : "See my result";

  // One card per real stop, under the map: what it was, how far you were, points earned.
  const rows = $("g-rows");
  rows.textContent = "";
  const perStop = STOP_SHARE / data.truth.length;
  res.stops.forEach((s, j) => {
    const stopTier = s.pin < 0 ? "no" : tierOf(s.pts, perStop);
    const li = document.createElement("li");
    li.className = "g-stop tier-" + stopTier;
    const head = document.createElement("div");
    head.className = "g-stop-head";
    const badge = document.createElement("span");
    badge.className = "g-badge";
    badge.textContent = String.fromCharCode(65 + j);
    const word = document.createElement("b");
    word.textContent = s.stop.word;
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = [s.stop.lang, s.stop.era].filter(Boolean).join(" · ");
    head.append(badge, word, meta);
    li.appendChild(head);
    if (s.stop.note) {
      const note = document.createElement("p");
      note.className = "note";
      note.textContent = s.stop.note;
      li.appendChild(note);
    }
    const meter = document.createElement("div");
    meter.className = "g-meter";
    const fill = document.createElement("span");
    fill.style.width = "0%";
    meter.appendChild(fill);
    li.appendChild(meter);
    requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.width = Math.max(2, (s.pts / perStop) * 100) + "%")));
    const foot = document.createElement("div");
    foot.className = "g-stop-foot";
    const dist = document.createElement("span");
    dist.textContent = s.pin < 0 ? "No pin matched this stop" : `Pin ${s.pin + 1} · ${fmtKm(s.km)} away`;
    const pts = document.createElement("b");
    pts.textContent = `+${Math.round(s.pts)} / ${Math.round(perStop)}`;
    foot.append(dist, pts);
    li.appendChild(foot);
    rows.appendChild(li);
  });
  // The whole round, added up: stop points (900 shared between the stops) + the order bonus (100).
  const distPts = res.total - res.bonus;
  const eq = document.createElement("li");
  eq.className = "g-eq tier-" + tier;
  const part = (cls, big, small) => {
    const d = document.createElement("div");
    d.className = "g-eq-part " + cls;
    const b = document.createElement("b");
    b.textContent = big;
    const sp = document.createElement("span");
    sp.textContent = small;
    d.append(b, sp);
    return d;
  };
  const op = (t) => {
    const s = document.createElement("span");
    s.className = "g-eq-op";
    s.textContent = t;
    return s;
  };
  eq.append(
    part("g-eq-dist", String(distPts), `distance points (of ${STOP_SHARE})`),
    op("+"),
    part("g-eq-bonus" + (res.bonus ? "" : " off"), String(res.bonus), `order bonus (of ${ORDER_BONUS})`),
    op("="),
    part("g-eq-total", String(res.total), `round total (of ${MAX_ROUND})`)
  );
  if (!res.bonus) {
    const note = document.createElement("p");
    note.className = "g-eq-note";
    note.textContent = "The order bonus needs at least two pins close to their stops, placed in the right order.";
    eq.appendChild(note);
  }
  rows.appendChild(eq);
  rows.hidden = false;
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

// "You beat 73% of players": a bar with a marker where you landed.
function renderPct(mode, res) {
  const box = $("e-pct");
  box.textContent = "";
  if (!res) return;
  if (res.pct == null) {
    const p = document.createElement("p");
    p.className = "g-pctnote";
    p.textContent = "You are among the first players. Percentiles appear once 10 games are in.";
    box.appendChild(p);
    return;
  }
  const gauge = document.createElement("div");
  gauge.className = "g-gauge";
  const fill = document.createElement("span");
  fill.className = "g-gauge-fill";
  fill.style.width = "0%";
  const knob = document.createElement("span");
  knob.className = "g-gauge-knob";
  knob.style.left = "0%";
  gauge.append(fill, knob);
  const p = document.createElement("p");
  p.className = "g-pctnote";
  const b = document.createElement("b");
  b.textContent = res.pct + "%";
  p.append(document.createTextNode("You beat "), b, document.createTextNode(` of players${mode === "daily" ? " today" : " recently"}`));
  box.append(gauge, p);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    fill.style.width = res.pct + "%";
    knob.style.left = res.pct + "%";
  }));
}

function renderEnd(data) {
  show("end");
  const tier = tierOf(data.score, MAX_TOTAL);
  $("e-label").textContent = data.mode === "daily" ? `Daily word · ${fmtDate(data.day)}` : "Practice game";
  const ringBox = $("e-ring");
  ringBox.textContent = "";
  ringBox.appendChild(ringSvg(data.score / MAX_TOTAL, data.score.toLocaleString("en-US"), "/ 5,000", tier));
  $("e-verdict").textContent = END_VERDICTS[tier];
  const st = $("e-streak");
  st.hidden = !(data.streak && data.streak >= 2);
  if (!st.hidden) st.textContent = `🔥 ${data.streak}-day streak`;
  renderPct(data.mode, data.pct);

  const list = $("e-rounds");
  list.textContent = "";
  for (const r of data.rounds) {
    const li = document.createElement("li");
    li.className = "tier-" + tierOf(r.pts, MAX_ROUND);
    const a = document.createElement("a");
    a.href = "/words/" + slugOf(r.key);
    a.textContent = r.key;
    const bar = document.createElement("span");
    bar.className = "g-bar2";
    const fill = document.createElement("span");
    fill.style.width = "0%";
    bar.appendChild(fill);
    requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.width = Math.max(2, (r.pts / MAX_ROUND) * 100) + "%")));
    const val = document.createElement("b");
    val.textContent = r.pts.toLocaleString("en-US");
    li.append(a, bar, val);
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
  if (currentEnd === data) renderPct(game.mode, res);
  if (game.mode === "daily") {
    safeSet(DAILY_KEY, JSON.stringify({ day: todayUTC, score: data.score, rounds: data.rounds, pct: res, streak: data.streak }));
  }
}

// --- Share: an image card in a window (same pattern as the word share card) ----------
const shareModal = $("share-modal");
const sharePreview = $("share-preview");
const shareStatus = $("share-status");
const shareBtns = { dl: $("share-download-btn"), copy: $("share-copy-btn"), native: $("share-native-btn") };
let shareBlob = null;
let shareUrl = null;
let shareTheme = "dark";

function siteIsDark() {
  const t = document.documentElement.getAttribute("data-theme");
  if (t === "dark") return true;
  if (t === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function shareText(d) {
  const lines = [`Etymology Map ${d.mode === "daily" ? "Daily " + fmtDate(d.day) : "Practice"}: ${d.score.toLocaleString("en-US")}/${MAX_TOTAL}`];
  if (d.pct && d.pct.pct != null) lines.push(`Beat ${d.pct.pct}% of players. Can you beat it?`);
  else lines.push("Can you beat it?");
  return lines.join("\n");
}

async function renderShare() {
  if (!currentEnd) return;
  const d = currentEnd;
  shareStatus.hidden = true;
  Object.values(shareBtns).forEach((b) => (b.disabled = true));
  const tier = tierOf(d.score, MAX_TOTAL);
  shareBlob = await buildGameCard({
    mode: d.mode,
    label: d.mode === "daily" ? `Daily word · ${fmtDate(d.day)}` : "Practice game",
    score: d.score,
    max: MAX_TOTAL,
    rounds: d.rounds.map((r) => r.pts),
    roundMax: MAX_ROUND,
    verdict: END_VERDICTS[tier],
    pct: d.pct && d.pct.pct != null ? d.pct.pct : null,
    streak: d.streak,
    theme: shareTheme,
    countries: countriesData,
    projection,
    d3geo: d3geoMod,
  });
  if (shareUrl) URL.revokeObjectURL(shareUrl);
  shareUrl = URL.createObjectURL(shareBlob);
  sharePreview.src = shareUrl;
  shareBtns.dl.disabled = false;
  shareBtns.copy.disabled = !(navigator.clipboard && window.ClipboardItem);
  shareBtns.native.disabled = false;
}

function setShareTheme(t) {
  shareTheme = t;
  $("share-theme-light-btn").setAttribute("aria-pressed", String(t === "light"));
  $("share-theme-dark-btn").setAttribute("aria-pressed", String(t === "dark"));
  renderShare();
}

function closeShare() {
  shareModal.hidden = true;
}

$("e-share").addEventListener("click", () => {
  if (!currentEnd) return;
  shareModal.hidden = false;
  setShareTheme(siteIsDark() ? "dark" : "light");
});
$("share-close-btn").addEventListener("click", closeShare);
shareModal.addEventListener("click", (e) => {
  if (e.target === shareModal) closeShare();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !shareModal.hidden) closeShare();
});
$("share-theme-light-btn").addEventListener("click", () => setShareTheme("light"));
$("share-theme-dark-btn").addEventListener("click", () => setShareTheme("dark"));

function say(msg) {
  shareStatus.textContent = msg;
  shareStatus.hidden = false;
}

shareBtns.dl.addEventListener("click", () => {
  if (!shareBlob) return;
  const a = document.createElement("a");
  a.href = shareUrl;
  a.download = "etymology-map-game.png";
  document.body.appendChild(a);
  a.click();
  a.remove();
  say("Image saved.");
});
shareBtns.copy.addEventListener("click", async () => {
  if (!shareBlob) return;
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": shareBlob })]);
    say("Image copied. Paste it anywhere.");
  } catch (err) {
    say("Couldn't copy the image in this browser. Use Download instead.");
  }
});
shareBtns.native.addEventListener("click", async () => {
  if (!shareBlob || !currentEnd) return;
  const file = new File([shareBlob], "etymology-map-game.png", { type: "image/png" });
  const data = { files: [file], title: "Etymology Map", text: shareText(currentEnd) + "\nhttps://etymologymap.com/play" };
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share(data);
    else if (navigator.share) await navigator.share({ title: "Etymology Map", text: shareText(currentEnd), url: "https://etymologymap.com/play" });
    else say("Sharing isn't available here. Download or copy the image instead.");
  } catch (err) {
    if (err && err.name !== "AbortError") say("Sharing isn't available right now.");
  }
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
    box.appendChild(document.createTextNode(` / ${MAX_TOTAL}`));
    box.appendChild(miniBars(done.rounds));
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

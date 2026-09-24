// Standalone per-word page (words/<slug>.html, statically pre-rendered by
// build_pages.py). The title, meta tags, and stage-by-stage content already
// exist in the raw HTML the server sends; this script reads that same data
// back out of the embedded <script id="word-data"> tag and layers the
// interactive map, pan/zoom, and share-card generation on top, reusing the
// same rendering logic as the main app (app.js), but without the search
// box, word list, or autocomplete: this page is a single word's permalink,
// not the explorer.

const MAP_WIDTH = 960;
const MAP_HEIGHT = 500;
const MIN_ZOOM = 1;
const MAX_ZOOM = 14;
const FIT_PADDING = 60;

// Offscreen canvas used only to measure pin-label text width (matches
// .pin-label's CSS font) so overlap checks don't force a synchronous
// layout via getBBox() on every pan/zoom frame.
const labelMeasureCtx = document.createElement("canvas").getContext("2d");
labelMeasureCtx.font = `600 17px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`;
function measureLabelWidth(text) {
  return labelMeasureCtx.measureText(text).width;
}

function rectsOverlap(a, b) {
  return !(a.x2 < b.x1 || a.x1 > b.x2 || a.y2 < b.y1 || a.y1 > b.y2);
}

// Same idea as the share card's label placement: try a ring of offsets
// around each pin and use the first one that doesn't overlap a label
// already placed or another pin's dot, so two stops close together on
// the map (e.g. neighboring countries) don't draw illegible overlapping
// text. Cheap enough (a handful of stops, run once per position update)
// to recompute on every pan/zoom frame rather than caching it.
const LABEL_CANDIDATES = [
  { dx: 13, dy: -11, anchor: "start" },
  { dx: 13, dy: 19, anchor: "start" },
  { dx: -13, dy: -11, anchor: "end" },
  { dx: -13, dy: 19, anchor: "end" },
  { dx: 13, dy: -29, anchor: "start" },
  { dx: 13, dy: 37, anchor: "start" },
  { dx: -13, dy: -29, anchor: "end" },
  { dx: -13, dy: 37, anchor: "end" },
];

function placePinLabels(entries) {
  const PAD = 4, H = 15, PIN_R = 10;
  const placedBoxes = [];
  return entries.map((entry, i) => {
    let chosen = LABEL_CANDIDATES[0];
    for (const off of LABEL_CANDIDATES) {
      const x = entry.sx + off.dx;
      const y = entry.sy + off.dy;
      const x1 = off.anchor === "start" ? x : x - entry.w;
      const x2 = off.anchor === "start" ? x + entry.w : x;
      const box = { x1: x1 - PAD, x2: x2 + PAD, y1: y - H - PAD, y2: y + PAD };
      const hitsLabel = placedBoxes.some((p) => rectsOverlap(box, p));
      const hitsOtherPin = entries.some((other, j) => {
        if (j === i) return false;
        return (
          box.x1 < other.sx + PIN_R && box.x2 > other.sx - PIN_R &&
          box.y1 < other.sy + PIN_R && box.y2 > other.sy - PIN_R
        );
      });
      if (!hitsLabel && !hitsOtherPin) {
        chosen = off;
        placedBoxes.push(box);
        break;
      }
    }
    return { ...entry, x: entry.sx + chosen.dx, y: entry.sy + chosen.dy, anchor: chosen.anchor };
  });
}

const notFoundEl = document.getElementById("not-found-msg");
const resultEl = document.getElementById("result");
const panelEl = document.getElementById("panel");
const resultHeaderEl = document.getElementById("result-header");
const resultWordTextEl = document.getElementById("result-word-text");
const resultTrailEl = document.getElementById("result-trail");
const mapSvg = document.getElementById("map");
const mapCanvasEl = document.querySelector(".map-canvas");
const zoomLayer = document.getElementById("zoom-layer");
const landLayer = document.getElementById("land-layer");
const pathLayer = document.getElementById("path-layer");
const arrowLayer = document.getElementById("arrow-layer");
const pinLayer = document.getElementById("pin-layer");
const badgeEl = document.getElementById("current-meaning-badge");
const badgeLabelEl = document.getElementById("badge-label");
const badgeTextEl = document.getElementById("badge-text");
const partialNoticeEl = document.getElementById("partial-notice");
const partialStageNumEl = document.getElementById("partial-stage-num");
const partialStageTotalEl = document.getElementById("partial-stage-total");
const partialFullLinkEl = document.getElementById("partial-full-link");
const journeyMetaEl = document.getElementById("journey-meta");
const relatedWordsEl = document.getElementById("related-words");
const relatedWordsLangEl = document.getElementById("related-words-lang");
const relatedWordsGridEl = document.getElementById("related-words-grid");
const zoomInBtn = document.getElementById("zoom-in-btn");
const zoomOutBtn = document.getElementById("zoom-out-btn");
const zoomResetBtn = document.getElementById("zoom-reset-btn");
const copyLinkBtn = document.getElementById("copy-link-btn");

// Lightweight word -> origin-language map for the whole collection (used
// for did-you-mean and related-words without fetching every word's full
// data). The specific word this page renders is fetched on its own.
let wordIndex = {};
let projectPoint = manualProject;

let mapLandFeature = null;
let mapProjection = null;
let d3geoModule = null;

let lastWord = null;
let lastEntry = null;
let lastPoints = null;

const view = { x: 0, y: 0, k: 1 };
let viewAnimFrame = null;

function manualProject(lon, lat) {
  const x = ((lon + 180) / 360) * MAP_WIDTH;
  const y = ((90 - lat) / 180) * MAP_HEIGHT;
  return [x, y];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function loadWordIndex() {
  try {
    const res = await fetch("/data/words-index.json");
    wordIndex = await res.json();
  } catch (err) {
    wordIndex = {};
    console.error("Could not load /data/words-index.json", err);
  }
}

function slugify(word) {
  return word
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function loadMap() {
  try {
    const [d3geo, topojsonClient, landResp] = await Promise.all([
      import("/vendor/d3-geo.js"),
      import("/vendor/topojson-client.js"),
      fetch("/vendor/land-110m.json"),
    ]);
    if (!landResp.ok) throw new Error("land topology fetch failed");
    const topology = await landResp.json();
    const land = topojsonClient.feature(topology, topology.objects.land);
    const projection = d3geo
      .geoEquirectangular()
      .fitSize([MAP_WIDTH, MAP_HEIGHT], land);
    const pathGen = d3geo.geoPath(projection);

    const pathEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pathEl.setAttribute("d", pathGen(land));
    pathEl.setAttribute("class", "land-path");
    landLayer.appendChild(pathEl);

    projectPoint = (lon, lat) => projection([lon, lat]);
    mapLandFeature = land;
    mapProjection = projection;
    d3geoModule = d3geo;
  } catch (err) {
    console.warn("Falling back to manual projection; world map coastlines unavailable.", err);
    projectPoint = manualProject;
  }
}

function setActive(index, isActive) {
  const row = panelEl.querySelector(`.stop-row[data-idx="${index}"]`);
  const pin = pinLayer.querySelector(`.pin-group[data-idx="${index}"]`);
  const trailItem = resultTrailEl.querySelector(`.trail-item[data-idx="${index}"]`);
  [row, pin, trailItem].forEach((el) => el && el.classList.toggle("active", isActive));
}

// --- Pan & zoom -----------------------------------------------------------

// Keeps at least PAN_MARGIN world-units of the map inside the viewBox at
// all times, so dragging or zoom-panning can never push the whole map
// offscreen. Bounds are derived from the current zoom: at k=1 (map exactly
// fills the viewBox) this caps how far you can drag; at high zoom the map
// is far larger than the viewBox, so the same margin barely constrains
// panning at all, which is the expected feel.
const PAN_MARGIN = 150;

function clampView(next) {
  const k = clamp(next.k, MIN_ZOOM, MAX_ZOOM);
  const minX = PAN_MARGIN - MAP_WIDTH * k;
  const maxX = MAP_WIDTH - PAN_MARGIN;
  const minY = PAN_MARGIN - MAP_HEIGHT * k;
  const maxY = MAP_HEIGHT - PAN_MARGIN;
  return {
    x: clamp(next.x, minX, maxX),
    y: clamp(next.y, minY, maxY),
    k,
  };
}

function setView(next) {
  const clamped = clampView(next);
  view.x = clamped.x;
  view.y = clamped.y;
  view.k = clamped.k;
  zoomLayer.setAttribute("transform", `translate(${view.x} ${view.y}) scale(${view.k})`);
  updatePinPositions();
  updateArrowPositions();
}

function updatePinPositions() {
  const groups = Array.from(pinLayer.querySelectorAll(".pin-group"));
  const entries = groups.map((g) => {
    const cx = parseFloat(g.dataset.cx);
    const cy = parseFloat(g.dataset.cy);
    return {
      g,
      sx: view.k * cx + view.x,
      sy: view.k * cy + view.y,
      w: parseFloat(g.dataset.labelWidth) || 0,
    };
  });
  const placed = placePinLabels(entries);
  placed.forEach(({ g, sx, sy, x, y, anchor }) => {
    const circle = g.querySelector(".pin-dot");
    const label = g.querySelector(".pin-label");
    circle.setAttribute("cx", sx);
    circle.setAttribute("cy", sy);
    label.setAttribute("x", x);
    label.setAttribute("y", y);
    label.setAttribute("text-anchor", anchor);
  });
}

function updateArrowPositions() {
  arrowLayer.querySelectorAll(".route-arrow").forEach((arrow) => {
    const cx = parseFloat(arrow.dataset.cx);
    const cy = parseFloat(arrow.dataset.cy);
    const angle = parseFloat(arrow.dataset.angle);
    const sx = view.k * cx + view.x;
    const sy = view.k * cy + view.y;
    arrow.setAttribute("transform", `translate(${sx} ${sy}) rotate(${angle})`);
  });
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function animateViewTo(target, duration = 700) {
  if (viewAnimFrame) clearTimeout(viewAnimFrame);
  const start = { ...view };
  const startTime = performance.now();

  function step() {
    const t = clamp((performance.now() - startTime) / duration, 0, 1);
    const eased = easeInOutCubic(t);
    setView({
      x: start.x + (target.x - start.x) * eased,
      y: start.y + (target.y - start.y) * eased,
      k: start.k + (target.k - start.k) * eased,
    });
    if (t < 1) viewAnimFrame = setTimeout(step, 16);
    else viewAnimFrame = null;
  }
  viewAnimFrame = setTimeout(step, 0);
}

function computeFitView(points) {
  if (points.length === 0) return { x: 0, y: 0, k: 1 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  points.forEach(([px, py]) => {
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  });
  const bboxW = Math.max(maxX - minX, 1);
  const bboxH = Math.max(maxY - minY, 1);
  const k = clamp(
    Math.min((MAP_WIDTH - 2 * FIT_PADDING) / bboxW, (MAP_HEIGHT - 2 * FIT_PADDING) / bboxH),
    MIN_ZOOM,
    MAX_ZOOM
  );
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { x: MAP_WIDTH / 2 - k * cx, y: MAP_HEIGHT / 2 - k * cy, k };
}

function toSvgPoint(evt) {
  const pt = mapSvg.createSVGPoint();
  pt.x = evt.clientX;
  pt.y = evt.clientY;
  const ctm = mapSvg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const transformed = pt.matrixTransform(ctm.inverse());
  return { x: transformed.x, y: transformed.y };
}

function zoomAroundPoint(point, factor) {
  const newK = clamp(view.k * factor, MIN_ZOOM, MAX_ZOOM);
  const worldX = (point.x - view.x) / view.k;
  const worldY = (point.y - view.y) / view.k;
  setView({ x: point.x - worldX * newK, y: point.y - worldY * newK, k: newK });
}

function zoomAroundCenter(factor) {
  zoomAroundPoint({ x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 }, factor);
}

function setupPanZoom() {
  // Tracks every finger/pointer currently down on the map, keyed by
  // pointerId, in SVG viewBox coordinates. One active pointer pans; two
  // pins to pinch-zoom (distance-ratio between them each move, applied as
  // an incremental factor around their midpoint, same as a wheel tick).
  const activePointers = new Map();
  let dragStart = null;
  let viewAtDragStart = null;
  let pinchPrevDist = null;

  function activePoints() {
    return [...activePointers.values()];
  }
  function pointDist(p1, p2) {
    return Math.hypot(p2.x - p1.x, p2.y - p1.y);
  }
  function pointMid(p1, p2) {
    return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  }
  function beginSingleDrag() {
    dragStart = activePoints()[0];
    viewAtDragStart = { ...view };
  }

  mapSvg.addEventListener("pointerdown", (e) => {
    if (viewAnimFrame) {
      clearTimeout(viewAnimFrame);
      viewAnimFrame = null;
    }
    try {
      mapSvg.setPointerCapture(e.pointerId);
    } catch (err) {
      // Some browsers reject capturing a pointer mid-gesture (e.g. the
      // second finger of a pinch); tracking below still works without it.
    }
    activePointers.set(e.pointerId, toSvgPoint(e));
    mapCanvasEl.classList.add("dragging");

    if (activePointers.size === 1) {
      beginSingleDrag();
      pinchPrevDist = null;
    } else if (activePointers.size === 2) {
      dragStart = null;
      const [p1, p2] = activePoints();
      pinchPrevDist = pointDist(p1, p2);
    }
  });

  mapSvg.addEventListener("pointermove", (e) => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, toSvgPoint(e));

    if (activePointers.size >= 2) {
      const [p1, p2] = activePoints();
      const d = pointDist(p1, p2);
      if (pinchPrevDist) zoomAroundPoint(pointMid(p1, p2), d / pinchPrevDist);
      pinchPrevDist = d;
    } else if (activePointers.size === 1 && dragStart) {
      const cur = activePoints()[0];
      setView({
        x: viewAtDragStart.x + (cur.x - dragStart.x),
        y: viewAtDragStart.y + (cur.y - dragStart.y),
        k: viewAtDragStart.k,
      });
    }
  });

  function releasePointer(e) {
    activePointers.delete(e.pointerId);
    if (activePointers.size === 0) {
      mapCanvasEl.classList.remove("dragging");
      dragStart = null;
      pinchPrevDist = null;
    } else if (activePointers.size === 1) {
      beginSingleDrag();
      pinchPrevDist = null;
    }
  }
  mapSvg.addEventListener("pointerup", releasePointer);
  mapSvg.addEventListener("pointercancel", releasePointer);

  mapSvg.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const point = toSvgPoint(e);
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      zoomAroundPoint(point, factor);
    },
    { passive: false }
  );

  zoomInBtn.addEventListener("click", () => zoomAroundCenter(1.4));
  zoomOutBtn.addEventListener("click", () => zoomAroundCenter(1 / 1.4));
  zoomResetBtn.addEventListener("click", () => animateViewTo({ x: 0, y: 0, k: 1 }));
}

// --- Rendering --------------------------------------------------------

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function pickRandom(arr, n) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

function renderRelatedWords(baseWord, originLang) {
  const candidates = Object.keys(wordIndex).filter(
    (key) => key !== baseWord && wordIndex[key] === originLang
  );
  if (candidates.length === 0) {
    relatedWordsEl.hidden = true;
    return;
  }

  const picks = pickRandom(candidates, 8).sort((a, b) => a.localeCompare(b));
  relatedWordsLangEl.textContent = originLang;
  relatedWordsGridEl.innerHTML = "";
  picks.forEach((key) => {
    const a = document.createElement("a");
    a.className = "related-word-item";
    a.href = `/words/${slugify(key)}`;
    a.textContent = key;
    relatedWordsGridEl.appendChild(a);
  });
  relatedWordsEl.hidden = false;
}

function renderWordPage(word, entry, baseWord) {
  resultEl.hidden = false;
  resultHeaderEl.hidden = false;
  resultWordTextEl.textContent = word;
  const baseSlug = slugify(baseWord);
  // The page's static HTML already has stage rows and a trail for the
  // no-JS/crawler case; clear them before rebuilding interactively so we
  // don't end up with two copies once JS runs.
  panelEl.innerHTML = "";
  resultTrailEl.innerHTML = "";

  entry.stops.forEach((stop, idx) => {
    const row = document.createElement("a");
    row.className = "stop-row";
    row.href = `/words/${baseSlug}?stop=${idx + 1}`;
    row.title = `View ${stop.word}'s stage`;
    row.dataset.idx = String(idx);
    row.innerHTML = `
      <div class="stop-marker">
        <div class="stop-circle">${idx + 1}</div>
        <div class="stop-connector"></div>
      </div>
      <div class="stop-card">
        <div class="stop-order">Stage ${idx + 1} of ${entry.stops.length}</div>
        <div class="stop-word">${escapeHtml(stop.word)}</div>
        <div class="stop-lang-era">${escapeHtml(stop.lang)} &middot; ${escapeHtml(stop.era)}</div>
        <div class="stop-meaning">"${escapeHtml(stop.meaning)}"</div>
        <div class="stop-note">${escapeHtml(stop.note)}</div>
      </div>
    `;
    row.addEventListener("mouseenter", () => setActive(idx, true));
    row.addEventListener("mouseleave", () => setActive(idx, false));
    panelEl.appendChild(row);
  });

  entry.stops.forEach((stop, idx) => {
    if (idx > 0) {
      const arrow = document.createElement("span");
      arrow.className = "trail-arrow";
      arrow.textContent = "→";
      resultTrailEl.appendChild(arrow);
    }
    const item = document.createElement("a");
    item.className = "trail-item";
    item.href = `/words/${baseSlug}?stop=${idx + 1}`;
    item.title = `View ${stop.word}'s stage`;
    item.dataset.idx = String(idx);
    item.textContent = stop.word;
    item.addEventListener("mouseenter", () => setActive(idx, true));
    item.addEventListener("mouseleave", () => setActive(idx, false));
    resultTrailEl.appendChild(item);
  });

  const points = entry.stops.map((s) => projectPoint(s.lon, s.lat));
  lastWord = word;
  lastEntry = entry;
  lastPoints = points;

  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", x1);
    line.setAttribute("y1", y1);
    line.setAttribute("x2", x2);
    line.setAttribute("y2", y2);
    line.setAttribute("class", "route-line");
    pathLayer.appendChild(line);

    const angleDeg = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
    const arrow = document.createElementNS("http://www.w3.org/2000/svg", "path");
    arrow.setAttribute("class", "route-arrow");
    arrow.setAttribute("d", "M -7,-7 L 8,0 L -7,7");
    arrow.dataset.cx = String((x1 + x2) / 2);
    arrow.dataset.cy = String((y1 + y2) / 2);
    arrow.dataset.angle = String(angleDeg);
    arrowLayer.appendChild(arrow);
  }

  entry.stops.forEach((stop, idx) => {
    const [x, y] = points[idx];
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "pin-group");
    g.dataset.idx = String(idx);
    g.dataset.cx = String(x);
    g.dataset.cy = String(y);
    g.dataset.labelWidth = String(measureLabelWidth(stop.word));

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("r", 8.5);
    circle.setAttribute("class", "pin-dot");

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("class", "pin-label");
    label.textContent = stop.word;

    g.appendChild(circle);
    g.appendChild(label);
    g.addEventListener("mouseenter", () => setActive(idx, true));
    g.addEventListener("mouseleave", () => setActive(idx, false));
    pinLayer.appendChild(g);
  });

  setView({ x: 0, y: 0, k: 1 });
  animateViewTo(computeFitView(points));

  badgeEl.hidden = false;
  badgeTextEl.textContent = entry.current_meaning;
}

// --- Did-you-mean for a bad slug ---------------------------------------

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function findSuggestions(raw, maxSuggestions = 3) {
  const threshold = raw.length <= 4 ? 1 : raw.length <= 7 ? 2 : 3;
  return Object.keys(wordIndex)
    .map((word) => ({ word, dist: levenshtein(raw, word) }))
    .filter((s) => s.dist > 0 && s.dist <= threshold)
    .sort((a, b) => a.dist - b.dist || a.word.localeCompare(b.word))
    .slice(0, maxSuggestions)
    .map((s) => s.word);
}

function showNotFound(raw) {
  notFoundEl.innerHTML = "";
  if (!raw) {
    notFoundEl.appendChild(document.createTextNode("No word was specified. "));
    const link = document.createElement("a");
    link.href = "/index.html";
    link.textContent = "Go trace one";
    notFoundEl.appendChild(link);
    notFoundEl.appendChild(document.createTextNode("."));
    notFoundEl.hidden = false;
    return;
  }

  notFoundEl.appendChild(document.createTextNode(`"${raw}" isn't in this collection yet.`));

  const suggestions = findSuggestions(raw);
  if (suggestions.length > 0) {
    const wrap = document.createElement("span");
    wrap.className = "message-suggestions";
    wrap.appendChild(document.createTextNode(" Did you mean "));
    suggestions.forEach((s, i) => {
      const link = document.createElement("a");
      link.className = "suggestion-link";
      link.href = `/words/${slugify(s)}`;
      link.textContent = s;
      wrap.appendChild(link);
      if (i < suggestions.length - 1) {
        wrap.appendChild(document.createTextNode(i === suggestions.length - 2 ? ", or " : ", "));
      }
    });
    wrap.appendChild(document.createTextNode("?"));
    notFoundEl.appendChild(wrap);
  }
  notFoundEl.hidden = false;
}

function setMetaTags(word, entry, baseWord, partialInfo) {
  const displayWord = word.charAt(0).toUpperCase() + word.slice(1);
  const title = `${displayWord} | Etymology Map`;
  let description;
  if (partialInfo) {
    const stop = entry.stops[entry.stops.length - 1];
    description = `"${word}" (${stop.lang}, ${stop.era}): stage ${partialInfo.stopCount} of ${partialInfo.totalStops} in "${baseWord}"'s journey to English.`;
  } else {
    description = `See how "${word}" traveled through ${entry.stops.length} language${entry.stops.length === 1 ? "" : "s"} on its way to English. Today it means: ${entry.current_meaning}`;
  }

  document.getElementById("page-title").textContent = title;
  document.getElementById("meta-description").setAttribute("content", description);
  document.getElementById("og-title").setAttribute("content", title);
  document.getElementById("og-description").setAttribute("content", description);
}

// --- Share card ---------------------------------------------------------
// Identical to the main app's share-card generator: renders a self-
// contained PNG (word, stage list, cropped map) onto an offscreen canvas.

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;
const CARD_FONT = `-apple-system, "Segoe UI", Helvetica, Arial, sans-serif`;
const CARD_COLORS_LIGHT = {
  bg: "#fdfbf8",
  ocean: "#eef3f4",
  land: "#eae7de",
  border: "#e3e1db",
  text: "#2a2a28",
  dim: "#6b6a64",
  accent: "#b3541e",
};
const CARD_COLORS_DARK = {
  bg: "#17140f",
  ocean: "#1c1811",
  land: "#2b271e",
  border: "#3a352c",
  text: "#f1ece2",
  dim: "#a89e8c",
  accent: "#e2934f",
};

function getCardColors(theme) {
  return theme === "dark" ? CARD_COLORS_DARK : CARD_COLORS_LIGHT;
}

const shareBtn = document.getElementById("share-btn");
const shareModal = document.getElementById("share-modal");
const sharePreview = document.getElementById("share-preview");
const shareThemeLightBtn = document.getElementById("share-theme-light-btn");
const shareThemeDarkBtn = document.getElementById("share-theme-dark-btn");
const shareDownloadBtn = document.getElementById("share-download-btn");
const shareCopyBtn = document.getElementById("share-copy-btn");
const shareNativeBtn = document.getElementById("share-native-btn");
const shareCloseBtn = document.getElementById("share-close-btn");
const shareStatusEl = document.getElementById("share-status");

let currentShareBlob = null;
let currentPreviewUrl = null;
let shareCardTheme = "light";

function wrapCanvasText(ctx, text, maxWidth) {
  const words = text.split(" ");
  const lines = [];
  let current = "";
  words.forEach((word) => {
    const test = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(test).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  });
  if (current) lines.push(current);
  return lines;
}

// Same as wrapCanvasText, but if the text needs more than maxLines it
// ellipsizes the last visible line instead of silently dropping the
// remainder - a wrapped-and-clipped sentence with no visual cue reads as
// a typo, not "there's more".
function wrapCanvasTextClamped(ctx, text, maxWidth, maxLines) {
  const lines = wrapCanvasText(ctx, text, maxWidth);
  if (lines.length <= maxLines) return lines;
  const clamped = lines.slice(0, maxLines);
  let last = clamped[maxLines - 1];
  while (last.length > 0 && ctx.measureText(last + "…").width > maxWidth) {
    last = last.slice(0, -1);
  }
  clamped[maxLines - 1] = last.replace(/\s+$/, "") + "…";
  return clamped;
}

function truncateToWidth(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + "…").width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + "…";
}

function fitCanvasFontSize(ctx, text, maxWidth, startSize, minSize, weight) {
  let size = startSize;
  while (size > minSize) {
    ctx.font = `${weight} ${size}px ${CARD_FONT}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 4;
  }
  return size;
}

function computeCropRect(points, panelW, panelH, padding = 40) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  points.forEach(([px, py]) => {
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  });
  const paddedW = Math.max(maxX - minX, 1) + padding * 2;
  const paddedH = Math.max(maxY - minY, 1) + padding * 2;
  const panelAspect = panelW / panelH;

  let srcW, srcH;
  if (paddedW / paddedH > panelAspect) {
    srcW = Math.min(paddedW, MAP_WIDTH);
    srcH = srcW / panelAspect;
  } else {
    srcH = Math.min(paddedH, MAP_HEIGHT);
    srcW = srcH * panelAspect;
  }
  if (srcW > MAP_WIDTH) {
    srcW = MAP_WIDTH;
    srcH = srcW / panelAspect;
  }
  if (srcH > MAP_HEIGHT) {
    srcH = MAP_HEIGHT;
    srcW = srcH * panelAspect;
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const srcX = clamp(cx - srcW / 2, 0, Math.max(0, MAP_WIDTH - srcW));
  const srcY = clamp(cy - srcH / 2, 0, Math.max(0, MAP_HEIGHT - srcH));
  return { srcX, srcY, srcW, srcH };
}

function rectsOverlapCard(a, b) {
  return !(a.x2 < b.x1 || a.x1 > b.x2 || a.y2 < b.y1 || a.y1 > b.y2);
}

// Greedy label placement for the pins drawn on the share-card canvas:
// try a ring of offsets around each pin and use the first that doesn't
// overlap a label already placed or another pin, so two stops close
// together on the map (e.g. neighboring countries) don't draw illegible
// overlapping text. A pin with no collision-free spot left falls back to
// a small numbered badge instead of forcing an overlapping label.
const CARD_LABEL_CANDIDATES = [
  { dx: 10, dy: -8, align: "left" },
  { dx: 10, dy: 18, align: "left" },
  { dx: -10, dy: -8, align: "right" },
  { dx: -10, dy: 18, align: "right" },
  { dx: 10, dy: -26, align: "left" },
  { dx: 10, dy: 36, align: "left" },
  { dx: -10, dy: -26, align: "right" },
  { dx: -10, dy: 36, align: "right" },
];

function placeCardLabels(ctx, entries, font, pinExclusionR = 9) {
  ctx.font = font;
  const PAD = 4, H = 13;
  const placedBoxes = [];
  return entries.map((entry, i) => {
    const w = ctx.measureText(entry.text).width;
    for (const off of CARD_LABEL_CANDIDATES) {
      const x = entry.sx + off.dx;
      const y = entry.sy + off.dy;
      const x1 = off.align === "left" ? x : x - w;
      const x2 = off.align === "left" ? x + w : x;
      const box = { x1: x1 - PAD, x2: x2 + PAD, y1: y - H - PAD, y2: y + PAD };
      const hitsLabel = placedBoxes.some((p) => rectsOverlapCard(box, p));
      const hitsOtherPin = entries.some((other, j) => {
        if (j === i) return false;
        return (
          box.x1 < other.sx + pinExclusionR && box.x2 > other.sx - pinExclusionR &&
          box.y1 < other.sy + pinExclusionR && box.y2 > other.sy - pinExclusionR
        );
      });
      if (!hitsLabel && !hitsOtherPin) {
        placedBoxes.push(box);
        return { ...entry, x, y, align: off.align, hidden: false };
      }
    }
    return { ...entry, hidden: true };
  });
}

// The site's favicon, reused as a brand mark next to the site link on the
// card. Loaded once and cached since it's the same asset every render.
let shareCardIconPromise = null;
function loadShareCardIcon() {
  if (!shareCardIconPromise) {
    shareCardIconPromise = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null); // draw without the icon if it fails to load
      img.src = "/share-card-mark.svg";
    });
  }
  return shareCardIconPromise;
}

async function buildShareCard(word, entry, points, colors) {
  const favicon = await loadShareCardIcon();

  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  const padding = 48;
  const leftW = 420;
  const mapX = padding + leftW + 28;
  const mapY = padding;
  const mapW = CARD_WIDTH - mapX - padding;
  const mapH = CARD_HEIGHT - padding * 2;

  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(mapX - 28, padding);
  ctx.lineTo(mapX - 28, CARD_HEIGHT - padding);
  ctx.stroke();

  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = colors.accent;
  ctx.font = `700 13px ${CARD_FONT}`;
  ctx.fillText("ETYMOLOGY MAP", padding, padding + 12);

  let y = padding + 68;
  const displayWord = word.charAt(0).toUpperCase() + word.slice(1);
  const titleSize = fitCanvasFontSize(ctx, displayWord, leftW, 60, 36, "700");
  ctx.fillStyle = colors.text;
  ctx.font = `700 ${titleSize}px ${CARD_FONT}`;
  ctx.fillText(displayWord, padding, y);

  y += 34;
  ctx.fillStyle = colors.dim;
  ctx.font = `400 15px ${CARD_FONT}`;
  wrapCanvasTextClamped(ctx, entry.current_meaning, leftW, 2).forEach((line) => {
    ctx.fillText(line, padding, y);
    y += 20;
  });
  y += 20;

  const rowsRemaining = CARD_HEIGHT - padding - 46 - y;
  const rowGap = Math.max(58, Math.min(72, rowsRemaining / entry.stops.length));
  entry.stops.forEach((stop, idx) => {
    // circleCenterY is the single shared vertical anchor for the circle,
    // its number, and the stage word - using textBaseline "middle" for
    // all three guarantees they line up regardless of font size, instead
    // of eyeballed baseline offsets that drift out of alignment.
    const circleCenterY = y + idx * rowGap;

    ctx.beginPath();
    ctx.arc(padding + 10, circleCenterY, 10, 0, Math.PI * 2);
    ctx.fillStyle = colors.bg;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = colors.accent;
    ctx.stroke();
    ctx.fillStyle = colors.accent;
    ctx.font = `700 11px ${CARD_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(idx + 1), padding + 10, circleCenterY + 1);
    ctx.textAlign = "left";

    if (idx < entry.stops.length - 1) {
      ctx.strokeStyle = colors.border;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(padding + 10, circleCenterY + 11);
      ctx.lineTo(padding + 10, circleCenterY + rowGap - 11);
      ctx.stroke();
    }

    ctx.fillStyle = colors.text;
    ctx.font = `700 17px ${CARD_FONT}`;
    ctx.textBaseline = "middle";
    ctx.fillText(stop.word, padding + 32, circleCenterY);
    const wordWidth = ctx.measureText(stop.word).width;
    ctx.fillStyle = colors.accent;
    ctx.font = `700 12px ${CARD_FONT}`;
    ctx.fillText(`${stop.lang.toUpperCase()} · ${stop.era}`, padding + 32 + wordWidth + 10, circleCenterY);
    ctx.textBaseline = "alphabetic";

    const flavor = stop.note || stop.meaning;
    ctx.fillStyle = colors.dim;
    ctx.font = `italic 400 13px ${CARD_FONT}`;
    ctx.fillText(truncateToWidth(ctx, flavor, leftW - 32), padding + 32, circleCenterY + 26);
  });

  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, CARD_HEIGHT - 46);
  ctx.lineTo(padding + leftW, CARD_HEIGHT - 46);
  ctx.stroke();

  // tagline stays under the stage list, bottom-left of the left column
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = colors.dim;
  ctx.font = `400 12px ${CARD_FONT}`;
  ctx.fillText("Trace any word's journey", padding, CARD_HEIGHT - 22);

  ctx.fillStyle = colors.ocean;
  ctx.fillRect(mapX, mapY, mapW, mapH);

  const crop = computeCropRect(points, mapW, mapH);

  if (mapLandFeature && mapProjection && d3geoModule) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(mapX, mapY, mapW, mapH);
    ctx.clip();
    const scaleX = mapW / crop.srcW;
    const scaleY = mapH / crop.srcH;
    ctx.translate(mapX - crop.srcX * scaleX, mapY - crop.srcY * scaleY);
    ctx.scale(scaleX, scaleY);
    const canvasPathGen = d3geoModule.geoPath(mapProjection, ctx);
    ctx.beginPath();
    canvasPathGen(mapLandFeature);
    ctx.fillStyle = colors.land;
    ctx.fill();
    ctx.restore();
  }

  function childToScreen(cx, cy) {
    return [mapX + (cx - crop.srcX) * (mapW / crop.srcW), mapY + (cy - crop.srcY) * (mapH / crop.srcH)];
  }

  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]);
  ctx.globalAlpha = 0.8;
  for (let i = 0; i < points.length - 1; i++) {
    const [sx1, sy1] = childToScreen(points[i][0], points[i][1]);
    const [sx2, sy2] = childToScreen(points[i + 1][0], points[i + 1][1]);
    ctx.beginPath();
    ctx.moveTo(sx1, sy1);
    ctx.lineTo(sx2, sy2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  ctx.fillStyle = colors.accent;
  for (let i = 0; i < points.length - 1; i++) {
    const [sx1, sy1] = childToScreen(points[i][0], points[i][1]);
    const [sx2, sy2] = childToScreen(points[i + 1][0], points[i + 1][1]);
    const mx = (sx1 + sx2) / 2;
    const my = (sy1 + sy2) / 2;
    const angle = Math.atan2(sy2 - sy1, sx2 - sx1);
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(-6, -5);
    ctx.lineTo(7, 0);
    ctx.lineTo(-6, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // draw every pin first, so label placement can treat all of them as
  // obstacles regardless of draw order
  const pinLabelFont = `700 13px ${CARD_FONT}`;
  const screenPositions = entry.stops.map((stop, idx) => {
    const [sx, sy] = childToScreen(points[idx][0], points[idx][1]);
    ctx.beginPath();
    ctx.arc(sx, sy, 6, 0, Math.PI * 2);
    ctx.fillStyle = colors.accent;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = colors.bg;
    ctx.stroke();
    return { sx, sy, text: stop.word, idx };
  });
  const placedLabels = placeCardLabels(ctx, screenPositions, pinLabelFont);
  placedLabels.forEach((label) => {
    if (label.hidden) {
      // no collision-free spot for the word itself - fall back to just
      // the stage number, still cross-referenceable against the list
      ctx.beginPath();
      ctx.arc(label.sx, label.sy, 8, 0, Math.PI * 2);
      ctx.fillStyle = colors.bg;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = colors.accent;
      ctx.stroke();
      ctx.fillStyle = colors.accent;
      ctx.font = `700 10px ${CARD_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(label.idx + 1), label.sx, label.sy + 1);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      return;
    }
    ctx.font = pinLabelFont;
    ctx.textAlign = label.align === "right" ? "right" : "left";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = colors.bg;
    ctx.strokeText(label.text, label.x, label.y);
    ctx.fillStyle = colors.text;
    ctx.fillText(label.text, label.x, label.y);
    ctx.textAlign = "left";
  });

  // site link + brand mark sit together in the card's actual bottom-right
  // corner, under the map, on the same baseline as the tagline at
  // bottom-left
  ctx.textBaseline = "alphabetic";
  const linkBaseline = CARD_HEIGHT - 22;
  const linkFont = `700 15px ${CARD_FONT}`;
  ctx.font = linkFont;
  const linkText = "ETYMOLOGYMAP.COM";
  const linkW = ctx.measureText(linkText).width;
  const iconSize = 16;
  const iconGap = 8;
  const groupRight = CARD_WIDTH - padding;
  const textX = groupRight - linkW;
  const iconX = textX - iconGap - iconSize;
  const iconY = linkBaseline - iconSize + 3;

  ctx.fillStyle = colors.accent;
  ctx.font = linkFont;
  ctx.fillText(linkText, textX, linkBaseline);

  if (favicon) {
    ctx.drawImage(favicon, iconX, iconY, iconSize, iconSize);
    ctx.save();
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(iconX - 0.5, iconY - 0.5, iconSize + 1, iconSize + 1);
    ctx.restore();
  }

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

function updateShareThemeButtons() {
  shareThemeLightBtn.classList.toggle("active", shareCardTheme === "light");
  shareThemeLightBtn.setAttribute("aria-pressed", shareCardTheme === "light" ? "true" : "false");
  shareThemeDarkBtn.classList.toggle("active", shareCardTheme === "dark");
  shareThemeDarkBtn.setAttribute("aria-pressed", shareCardTheme === "dark" ? "true" : "false");
}

async function generateShareCard() {
  shareStatusEl.hidden = true;
  shareStatusEl.textContent = "";
  shareDownloadBtn.disabled = true;
  shareCopyBtn.disabled = true;
  shareNativeBtn.disabled = true;

  const blob = await buildShareCard(lastWord, lastEntry, lastPoints, getCardColors(shareCardTheme));
  currentShareBlob = blob;
  if (!blob) {
    shareStatusEl.hidden = false;
    shareStatusEl.textContent = "Couldn't render the image in this browser.";
    return;
  }

  if (currentPreviewUrl) URL.revokeObjectURL(currentPreviewUrl);
  currentPreviewUrl = URL.createObjectURL(blob);
  sharePreview.src = currentPreviewUrl;

  shareDownloadBtn.disabled = false;
  shareCopyBtn.disabled = !(navigator.clipboard && window.ClipboardItem);

  const shareFile = new File([blob], `${lastWord}-etymology.png`, { type: "image/png" });
  shareNativeBtn.disabled = !(navigator.canShare && navigator.canShare({ files: [shareFile] }));
}

async function openShareModal() {
  if (!lastWord || !lastEntry || !lastPoints) return;

  shareCardTheme = isDarkActive() ? "dark" : "light";
  updateShareThemeButtons();

  shareStatusEl.hidden = true;
  shareStatusEl.textContent = "";
  shareDownloadBtn.disabled = true;
  shareCopyBtn.disabled = true;
  shareNativeBtn.disabled = true;
  sharePreview.removeAttribute("src");
  shareModal.hidden = false;

  await generateShareCard();
}

function closeShareModal() {
  shareModal.hidden = true;
}

function setupShareCard() {
  shareBtn.addEventListener("click", openShareModal);
  shareCloseBtn.addEventListener("click", closeShareModal);
  shareModal.addEventListener("click", (e) => {
    if (e.target === shareModal) closeShareModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !shareModal.hidden) closeShareModal();
  });

  shareThemeLightBtn.addEventListener("click", () => {
    if (shareCardTheme === "light") return;
    shareCardTheme = "light";
    updateShareThemeButtons();
    generateShareCard();
  });
  shareThemeDarkBtn.addEventListener("click", () => {
    if (shareCardTheme === "dark") return;
    shareCardTheme = "dark";
    updateShareThemeButtons();
    generateShareCard();
  });

  shareDownloadBtn.addEventListener("click", () => {
    if (!currentShareBlob || !lastWord) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(currentShareBlob);
    a.download = `${lastWord}-etymology.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });

  shareCopyBtn.addEventListener("click", async () => {
    if (!currentShareBlob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": currentShareBlob })]);
      shareStatusEl.hidden = false;
      shareStatusEl.textContent = "Copied to clipboard.";
    } catch (err) {
      shareStatusEl.hidden = false;
      shareStatusEl.textContent = "Couldn't copy the image in this browser.";
    }
  });

  shareNativeBtn.addEventListener("click", async () => {
    if (!currentShareBlob || !lastWord || !lastEntry) return;
    const file = new File([currentShareBlob], `${lastWord}-etymology.png`, { type: "image/png" });
    try {
      await navigator.share({
        files: [file],
        title: `${lastWord} | Etymology Map`,
        // Web Share API support for combining files with a separate url
        // field is inconsistent across browsers, so the link travels as
        // plain text instead - that works everywhere the text field does.
        text: `Check out the journey "${lastWord}" took into English! See more at ${window.location.href}`,
      });
    } catch (err) {
      if (err && err.name !== "AbortError") {
        shareStatusEl.hidden = false;
        shareStatusEl.textContent = "Sharing isn't available right now.";
      }
    }
  });
}

function setupCopyLink() {
  let resetTimer = null;
  copyLinkBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      copyLinkBtn.textContent = "✓";
      copyLinkBtn.classList.add("copied");
    } catch (err) {
      copyLinkBtn.textContent = "⚠️";
    }
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      copyLinkBtn.textContent = "🔗";
      copyLinkBtn.classList.remove("copied");
    }, 1500);
  });
}

// --- Dark mode ------------------------------------------------------------

const THEME_STORAGE_KEY = "etymology-map-theme";
const themeToggleBtn = document.getElementById("theme-toggle-btn");

function isDarkActive() {
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit === "dark") return true;
  if (explicit === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(theme) {
  if (theme === "dark" || theme === "light") {
    document.documentElement.setAttribute("data-theme", theme);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  const dark = isDarkActive();
  themeToggleBtn.textContent = dark ? "☀️" : "🌙";
  themeToggleBtn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
}

function setupThemeToggle() {
  let stored = null;
  try {
    stored = localStorage.getItem(THEME_STORAGE_KEY);
  } catch (err) {
    stored = null;
  }
  applyTheme(stored);

  themeToggleBtn.addEventListener("click", () => {
    const next = isDarkActive() ? "light" : "dark";
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch (err) {}
    applyTheme(next);
  });
}

setupPanZoom();
setupShareCard();
setupCopyLink();
setupThemeToggle();

(async function init() {
  const dataEl = document.getElementById("word-data");
  const pageData = dataEl ? JSON.parse(dataEl.textContent) : null;
  const normalized = pageData ? pageData.word : "";
  const entry = pageData ? { stops: pageData.stops, current_meaning: pageData.current_meaning } : null;
  const stopParam = new URLSearchParams(window.location.search).get("stop");

  await Promise.all([loadWordIndex(), loadMap()]);

  if (entry) {
    const totalStops = entry.stops.length;
    let stopCount = totalStops;
    if (stopParam) {
      const n = parseInt(stopParam, 10);
      if (Number.isFinite(n)) stopCount = clamp(n, 1, totalStops);
    }
    const isPartial = stopCount < totalStops;
    const displayEntry = isPartial
      ? { stops: entry.stops.slice(0, stopCount), current_meaning: entry.stops[stopCount - 1].meaning }
      : entry;
    const displayWord = entry.stops[stopCount - 1].word;

    // Only override the baked-in title/description for a partial (?stop=)
    // view — the full-journey view's static tags are already correct and
    // more descriptive than what setMetaTags would generate.
    if (isPartial) {
      setMetaTags(displayWord, displayEntry, normalized, { stopCount, totalStops });
    }
    renderWordPage(displayWord, displayEntry, normalized);

    const originLang = entry.stops[0].lang;
    journeyMetaEl.textContent = `${totalStops} stage${totalStops === 1 ? "" : "s"} from ${originLang} to English.`;
    journeyMetaEl.hidden = false;

    renderRelatedWords(normalized, originLang);

    if (isPartial) {
      partialStageNumEl.textContent = String(stopCount);
      partialStageTotalEl.textContent = String(totalStops);
      partialFullLinkEl.href = `/words/${slugify(normalized)}`;
      partialNoticeEl.hidden = false;
      badgeLabelEl.textContent = "At this point it meant";
    } else {
      partialNoticeEl.hidden = true;
      badgeLabelEl.textContent = "Today it means";
    }
  } else {
    showNotFound(normalized);
  }
})();

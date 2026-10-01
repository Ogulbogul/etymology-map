// Share card renderer (1200x630 PNG), used by the home page and every word page.
// Layout: the route map fills the card, a wash fades it out behind the headline on
// the left, and a strip along the bottom lists each stage.

const W = 1200;
const H = 630;
const FONT = `"DM Sans", -apple-system, "Segoe UI", Helvetica, Arial, sans-serif`;

const THEMES = {
  light: {
    page: "#ffffff", mapBg: "#fbfaf7", land: "#ddd8ca", landStroke: "#c6bfae", accent: "#b3541e",
    text: "#2a2a28", dim: "#6b6a64", soft: "#f3e3d3", border: "#e3e1db", strip: "rgba(255,255,255,0.96)",
    pinStroke: "#ffffff", pinText: "#ffffff",
  },
  dark: {
    page: "#14110d", mapBg: "#17130e", land: "#2b271e", landStroke: "#423c30", accent: "#e2934f",
    text: "#f1ece2", dim: "#a89e8c", soft: "rgba(226,147,79,0.16)", border: "#3a352c", strip: "rgba(28,24,17,0.96)",
    pinStroke: "#1c1811", pinText: "#14110d",
  },
};

let iconPromise = null;
function loadIcon(url) {
  if (!iconPromise) {
    iconPromise = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }
  return iconPromise;
}

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitSize(ctx, text, maxW, start, min, weight, style = "") {
  let size = start;
  while (size > min) {
    ctx.font = `${style} ${weight} ${size}px ${FONT}`;
    if (ctx.measureText(text).width <= maxW) break;
    size -= 2;
  }
  return size;
}

function truncate(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + "…").width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + "…";
}

function wrap(ctx, text, maxW, maxLines) {
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  words.forEach((w) => {
    const t = cur ? `${cur} ${w}` : w;
    if (cur && ctx.measureText(t).width > maxW) { lines.push(cur); cur = w; } else cur = t;
  });
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const out = lines.slice(0, maxLines);
  out[maxLines - 1] = truncate(ctx, out[maxLines - 1] + "…", maxW);
  return out;
}

function groupStops(stops) {
  const groups = [];
  stops.forEach((s, i) => {
    const hit = groups.find((g) => Math.abs(g.lon - s.lon) < 0.3 && Math.abs(g.lat - s.lat) < 0.3);
    if (hit) hit.idxs.push(i);
    else groups.push({ idxs: [i], lon: s.lon, lat: s.lat });
  });
  groups.forEach((g) => {
    const f = g.idxs[0];
    const run = g.idxs.every((k, n) => n === 0 || k === g.idxs[n - 1] + 1);
    g.badge = g.idxs.length === 1 ? String(f + 1) : run ? `${f + 1}–${g.idxs[g.idxs.length - 1] + 1}` : g.idxs.map((k) => k + 1).join(",");
  });
  return groups;
}

export async function buildShareCard({ word, entry, points, theme = "light", land, projection, d3geo, wordCount, iconUrl = "favicon.svg" }) {
  const c = THEMES[theme] || THEMES.light;
  try {
    await Promise.all(["400", "500", "600", "700"].map((w) => document.fonts.load(`${w} 20px \"DM Sans\"`)).concat(document.fonts.load('italic 400 20px "DM Sans"')));
  } catch (e) { /* fall back to the system font */ }
  const icon = await loadIcon(iconUrl);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = c.mapBg;
  ctx.fillRect(0, 0, W, H);

  // --- Map: route fitted into the right-hand clear area
  const box = { x1: 600, y1: 100, x2: 1140, y2: 395 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  points.forEach(([px, py]) => { minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py); });
  const bw = Math.max(maxX - minX, 1);
  const bh = Math.max(maxY - minY, 1);
  const scale = Math.max(1.4, Math.min(5, (box.x2 - box.x1) / bw, (box.y2 - box.y1) / bh));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const ox = (box.x1 + box.x2) / 2 - cx * scale;
  const oy = (box.y1 + box.y2) / 2 - cy * scale;
  const toPx = ([px, py]) => [px * scale + ox, py * scale + oy];

  if (land && projection && d3geo) {
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    const gen = d3geo.geoPath(projection, ctx);
    ctx.beginPath();
    gen(land);
    ctx.fillStyle = c.land;
    ctx.fill();
    ctx.lineWidth = 0.72 / scale;
    ctx.strokeStyle = c.landStroke;
    ctx.stroke();
    ctx.restore();
  }

  // Dashed route arcs with an arrowhead short of each pin
  const pts = points.map(toPx);
  const PIN_R = 16;
  ctx.lineCap = "round";
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;
    let nx = dy / len, ny = -dx / len;
    if (ny > 0) { nx = -nx; ny = -ny; }
    const qx = (x1 + x2) / 2 + nx * len * 0.17;
    const qy = (y1 + y2) / 2 + ny * len * 0.17;
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(qx, qy, x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Pins (stages at the same place share one badged pin)
  groupStops(entry.stops).forEach((g) => {
    const [px, py] = pts[g.idxs[0]];
    ctx.font = `700 21px ${FONT}`;
    const pillW = g.idxs.length > 1 ? Math.max(PIN_R * 2, ctx.measureText(g.badge).width + 22) : PIN_R * 2;
    rrect(ctx, px - pillW / 2, py - PIN_R, pillW, PIN_R * 2, PIN_R);
    ctx.fillStyle = c.accent;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = c.pinStroke;
    ctx.stroke();
    ctx.fillStyle = c.pinText;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(g.badge, px, py + 1);
  });
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // --- Wash behind the headline
  const wash = ctx.createLinearGradient(0, 0, W, 0);
  wash.addColorStop(0, c.page);
  wash.addColorStop(0.32, c.page + "f2");
  wash.addColorStop(0.62, c.page + "00");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);

  // --- Header: logo, name, count
  if (icon) {
    ctx.save();
    rrect(ctx, 64, 44, 44, 44, 10);
    ctx.clip();
    ctx.drawImage(icon, 64, 44, 44, 44);
    ctx.restore();
  }
  ctx.fillStyle = c.text;
  ctx.font = `500 26px ${FONT}`;
  ctx.fillText("Etymology Map", 120, 75);
  ctx.textAlign = "right";
  ctx.fillStyle = c.dim;
  ctx.font = `400 18px ${FONT}`;
  ctx.fillText(wordCount ? `${wordCount.toLocaleString()} words traced` : "etymologymap.com", W - 64, 73);
  ctx.textAlign = "left";

  // --- Headline block
  ctx.fillStyle = c.dim;
  ctx.font = `600 18px ${FONT}`;
  if ("letterSpacing" in ctx) ctx.letterSpacing = "1.8px";
  ctx.fillText("TRACE THE JOURNEY OF", 64, 150);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";

  const shown = word.toLowerCase();
  const size = fitSize(ctx, shown, 560, 116, 52, "700");
  ctx.fillStyle = c.accent;
  ctx.font = `700 ${size}px ${FONT}`;
  ctx.fillText(shown, 60, 150 + 8 + size * 0.86);

  let y = 150 + 8 + size * 0.86 + 38;
  ctx.fillStyle = c.dim;
  ctx.font = `italic 400 24px ${FONT}`;
  wrap(ctx, entry.current_meaning, 540, 2).forEach((line) => { ctx.fillText(line, 64, y); y += 32; });

  // pills
  const stops = entry.stops;
  const eras = stops.map((s) => s.era).filter(Boolean);
  const firstEra = (eras[0] || "").replace(/^c\.\s*/, "c. ");
  const lastEra = eras[eras.length - 1] || "";
  const pills = [
    `${stops.length} stages`,
    `${stops[0].lang} to ${stops[stops.length - 1].lang}`,
    firstEra && lastEra && firstEra !== lastEra ? `${firstEra}–${lastEra.replace(/^c\.\s*/, "")}` : firstEra || lastEra,
  ].filter(Boolean);
  let px = 64;
  const py = y + 2;
  ctx.font = `600 18px ${FONT}`;
  pills.forEach((t) => {
    const tw = ctx.measureText(t).width;
    if (px + tw + 28 > 620) return;
    rrect(ctx, px, py, tw + 28, 36, 18);
    ctx.fillStyle = c.soft;
    ctx.fill();
    ctx.fillStyle = c.accent;
    ctx.fillText(t, px + 14, py + 25);
    px += tw + 28 + 10;
  });

  // --- Bottom strip: each stage with its meaning and note
  const SH = 200;
  ctx.fillStyle = c.strip;
  ctx.fillRect(0, H - SH, W, SH);
  ctx.fillStyle = c.border;
  ctx.fillRect(0, H - SH, W, 1);
  const colW = (W - 100) / stops.length;
  stops.forEach((s, i) => {
    const x = 50 + i * colW;
    if (i > 0) { ctx.fillStyle = c.border; ctx.fillRect(x, H - SH + 22, 1, SH - 44); }
    const tx = x + 14;
    const innerW = colW - 28;
    const cy0 = H - SH + 22 + 15;
    ctx.beginPath();
    ctx.arc(tx + 15, cy0, 15, 0, Math.PI * 2);
    ctx.fillStyle = c.accent;
    ctx.fill();
    ctx.fillStyle = c.pinText;
    ctx.font = `700 16px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), tx + 15, cy0 + 1);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    const availW = innerW - 40;
    const wsize = fitSize(ctx, s.word, availW, 28, 15, "700");
    ctx.fillStyle = c.text;
    ctx.font = `700 ${wsize}px ${FONT}`;
    ctx.fillText(truncate(ctx, s.word, availW), tx + 40, cy0 + 9);
    let ly = cy0 + 42;
    ctx.font = `600 15px ${FONT}`;
    ctx.fillStyle = c.accent;
    const langText = truncate(ctx, s.lang, innerW);
    ctx.fillText(langText, tx, ly);
    ly += 19;
    ctx.font = `400 14px ${FONT}`;
    ctx.fillStyle = c.dim;
    ctx.fillText(truncate(ctx, s.era || "", innerW), tx, ly);
    ly += 24;
    if (s.meaning) {
      ctx.font = `italic 400 15px ${FONT}`;
      ctx.fillStyle = c.text;
      ctx.fillText(truncate(ctx, `\u201c${s.meaning}\u201d`, innerW), tx, ly);
      ly += 21;
    }
    if (s.note) {
      ctx.font = `400 14px ${FONT}`;
      ctx.fillStyle = c.dim;
      const room = Math.max(1, Math.floor((H - 14 - ly) / 18) + 1);
      wrap(ctx, s.note, innerW, Math.min(3, room)).forEach((line) => { ctx.fillText(line, tx, ly); ly += 18; });
    }
  });

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

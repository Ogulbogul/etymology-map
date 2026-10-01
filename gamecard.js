// The image you get from "Share result" on /play: a 1200x630 PNG with the score ring,
// a verdict, one bar per round and, when known, where the player landed among everyone.
// It deliberately shows no word names, so sharing a daily result never spoils the words.

const W = 1200;
const H = 630;
const FONT = `"Inter", -apple-system, "Segoe UI", Helvetica, Arial, sans-serif`;

const THEMES = {
  light: {
    page: "#fbfaf7", land: "#e3ded0", landStroke: "#d2cbb9", accent: "#b3541e", text: "#2a2a28", dim: "#6b6a64",
    track: "#ece9e1", border: "#e3e1db", panel: "rgba(255,255,255,0.88)",
    hi: "#2e7d4f", mid: "#d9a21b", low: "#b42318",
  },
  dark: {
    page: "#14110d", land: "#2b271e", landStroke: "#3a352c", accent: "#e2934f", text: "#f1ece2", dim: "#a89e8c",
    track: "#2a251c", border: "#3a352c", panel: "rgba(28,24,17,0.86)",
    hi: "#6fcf97", mid: "#e2b04a", low: "#f97066",
  },
};

export const tierFor = (value, max) => {
  const f = value / max;
  return f >= 0.7 ? "hi" : f >= 0.35 ? "mid" : "low";
};

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

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

export async function buildGameCard({ mode, label, score, max, rounds, roundMax, verdict, pct, streak, theme = "dark", countries, projection, d3geo }) {
  const c = THEMES[theme] || THEMES.dark;
  try {
    await Promise.all(["400", "500", "600", "700"].map((w) => document.fonts.load(`${w} 20px "Inter"`)));
  } catch (e) { /* the system font is fine */ }
  const icon = await loadIcon("favicon.svg");
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "alphabetic";

  // Background: the world, faint.
  ctx.fillStyle = c.page;
  ctx.fillRect(0, 0, W, H);
  if (countries && projection && d3geo) {
    ctx.save();
    const k = W / 960;
    ctx.translate(0, (H - 500 * k) / 2);
    ctx.scale(k, k);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = c.land;
    ctx.strokeStyle = c.landStroke;
    ctx.lineWidth = 0.7;
    const path = d3geo.geoPath(projection).context(ctx);
    ctx.beginPath();
    path(countries);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  // A soft panel behind the content keeps the text readable over the map.
  ctx.fillStyle = c.panel;
  rrect(ctx, 40, 110, W - 80, 430, 22);
  ctx.fill();
  ctx.strokeStyle = c.border;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Header
  if (icon) {
    ctx.save();
    rrect(ctx, 64, 40, 44, 44, 10);
    ctx.clip();
    ctx.drawImage(icon, 64, 40, 44, 44);
    ctx.restore();
  }
  ctx.fillStyle = c.text;
  ctx.font = `600 26px ${FONT}`;
  ctx.fillText("Etymology Map", 122, 72);
  ctx.textAlign = "right";
  ctx.fillStyle = c.dim;
  ctx.font = `600 20px ${FONT}`;
  ctx.fillText(label, W - 64, 70);
  ctx.textAlign = "left";

  // Score ring
  const cx = 300;
  const cy = 325;
  const R = 130;
  const lw = 28;
  const total = tierFor(score, max);
  ctx.lineWidth = lw;
  ctx.lineCap = "round";
  ctx.strokeStyle = c.track;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = c[total];
  ctx.beginPath();
  ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.012, Math.min(1, score / max)));
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.fillStyle = c.text;
  ctx.font = `700 62px ${FONT}`;
  ctx.fillText(score.toLocaleString("en-US"), cx, cy + 14);
  ctx.fillStyle = c.dim;
  ctx.font = `500 26px ${FONT}`;
  ctx.fillText(`/ ${max.toLocaleString("en-US")}`, cx, cy + 56);
  ctx.textAlign = "left";

  // Verdict + streak
  const x0 = 560;
  ctx.fillStyle = c.text;
  ctx.font = `700 46px ${FONT}`;
  ctx.fillText(verdict, x0, 190);
  if (streak && streak >= 2) {
    ctx.fillStyle = c.accent;
    ctx.font = `600 22px ${FONT}`;
    ctx.fillText(`🔥 ${streak}-day streak`, x0, 224);
  }

  // One bar per round (no word names: nothing to spoil)
  const barX = x0 + 120;
  const barW = 380;
  let y = 252;
  rounds.forEach((pts, i) => {
    const t = tierFor(pts, roundMax);
    ctx.fillStyle = c.dim;
    ctx.font = `600 20px ${FONT}`;
    ctx.fillText(`Word ${i + 1}`, x0, y + 17);
    ctx.fillStyle = c.track;
    rrect(ctx, barX, y, barW, 20, 10);
    ctx.fill();
    ctx.fillStyle = c[t];
    rrect(ctx, barX, y, Math.max(20, barW * Math.min(1, pts / roundMax)), 20, 10);
    ctx.fill();
    ctx.fillStyle = c.text;
    ctx.textAlign = "right";
    ctx.font = `700 22px ${FONT}`;
    ctx.fillText(String(pts), x0 + 560 + 20, y + 18);
    ctx.textAlign = "left";
    y += 42;
  });

  // Where you landed among all players
  if (pct != null) {
    ctx.fillStyle = c.track;
    rrect(ctx, x0, 508, 560, 12, 6);
    ctx.fill();
    ctx.fillStyle = c.accent;
    rrect(ctx, x0, 508, Math.max(12, 560 * pct / 100), 12, 6);
    ctx.fill();
    ctx.fillStyle = c.text;
    ctx.font = `600 22px ${FONT}`;
    ctx.fillText(`Beat ${pct}% of players`, x0, 498);
  }

  // Footer
  ctx.fillStyle = c.dim;
  ctx.font = `500 22px ${FONT}`;
  ctx.fillText("Can you beat it?  etymologymap.com/play", 64, 590);

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

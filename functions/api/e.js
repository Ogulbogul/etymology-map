// Receives anonymous usage events from track.js and adds them to daily
// totals in the D1 database bound as DB. Only (day, event type, word or
// search text, count, seconds) is stored: no IP address, cookie, user agent
// or visitor/session ID is ever written. Totals older than ~13 months are
// deleted.

const TYPES = new Set(["view", "miss", "story", "share", "time", "404"]);
const MAX_EVENTS = 30;
const MAX_SECONDS = 1800;
const BOT_RE = /bot|crawl|spider|slurp|preview|headless|lighthouse|monitor/i;

let wordSet = null;

async function knownWords(env, request) {
  if (wordSet) return wordSet;
  const url = new URL("/data/words-index.json", request.url);
  const res = await env.ASSETS.fetch(url);
  const idx = await res.json();
  wordSet = new Set(Object.keys(idx));
  return wordSet;
}

// Returns a safe key for the event, or null to drop it.
function cleanKey(type, raw, words) {
  if (typeof raw !== "string") return null;
  if (type === "404") {
    const path = raw.toLowerCase().split(/[?#]/)[0].slice(0, 80);
    return /^\/[a-z0-9\/._%-]*$/.test(path) ? path : null;
  }
  const key = raw.toLowerCase().normalize("NFC").replace(/\s+/g, " ").trim();
  if (type === "miss") {
    // Keep only plausible words: letters, spaces, hyphens, apostrophes,
    // at most four words. Anything else (numbers, emails, long text) is
    // dropped so no personal information can end up in the totals.
    if (key.length < 2 || key.length > 40) return null;
    if (!/^[\p{L}][\p{L}' -]*$/u.test(key)) return null;
    if (key.split(" ").length > 4) return null;
    if (words.has(key)) return null;
    return key;
  }
  return words.has(key) ? key : null;
}

export async function onRequestPost({ request, env }) {
  const done = new Response(null, { status: 204 });
  if (!env.DB) return done;
  if (BOT_RE.test(request.headers.get("user-agent") || "")) return done;

  let events;
  try {
    events = await request.json();
  } catch (err) {
    return new Response(null, { status: 400 });
  }
  if (!Array.isArray(events)) return new Response(null, { status: 400 });

  const words = await knownWords(env, request);
  const totals = new Map();
  for (const ev of events.slice(0, MAX_EVENTS)) {
    if (!ev || !TYPES.has(ev.t)) continue;
    const key = cleanKey(ev.t, ev.k, words);
    if (!key) continue;
    let seconds = 0;
    if (ev.t === "time") {
      seconds = Math.min(MAX_SECONDS, Math.max(0, Math.round(Number(ev.s) || 0)));
      if (!seconds) continue;
    }
    const id = ev.t + "\u0000" + key;
    const cur = totals.get(id) || { type: ev.t, key, count: 0, seconds: 0 };
    cur.count += 1;
    cur.seconds += seconds;
    totals.set(id, cur);
  }
  if (!totals.size) return done;

  const day = new Date().toISOString().slice(0, 10);
  const stmt = env.DB.prepare(
    "INSERT INTO daily_counts (day, type, key, count, seconds) VALUES (?1, ?2, ?3, ?4, ?5) " +
      "ON CONFLICT (day, type, key) DO UPDATE SET count = count + excluded.count, seconds = seconds + excluded.seconds"
  );
  try {
    await env.DB.batch([...totals.values()].map((t) => stmt.bind(day, t.type, t.key, t.count, t.seconds)));
    if (Math.random() < 0.01) {
      await env.DB.prepare("DELETE FROM daily_counts WHERE day < date('now', '-400 days')").run();
    }
  } catch (err) {
    // Over the free daily write limit, or the table is missing: drop silently.
  }
  return done;
}

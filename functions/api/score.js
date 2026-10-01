// Anonymous score percentiles for the /play game.
//
// The game posts one finished score. Only a count per score bucket is kept
// (in the same daily_counts table as the usage totals, type = 'game'), so
// nothing links a score to a person: no cookie, IP address or ID is stored.
// The reply says what share of earlier games this score beat.
//
//   POST /api/score  { m: "d" | "p", s: 0..5000, r: 1 | 0 }
//     m  mode: d = today's daily game, p = practice
//     s  total score (five rounds of up to 1000)
//     r  1 = also add this game to the totals, 0 = only look up the percentile
//        (used when the visitor has Do Not Track / Global Privacy Control on)
//   -> { pct: 0..100 | null, n: number of earlier games compared }

const MAX_SCORE = 5000;
const BUCKET = 50;
const MIN_GAMES = 10;
const BOT_RE = /bot|crawl|spider|slurp|preview|headless|lighthouse|monitor/i;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ pct: null, n: 0 });

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "bad request" }, 400);
  }
  const mode = body && body.m === "d" ? "d" : body && body.m === "p" ? "p" : null;
  const score = Math.round(Number(body && body.s));
  if (!mode || !Number.isFinite(score) || score < 0 || score > MAX_SCORE) return json({ error: "bad request" }, 400);

  const bucket = Math.floor(score / BUCKET) * BUCKET;
  const day = new Date().toISOString().slice(0, 10);
  const dayFilter = mode === "d" ? "day = ?1" : "day >= date(?1, '-30 days')";

  let rows = [];
  try {
    rows = (
      await env.DB.prepare(
        `SELECT key, SUM(count) AS n FROM daily_counts WHERE type = 'game' AND key LIKE ?2 AND ${dayFilter} GROUP BY key`
      )
        .bind(day, mode + ":%")
        .all()
    ).results;
  } catch (err) {
    return json({ pct: null, n: 0 });
  }

  let below = 0;
  let equal = 0;
  let total = 0;
  for (const r of rows) {
    const b = Number(String(r.key).slice(2));
    if (!Number.isFinite(b)) continue;
    total += r.n;
    if (b < bucket) below += r.n;
    else if (b === bucket) equal += r.n;
  }
  const pct = total >= MIN_GAMES ? Math.round(((below + equal / 2) / total) * 100) : null;

  if (body.r === 1 && !BOT_RE.test(request.headers.get("user-agent") || "")) {
    try {
      await env.DB.prepare(
        "INSERT INTO daily_counts (day, type, key, count, seconds) VALUES (?1, 'game', ?2, 1, 0) " +
          "ON CONFLICT (day, type, key) DO UPDATE SET count = count + 1"
      )
        .bind(day, `${mode}:${bucket}`)
        .run();
    } catch (err) {
      // Over the free write limit or table missing: the percentile still works.
    }
  }
  return json({ pct, n: total });
}

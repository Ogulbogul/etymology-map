// Private stats page for the anonymous usage totals.
// Open /api/stats?key=YOUR_STATS_KEY (optionally &days=7, max 400).
// STATS_KEY is a secret set in the Cloudflare Pages project settings.

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function table(title, note, headers, rows) {
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join("");
  const body = rows.length
    ? rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${headers.length}" class="empty">No data yet</td></tr>`;
  return `<section><h2>${esc(title)}</h2>${note ? `<p class="note">${esc(note)}</p>` : ""}<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></section>`;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key") || "";
  if (!env.STATS_KEY || key !== env.STATS_KEY) return new Response("Not found", { status: 404 });
  if (!env.DB) return new Response("The DB binding is not configured.", { status: 500 });

  const days = Math.min(400, Math.max(1, parseInt(url.searchParams.get("days") || "30", 10) || 30));
  const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
  const q = (sql, ...args) => env.DB.prepare(sql).bind(since, ...args).all().then((r) => r.results);

  const [totals, misses, views, stories, shares, times, notFound, daily] = await Promise.all([
    q("SELECT type, SUM(count) AS n FROM daily_counts WHERE day >= ?1 GROUP BY type"),
    q("SELECT key, SUM(count) AS n FROM daily_counts WHERE day >= ?1 AND type = 'miss' GROUP BY key ORDER BY n DESC LIMIT 100"),
    q("SELECT key, SUM(count) AS n FROM daily_counts WHERE day >= ?1 AND type = 'view' GROUP BY key ORDER BY n DESC LIMIT 50"),
    q("SELECT key, SUM(count) AS n FROM daily_counts WHERE day >= ?1 AND type = 'story' GROUP BY key ORDER BY n DESC LIMIT 25"),
    q("SELECT key, SUM(count) AS n FROM daily_counts WHERE day >= ?1 AND type = 'share' GROUP BY key ORDER BY n DESC LIMIT 25"),
    q(
      "SELECT v.key AS key, v.n AS views, COALESCE(t.s, 0) AS secs FROM " +
        "(SELECT key, SUM(count) AS n FROM daily_counts WHERE day >= ?1 AND type = 'view' GROUP BY key) v " +
        "LEFT JOIN (SELECT key, SUM(seconds) AS s FROM daily_counts WHERE day >= ?1 AND type = 'time' GROUP BY key) t " +
        "ON t.key = v.key WHERE v.n >= 3 ORDER BY secs * 1.0 / v.n DESC LIMIT 25"
    ),
    q("SELECT key, SUM(count) AS n FROM daily_counts WHERE day >= ?1 AND type = '404' GROUP BY key ORDER BY n DESC LIMIT 25"),
    q("SELECT day, SUM(count) AS n FROM daily_counts WHERE day >= ?1 AND type = 'view' GROUP BY day ORDER BY day DESC"),
  ]);

  const total = Object.fromEntries(totals.map((r) => [r.type, r.n]));
  const fmtSecs = (s) => (s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`);
  const summary = [
    ["Word views", total.view || 0],
    ["Searches for missing words", total.miss || 0],
    ["Full stories opened", total.story || 0],
    ["Shares", total.share || 0],
    ["404 page hits", total["404"] || 0],
  ];

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Etymology Map stats</title>
<style>
body{font:15px/1.45 system-ui,sans-serif;margin:0 auto;max-width:900px;padding:16px;color:#1d1d1f;background:#fafafa}
h1{font-size:22px}h2{font-size:17px;margin:28px 0 6px}.note{color:#666;margin:0 0 8px;font-size:13px}
table{border-collapse:collapse;width:100%;background:#fff}th,td{text-align:left;padding:5px 8px;border-bottom:1px solid #e5e5e5}
th{font-size:12px;text-transform:uppercase;color:#666}td:last-child,th:last-child{text-align:right}.empty{color:#999;text-align:left!important}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:0 24px}nav a{margin-right:10px}
@media (prefers-color-scheme:dark){body{background:#161618;color:#eee}table{background:#1f1f22}th,td{border-color:#333}.note,th{color:#aaa}}
</style></head><body>
<h1>Etymology Map: last ${days} day${days > 1 ? "s" : ""}</h1>
<nav>${[1, 7, 30, 90, 365].map((d) => `<a href="?key=${encodeURIComponent(key)}&days=${d}">${d}d</a>`).join("")}</nav>
${table("Summary", "Anonymous totals since " + since + " (UTC).", ["Metric", "Total"], summary)}
${table("Most searched missing words", "Candidates for the next batches of words.", ["Search", "Times"], misses.map((r) => [r.key, r.n]))}
<div class="grid">
${table("Most viewed words", "", ["Word", "Views"], views.map((r) => [r.key, r.n]))}
${table("Longest average time", "Words with at least 3 views; visible time only.", ["Word", "Avg time"], times.map((r) => [r.key, fmtSecs(r.secs / r.views)]))}
${table("Full story opened", "", ["Word", "Opens"], stories.map((r) => [r.key, r.n]))}
${table("Shared", "", ["Word", "Shares"], shares.map((r) => [r.key, r.n]))}
${table("404 pages", "Broken or mistyped links people arrived from.", ["Path", "Hits"], notFound.map((r) => [r.key, r.n]))}
${table("Word views per day", "", ["Day", "Views"], daily.map((r) => [r.day, r.n]))}
</div></body></html>`;

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
}

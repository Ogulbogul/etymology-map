# Anonymous usage statistics

How it works:

- `track.js` (loaded on every page) queues a few anonymous events and sends
  them in one small request to `/api/e` when the visitor leaves or switches
  tabs. It sets no cookies, uses no local storage and has no visitor or
  session ID. It does nothing on localhost or when the browser sends a
  Global Privacy Control or Do Not Track signal.
- `functions/api/e.js` (a Cloudflare Pages Function) checks each event and
  adds it to daily totals in a D1 database. Only the day, event type, word,
  count and seconds are stored: no IP address, user agent or identifier.
  Word events must name a word in the collection, and missing-word searches
  must look like a word (letters only, up to four words). Bots are skipped
  and totals older than about 13 months are deleted.
- `functions/api/stats.js` serves a private stats page.

Events: `view` (word shown), `time` (visible seconds on a word), `miss`
(search for a word not in the collection), `story` ("Read the full story"
opened), `share` (Share button), `404` (missing page).

## One-time setup in the Cloudflare dashboard

1. **Create the database.** Storage & Databases → D1 SQL Database → Create.
   Name it `etymology-analytics`.
2. **Create the table.** Open the database → Console, paste the contents of
   `analytics/schema.sql`, and run it.
3. **Bind it to the site.** Workers & Pages → the etymologymap Pages
   project → Settings → Bindings → Add → D1 database. Variable name: `DB`,
   database: `etymology-analytics`. Save it for Production.
4. **Set the stats password.** Same project → Settings → Variables and
   Secrets → Add → type Secret, name `STATS_KEY`, value: a long random
   string only you know.
5. **Redeploy.** Bindings apply to the next deployment, so merge/push to
   `main` (or use Retry deployment on the latest one).

## Viewing the data

Open `https://etymologymap.com/api/stats?key=YOUR_STATS_KEY`. Links at the
top switch between the last 1, 7, 30, 90 and 365 days. Without the right
key the page returns "Not found".

You can also run SQL in the D1 Console, for example:

```sql
SELECT key, SUM(count) AS n FROM daily_counts
WHERE type = 'miss' AND day >= date('now', '-30 days')
GROUP BY key ORDER BY n DESC LIMIT 50;
```

## Cost

Everything fits in Cloudflare's free plan. Only requests to `/api/*` run
the function (static pages don't). Each visit sends about one request and a
few row writes, so the free limits (100,000 function requests and 100,000
D1 row writes per day) cover tens of thousands of visits a day. Past the
free limit, writes simply fail until midnight UTC; nothing is billed.

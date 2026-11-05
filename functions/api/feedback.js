// Feedback from the site's "Feedback" button.
//
//   POST /api/feedback  { m: message (5..1000 chars), c: optional contact email, p: page path, h: honeypot }
//
// The message is stored in D1 (table `feedback`, see analytics/schema.sql) and, when the Pages project
// has the secrets RESEND_API_KEY and FEEDBACK_TO, also emailed through Resend (free tier: 3,000 a month).
// Without those secrets it is stored only, and shows up on the private stats page.
// Nothing about the sender is kept except what they type: no IP address, cookie or ID.

const MAX_MESSAGE = 1000;
const DAILY_CAP = 100; // stored messages per day, a brake against floods
const BOT_RE = /bot|crawl|spider|slurp|preview|headless|lighthouse|monitor/i;
const EMAIL_RE = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[^\s@<>]{2,}$/;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "bad request" }, 400);
  }
  if (!body || typeof body !== "object") return json({ error: "bad request" }, 400);
  // Bots fill the hidden field: say thanks and drop it.
  if (body.h) return json({ ok: true });
  if (BOT_RE.test(request.headers.get("user-agent") || "")) return json({ ok: true });

  const message = String(body.m == null ? "" : body.m).trim().slice(0, MAX_MESSAGE);
  if (message.length < 5) return json({ error: "Please write a little more." }, 400);
  const contact = String(body.c == null ? "" : body.c).trim().slice(0, 200);
  if (contact && !EMAIL_RE.test(contact)) return json({ error: "That email address does not look right." }, 400);
  let page = String(body.p == null ? "" : body.p).slice(0, 120);
  if (!/^\/[A-Za-z0-9\-._~\/]*$/.test(page)) page = "";

  const day = new Date().toISOString().slice(0, 10);
  let stored = false;
  if (env.DB) {
    try {
      const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback WHERE day = ?1").bind(day).first();
      if (n && n.n >= DAILY_CAP) return json({ error: "Lots of feedback today! Please try again tomorrow." }, 429);
      await env.DB.prepare("INSERT INTO feedback (day, page, message, contact) VALUES (?1, ?2, ?3, ?4)")
        .bind(day, page, message, contact)
        .run();
      stored = true;
    } catch (err) {
      // Table missing or database busy: fall through to email.
    }
  }

  let emailed = false;
  if (env.RESEND_API_KEY && env.FEEDBACK_TO) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" },
        body: JSON.stringify({
          from: "Etymology Map <onboarding@resend.dev>",
          to: [env.FEEDBACK_TO],
          reply_to: contact || undefined,
          subject: "Etymology Map feedback" + (page ? " (" + page + ")" : ""),
          text: message + "\n\n---\nPage: " + (page || "unknown") + "\nReply to: " + (contact || "not given"),
        }),
      });
      emailed = res.ok;
    } catch (err) {
      emailed = false;
    }
  }

  if (!stored && !emailed) return json({ error: "Sorry, that did not go through. Please try again later." }, 500);
  return json({ ok: true });
}

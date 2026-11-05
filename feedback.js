// "Feedback" link in the footer: opens a small form that posts to /api/feedback.
const LIMIT = 1000;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function setup() {
  const links = document.querySelector(".footer-links");
  if (!links) return;
  const trigger = el("button", "footer-feedback", "Feedback");
  trigger.type = "button";
  links.appendChild(trigger);

  let overlay = null;
  const close = () => {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    document.removeEventListener("keydown", onKey);
    trigger.focus();
  };
  const onKey = (e) => e.key === "Escape" && close();

  trigger.addEventListener("click", () => {
    if (overlay) return;
    overlay = el("div", "modal-overlay");
    const card = el("div", "modal-card fb-card");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "fb-title");
    const x = el("button", "icon-btn small modal-close", "×");
    x.type = "button";
    x.setAttribute("aria-label", "Close");
    x.addEventListener("click", close);
    const title = el("h2", "modal-title", "Tell us what you think");
    title.id = "fb-title";
    const intro = el("p", "fb-intro", "A word we are missing, a bug, or an idea. Every message gets read!");

    const form = el("form", "fb-form");
    const ta = el("textarea", "fb-text");
    ta.rows = 5;
    ta.maxLength = LIMIT;
    ta.required = true;
    ta.placeholder = "Your message";
    ta.setAttribute("aria-label", "Your message");
    const count = el("span", "fb-count", "0 / " + LIMIT);
    ta.addEventListener("input", () => (count.textContent = ta.value.length + " / " + LIMIT));
    const mail = el("input", "fb-mail");
    mail.type = "email";
    mail.maxLength = 200;
    mail.placeholder = "Your email (optional, for a reply)";
    mail.setAttribute("aria-label", "Your email, optional");
    mail.autocomplete = "email";
    const trap = el("input", "fb-trap");
    trap.type = "text";
    trap.tabIndex = -1;
    trap.autocomplete = "off";
    trap.setAttribute("aria-hidden", "true");
    const status = el("p", "modal-status");
    status.setAttribute("role", "status");
    const actions = el("div", "modal-actions");
    const send = el("button", "btn btn-primary", "Send feedback");
    send.type = "submit";
    const cancel = el("button", "btn btn-outline", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", close);
    actions.append(send, cancel);
    const note = el("p", "fb-note", "We use this only to read and reply to your message.");
    form.append(ta, count, mail, note, trap, actions, status);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (ta.value.trim().length < 5) {
        status.textContent = "Please write a little more.";
        return;
      }
      send.disabled = true;
      status.textContent = "Sending…";
      try {
        const res = await fetch("/api/feedback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ m: ta.value, c: mail.value, p: location.pathname, h: trap.value }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || "Sorry, that did not go through. Please try again later.");
        card.textContent = "";
        const done = el("div", "fb-done");
        done.append(el("h2", "modal-title", "Thank you!"), el("p", "fb-intro", "Your message is on its way to us. We really appreciate it."));
        const ok = el("button", "btn btn-primary", "Close");
        ok.type = "button";
        ok.addEventListener("click", close);
        done.appendChild(ok);
        card.append(x, done);
        ok.focus();
      } catch (err) {
        send.disabled = false;
        status.textContent = err.message || "Sorry, that did not go through. Please try again later.";
      }
    });

    card.append(x, title, intro, form);
    overlay.appendChild(card);
    overlay.addEventListener("mousedown", (e) => e.target === overlay && close());
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey);
    ta.focus();
  });
}

setup();

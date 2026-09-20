// Send the "it got cheaper" emails.
//
// Runs once a day, straight after the scrape, from .github/workflows/scrape.yml.
// It reads the alerts people set on the site, compares each one against the
// catalogue that was just rebuilt, and emails the ones that came true.
//
// Three rules it will not break:
//
//  1. It never fails the workflow. A missing key, an email provider having a
//     bad morning - none of that is allowed to stop fresh prices reaching the
//     site. It says what went wrong and exits 0.
//
//  2. It never sends the same thing twice. A row is only written back after
//     the message is accepted, and what is written is the price that was
//     reported - so the next drop is measured from there, not from the price
//     the product was first watched at.
//
//  3. It never emails about a rise, and never about a drop too small to care
//     about. A dinar off a 900 dinar graphics card is not news.
//
// Nothing secret is in this file. Everything it needs comes from the
// environment, which on GitHub means repository secrets.
//
//   SUPABASE_SERVICE_KEY   service_role key, Supabase -> Settings -> API Keys
//   BREVO_API_KEY          or RESEND_API_KEY - whichever is set
//   ALERT_FROM             the address the mail comes from
//   SITE_URL               where the links point (defaults to the live site)

import fs from 'node:fs/promises';
import path from 'node:path';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nqntsolftwwbgveouptv.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const BREVO_KEY = process.env.BREVO_API_KEY || '';
const RESEND_KEY = process.env.RESEND_API_KEY || '';
const FROM = process.env.ALERT_FROM || 'officialrighunt@gmail.com';
const FROM_NAME = 'RIGHUNT';
const SITE = (process.env.SITE_URL || 'https://righunt.yaseenalqudah3.workers.dev').replace(/\/+$/, '');
const DATA = path.resolve(process.argv[2] || '.', 'data');

/** A drop worth an email: at least one dinar, and at least one percent. */
const WORTH_SAYING = (was, now) => was - now >= 1 && (was - now) / was >= 0.01;

const say = (...a) => console.log('[alerts]', ...a);

/* ---------------------------------------------------------------------------
 * The catalogue that was just built
 * ------------------------------------------------------------------------ */

async function catalogue() {
  const byId = new Map();
  const dir = path.join(DATA, 'sub');
  for (const file of await fs.readdir(dir)) {
    if (!file.endsWith('.json')) continue;
    let parsed;
    try {
      parsed = JSON.parse(await fs.readFile(path.join(dir, file), 'utf8'));
    } catch {
      continue; // one unreadable category must not stop the rest
    }
    for (const p of parsed.products || []) {
      byId.set(p.id, { ...p, sub: parsed.sub || p.sub });
    }
  }
  return byId;
}

/* ---------------------------------------------------------------------------
 * Supabase, with the service key - so this sees every visitor's alerts, which
 * nothing running in a browser ever can.
 * ------------------------------------------------------------------------ */

async function rest(pathAndQuery, { method = 'GET', body, prefer } = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : null),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

/* ---------------------------------------------------------------------------
 * Sending
 *
 * Two providers, because neither is obviously right for everyone: Brevo will
 * send to any address with nothing but a confirmed sender, and Resend is
 * tidier once there is a real domain. Whichever key is present wins.
 * ------------------------------------------------------------------------ */

async function send({ to, subject, html, text }) {
  if (BREVO_KEY) {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: FROM, name: FROM_NAME },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text,
      }),
    });
    if (!r.ok) throw new Error(`brevo ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return;
  }

  if (RESEND_KEY) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `${FROM_NAME} <${FROM}>`, to: [to], subject, html, text }),
    });
    if (!r.ok) throw new Error(`resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return;
  }

  throw new Error('no email provider configured');
}

/* ---------------------------------------------------------------------------
 * The message
 * ------------------------------------------------------------------------ */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n) => (Number(n) % 1 === 0 ? String(Number(n)) : Number(n).toFixed(2));

function message(alert, now, was) {
  const off = Math.round(((was - now.price) / was) * 100);
  const link = `${SITE}/product/${now.sub}/${encodeURIComponent(now.id)}`;
  const stop = `${SITE}/unsubscribe?t=${encodeURIComponent(alert.token)}`;
  const shop = now.storeName || alert.store_name || alert.store || 'the shop';
  const subject = `${money(now.price)} JOD — ${String(alert.title).slice(0, 60)} dropped ${off}%`;

  const text = [
    `${alert.title}`,
    ``,
    `Now ${money(now.price)} JOD at ${shop} — down from ${money(was)} JOD.`,
    now.inStock === false ? `Note: the shop currently lists it as out of stock.` : ``,
    ``,
    `See it: ${link}`,
    ``,
    `You asked RIGHUNT to watch this price. Stop these emails: ${stop}`,
  ].filter(Boolean).join('\n');

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f7f7f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1917">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e0d9;border-radius:6px">
    <tr><td style="padding:22px 22px 8px">
      <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#86837b;font-weight:700">RIGHUNT · Price drop</div>
    </td></tr>
    ${now.image ? `<tr><td style="padding:8px 22px"><img src="${esc(now.image)}" alt="" width="220" style="max-width:100%;height:auto;border-radius:4px;background:#efeeea"></td></tr>` : ''}
    <tr><td style="padding:8px 22px 0">
      <div style="font-size:17px;font-weight:700;line-height:1.35">${esc(alert.title)}</div>
      <div style="margin-top:14px">
        <span style="font-size:28px;font-weight:800">${money(now.price)} JOD</span>
        <span style="font-size:15px;color:#86837b;text-decoration:line-through;margin-left:8px">${money(was)} JOD</span>
        <span style="display:inline-block;margin-left:8px;background:#e6f5ed;color:#0a7a46;font-size:13px;font-weight:700;padding:2px 8px;border-radius:999px">-${off}%</span>
      </div>
      <div style="margin-top:8px;font-size:14px;color:#57554f">at ${esc(shop)}${now.inStock === false ? ' — listed as out of stock right now' : ''}</div>
      <div style="margin:22px 0 6px">
        <a href="${esc(link)}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 22px;border-radius:6px">See it on RIGHUNT</a>
      </div>
    </td></tr>
    <tr><td style="padding:16px 22px 22px;border-top:1px solid #e2e0d9;font-size:12px;color:#86837b;line-height:1.6">
      RIGHUNT does not sell anything and never asks for payment — the button goes to ${esc(shop)}'s own page.
      Prices are as of this morning's check.<br><br>
      You asked us to watch this price. <a href="${esc(stop)}" style="color:#57554f">Stop these emails</a>.
    </td></tr>
  </table></body></html>`;

  return { subject, html, text };
}

/* ---------------------------------------------------------------------------
 * The run
 * ------------------------------------------------------------------------ */

async function main() {
  if (!SERVICE_KEY) return say('no SUPABASE_SERVICE_KEY — nothing sent.');
  if (!BREVO_KEY && !RESEND_KEY) return say('no email provider key — nothing sent.');

  const alerts = await rest('price_alerts?active=eq.true&select=*');
  if (!alerts?.length) return say('nobody is watching a price. Done.');

  const by = await catalogue();
  say(`${alerts.length} alerts, ${by.size} products in the new catalogue.`);

  let sent = 0;
  let failed = 0;
  let gone = 0;

  for (const a of alerts) {
    const now = by.get(a.product_id);
    if (!now || typeof now.price !== 'number') { gone += 1; continue; }

    // What the last email said it cost - or what it cost when they asked, if
    // this is the first one.
    const was = Number(a.last_price ?? a.price_at_signup ?? now.price);
    const target = a.target_price === null ? null : Number(a.target_price);

    const hit = target !== null
      ? now.price <= target
      : WORTH_SAYING(was, now.price);
    if (!hit) continue;

    // A target that was already met when they asked is not news either.
    if (target !== null && !(now.price < was) && a.notify_count > 0) continue;

    try {
      await send({ to: a.email, ...message(a, now, Math.max(was, now.price)) });
      sent += 1;
    } catch (e) {
      failed += 1;
      say(`could not email about ${a.product_id}: ${e.message}`);
      continue; // the row is untouched, so tomorrow tries again
    }

    try {
      await rest(`price_alerts?id=eq.${a.id}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: {
          last_price: now.price,
          notified_at: new Date().toISOString(),
          notify_count: (a.notify_count || 0) + 1,
          // A target price is a question that has now been answered. An
          // any-drop alert is an open-ended one, so it stays on and measures
          // the next drop from here.
          active: target === null,
        },
      });
    } catch (e) {
      say(`emailed about ${a.product_id} but could not record it: ${e.message}`);
    }

    // Gentle on the provider's rate limit, and it costs nothing: this runs
    // once a day with nobody waiting on it.
    await new Promise((r) => setTimeout(r, 250));
  }

  say(`sent ${sent}, failed ${failed}, ${gone} watching something the shops no longer list.`);
}

main().catch((e) => {
  // Deliberately not a failure. Fresh prices matter more than today's emails.
  say(`did not run: ${e.message}`);
});

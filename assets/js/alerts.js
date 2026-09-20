// "Email me when this gets cheaper."
//
// Why email and not a browser notification: a push notification needs a
// service worker, a push server and a signing key pair, and on an iPhone it
// only arrives if the visitor has first added the site to their home screen -
// so for most of the people using this site it would silently never fire.
// Email reaches everyone, survives a cleared browser, and the prices are
// already re-read once a day, which is exactly when there is something to say.
//
// The row is written from here; the message is sent by scripts/price-alerts.mjs
// during the daily refresh. Nothing on this site sends mail from the browser.

import { el, toast } from './util.js';
import { db } from './supabase.js';

const WATCHING = 'righunt.alerts.v1';   // product ids, so the button knows its state
const ADDRESS = 'righunt.email';        // typed once, offered back every time after

const readJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const write = (key, value) => {
  try { localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); } catch { /* private mode */ }
};

const watching = () => readJson(WATCHING, []);
export const isWatched = (id) => watching().includes(id);

const remember = (id) => write(WATCHING, [id, ...watching().filter((x) => x !== id)].slice(0, 200));
const forget = (id) => write(WATCHING, watching().filter((x) => x !== id));

const BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8.5a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5Z"/><path d="M13.7 19a2 2 0 0 1-3.4 0"/></svg>';

/* ---------------------------------------------------------------------------
 * The button
 * ------------------------------------------------------------------------ */

/**
 * The control shown on a product page. It carries its own state: once an
 * alert exists, pressing it again cancels it, which is the behaviour of every
 * other "notify me" control people have used.
 */
export function priceAlertButton(product) {
  const btn = el('button', { class: 'btn btn-lg alert-btn', type: 'button' });

  const paint = () => {
    const on = isWatched(product.id);
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.replaceChildren(
      el('span', { class: 'alert-ico', html: BELL }),
      on ? 'Watching the price' : 'Notify me when the price drops',
    );
  };

  btn.addEventListener('click', async () => {
    if (isWatched(product.id)) {
      forget(product.id);
      paint();
      toast('Price alert turned off');
      try {
        await db(`price_alerts?product_id=eq.${encodeURIComponent(product.id)}`, { method: 'DELETE' });
      } catch { /* the button is already right; the next visit reconciles */ }
      return;
    }
    openAlertDialog(product, paint);
  });

  paint();
  return btn;
}

/* ---------------------------------------------------------------------------
 * The dialog
 *
 * A native <dialog>, which brings the backdrop, the focus trap and Escape
 * with it - a hand-rolled overlay gets all three wrong on a phone. It is
 * centred on a laptop and a tablet, and slides up from the bottom edge on a
 * phone, where the thumb is.
 * ------------------------------------------------------------------------ */

function openAlertDialog(product, done) {
  const price = Number(product.price) || 0;

  const email = el('input', {
    type: 'email', name: 'email', required: true, inputmode: 'email',
    autocomplete: 'email', placeholder: 'you@example.com', id: 'alert-email',
    value: localStorage.getItem(ADDRESS) || '',
  });

  const target = el('input', {
    type: 'number', name: 'target', min: '1', step: '1', inputmode: 'numeric',
    id: 'alert-target', placeholder: price ? String(Math.floor(price * 0.9)) : '',
  });

  const err = el('p', { class: 'alert-err', hidden: true, role: 'alert' });
  const send = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Notify me');

  const form = el('form', { class: 'alert-form', method: 'dialog' },
    el('div', { class: 'alert-head' },
      el('h2', {}, 'Notify me when the price drops'),
      el('p', {}, product.title),
    ),

    el('label', { for: 'alert-email' }, 'Your email'),
    email,

    el('label', { for: 'alert-target' }, 'Only tell me if it falls below ', el('small', {}, '(optional)')),
    el('div', { class: 'alert-target' }, target, el('span', {}, 'JOD')),
    el('p', { class: 'alert-note' },
      price
        ? `It costs ${price} JOD today. Leave the box empty and you will hear about any drop at all.`
        : 'Leave the box empty and you will hear about any drop at all.'),

    err,

    el('div', { class: 'alert-actions' },
      el('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel'),
      send,
    ),

    el('p', { class: 'alert-fine' },
      'One email, about this product only. Every message has a one-click link '
      + 'that stops it. Your address is never shown to anyone or passed on.'),
  );

  const dlg = el('dialog', { class: 'alert-dialog' }, form);
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  // Tapping the backdrop is how a sheet is dismissed on a phone.
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const address = email.value.trim();
    if (!email.checkValidity() || !address) {
      err.textContent = 'That does not look like an email address.';
      err.hidden = false;
      email.focus();
      return;
    }

    const want = target.value ? Number(target.value) : null;
    if (want !== null && (!Number.isFinite(want) || want <= 0)) {
      err.textContent = 'Give a price in whole dinars, or leave it empty.';
      err.hidden = false;
      return;
    }

    err.hidden = true;
    send.disabled = true;
    send.textContent = 'Setting it up…';

    try {
      await db('price_alerts?on_conflict=user_id,product_id', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: [{
          product_id: product.id,
          sub: product.sub ?? null,
          title: product.title,
          image: product.image ?? null,
          url: product.url ?? null,
          store: product.store ?? String(product.id || '').split('-')[0],
          store_name: product.storeName ?? null,
          email: address,
          price_at_signup: price || null,
          last_price: price || null,
          target_price: want,
          active: true,
        }],
      });
    } catch {
      err.textContent = 'Could not set that up just now. Check your connection and try again.';
      err.hidden = false;
      send.disabled = false;
      send.textContent = 'Notify me';
      return;
    }

    write(ADDRESS, address);
    remember(product.id);
    done?.();
    dlg.close();
    toast(want ? `We will email you if it falls below ${want} JOD` : 'We will email you when it gets cheaper');
  });

  dlg.showModal();
  // Skip straight past a remembered address to the thing still to decide.
  (email.value ? target : email).focus();
}

/* ---------------------------------------------------------------------------
 * Unsubscribing
 *
 * Reached only from the link in an email, in a browser that may never have
 * opened the site.
 * ------------------------------------------------------------------------ */

export async function unsubscribe(token) {
  const box = el('div', { class: 'empty' });
  const say = (h, p) => box.replaceChildren(el('h2', {}, h), el('p', {}, p));

  say('Stopping that alert…', 'One moment.');

  if (!token) {
    say('Nothing to stop', 'That link is missing the part that says which alert it is.');
    return box;
  }

  try {
    const gone = await db('rpc/stop_alert', { method: 'POST', body: { t: token } });
    if (gone === false) {
      say('Already stopped',
        'That alert is no longer active, so there is nothing left to turn off. '
        + 'You will not hear from us about it again.');
    } else {
      say('Stopped',
        'That price alert is off and the email address attached to it has been '
        + 'deleted. You will not get another message about this product.');
    }
  } catch {
    say('Could not reach the server',
      'The alert is still on. Open this link again in a minute and it will go through.');
  }
  return box;
}

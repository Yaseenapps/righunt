import { el, money, plural, labelise, specValue, similarity, imageOrPlaceholder, toast, compareKey, href, clip } from '../util.js';
import * as data from '../data.js';
import * as store from '../state.js';
import { crumbs, emptyState, storeOf, section, rail, isBackInStock } from '../components.js';

export async function product(subId, productId) {
  const p = await data.product(subId, productId);
  if (!p) {
    return emptyState('Product not found',
      'This listing may have been removed by the store since our last update.',
      { href: href('home'), text: 'Back home' });
  }

  const realSub = p.sub || subId;
  const { subs } = await data.meta();
  const info = subs.get(realSub) || { name: 'Products', cat: '', catName: '' };
  const s = storeOf(p.store);
  const det = await data.detail(realSub, p.id);
  const hist = (await data.history())[p.id] || null;
  const images = det?.images?.length ? det.images : (p.image ? [p.image] : []);

  store.markViewed({ ...p, sub: realSub });

  /* ---------- gallery ---------- */
  const mainImg = el('div', { class: 'gallery-main' }, imageOrPlaceholder(images[0], p.title));
  const gallery = el('div', { class: 'gallery' }, mainImg);

  if (images.length > 1) {
    const thumbs = el('div', { class: 'thumbs' });
    images.slice(0, 8).forEach((src, i) => {
      const b = el('button', {
        type: 'button', 'aria-current': i === 0 ? 'true' : 'false', 'aria-label': `Image ${i + 1}`,
        onclick: () => {
          mainImg.replaceChildren(imageOrPlaceholder(src, p.title));
          [...thumbs.children].forEach((c, j) => c.setAttribute('aria-current', String(i === j)));
        },
      }, imageOrPlaceholder(src, ''));
      thumbs.append(b);
    });
    gallery.append(thumbs);
  }

  /* ---------- buy panel ---------- */
  const buy = el('div', {},
    p.brand ? el('div', { class: 'pdp-brand' }, p.brand) : null,
    el('h1', { class: 'pdp-title' }, p.title),

    el('div', { class: 'price-box' },
      el('div', { class: 'price-now' }, money(p.price), ' ', el('small', {}, 'JOD')),
      p.was ? el('span', { class: 'price-old' }, `${money(p.was)} JOD`) : null,
      p.off > 0 ? el('span', { class: 'price-off' }, `Save ${p.off}%`) : null,
    ),

    priceHistoryNote(hist),

    el('div', { class: `stock ${p.inStock ? 'in' : 'out'}` },
      el('i', {}),
      p.inStock ? 'In stock at this store' : 'Out of stock at this store'),

    // Worth saying plainly: this one was gone and is not any more.
    p.inStock && isBackInStock(p.id)
      ? el('p', { class: 'back-note' }, 'This sold out and has come back — stock like this can go again quickly.')
      : null,

    el('div', { class: 'seller' },
      el('div', { class: 'sq', style: `background:${s.color}` }, initials(s.name)),
      el('div', { class: 'who' },
        el('b', {}, p.social ? (p.social.seller ? `@${p.social.seller}` : s.name) : s.name),
        el('span', {}, p.social
          ? `Private seller on ${p.social.platform === 'facebook' ? 'Facebook' : 'Instagram'} — agree the details in the post`
          : 'Sold and shipped by the store, not by us'),
      ),
    ),

    el('div', { class: 'buy-row' },
      el('a', {
        class: 'btn btn-primary btn-lg', href: p.url, target: '_blank', rel: 'noopener noreferrer',
      }, p.social
        ? `View post on ${p.social.platform === 'facebook' ? 'Facebook' : 'Instagram'}`
        : `Buy at ${s.name}`,
        el('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' })),
      saveToggle({ ...p, sub: realSub }),
    ),

    optionBlock(p),
    specTable(p),
  );

  // The external-link arrow needs real path data.
  const arrow = buy.querySelector('.btn-primary svg');
  if (arrow) arrow.innerHTML = '<path d="M7 17 17 7M9 7h8v8"/>';

  /* ---------- description ---------- */
  const blocks = [];
  if (det?.description?.trim()) {
    const body = el('div', { class: 'desc' }, det.description.trim(), el('div', { class: 'desc-fade' }));
    const more = el('button', {
      class: 'btn', type: 'button', style: 'margin-top:12px',
      onclick: () => {
        const open = body.classList.toggle('open');
        body.querySelector('.desc-fade')?.style.setProperty('display', open ? 'none' : 'block');
        more.textContent = open ? 'Show less' : 'Read full description';
      },
    }, 'Read full description');

    blocks.push(el('section', { class: 'panel' },
      el('h2', {}, `Description from ${s.name}`),
      body,
      det.description.length > 700 ? more : null,
    ));
  }

  /* ---------- price comparison ---------- */
  const { same, similar, exactMatch } = await findComparisons(p, realSub);

  if (same.length) {
    const cheapest = Math.min(p.price, ...same.map((r) => r.price));
    const saving = p.price - cheapest;
    blocks.push(el('section', { class: 'panel' },
      el('h2', {}, `Same product at ${plural(same.length, 'other store')}`),
      saving > 0
        ? el('p', { class: 'note note-win', style: 'margin:0 0 10px' },
            `Cheaper elsewhere — you could save ${money(saving)} JOD.`)
        : el('p', { class: 'note', style: 'margin:0 0 10px' },
            'This is the cheapest listing we found for it.'),
      ...[{ ...p, sub: realSub, self: true }, ...same]
        .sort((a, b) => a.price - b.price)
        .map((r) => compareRow(r, cheapest)),
      el('p', { class: 'note' }, 'Matched on brand and model number. Check the exact variant before buying.'),
    ));
  }

  if (similar.length) {
    blocks.push(el('section', { class: 'panel' },
      el('h2', {}, `Compare with similar ${info.name.toLowerCase()}`),
      el('p', { class: 'note', style: 'margin:0 0 10px' },
        exactMatch ? comparisonBasis(realSub, p.specs)
          : 'Same category and a similar price, so these are the realistic alternatives.'),
      ...[{ ...p, sub: realSub, self: true }, ...similar]
        .sort((a, b) => a.price - b.price)
        .map((r) => compareRow(r, Math.min(p.price, ...similar.map((x) => x.price)))),
    ));
  }

  /* ---------- more from the same category ---------- */
  const siblings = (await data.sub(realSub))
    .filter((x) => x.id !== p.id && x.inStock && x.image)
    .sort((a, b) => Math.abs(a.price - p.price) - Math.abs(b.price - p.price))
    .slice(0, 18)
    .map((x) => ({ ...x, sub: realSub }));

  return el('div', {},
    crumbs([
      { text: 'Home', href: href('home') },
      info.catName ? { text: info.catName, href: href(`category/${info.cat}`) } : null,
      { text: info.name, href: href(`products/${realSub}`) },
      { text: clip(p.title, 42) },
    ].filter(Boolean)),

    el('div', { class: 'pdp' }, gallery, buy),
    ...blocks,
    siblings.length ? section('Similar prices in this category', null, rail(siblings)) : null,
  );
}

/**
 * What we have seen this cost before. Deliberately silent until there are at
 * least a couple of readings - an empty chart says nothing useful.
 */
function priceHistoryNote(h) {
  if (!h || (h.n || 0) < 2) return null;

  const bits = [];
  if (h.prev !== undefined && h.last < h.prev) {
    const off = Math.round(((h.prev - h.last) / h.prev) * 100);
    bits.push(el('span', { class: 'ph-drop' }, `Dropped ${off}% from ${money(h.prev)} JOD`));
  } else if (h.prev !== undefined && h.last > h.prev) {
    bits.push(el('span', { class: 'ph-rise' }, `Up from ${money(h.prev)} JOD`));
  }
  if (h.min < h.last) {
    bits.push(el('span', {}, `Lowest we've seen: ${money(h.min)} JOD`));
  } else if (h.max > h.min) {
    bits.push(el('span', { class: 'ph-drop' }, 'This is the lowest we have seen it'));
  }
  if (!bits.length) return null;

  return el('div', { class: 'price-history' }, bits);
}

function saveToggle(p) {
  const label = () => (store.isSaved(p.id) ? 'Saved' : 'Save');
  const btn = el('button', { class: 'btn btn-lg', type: 'button' }, label());
  btn.addEventListener('click', () => {
    const now = store.toggleSave(p);
    btn.textContent = label();
    toast(now ? 'Saved — kept in this browser' : 'Removed from saved');
  });
  return btn;
}

function optionBlock(p) {
  if (!p.options?.length) return null;
  return el('div', {}, p.options.map((o) =>
    el('div', { class: 'opt-group' },
      el('h3', {}, `${o.name} available at this store`),
      el('div', { class: 'opt-vals' }, o.values.map((v) => el('span', { class: 'opt-val' }, v))),
      el('p', { class: 'opt-note' }, `Pick your ${o.name.toLowerCase()} on the store's page — the price shown here is the lowest option.`),
    )));
}

function specTable(p) {
  const rows = Object.entries(p.specs || {}).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!rows.length) return null;
  return el('section', { class: 'panel' },
    el('h2', {}, 'Specifications'),
    el('table', { class: 'specs' },
      el('tbody', {}, rows.map(([k, v]) =>
        el('tr', {}, el('th', {}, labelise(k)), el('td', {}, specValue(k, v)))))),
    el('p', { class: 'note' },
      'Read from the store\'s own product title and description.'),
  );
}

function compareRow(r, cheapest) {
  const s = storeOf(r.store);
  return el('a', {
    class: 'compare-row',
    href: r.self ? 'javascript:void 0' : href(`product/${r.sub}/${r.id}`),
    style: r.self ? 'pointer-events:none' : '',
  },
    imageOrPlaceholder(r.image, ''),
    el('div', { class: 'c-t' },
      r.self ? el('b', {}, 'This listing') : r.title.slice(0, 70),
      el('small', {}, s.name, r.inStock === false ? ' · out of stock' : ''),
    ),
    el('div', { style: 'text-align:end' },
      el('div', { class: 'c-p' }, `${money(r.price)} JOD`),
      r.price === cheapest ? el('span', { class: 'cheapest' }, 'Cheapest') : null,
    ),
  );
}

function comparisonBasis(sub, specs) {
  const key = compareKey(sub, specs);
  return key
    ? `Same category and the same key spec (${key}), so the prices mean something.`
    : 'Same category and a similar price range.';
}

/** Model numbers like "5070", "GV-N5060WF2OC-8GD", "A520M". */
function modelTokens(title) {
  return new Set(
    (title.toLowerCase().match(/\b[a-z]{0,4}\d{3,}[a-z0-9-]*\b/g) || [])
      .filter((t) => t.length >= 3),
  );
}

/**
 * Two passes over the same category only:
 *  - `same`    other shops selling what looks like this exact product
 *  - `similar` other products worth weighing it against
 */
async function findComparisons(p, subId) {
  const all = (await data.sub(subId)).filter((x) => x.id !== p.id);
  const myModels = modelTokens(p.title);
  const myKey = compareKey(subId, p.specs);

  const same = all
    .filter((x) => x.store !== p.store)
    // An RTX 5060 and an RTX 5060 Ti share the token "5060" but are not the
    // same card, so when both sides name a chipset it has to match exactly.
    .filter((x) => {
      const theirs = compareKey(subId, x.specs);
      return !myKey || !theirs || theirs === myKey;
    })
    .map((x) => {
      const shared = [...modelTokens(x.title)].filter((t) => myModels.has(t)).length;
      const sameBrand = p.brand && x.brand && p.brand.toLowerCase() === x.brand.toLowerCase();
      const text = similarity(p.title, x.title);
      return { ...x, sub: subId, shared, sameBrand, text };
    })
    // A shared model number is the strong signal; a same-brand listing with a
    // very similar name is the fallback.
    .filter((x) => (x.shared >= 1 && (x.sameBrand || x.text >= 0.45)) || x.text >= 0.7)
    .sort((a, b) => b.shared - a.shared || a.price - b.price)
    .slice(0, 6);

  const taken = new Set(same.map((x) => x.id));
  const pool = all.filter((x) => !taken.has(x.id) && x.inStock && x.image);
  const near = (x) => x.price >= p.price * 0.6 && x.price <= p.price * 1.6;

  // Prefer products sharing the same key spec. If nothing does - a one-off
  // chipset, say - fall back to the same category at a similar price, so
  // there is always something meaningful to weigh this against.
  const byKey = myKey ? pool.filter((x) => compareKey(subId, x.specs) === myKey) : [];
  const similar = (byKey.length ? byKey : pool.filter(near))
    .map((x) => ({ ...x, sub: subId }))
    .sort((a, b) => Math.abs(a.price - p.price) - Math.abs(b.price - p.price))
    .slice(0, 6)
    .sort((a, b) => a.price - b.price);

  return { same, similar, exactMatch: byKey.length > 0 };
}

const initials = (name) => name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

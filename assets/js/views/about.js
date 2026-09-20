// About, and the things a visitor is entitled to know.
//
// Plain text, deliberately. This page exists to be read and to be accurate,
// not to sell anything - so it says who runs the site, where the prices come
// from, how buying works, and what is kept about you. Anything it
// claims has to stay true as the site changes; a promise here that the code
// stops keeping is worse than no page at all.

import { el, href } from '../util.js';
import * as data from '../data.js';
import { crumbs } from '../components.js';

const EMAIL = 'officialrighunt@gmail.com';

export async function about() {
  let shops = [];
  let count = null;
  try {
    const { idx } = await data.meta();
    shops = idx.stores.map((s) => s.name);
    count = idx.inStock;
  } catch { /* the page still reads fine without the numbers */ }

  return el('div', { class: 'prose' },
    crumbs([{ text: 'Home', href: href('home') }, { text: 'About' }]),

    el('h1', {}, 'About RIGHUNT'),

    el('p', { class: 'lead' },
      'RIGHUNT compares what PC parts and gaming gear actually cost across '
      + 'shops in Jordan, so you can see the same product at several stores '
      + 'side by side instead of opening nine tabs.'),

    el('h2', {}, 'Who runs it'),
    el('p', {},
      'RIGHUNT is run from Jordan by Yaseen Alqudah. It is not a company, and '
      + 'it is not owned by or affiliated with any of the shops listed. ',
      'Reach me at ', el('a', { href: `mailto:${EMAIL}` }, EMAIL), '.'),

    el('h2', {}, 'Where the prices come from'),
    el('p', {},
      'A program reads each shop’s own public website and records what it '
      + 'lists: the product, the price, the photo and whether it is in stock. '
      + 'Nothing is invented and nothing is AI-generated. If a price is here, '
      + 'a Jordanian shop published it.'),
    el('p', {},
      'It runs ', el('b', {}, 'once every 24 hours'), '. The exact time of the last '
      + 'update is shown at the top of every page. Between updates a shop can '
      + 'change a price or sell out, so the price you see is the price at the '
      + 'last check — not a live quote.'),
    shops.length
      ? el('p', {}, 'Currently reading: ', el('b', {}, shops.join(', ')), '.')
      : null,

    el('h2', {}, 'Buying something'),
    el('p', {},
      el('b', {}, 'RIGHUNT does not sell anything.'),
      ' When you find what you want, “Check at” takes you to that shop’s own '
      + 'page, and you buy it there, on their terms, with their delivery and '
      + 'their warranty. RIGHUNT never takes payment and never asks for card or '
      + 'bank details. Anyone asking you for those in our name is not us.'),
    el('p', {},
      'Tap the heart on anything to add it to your wishlist. It stays for you, and '
      + 'the wishlist tells you when something gets cheaper or comes back in stock. '
      + 'On a product page you can also ask to be emailed the moment its price '
      + 'falls — the prices are re-read every morning, and if yours has dropped '
      + 'the message goes out then.'),

    el('h2', {}, 'What is kept about you'),
    el('p', {},
      'No sign-up and no password. Your browser is given an anonymous id the '
      + 'first time you visit, which is what lets your saved products still be '
      + 'there when you come back. There is no name attached to it.'),
    el('p', {}, 'What is stored:'),
    el('ul', {},
      el('li', {}, 'the products in your wishlist, and what they cost when you added them'),
      el('li', {}, 'if you ask to be told when a price drops: your email address, '
        + 'attached to that one product. It is used to send that one message and '
        + 'nothing else — no newsletter, no offers — and every email has a link '
        + 'that deletes it in one click.'),
    ),
    el('p', {}, 'What is never stored: your name, address, card numbers, bank '
      + 'details or passwords. There is no place in the system to put them.'),
    el('p', {},
      'None of it is sold or passed to anyone. Ask at ',
      el('a', { href: `mailto:${EMAIL}` }, EMAIL),
      ' and everything held about you is deleted.'),

    el('h2', {}, 'What it costs'),
    el('p', {},
      'Nothing. The site is free to use, and the price you see is the shop’s '
      + 'own listed price.'),

    el('h2', {}, 'Things worth knowing'),
    el('ul', {},
      el('li', {}, 'Prices and stock are as of the last update, not live. Confirm on the shop’s own page before buying anything expensive.'),
      el('li', {}, 'Where a shop offers colour or size options, the price shown is the cheapest one.'),
      el('li', {}, 'Products are sorted into categories automatically from the shop’s own wording. It is good, not perfect, and the occasional oddity lands in the wrong place.'),
      el('li', {}, '"Same product elsewhere" is matched on brand and model number. Check the exact variant before comparing.'),
      el('li', {}, 'Shop names and logos belong to those shops. They are used to say who is selling what.'),
    ),

    el('h2', {}, 'Something wrong?'),
    el('p', {},
      'A wrong price, a product in the wrong place, a shop that should be here '
      + 'or should not be — tell me and it gets fixed: ',
      el('a', { href: `mailto:${EMAIL}` }, EMAIL), '.'),
    el('p', {},
      'If you are a shop listed here and want your products removed, email the '
      + 'same address and they will be taken down.'),

    count
      ? el('p', { class: 'about-foot' },
          `${count.toLocaleString()} products in stock at the last update.`)
      : null,
  );
}

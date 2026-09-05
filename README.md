# RIGHUNT — PC & Gaming Prices in Jordan

A free, no-login price comparison site for **gaming and PC hardware sold in
Jordan**. Every product is real and comes from a Jordanian retailer's own
website — nothing here is invented or AI-generated.

The site is plain HTML/CSS/JS with no build step. A Node script reads the shops
and writes static JSON into `data/`, which the page loads.

---

## Quick start

```bash
npm install
npm run scrape
npm run dev
```

Then open <http://localhost:5173>.

> `npm run dev` is required: browsers refuse to `fetch()` local JSON when you
> open `index.html` straight off the disk.

Refresh a single shop while leaving the others untouched:

```bash
node scraper/build.js --store igeek
```

Prefix any command with `SCRAPE_CACHE=1` to reuse previously downloaded pages —
fast and offline, useful while tuning categorisation. Delete `.cache/` to force
fresh downloads.

Rebuild the derived files (categories, filters, search index, home rows) from
products already on disk, without touching the network:

```bash
node scraper/build.js --rebuild
```

---

## Shops compared

| Shop | Site | How it is read |
|---|---|---|
| iGeek Megastore | igeekjo.com | Shopify public JSON |
| GameOn JO | gameonjo.com | Shopify public JSON |
| Compu Me | compume.jo | Shopify public JSON |
| PC Circle | pccircle.com | WooCommerce Store API |
| White Angel | whiteangeljo.com | WooCommerce Store API |
| Compu Jordan | compujordan.com | OpenCart catalogue pages |
| Oriental Store | os-jo.com | OpenCart catalogue pages |
| Number One Store | numberonestore.net | OpenCart catalogue pages |
| Midas Computer Center | mcc-jo.com | FleetCart category JSON |
| Instagram & Facebook | — | curated by hand — see below |
| City Center Computers | citycenter.jo | **off** — see below |

Adding a shop is one entry in `scraper/stores.js`. If it runs Shopify,
WooCommerce, OpenCart or FleetCart, an existing adapter already handles it.

Each site's `robots.txt` is checked first, requests are spaced about a second
apart per host, and the client identifies itself.

**City Center Computers** answers with `HTTP 403` — the shop is deliberately
refusing automated access, and that is not worked around. It is switched off in
`scraper/stores.js`. The adapter still works: if the block is lifted, or you
arrange access with the shop, set `enabled: true` and it reappears.

### Instagram and Facebook sellers

Neither platform can be read automatically. Both answer a plain request with a
login wall containing **zero posts, zero captions and zero post links**, and the
old public JSON endpoint returns 400. Getting past that means supplying
credentials or defeating bot protection — against Meta's terms, certain to fail
from GitHub's runners, and a real risk to a published site. So it is not done.

Instead, `scraper/social-listings.json` holds listings you add by hand: product,
price, photo and the link to the post. They flow through the same pipeline as
every shop, so they get categories, specs, filters, search and comparison — and
their Buy button reads **"View post on Instagram"** and opens that exact post in
a new tab. The file ships empty, and any entry missing a valid post link, price
or title is rejected at build time, so nothing invented can reach the site.

---

## Gaming only

The shops we read also sell printers, routers, ink, office laptops and kettles.
None of that is published. `HIDDEN_SUBS` in `scraper/lib/taxonomy.js` lists the
categories that are classified (so the junk has somewhere to go) but never
shipped. Roughly 40% of everything read is dropped this way.

To publish one of them anyway — say external storage — remove it from
`HIDDEN_SUBS` and give it a home in `CATEGORIES`.

---

## How it works

```
scraper/
  stores.js            which shops to read, and with which adapter
  build.js             runs everything, writes data/, prints a report
  adapters/
    shopify.js         /products.json + /collections.json
    woocommerce.js     /wp-json/wc/store/v1/products
    opencart.js        sitemap -> category pages -> product cards
    midas.js           FleetCart /category/<slug>?page=N JSON
  lib/
    taxonomy.js        category tree, classification rules, spec extraction
    normalize.js       raw rows -> one canonical product shape
    http.js            polite fetch: robots.txt, rate limit, retry, disk cache
    text.js            HTML stripping, price parsing, slugs

data/                  generated - do not hand-edit
  index.json           categories, shops, counts, per-category filter options
  sub/<category>.json  the products in one category
  detail/<category>.json  descriptions and extra images, loaded on demand
  search.json          compact index for the search box
  home.json            the rows on the front page
  deals.json           every current discount
  status.json          per-shop success/failure from the last run

assets/js/             the site: hash router, nav bars, views, filters, saving
```

### Working out what a product actually is

Shops file products inconsistently and titles are noisy, so `taxonomy.js`
decides from several signals, in order of trust:

1. an exact `product_type` from the shop — a shop calling something a "PC" wins,
   provided the title also names a whole machine;
2. ordered regex rules over the title;
3. the shop's own category path **and its URL slug** — a product living at
   `/product/asus-g815lm-gaming-laptop/` is a laptop whatever its title says.

Then `sanitize()` argues with the result:

- an accessory is never the thing it is an accessory for — "ARGB light strip for
  motherboard" is lighting, "gaming laptop cooling pad" is a cooling pad;
- leads and docks named after the peripheral they plug into are not that
  peripheral — "XLR Microphone Extension Cable" and "Charging Dock for PS4
  Controllers" are hidden. A bare "cable" is deliberately not a trigger, so
  "Keyboard K100 — 1.5m cable length" survives;
- a title naming **both** a processor and a graphics card is a whole machine, not
  either part;
- a laptop model family ("Zenbook … Core Ultra 7 Processor") is a laptop;
- a price floor per category: a 4 JOD "graphics card" is not a graphics card.
  Floors live in `PRICE_FLOOR` in `normalize.js`. This is blunt, and a genuinely
  cheap clearance part could be hidden by it — raise or remove a floor if you
  would rather have the odd stray listing than lose those.

### Filters

`build.js` precomputes, per category, which filters make sense and which values
actually exist — RAM gets DDR generation, capacity, speed and stick count; power
supplies get wattage, 80-PLUS rating and modularity; monitors get size, refresh
rate, resolution and panel. No filter is ever shown with nothing behind it.

Specs are read from the shop's own title and description. The title wins, since
descriptions often list every model in a range. Anything unstated is left blank
rather than guessed.

Counts next to each option are computed in one pass per filter, not one pass per
option — that is what keeps a 1,200-product category responsive while typing.

### The build assistant

The floating **Assistant** answers from `data/builder.json` — nothing but
in-stock rows from the catalogue. It is a rules engine (`assets/js/lib/builder.js`),
not a language model, and that is the point: it can only return products that
exist at the price shown, so it cannot invent a part, a price or a shop.

- *"Build me a gaming PC for 2000 JD"* → a complete parts list, a total, and
  **Agree — save all parts**, which puts every part in Saved.
- *"Best 32GB DDR5 under 120 JD"* → three ranked options, each savable.
- Processor and motherboard are chosen **as a pair** so their sockets match;
  memory must match the board's generation; the power supply is sized for the
  card actually chosen. `checkCompatibility()` states any problem it cannot fix.
- If a budget genuinely will not stretch, it says so and quotes the real floor
  price rather than assembling a fantasy build. `scripts/test-builder.mjs`
  asserts all of this against the live catalogue — run it after any change.

### Comparing prices

Every product page compares within its own category only — a laptop is never
weighed against a monitor. Two panels:

- **Same product at other stores.** Matched on shared model numbers plus brand
  or a close title. Where both listings name a chipset, wattage or capacity,
  those must agree — which is what stops an RTX 5060 being matched with a
  5060 Ti just because both titles contain "5060". Shows what you'd save.
- **Compare with similar …** Products sharing the same key spec (`compareKey`
  in `assets/js/util.js` defines it per category); if nothing does, the same
  category at a similar price, so there is always something to weigh against.

### Sorting

The default is **Best overall** — best *value*, not best specs and not cheapest.
A listing scores well when it undercuts the going rate for the very same thing
(the median price of every other RTX 5070, every other 750W supply), when
several shops stock it, and when it is a complete listing worth clicking. The
comparison only counts when at least three shops sell the same spec, so a
one-off item cannot win by default.

Cheapest-first is deliberately **not** the default: in most categories the
cheapest item is the weakest thing in it, and browsing Graphics Cards should
not open on a GT 610.

But the moment you filter to a specific model — `?chipset=RTX 5070`, a memory
capacity, a wattage — the default flips to **price ascending**, because now you
have said what you want and the only question left is who sells it for least.
`isSpecificChoice()` in `assets/js/util.js` decides this per category. Choosing
a sort yourself always wins and is remembered.

### What the visitor's browser remembers

No account, no server storage. `localStorage` keeps saved products, recently
viewed items, the last filters used in each category, the in-stock preference
and the theme. Everything writes immediately — nothing to submit or confirm.

---

## Publishing it (free, refreshes itself)

Order matters: the two repository settings in steps 5 and 6 have to be in place
before a workflow run can finish. The run that fires automatically on your first
push will fail before them — that is expected, and harmless.

**1. Tell git who you are.** Once per machine. Without this the first commit
fails with *"Please tell me who you are"*.

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

**2. Make the repository.** The `-b main` matters — the workflow only triggers
on `main`, and plain `git init` still creates `master`.

```bash
git init -b main
git add -A
git commit -m "RigHunt: Jordan PC and gaming price comparison"
```

**3. Create an empty repo on github.com.** New → repository name (e.g.
`righunt`) → Public → **do not** add a README, .gitignore or licence. An empty
repo keeps the first push clean.

**4. Push.** Use the URL GitHub shows you.

```bash
git remote add origin https://github.com/<username>/<repo>.git
git push -u origin main
```

A browser window opens to sign in to GitHub — that is Git Credential Manager,
not an error. GitHub does not accept account passwords on the command line.

**5. Settings → Actions → General → Workflow permissions → "Read and write
permissions"** → Save. The refresh job pushes updated prices back to the repo;
without this the push fails, the job stops, and nothing deploys.

**6. Settings → Pages → Source: "GitHub Actions"**. Pages has to be enabled
before `configure-pages` will run.

**7. Actions tab → "Refresh prices and deploy" → Run workflow.**

**8. Wait ~20–25 minutes** — the first run reads all six shops. Your site is
then at `https://<username>.github.io/<repo>/`, also shown under Settings →
Pages. After this it refreshes and redeploys itself every 6 hours.

The site is served from a project subpath (`/<repo>/`) and every path in the
project is relative, so it works there with no configuration.

If a shop is down or changes its markup, it keeps its previous data, the rest of
the site still updates, and the failure is recorded in `data/status.json`.

---

## Known limits

- Prices, stock and offers are as of the last refresh (shown in the header), not
  live at the instant you look.
- Out-of-stock items are hidden by default; the toolbar has a switch for them.
- Where a shop offers colour or size choices, the price shown is the cheapest
  option — pick the exact one on the shop's page.
- "Looks like the same product elsewhere" matches on the product name, so
  confirm the exact model before buying.
- Classification is rules-based over messy retailer text. It is good, not
  perfect; the occasional oddity will still slip into a category.
- No payments and no checkout ever happen here. Every Buy button opens the
  shop's own product page.

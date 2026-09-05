// The assistant's brain.
//
// This is a rules engine, not a language model, and that is deliberate: it can
// only ever return rows that exist in the catalogue at the price shown, so it
// cannot invent a product, a price or a shop. Where it cannot do what was
// asked - a budget that genuinely will not stretch - it says so and shows the
// nearest real option rather than assembling something imaginary.

/* ---------------------------------------------------------------- parsing */

const NUM_AR = { '٠': 0, '١': 1, '٢': 2, '٣': 3, '٤': 4, '٥': 5, '٦': 6, '٧': 7, '٨': 8, '٩': 9 };
const westernise = (s) => s.replace(/[٠-٩]/g, (d) => NUM_AR[d]);

/** Budget in JOD, from "2000 jd", "under 500", "بـ 300", "~1500". */
export function parseBudget(text) {
  const t = westernise(text.toLowerCase());
  const m = t.match(/(?:under|below|max|up to|budget of|for|around|about|~|بـ|ب)?\s*(\d[\d,]{1,7})\s*(?:jod|jd|dinars?|dinar|د\.?ا)?/g) || [];
  const nums = m
    .map((x) => parseFloat(x.replace(/[^\d.]/g, '')))
    .filter((n) => Number.isFinite(n) && n >= 20 && n <= 100000);
  if (!nums.length) return null;
  // The budget is normally the largest number in the sentence; model numbers
  // like "5070" or "32GB" are filtered out by the qualifier check below.
  const explicit = westernise(text.toLowerCase())
    .match(/(?:under|below|max|up to|budget|for|around|about|~|with|بـ)\s*(\d[\d,]{1,7})/);
  if (explicit) return parseFloat(explicit[1].replace(/,/g, ''));
  const withUnit = westernise(text.toLowerCase()).match(/(\d[\d,]{1,7})\s*(?:jod|jd|dinars?|dinar|د\.?ا)/);
  if (withUnit) return parseFloat(withUnit[1].replace(/,/g, ''));
  return null;
}

// Words people actually use, mapped to our categories.
const CATEGORY_WORDS = [
  ['prebuilt', /\b(pre[\s-]?built|ready\s*built|complete\s+(pc|system)|mini\s*pc)\b/i],
  ['gaming-laptop', /\b(laptop|notebook)\b/i],
  ['gpu', /\b(gpu|graphics?\s*card|video\s*card|vga|rtx|gtx|radeon)\b/i],
  ['cpu', /\b(cpu|processor|ryzen|core\s*i[3579]|core\s*ultra)\b/i],
  ['motherboard', /\b(mother\s*board|mobo|mainboard)\b/i],
  ['ram', /\b(ram|memory|ddr[345]|dimm)\b/i],
  ['storage', /\b(ssd|nvme|hdd|hard\s*(disk|drive)|storage)\b/i],
  ['psu', /\b(psu|power\s*supply)\b/i],
  ['case', /\b(case|casing|chassis|tower)\b/i],
  ['cooling', /\b(cooler|cooling|aio|fan|radiator|heat\s*sink)\b/i],
  ['monitor', /\b(monitor|screen|display)\b/i],
  ['keyboard', /\b(keyboard|keeb|keycaps?)\b/i],
  ['mouse', /\b(mouse|mice)\b/i],
  ['headset', /\b(head\s*set|head\s*phones?|ear\s*(buds?|phones?))\b/i],
  ['mousepad', /\b(mouse\s*pad|mousepad|desk\s*mat)\b/i],
  ['controller', /\b(controller|game\s*pad|joystick)\b/i],
  ['microphone', /\b(microphone|mic)\b/i],
  ['webcam', /\b(web\s*cam|capture\s*card|stream)\b/i],
  ['speakers', /\b(speakers?|sound\s*bar)\b/i],
  ['chair', /\b(chair|seat)\b/i],
  ['desk', /\b(desk|table)\b/i],
  ['console', /\b(playstation|ps[45]|xbox|nintendo|switch|steam\s*deck)\b/i],
];

const BUILD_WORDS = /\b(build|assemble|put together|full\s*(pc|rig|setup)|gaming\s*(pc|rig|computer|setup)|whole\s*(pc|setup))\b/i;

/** Specs the shopper asked for, e.g. "32GB DDR5", "1440p", "wireless". */
function parseConstraints(text) {
  const t = text.toLowerCase();
  const c = {};
  const ddr = t.match(/\bddr([345])\b/);
  if (ddr) c.ddr = `DDR${ddr[1]}`;
  const cap = t.match(/\b(\d{1,3})\s*gb\b/);
  if (cap) c.capacity = parseInt(cap[1], 10);
  const tb = t.match(/\b(\d)\s*tb\b/);
  if (tb) c.capacity = parseInt(tb[1], 10) * 1024;
  const hz = t.match(/\b(\d{2,3})\s*hz\b/);
  if (hz) c.refresh = parseInt(hz[1], 10);
  if (/\b(1440p|2k|qhd)\b/.test(t)) c.resolution = 'QHD 1440p';
  else if (/\b(4k|uhd|2160p)\b/.test(t)) c.resolution = '4K UHD';
  else if (/\b(1080p|fhd|full\s*hd)\b/.test(t)) c.resolution = 'FHD 1080p';
  if (/\bwireless\b/.test(t)) c.connection = 'Wireless';
  else if (/\bwired\b/.test(t)) c.connection = 'Wired';
  if (/\bmechanical\b/.test(t)) c.switchType = 'Mechanical';
  const w = t.match(/\b(\d{3,4})\s*w(att)?\b/);
  if (w) c.wattage = parseInt(w[1], 10);
  const chip = t.match(/\b(rtx|gtx)\s*(\d{3,4})\s*(ti\s*super|super|ti)?\b/);
  if (chip) c.chipset = `${chip[1].toUpperCase()} ${chip[2]}${chip[3] ? ` ${chip[3].toUpperCase()}` : ''}`.trim();
  return c;
}

// Ordinary conversation. People say hello before they ask for anything.
const SMALL_TALK = [
  ['greeting', /^\s*(hi|hey|hello|yo|hii+|salam|salaam|السلام|مرحبا|أهلا|ahlan|marhaba|good\s*(morning|evening|afternoon))\b/i],
  ['thanks', /\b(thanks|thank you|thx|cheers|شكرا)\b/i],
  ['bye', /\b(bye|goodbye|see ya|later|مع السلامة)\b/i],
  ['howareyou', /\bhow\s+are\s+you\b|\bwhat'?s\s+up\b|\bhows it going\b/i],
  ['whoareyou', /\b(who|what)\s+are\s+you\b|\bwhat\s+can\s+you\s+do\b|\bhelp\b|\bhow\s+(do|does)\s+(this|you)\s+work\b/i],
];

// Plainly nothing to do with gaming or computers. Answering these would be
// pretending to be something this is not.
const OFF_TOPIC = /\b(school|homework|essay|maths?|history|exam|university|recipe|cook(ing)?|weather|football match|politics|news|medicine|doctor|lawyer|translate|poem|joke|song|movie plot|who is the president)\b/i;

/** Work out what was asked. */
export function parseQuestion(text) {
  const budget = parseBudget(text);
  const constraints = parseConstraints(text);

  let category = null;
  for (const [sub, re] of CATEGORY_WORDS) {
    if (re.test(text)) { category = sub; break; }
  }

  // "build me a gaming pc" beats the fact that the sentence also says "pc".
  const wantsBuild = BUILD_WORDS.test(text) && !/\b(laptop|notebook)\b/i.test(text);
  if (wantsBuild) return { intent: 'build', category, budget, constraints, text };
  if (category) return { intent: 'pick', category, budget, constraints, text };

  // Off-topic is checked first: "can you help me with my school homework"
  // contains "help", which would otherwise read as asking what this does.
  if (OFF_TOPIC.test(text)) return { intent: 'offtopic', category, budget, constraints, text };

  for (const [kind, re] of SMALL_TALK) {
    if (re.test(text)) return { intent: 'chat', chat: kind, category, budget, constraints, text };
  }

  return { intent: 'help', category, budget, constraints, text };
}

/* ------------------------------------------------------------ compatibility */

/** Rough draw of a card, so the supply can be sized honestly. */
function gpuWatts(specs = {}) {
  const c = (specs.chipset || '').toUpperCase();
  const tiers = [
    [/5090/, 575], [/5080/, 360], [/5070\s*TI/, 300], [/5070/, 250], [/5060\s*TI/, 180], [/5060/, 145],
    [/4090/, 450], [/4080/, 320], [/4070\s*TI/, 285], [/4070/, 200], [/4060\s*TI/, 165], [/4060/, 115],
    [/3090/, 350], [/3080/, 320], [/3070/, 220], [/3060\s*TI/, 200], [/3060/, 170], [/3050/, 130],
    [/RX\s*9070/, 260], [/RX\s*7900/, 355], [/RX\s*7800/, 263], [/RX\s*7700/, 245], [/RX\s*7600/, 165],
    [/RX\s*6\d00/, 200], [/GT\s*\d+/, 30], [/GTX\s*16\d0/, 75],
  ];
  for (const [re, w] of tiers) if (re.test(c)) return w;
  return 150;
}

/** Does this set of parts actually go together? Returns a list of problems. */
export function checkCompatibility(parts) {
  const problems = [];
  const { cpu, motherboard, ram, psu, gpu } = parts;

  if (cpu?.specs?.socket && motherboard?.specs?.socket && cpu.specs.socket !== motherboard.specs.socket) {
    problems.push(`${cpu.specs.socket} processor will not fit an ${motherboard.specs.socket} board`);
  }
  if (ram?.specs?.ddr && motherboard?.specs?.memory && ram.specs.ddr !== motherboard.specs.memory) {
    problems.push(`${ram.specs.ddr} memory will not fit a ${motherboard.specs.memory} board`);
  }
  if (psu?.specs?.wattage) {
    const need = (gpu ? gpuWatts(gpu.specs) : 0) + 150;
    if (psu.specs.wattage < need) {
      problems.push(`${psu.specs.wattage}W supply is short for this card (about ${need}W needed)`);
    }
  }
  if (ram?.specs?.formFactor === 'Laptop (SO-DIMM)') {
    problems.push('that memory is laptop memory, not desktop');
  }
  return problems;
}

/* ---------------------------------------------------------------- picking */

/** Best value inside a budget: cheap for what it is, and a complete listing. */
function rank(list, ceiling) {
  const affordable = list.filter((p) => p.price <= ceiling);
  const pool = affordable.length ? affordable : list;
  const prices = pool.map((p) => p.price).sort((a, b) => a - b);
  const mid = prices[Math.floor(prices.length / 2)] || 1;

  return [...pool].sort((a, b) => score(b) - score(a) || a.price - b.price);

  function score(p) {
    // Spend the budget rather than hoarding it, but never reward overspending.
    const use = Math.min(p.price / ceiling, 1);
    return use * 55
      + (p.price <= mid ? 8 : 0)
      + Math.min(p.off, 40) * 0.8
      + (p.brand ? 10 : 0)
      + Math.min(Object.keys(p.specs || {}).length, 6) * 3
      + (p.image ? 5 : 0);
  }
}

const matchesConstraints = (p, c) => Object.entries(c).every(([k, v]) => {
  const actual = p.specs?.[k];
  if (actual === undefined || actual === null) return false;
  if (typeof v === 'number') return Number(actual) >= v;
  return String(actual).toLowerCase().includes(String(v).toLowerCase());
});

/** Top N of one category within a budget, honouring any stated specs. */
export function pick(products, sub, { budget = Infinity, constraints = {}, limit = 3 } = {}) {
  let list = products.filter((p) => p.sub === sub);
  if (!list.length) return { items: [], total: list.length };

  const constrained = Object.keys(constraints).length
    ? list.filter((p) => matchesConstraints(p, constraints))
    : list;

  // If the exact spec asked for does not exist, say so rather than quietly
  // returning something else.
  const relaxed = constrained.length ? constrained : list;
  const withinBudget = relaxed.filter((p) => p.price <= budget);

  return {
    items: rank(withinBudget.length ? withinBudget : relaxed, budget).slice(0, limit),
    matchedConstraints: constrained.length > 0,
    anyWithinBudget: withinBudget.length > 0,
    cheapest: relaxed.length ? Math.min(...relaxed.map((p) => p.price)) : null,
    total: relaxed.length,
  };
}

/* ----------------------------------------------------------------- builds */

// Roughly how a balanced gaming machine splits, before compatibility nudges it.
const SPLIT = [
  ['gpu', 0.34], ['cpu', 0.17], ['motherboard', 0.11], ['ram', 0.09],
  ['storage', 0.09], ['psu', 0.08], ['case', 0.07], ['cooling', 0.05],
];

const PART_LABEL = {
  gpu: 'Graphics card', cpu: 'Processor', motherboard: 'Motherboard', ram: 'Memory',
  storage: 'Storage', psu: 'Power supply', case: 'Case', cooling: 'Cooling',
};

/**
 * The cheapest each part can be had for right now. This is what makes the
 * "not at this budget" answer truthful instead of a guess.
 */
export function floorPrice(products) {
  let total = 0;
  const parts = {};
  for (const [sub] of SPLIT) {
    const list = products.filter((p) => p.sub === sub);
    if (!list.length) continue;
    const cheapest = list.reduce((a, b) => (a.price <= b.price ? a : b));
    parts[sub] = cheapest;
    total += cheapest.price;
  }
  return { total, parts };
}

const isDesktopRam = (p) => p.specs?.formFactor !== 'Laptop (SO-DIMM)';

/**
 * Processor and motherboard are chosen together, never separately. Picking
 * the best of each on its own is how you end up with an LGA1151 chip on an
 * LGA1700 board - both individually sensible, together useless.
 */
function pickPlatform(products, ceiling) {
  const cpus = products.filter((p) => p.sub === 'cpu' && p.specs?.socket);
  const boards = products.filter((p) => p.sub === 'motherboard' && p.specs?.socket);
  if (!cpus.length || !boards.length) return null;

  const bySocket = new Map();
  for (const b of boards) {
    const s = b.specs.socket;
    if (!bySocket.has(s)) bySocket.set(s, []);
    bySocket.get(s).push(b);
  }

  let best = null;
  for (const cpu of cpus) {
    const options = bySocket.get(cpu.specs.socket);
    if (!options) continue;
    for (const board of options) {
      const pair = cpu.price + board.price;
      if (pair > ceiling) continue;
      // Spend most of the platform budget, favouring the processor.
      const value = pair / ceiling + (cpu.price / Math.max(pair, 1)) * 0.35;
      if (!best || value > best.value) best = { cpu, board, pair, value };
    }
  }

  if (best) return best;
  // Nothing fits the ceiling: take the cheapest compatible pair that exists.
  for (const cpu of cpus) {
    for (const board of bySocket.get(cpu.specs.socket) || []) {
      const pair = cpu.price + board.price;
      if (!best || pair < best.pair) best = { cpu, board, pair, value: 0 };
    }
  }
  return best;
}

/**
 * Build a machine to a budget out of real, in-stock, compatible parts.
 * Returns either a build or an honest explanation of why not.
 */
export function buildPC(products, budget) {
  const floor = floorPrice(products);
  if (!Number.isFinite(budget) || budget <= 0) {
    return { ok: false, reason: 'no-budget', floor };
  }
  if (budget < floor.total) {
    return { ok: false, reason: 'too-low', floor, budget };
  }

  const chosen = {};
  const cheapestOf = (sub, filter = () => true) => {
    const list = products.filter((p) => p.sub === sub && filter(p));
    return list.length ? list.reduce((a, b) => (a.price <= b.price ? a : b)) : null;
  };

  // Platform first, as one decision.
  const platformShare = (SPLIT.find(([s]) => s === 'cpu')[1] + SPLIT.find(([s]) => s === 'motherboard')[1]);
  const platform = pickPlatform(products, budget * platformShare);
  if (!platform) return { ok: false, reason: 'too-low', floor, budget };
  chosen.cpu = platform.cpu;
  chosen.motherboard = platform.board;

  // Memory has to match what that board takes, and be desktop memory.
  const wantDdr = chosen.motherboard.specs?.memory;
  const ramFits = (p) => isDesktopRam(p) && (!wantDdr || !p.specs?.ddr || p.specs.ddr === wantDdr);
  chosen.ram = rank(products.filter((p) => p.sub === 'ram' && ramFits(p)), budget * 0.09)[0]
    || cheapestOf('ram', ramFits) || cheapestOf('ram');

  chosen.gpu = rank(products.filter((p) => p.sub === 'gpu'), budget * 0.34)[0] || cheapestOf('gpu');

  // The supply is sized for the card that was actually chosen.
  const need = (chosen.gpu ? gpuWatts(chosen.gpu.specs) : 0) + 150;
  const psuFits = (p) => (p.specs?.wattage || 0) >= need;
  chosen.psu = rank(products.filter((p) => p.sub === 'psu' && psuFits(p)), budget * 0.08)[0]
    || cheapestOf('psu', psuFits) || cheapestOf('psu');

  for (const [sub, share] of [['storage', 0.09], ['case', 0.07], ['cooling', 0.05]]) {
    chosen[sub] = rank(products.filter((p) => p.sub === sub), budget * share)[0] || cheapestOf(sub);
  }

  // Nothing above guarantees the total fits, so trim until it does: replace
  // the dearest part with the best cheaper option, over and over.
  const constraintFor = {
    ram: ramFits,
    psu: psuFits,
    cpu: (p) => p.specs?.socket === chosen.motherboard?.specs?.socket,
    motherboard: (p) => p.specs?.socket === chosen.cpu?.specs?.socket,
  };

  for (let guard = 0; guard < 40; guard++) {
    const total = Object.values(chosen).reduce((s, p) => s + (p?.price || 0), 0);
    if (total <= budget) break;

    const over = total - budget;
    const swappable = Object.entries(chosen)
      .filter(([, p]) => p)
      .sort((a, b) => b[1].price - a[1].price);

    let swapped = false;
    for (const [sub, current] of swappable) {
      const fits = constraintFor[sub] || (() => true);
      const cheaper = products
        .filter((p) => p.sub === sub && p.price < current.price && fits(p))
        .sort((a, b) => b.price - a.price);
      // Prefer the smallest cut that closes the gap, else the next step down.
      const target = cheaper.find((p) => current.price - p.price >= over) || cheaper[0];
      if (target) { chosen[sub] = target; swapped = true; break; }
    }
    if (!swapped) break;
  }

  const parts = SPLIT
    .map(([sub]) => chosen[sub] && { sub, label: PART_LABEL[sub], product: chosen[sub] })
    .filter(Boolean)
    .sort((a, b) => b.product.price - a.product.price);

  const total = parts.reduce((s, x) => s + x.product.price, 0);

  return {
    ok: true,
    parts,
    total,
    budget,
    leftover: budget - total,
    overBudget: total > budget,
    problems: checkCompatibility(chosen),
    stores: [...new Set(parts.map((x) => x.product.storeName))],
  };
}

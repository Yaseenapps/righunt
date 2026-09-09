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
  const chip = t.match(/\b(rtx|gtx|rx)\s*(\d{3,4})\s*(xt\s*x|ti\s*super|super|ti|xt|gre)?\b/);
  if (chip) {
    const maker = chip[1].toUpperCase();
    c.chipset = `${maker} ${chip[2]}${chip[3] ? ` ${chip[3].toUpperCase()}` : ''}`.replace(/\s+/g, ' ').trim();
  } else {
    // People name a card by its number alone - "build the best 9070 pc",
    // "is a 5050 enough". Kept as a hint rather than a chipset because a
    // bare number could equally be money; buildPC only believes it if a card
    // with that number is actually in the catalogue, and it ignores anything
    // written as an amount.
    const bare = t.match(/\b(\d{4})\b(?!\s*(jd|jod|dinars?|د\.?ا|mhz|mt\/?s|w\b))/);
    // "for 2000" is money, "the best 9070" is a card. The words immediately
    // in front decide it.
    const before = bare ? t.slice(Math.max(0, bare.index - 14), bare.index) : '';
    if (bare && !/\b(under|below|max|up to|budget(\s+of)?|for|around|about|~)\s*$/.test(before)) {
      c.gpuHint = bare[1];
    }
  }
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
  if (wantsBuild) {
    // "...with the monitor" asks for a screen as part of the build. Ignoring
    // it and returning eight parts and no screen is not an answer.
    const withMonitor = /\b(with|include|including|plus|and)\s+(a\s+|the\s+|an\s+)?(monitor|screen|display)\b/i.test(text);
    return { intent: 'build', category, budget, constraints, withMonitor, text };
  }
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

/**
 * Roughly how fast a graphics card is, 0-100.
 *
 * Price alone cannot answer this. A GT 1030 is an office display adapter that
 * happens to cost about the same as a real budget card, and ranking on "uses
 * up the budget" put one in a 1,700 JOD gaming build.
 *
 * Written out rather than calculated from the model number. A formula gets it
 * wrong in both directions - it rates an RTX 5050 above an RTX 4070, and a
 * GTX 1660 near an RTX 3060 - because neither generation nor tier on its own
 * tracks real speed. Ordered fastest first; the first match wins.
 */
function gpuClass(specs = {}) {
  const c = String(specs.chipset || '').toUpperCase().replace(/\s+/g, ' ');

  const TIERS = [
    [/\b5090\b/, 100], [/\b4090\b/, 96], [/\b5080\b/, 92], [/\b4080\b/, 88],
    [/\bRX 7900\b/, 84], [/\b3090\b/, 84], [/\b5070 TI\b/, 82],
    [/\bRX 9070 XT\b/, 78], [/\b4070 TI\b/, 78], [/\b3080\b/, 76],
    [/\bRX 9070\b/, 74], [/\b5070\b/, 72], [/\bRX 7800\b/, 70], [/\b4070\b/, 68],
    [/\b3070\b/, 62], [/\bRX 7700\b/, 62], [/\b5060 TI\b/, 58],
    [/\bRX 9060 XT\b/, 56], [/\b4060 TI\b/, 54], [/\b3060 TI\b/, 52],
    [/\b5060\b/, 50], [/\bRX 7600\b/, 48], [/\b4060\b/, 46], [/\b3060\b/, 42],
    [/\bRX 6600\b/, 40], [/\b5050\b/, 38], [/\bARC [AB]7\d0\b/, 44],
    [/\bARC [AB]5\d0\b/, 34], [/\b3050\b/, 32], [/\bRX 6500\b/, 26],
    [/\b1660\b/, 26], [/\bARC [AB]3\d0\b/, 24], [/\b1650\b/, 20], [/\b1630\b/, 12],
    // Display adapters. Not gaming cards at any price - this is the one that
    // got picked for a 1,700 JOD build because it used up the budget.
    [/\bGT (1030|710|730|740|610|620|640)\b/, 2],
    [/\bQUADRO|NVS|FIREPRO|RADEON PRO\b/, 4],
  ];
  for (const [re, v] of TIERS) if (re.test(c)) return v;

  // An unknown model sits mid-low, so it is never preferred over a card we
  // can actually place.
  return 22;
}

/** How much of a part you are getting, 0-100, from the specs we already read. */
function capability(sub, p) {
  const s = p.specs || {};
  switch (sub) {
    case 'gpu': return gpuClass(s);
    case 'cpu': {
      const cores = Number(s.cores) || 0;
      const series = /i9|ryzen 9/i.test(s.series || '') ? 22
        : /i7|ryzen 7/i.test(s.series || '') ? 16
        : /i5|ryzen 5/i.test(s.series || '') ? 10 : 4;
      return Math.min(100, cores * 2.4 + series * 2);
    }
    case 'ram': {
      const gb = Number(s.capacity) || 0;
      // 8GB is not a gaming amount any more; 16 is the floor, 32 the target.
      return gb >= 64 ? 95 : gb >= 32 ? 85 : gb >= 16 ? 60 : gb >= 8 ? 20 : 5;
    }
    case 'storage': {
      const gb = Number(s.capacity) || 0;
      const fast = /nvme/i.test(s.type || '') ? 18 : 0;
      return Math.min(100, (gb >= 2048 ? 60 : gb >= 1024 ? 48 : gb >= 512 ? 30 : 12) + fast);
    }
    case 'psu': {
      // Wattage is a fit requirement, handled elsewhere. Here, efficiency and
      // modularity are what separate a good supply from a cheap one.
      const eff = /titanium/i.test(s.efficiency || '') ? 30
        : /platinum/i.test(s.efficiency || '') ? 25
        : /gold/i.test(s.efficiency || '') ? 20
        : /bronze/i.test(s.efficiency || '') ? 10 : 0;
      return Math.min(100, eff * 2 + (/full/i.test(s.modular || '') ? 20 : 0) + 20);
    }
    case 'monitor': {
      // Without this every monitor scored the same, so the only thing telling
      // them apart was which price sat closest to the allowance - and the
      // same screen came back for 1,200 JOD and 1,500 JOD builds.
      const hz = Number(s.refresh) || 60;
      const speed = hz >= 240 ? 34 : hz >= 165 ? 28 : hz >= 144 ? 22 : hz >= 100 ? 12 : 0;
      const res = /4K/i.test(s.resolution || '') ? 30
        : /UWQHD/i.test(s.resolution || '') ? 26
        : /QHD|1440/i.test(s.resolution || '') ? 20
        : /FHD|1080/i.test(s.resolution || '') ? 8 : 4;
      const size = Number(s.size) || 0;
      const inches = size >= 34 ? 16 : size >= 32 ? 13 : size >= 27 ? 10 : size >= 24 ? 6 : 2;
      const panel = /OLED/i.test(s.panel || '') ? 14 : /IPS/i.test(s.panel || '') ? 8 : /VA/i.test(s.panel || '') ? 5 : 0;
      return Math.min(100, speed + res + inches + panel);
    }
    default: return 50;   // cases, cooling: taste, not performance
  }
}

/**
 * Best value inside a budget.
 *
 * Two things matter and they pull against each other: how much part you get,
 * and not wasting money. Capability leads, because a build that spends its
 * whole graphics budget on a display adapter is worse than one that spends
 * half of it on a real card.
 */
function rank(list, ceiling, sub = null) {
  const affordable = list.filter((p) => p.price <= ceiling);
  const pool = affordable.length ? affordable : list;

  return [...pool].sort((a, b) => score(b) - score(a) || a.price - b.price);

  function score(p) {
    const able = sub ? capability(sub, p) : 50;
    // Using the budget counts for something - a part that costs more usually
    // is more - but only a little. It used to be worth 18 points against a
    // capability difference of about 7, so a dearer, slower graphics card
    // could win, and a 1,500 JOD build came back with a worse card than a
    // 1,200 JOD one. What the part actually is has to dominate.
    const use = Math.min(p.price / ceiling, 1);
    return able * 1.6
      + use * 7
      + Math.min(p.off, 40) * 0.5
      + (p.brand ? 6 : 0)
      + Math.min(Object.keys(p.specs || {}).length, 6) * 2
      + (p.image ? 4 : 0);
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
    items: rank(withinBudget.length ? withinBudget : relaxed, budget, sub).slice(0, limit),
    matchedConstraints: constrained.length > 0,
    anyWithinBudget: withinBudget.length > 0,
    cheapest: relaxed.length ? Math.min(...relaxed.map((p) => p.price)) : null,
    total: relaxed.length,
  };
}

/* ----------------------------------------------------------------- builds */

// Roughly how a balanced gaming machine splits, before compatibility nudges it.
/**
 * How the money is divided.
 *
 * Weighted towards the graphics card, because that is what decides frame rate
 * in games and it is what someone buying a gaming PC is really buying. At 34%
 * a 1,700 JOD budget capped the card at 578, so the RTX 5070s in the
 * catalogue from 649 were never even considered and the build came back with
 * a 3070 at 449 - a quarter of the machine. 42% reaches them.
 */
const SPLIT = [
  ['gpu', 0.42], ['cpu', 0.15], ['motherboard', 0.09], ['ram', 0.10],
  ['storage', 0.08], ['psu', 0.07], ['case', 0.05], ['cooling', 0.04],
];

const PART_LABEL = {
  gpu: 'Graphics card', cpu: 'Processor', motherboard: 'Motherboard', ram: 'Memory',
  storage: 'Storage', psu: 'Power supply', case: 'Case', cooling: 'Cooling', monitor: 'Monitor',
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
/**
 * The card the question asked for, if the catalogue has one.
 *
 * "RTX 5070", "rx 9070 xt" and a bare "9070" all arrive here. The bare number
 * is only believed when a real card carries it - which is what stops a price
 * being mistaken for a model.
 */
function requestedGpu(products, constraints = {}) {
  const asked = String(constraints.chipset || constraints.gpuHint || '').trim();
  if (!asked) return null;

  const digits = asked.match(/\d{3,4}/)?.[0];
  if (!digits) return null;
  const suffix = asked.replace(/.*\d{3,4}\s*/, '').trim().toUpperCase();

  const cards = products.filter((p) => {
    if (p.sub !== 'gpu') return false;
    const chip = String(p.specs?.chipset || '').toUpperCase();
    if (!chip.includes(digits)) return false;
    // "5070" must not answer with a 5070 Ti unless a Ti was asked for, but
    // "5070 ti" must not answer with a plain 5070 either.
    const chipSuffix = chip.replace(/.*\d{3,4}\s*/, '').trim();
    return suffix ? chipSuffix.includes(suffix) : chipSuffix === '';
  });
  if (!cards.length) return null;

  // Best of the matching cards rather than the cheapest: they asked for this
  // chip, so the question is which board partner's version to buy.
  return rank(cards, Math.max(...cards.map((c) => c.price)), 'gpu')[0] || null;
}

/**
 * What a machine built around this card should cost.
 *
 * The card is the biggest line in a gaming build, so a share of the budget is
 * the obvious estimate - but it is wrong at the cheap end. A 279 JOD card
 * priced at 42% gives a 664 JOD budget, and the rest of a machine cannot
 * actually be bought for the 385 that leaves: the memory gets squeezed down
 * to 8GB to make it fit, which is not a machine worth recommending.
 *
 * So take whichever is larger - the share, or what the other parts genuinely
 * cost at their cheapest with memory held at 16GB - and leave a tenth for the
 * build not to be scraping the bottom of every category.
 */
function budgetAround(products, card) {
  const cheapest = (sub, extra = () => true) => {
    const list = products.filter((p) => p.sub === sub && extra(p));
    return list.length ? Math.min(...list.map((p) => p.price)) : 0;
  };

  const rest = cheapest('cpu') + cheapest('motherboard')
    + cheapest('ram', (p) => (p.specs?.capacity || 0) >= 16 && isDesktopRam(p))
    + cheapest('psu') + cheapest('case') + cheapest('storage') + cheapest('cooling');

  const byShare = card.price / (SPLIT.find(([s]) => s === 'gpu')?.[1] || 0.42);
  return Math.round(Math.max(byShare, (card.price + rest) * 1.1));
}

/**
 * Put a whole machine together inside a budget.
 *
 * `withMonitor` adds a screen to the build. Asking for "a PC for 1700 with
 * the monitor" and getting eight parts and no screen back is not an answer to
 * the question that was asked, so the screen takes its own slice of the money
 * rather than being quietly dropped.
 */
export function buildPC(products, budget, { withMonitor = false, constraints = {} } = {}) {
  const floor = floorPrice(products);

  // Someone naming the card they want has told us plenty: "build the best
  // 9070 pc" does not need a budget, because the card sets the budget. Asking
  // for one back is a worse answer than building the machine they described.
  const wanted = requestedGpu(products, constraints);
  let derivedBudget = false;
  if (!Number.isFinite(budget) || budget <= 0) {
    if (!wanted) return { ok: false, reason: 'no-budget', floor };
    budget = budgetAround(products, wanted);
    derivedBudget = true;
  }

  if (budget < floor.total) {
    return { ok: false, reason: 'too-low', floor, budget };
  }

  const chosen = {};
  const cheapestOf = (sub, filter = () => true) => {
    const list = products.filter((p) => p.sub === sub && filter(p));
    return list.length ? list.reduce((a, b) => (a.price <= b.price ? a : b)) : null;
  };

  // A screen comes out of the same money, so the parts get what is left.
  const monitorShare = withMonitor ? 0.2 : 0;
  const forParts = budget * (1 - monitorShare);
  if (withMonitor) {
    chosen.monitor = rank(products.filter((p) => p.sub === 'monitor'), budget * monitorShare, 'monitor')[0]
      || cheapestOf('monitor');
  }

  // Platform first, as one decision.
  const platformShare = (SPLIT.find(([s]) => s === 'cpu')[1] + SPLIT.find(([s]) => s === 'motherboard')[1]);
  const platform = pickPlatform(products, forParts * platformShare);
  if (!platform) return { ok: false, reason: 'too-low', floor, budget };
  chosen.cpu = platform.cpu;
  chosen.motherboard = platform.board;

  // Memory has to match what that board takes, and be desktop memory.
  const wantDdr = chosen.motherboard.specs?.memory;
  const ramFits = (p) => isDesktopRam(p) && (!wantDdr || !p.specs?.ddr || p.specs.ddr === wantDdr);
  // 8GB is not a gaming amount any more. A 16GB kit often sits just outside
  // the memory allowance while the budget as a whole can plainly afford it,
  // so the allowance is stretched before settling for less - that is what put
  // 8GB in a 1,200 JOD build.
  const ramPool = products.filter((p) => p.sub === 'ram' && ramFits(p));
  const enough = ramPool.filter((p) => (p.specs?.capacity || 0) >= 16 && p.price <= forParts * 0.16);
  chosen.ram = rank(enough.length ? enough : ramPool, forParts * 0.11, 'ram')[0]
    || cheapestOf('ram', ramFits) || cheapestOf('ram');

  // Read from SPLIT rather than repeating the number, so the share is stated
  // in exactly one place.
  const shareOf = (sub) => SPLIT.find(([s]) => s === sub)?.[1] || 0.1;
  // A card the question named is the point of the build, so it is not up for
  // reconsideration: neither the trim loop nor the upgrade pass may replace
  // it. Everything else bends around it.
  chosen.gpu = wanted
    || rank(products.filter((p) => p.sub === 'gpu'), forParts * shareOf('gpu'), 'gpu')[0]
    || cheapestOf('gpu');

  // The supply is sized for the card that was actually chosen.
  const need = (chosen.gpu ? gpuWatts(chosen.gpu.specs) : 0) + 150;
  const psuFits = (p) => (p.specs?.wattage || 0) >= need;
  chosen.psu = rank(products.filter((p) => p.sub === 'psu' && psuFits(p)), forParts * 0.08, 'psu')[0]
    || cheapestOf('psu', psuFits) || cheapestOf('psu');

  for (const [sub, share] of [['storage', 0.09], ['case', 0.07], ['cooling', 0.05]]) {
    chosen[sub] = rank(products.filter((p) => p.sub === sub), forParts * share, sub)[0] || cheapestOf(sub);
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
      .filter(([sub, p]) => p && !(wanted && sub === 'gpu'))
      .sort((a, b) => b[1].price - a[1].price);

    let swapped = false;
    // Two passes. The first refuses to take memory below 16GB, because it is
    // usually the dearest part left once the graphics card is spoken for, and
    // trimming it first is how a machine built around a named card ended up
    // with 8GB while its case and cooler went untouched. Only if nothing else
    // will give way does the second pass allow it.
    for (const lastResort of [false, true]) {
      for (const [sub, current] of swappable) {
        const fits = constraintFor[sub] || (() => true);
        let cheaper = products.filter((p) => p.sub === sub && p.price < current.price && fits(p));
        if (sub === 'ram' && !lastResort && (current.specs?.capacity || 0) >= 16) {
          cheaper = cheaper.filter((p) => (p.specs?.capacity || 0) >= 16);
        }
        cheaper.sort((a, b) => b.price - a.price);
        // Prefer the smallest cut that closes the gap, else the next step down.
        const target = cheaper.find((p) => current.price - p.price >= over) || cheaper[0];
        if (target) { chosen[sub] = target; swapped = true; break; }
      }
      if (swapped) break;
    }
    if (!swapped) break;
  }

  /* ------------------------------------------------------------------
   * Spend what is left.
   *
   * Every part is picked against a fixed share of the budget, and there was a
   * trim loop for going over but nothing for coming in under. So when the
   * graphics allowance stopped just short of the next card up, the money
   * simply went unspent: a 2,200 JOD build came back identical to a 1,700 one
   * with 218 JOD left over, which is not the build someone asked for.
   *
   * Repeatedly buy the single best upgrade available - the one gaining the
   * most capability per dinar - until nothing worthwhile fits.
   * ------------------------------------------------------------------ */
  const UPGRADE_ORDER = ['gpu', 'cpu', 'ram', 'monitor', 'storage', 'psu', 'cooling', 'case'];
  // How much a point of improvement is worth in each part, for a machine
  // bought to play games on.
  const UPGRADE_WEIGHT = {
    gpu: 3, cpu: 1.6, ram: 1.2, monitor: 1, storage: 0.8, psu: 0.5, cooling: 0.4, case: 0.3,
  };
  for (let guard = 0; guard < 24; guard++) {
    const spent = Object.values(chosen).reduce((s, p) => s + (p?.price || 0), 0);
    const spare = budget - spent;
    // Chasing the last few dinars just churns the build for no real gain.
    if (spare < Math.max(25, budget * 0.02)) break;

    let best = null;
    for (const sub of UPGRADE_ORDER) {
      const current = chosen[sub];
      if (!current) continue;
      if (wanted && sub === 'gpu') continue;   // they chose this card
      const fits = constraintFor[sub] || (() => true);
      const now = capability(sub, current);

      for (const p of products) {
        if (p.sub !== sub || !fits(p)) continue;
        const extra = p.price - current.price;
        if (extra <= 0 || extra > spare) continue;
        const gain = capability(sub, p) - now;
        if (gain <= 0) continue;
        // Per-dinar, so a small sensible step beats a huge indulgent one -
        // but weighted, because measuring purely per-dinar always bought the
        // cheap upgrade. A better screen would win over a better card every
        // time, which is not how anyone spends money on a gaming PC.
        const worth = (gain * UPGRADE_WEIGHT[sub] || gain) / extra;
        if (!best || worth > best.worth) best = { sub, product: p, worth };
      }
    }

    if (!best) break;
    chosen[best.sub] = best.product;

    // A bigger card may now need a bigger supply.
    if (best.sub === 'gpu') {
      const needed = gpuWatts(best.product.specs) + 150;
      if ((chosen.psu?.specs?.wattage || 0) < needed) {
        const stronger = products
          .filter((p) => p.sub === 'psu' && (p.specs?.wattage || 0) >= needed)
          .sort((a, b) => a.price - b.price)[0];
        if (stronger) chosen.psu = stronger;
      }
    }
  }

  const parts = [...SPLIT.map(([sub]) => sub), 'monitor']
    .map((sub) => chosen[sub] && { sub, label: PART_LABEL[sub], product: chosen[sub] })
    .filter(Boolean)
    .sort((a, b) => b.product.price - a.product.price);

  const total = parts.reduce((s, x) => s + x.product.price, 0);

  return {
    ok: true,
    parts,
    total,
    budget,
    // True when no budget was given and this one was worked out from the card
    // they named - so the answer does not call it "your" budget.
    derivedBudget,
    leftover: budget - total,
    overBudget: total > budget,
    problems: checkCompatibility(chosen),
    stores: [...new Set(parts.map((x) => x.product.storeName))],
  };
}

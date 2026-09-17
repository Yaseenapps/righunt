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
export function gpuWatts(specs = {}) {
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
export function gpuClass(specs = {}) {
  const c = String(specs.chipset || '').toUpperCase().replace(/\s+/g, ' ');

  const TIERS = [
    [/\b5090\b/, 100], [/\b4090\b/, 96], [/\b5080\b/, 92], [/\b4080\b/, 88],
    // Older and AMD RX 6000 cards, which the list below never named - an RX
    // 6700 XT scored as an RX 6600, and an RTX 2070 as an unknown.
    [/\bRX 69[05]0\b/, 72], [/\bRX 6800 XT\b/, 66], [/\bRX 6800\b/, 62], [/\bRX 6750\b/, 58],
    [/\bRX 6700 XT\b/, 56], [/\bRX 6700\b/, 52], [/\bRX 6650\b/, 46], [/\bRX 6600 XT\b/, 44],
    [/\bRX 5700 XT\b/, 44], [/\bRX 5700\b/, 40], [/\bRX 5600\b/, 36], [/\bRX 5[89]0\b/, 20],
    [/\b2080 (TI|SUPER)\b/, 58], [/\b2080\b/, 52], [/\b2070 SUPER\b/, 50], [/\b2070\b/, 46],
    [/\b2060 SUPER\b/, 44], [/\b2060\b/, 40], [/\b1080 TI\b/, 42], [/\b1080\b/, 36],
    [/\b1070\b/, 30], [/\b1660 (SUPER|TI)\b/, 28],
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

/**
 * Roughly how fast a processor is for gaming, 0-100.
 *
 * It used to be worked out from the core count and the series name - and a
 * third of the listings carry no core count, so a Core i3-14100 scored 8, an
 * i5-12400F scored 20 on one shop and 34 on another, and a Ryzen 5 7600 scored
 * exactly the same as a Ryzen 5 5500. A 600 JOD build then kept a 45 JOD Ryzen
 * 3 3100 because nothing looked better. Written out by model, like the
 * graphics cards, from the model name in the title. Ordered so the first
 * match wins: X3D before plain, K before non-K, newer before older.
 */
export function cpuClass(p) {
  const t = String(`${p.title || ''} ${p.specs?.series || ''}`).toUpperCase().replace(/[™®]/g, ' ').replace(/\s+/g, ' ');
  const TIERS = [
    // AMD
    [/\b9950X3D\b/, 80], [/\b9800X3D\b/, 78], [/\b7950X3D\b/, 72], [/\b7800X3D\b/, 72], [/\b9950X\b/, 68],
    [/\b9900X3D\b/, 70], [/\b9900X\b/, 64], [/\b7950X\b/, 62], [/\b9700X\b/, 60], [/\b7900X3D\b/, 64],
    [/\b7900X?\b/, 58], [/\b5800X3D\b/, 58], [/\b5700X3D\b/, 56], [/\b9600X?\b/, 56], [/\b7700X?\b/, 56],
    [/\b8700[FG]\b/, 52], [/\b7600X?\b/, 50], [/\b7500F\b/, 50], [/\b8600G\b/, 48], [/\b5950X\b/, 52],
    [/\b5900XT?\b/, 50], [/\b5800XT?\b/, 47], [/\b5700X?\b/, 44], [/\b5500X3D\b/, 44], [/\b8400F\b/, 44],
    [/\b8500G\b/, 42], [/\b5600X?T?\b/, 40], [/\b5600G\b/, 36], [/\b5500\b/, 34], [/\b5700G\b/, 40],
    [/\b3600X?\b/, 28], [/\b4600G\b/, 26], [/\b4500\b/, 26], [/\b(3100|3200G|4100|4300G|3300X)\b/, 20],
    // Intel Core Ultra
    [/ULTRA 9 ?285K?/, 68], [/ULTRA 7 ?265K?F?/, 62], [/ULTRA 5 ?245K?F?/, 54], [/ULTRA 5 ?225F?/, 44],
    // Intel Core, 12th-14th gen
    [/I9[\s-]?14900/, 70], [/I9[\s-]?13900/, 68], [/I9[\s-]?12900/, 60],
    [/I7[\s-]?14700/, 66], [/I7[\s-]?13700/, 62], [/I7[\s-]?12700/, 55],
    [/I5[\s-]?14600/, 58], [/I5[\s-]?13600/, 58], [/I5[\s-]?12600/, 50],
    [/I5[\s-]?14400/, 48], [/I5[\s-]?13400/, 46], [/I5[\s-]?12400/, 42],
    [/I3[\s-]?1[34]100/, 33], [/I3[\s-]?12100/, 30],
    // Older Intel
    [/I9[\s-]?1[01]900/, 44], [/I7[\s-]?1[01]700/, 40], [/I5[\s-]?11[46]00/, 32], [/I5[\s-]?10[46]00/, 26],
    [/I3[\s-]?10100/, 20], [/\b(PENTIUM|CELERON|ATHLON)\b/, 8],
  ];
  for (const [re, v] of TIERS) if (re.test(t)) return v;

  // Unknown model: the old estimate, kept below anything we can place.
  const s = p.specs || {};
  const cores = Number(s.cores) || 0;
  const series = /i9|ryzen 9/i.test(s.series || '') ? 30 : /i7|ryzen 7/i.test(s.series || '') ? 26
    : /i5|ryzen 5/i.test(s.series || '') ? 20 : 10;
  return Math.min(40, series + cores);
}

// Power supply makers whose cheap units are the ones that fail and take a
// machine with them. A 45 JOD "1000W 80 Plus Gold fully modular" unit is not
// what its label says; putting one in a build is the worst advice this site
// could give, however good it looks on paper.
const PSU_AVOID = /\b(mercury|aigo|huntkey|black\s*storm|raidmax|redragon|intech|fonte|gamemax|golden\s*field|xtreme|segotep)\b/i;
const PSU_TRUSTED = /\b(corsair|seasonic|be\s*quiet|cooler\s*master|thermaltake|deepcool|msi|gigabyte|aorus|asus|rog|antec|fsp|xpg|nzxt|lian\s*li|super\s*flower|thermalright|montech|silverstone|evga|chieftec|phanteks|fractal|cougar)\b/i;

/** How much of a part you are getting, 0-100, from the specs we already read. */
export function capability(sub, p) {
  const s = p.specs || {};
  switch (sub) {
    case 'gpu': return gpuClass(s);
    case 'cpu': return cpuClass(p);
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
      // Who made it counts for more than the sticker on the box.
      const maker = PSU_TRUSTED.test(p.title || '') ? 25 : PSU_AVOID.test(p.title || '') ? -30 : 0;
      return Math.max(0, Math.min(100, eff * 1.5 + (/full/i.test(s.modular || '') ? 10 : 0) + 20 + maker));
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
    case 'cooling': {
      // A 360mm liquid cooler over a 240, and either over a single tower. The
      // title first: shops label plain tower coolers "Liquid / AIO".
      const title = p.title || '';
      const t = /\bair\b|\btower\b|heat\s*pipes?/i.test(title) ? 'air'
        : /\b(aio|liquid|water)\b|\b\d{3}\s*mm\s*radiator/i.test(title) ? 'liquid' : String(s.type || '');
      const base = /liquid|aio/i.test(t) ? 55 : /air/i.test(t) ? 40 : 5;
      const size = Number(String(s.size || '').match(/\d+/)?.[0]) || 0;
      return Math.min(100, base + (size >= 360 ? 20 : size >= 280 ? 14 : size >= 240 ? 10 : 0));
    }
    case 'case': {
      // Mostly taste. Airflow and room are the parts of it that are not.
      const size = /full/i.test(s.size || '') ? 12 : /mid/i.test(s.size || '') ? 10 : 4;
      const panel = /mesh/i.test(s.panel || '') ? 12 : /glass/i.test(s.panel || '') ? 8 : 0;
      return 30 + size + panel;
    }
    default: return 50;
  }
}

/* ---------------------------------------------------------------------------
 * Is this listing really the part its category says?
 *
 * Shops file things loosely, and the catalogue inherits it: a computer case
 * sits under Graphics Cards, a 360mm water cooler under Processors, a pack of
 * case fans under Cooling. Every one of those was put into a build as if it
 * were the part - a 700 JOD machine came back with a case for a graphics card
 * and a water cooler for a processor. A build only uses listings that carry
 * the specs of the part they are standing in for.
 * ------------------------------------------------------------------------ */

const NOT_A_CHIP = /\b(cooler|cooling|water|liquid|aio|radiator|fan|paste|thermal|bracket)\b/i;

export function fitsSlot(p) {
  const s = p.specs || {};
  switch (p.sub) {
    // Not a water block or a backplate that happens to name the card it fits:
    // "EKWB GeForce RTX 2080 Ti Plexi Glass" was a 119 JOD graphics card in a
    // 500 JOD build.
    case 'gpu': return !!s.chipset && gpuClass(s) >= 12
      && !/\b(water\s*block|waterblock|ekwb|ek-|bykski|barrow|alphacool|backplate|plexi|vector|block|bracket|riser|holder|support)\b/i.test(p.title || '');
    case 'cpu': return !!s.socket && !!(s.cores || s.series || cpuClass(p) > 10) && !NOT_A_CHIP.test(p.title || '');
    case 'motherboard': return !!s.socket && !!s.memory;
    case 'ram': return (Number(s.capacity) || 0) >= 8 && !!s.ddr && !/laptop|so-?dimm/i.test(s.formFactor || '');
    // An SSD. A hard drive alone is a surveillance disk as the system drive.
    case 'storage': return (Number(s.capacity) || 0) >= 240 && /nvme|sata ssd/i.test(s.type || '');
    case 'psu': return (Number(s.wattage) || 0) >= 400 && !PSU_AVOID.test(p.title || '')
      && !/\b(case|chassis|tower|adapter|charger)\b/i.test(p.title || '');
    // A cooler for the processor - not case fans, paste, or a tube fitting.
    case 'cooling': return /air cooler|liquid|aio/i.test(s.type || '')
      && (p.price >= 20 || /\b(cooler|aio|liquid|radiator)\b/i.test(p.title || ''))
      && !/\b(fitting|tubing|soft tube|hard tube|reservoir|compression|coolant|wipes?|cleaner|paste|frame|charging|wi-?fi|bluetooth|case|chassis|vga|phone|mobile|laptop|pad|ps[45]|console|magnetic|face cover)\b/i.test(p.title || '');
    case 'case': return !!s.size || /\b(case|tower|chassis)\b/i.test(p.title || '');
    default: return true;
  }
}

/** Parts a build is made of - the only categories fitsSlot() judges. */
const BUILD_SUBS = new Set(['gpu', 'cpu', 'motherboard', 'ram', 'storage', 'psu', 'cooling', 'case']);

/* ---------------------------------------------------------------------------
 * Too cheap to be real
 *
 * A listing priced at half what every other shop charges for the same thing
 * is a mislabelled accessory, a used part, a typo, or a scam - and it is
 * exactly the listing a cost-minded builder is drawn to. Each part is
 * compared with others like it (the same graphics chip, the same processor
 * class, the same wattage and so on) and set aside when it costs less than
 * half of what they typically do. Only where there are enough others to
 * compare with; a one-off is left alone.
 * ------------------------------------------------------------------------ */

function peerKey(p) {
  const s = p.specs || {};
  switch (p.sub) {
    case 'gpu': return s.chipset ? `gpu:${String(s.chipset).toUpperCase()}` : null;
    // By model number, not by class: a class lumps a 79 JOD Ryzen 5 5500 in
    // with processors that cost twice as much, and calls the 5500 a fake.
    case 'cpu': {
      const m = String(p.title || '').toUpperCase().match(/\b(?:I[3579][\s-]?|ULTRA\s*[3579]\s*|RYZEN\s*[3579]\s*(?:PRO\s*)?)(\d{3,5}[A-Z0-9]*)\b/);
      return m ? `cpu:${m[1]}` : null;
    }
    case 'psu': return s.wattage ? `psu:${Math.round(s.wattage / 100) * 100}` : null;
    case 'ram': return s.capacity && s.ddr ? `ram:${s.ddr}:${s.capacity}` : null;
    case 'storage': return s.capacity && s.type ? `storage:${s.type}:${s.capacity >= 1900 ? 2048 : s.capacity >= 900 ? 1024 : s.capacity >= 450 ? 512 : 256}` : null;
    default: return null;
  }
}

const suspectCache = new WeakMap();

/** Listings to keep out of builds for being implausibly cheap. */
export function suspiciouslyCheap(products) {
  if (suspectCache.has(products)) return suspectCache.get(products);
  const groups = new Map();
  for (const p of products) {
    if (!BUILD_SUBS.has(p.sub) || !(p.price > 0)) continue;
    const k = peerKey(p);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  const out = new Set();
  for (const list of groups.values()) {
    if (list.length < 3) continue;
    const prices = list.map((p) => p.price).sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)];
    for (const p of list) if (p.price < median * 0.5) out.add(p.id);
  }
  // A card from a fast family at a price no such card sells for.
  for (const p of products) {
    if (p.sub === 'gpu' && gpuClass(p.specs) >= 40 && p.price < 150) out.add(p.id);
  }
  suspectCache.set(products, out);
  return out;
}

/**
 * Best value inside a budget.
 *
 * Two things matter and they pull against each other: how much part you get,
 * and not wasting money. Capability leads, because a build that spends its
 * whole graphics budget on a display adapter is worse than one that spends
 * half of it on a real card.
 */
function rank(list, ceiling, sub = null, { avoid = null, jitter = null } = {}) {
  const affordable = list.filter((p) => p.price <= ceiling);
  const pool = affordable.length ? affordable : list;

  // Scored once: a jittered score has to stay the same for the whole sort.
  const scores = new Map(pool.map((p) => [p, score(p)]));
  return [...pool].sort((a, b) => scores.get(b) - scores.get(a) || a.price - b.price);

  function score(p) {
    const able = sub ? capability(sub, p) : 50;
    // What was already shown in this conversation gives way to an equal
    // alternative - asked for a second build, a shopper should not be handed
    // the same case and cooler as the first. Only the parts where there are
    // many near-equal choices; a better graphics card is never passed over
    // for the sake of looking different.
    const taste = sub === 'case' || sub === 'cooling';
    const seen = avoid?.has(p.id) ? (taste ? 14 : sub === 'storage' || sub === 'psu' ? 5 : 0) : 0;
    const wobble = taste && jitter ? jitter() * 8 : 0;
    // Using the budget counts for something - a part that costs more usually
    // is more - but only a little. It used to be worth 18 points against a
    // capability difference of about 7, so a dearer, slower graphics card
    // could win, and a 1,500 JOD build came back with a worse card than a
    // 1,200 JOD one. What the part actually is has to dominate.
    //
    // And the same part for more money is not more part. With using the budget
    // worth 7 points, an ASUS RTX 3050 at 249 beat an identical Gigabyte RTX
    // 3050 at 199, and the 50 JOD that could have bought a real processor went
    // on a sticker. Extras now only break ties between near-equals, and an
    // exact tie goes to the cheaper listing.
    const use = Math.min(p.price / ceiling, 1);
    return able * 1.6
      - seen + wobble
      + (taste ? use * 4 : 0)
      + Math.min(p.off, 30) * 0.03
      + (p.brand ? 0.5 : 0)
      + Math.min(Object.keys(p.specs || {}).length, 6) * 0.1
      + (p.image ? 0.4 : 0);
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

// How much a point of capability is worth in each part, for a machine bought
// to play games on. Used both to spend spare money and to decide what to cut.
export const UPGRADE_WEIGHT = {
  gpu: 3, cpu: 1.6, ram: 1.2, monitor: 1, storage: 0.8, psu: 0.5, cooling: 0.4, case: 0.3, motherboard: 0.2,
};

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
function pickPlatform(products, ceiling, ramCost = () => 0, ramAllowance = Infinity) {
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
      // A DDR5 board is a cheap board that makes the memory dear: 16GB of
      // DDR5 costs nearly twice what DDR4 does here. Pricing the pair alone
      // put a DDR5 board in a 1,000 JOD build and left 8GB of memory in it.
      if (ramCost(board.specs.memory) > ramAllowance) continue;
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

/* ---------------------------------------------------------------------------
 * Adjusting a machine that already exists
 *
 * Both of these change the parts in `chosen` in place, one part at a time,
 * and never break what makes the machine work: the processor stays on the
 * board's socket, the memory stays the board's type, and the supply stays big
 * enough for the card. buildPC uses them to land on its budget; the assistant
 * uses them to move a build it has already shown up or down without starting
 * again - which is what kept an i7 an i7 when someone asked for more money
 * to go on the graphics card.
 * ------------------------------------------------------------------------ */

/** What each slot will accept, given the rest of the machine as it is now. */
export function fitsWith(chosen) {
  const need = (chosen.gpu ? gpuWatts(chosen.gpu.specs) : 0) + 150;
  const boardMem = chosen.motherboard?.specs?.memory;
  return {
    ram: (p) => isDesktopRam(p) && (!boardMem || !p.specs?.ddr || p.specs.ddr === boardMem),
    psu: (p) => (p.specs?.wattage || 0) >= need,
    cpu: (p) => !chosen.motherboard || p.specs?.socket === chosen.motherboard.specs?.socket,
    motherboard: (p) => (!chosen.cpu || p.specs?.socket === chosen.cpu.specs?.socket)
      && (!chosen.ram?.specs?.ddr || p.specs?.memory === chosen.ram.specs.ddr),
  };
}

const spentOn = (chosen) => Object.values(chosen).reduce((sum, x) => sum + (x?.price || 0), 0);

/**
 * Cut until the machine costs no more than `budget`.
 *
 * Each cut is the one that costs the machine least for the money it frees.
 * It used to be "the dearest part first", and the dearest part is nearly
 * always the graphics card: a 1,500 JOD build that came in a little over gave
 * up its RX 9070 for a slower card while a 309 JOD processor and a 59 JOD
 * water cooler stayed exactly as they were.
 */
export function trimTo(products, chosen, budget, { locked = new Set() } = {}) {
  for (let guard = 0; guard < 80; guard++) {
    const total = spentOn(chosen);
    if (total <= budget) return true;
    const over = total - budget;
    const fits = fitsWith(chosen);

    let cut = null;
    // Two passes. The first refuses to take memory below 16GB, because it is
    // usually the dearest part left once the graphics card is spoken for, and
    // trimming it first is how a machine built around a named card ended up
    // with 8GB. Only if nothing else will give way does the second allow it.
    for (const lastResort of [false, true]) {
      for (const [sub, current] of Object.entries(chosen)) {
        if (!current || locked.has(sub)) continue;
        const ok = fits[sub] || (() => true);
        const now = capability(sub, current);
        for (const x of products) {
          if (x.sub !== sub || x.price >= current.price || !ok(x)) continue;
          if (sub === 'ram' && !lastResort && (current.specs?.capacity || 0) >= 16 && (x.specs?.capacity || 0) < 16) continue;
          const freed = Math.min(current.price - x.price, over);
          const loss = Math.max(0, now - capability(sub, x)) * (UPGRADE_WEIGHT[sub] || 1);
          const cost = loss / freed;
          if (!cut || cost < cut.cost || (cost === cut.cost && freed > cut.freed)) cut = { sub, product: x, cost, freed };
        }
      }
      if (cut) break;
    }
    if (!cut) return spentOn(chosen) <= budget;
    chosen[cut.sub] = cut.product;
  }
  return spentOn(chosen) <= budget;
}

/**
 * Spend what is left.
 *
 * Every part is picked against a fixed share of the budget, and there was a
 * trim loop for going over but nothing for coming in under. So when the
 * graphics allowance stopped just short of the next card up, the money simply
 * went unspent: a 2,200 JOD build came back identical to a 1,700 one with 218
 * JOD left over, which is not the build someone asked for.
 *
 * Repeatedly buy the single best upgrade available - the one gaining the most
 * weighted capability per dinar - until nothing worthwhile fits. Only ever an
 * improvement: no part is swapped for a weaker one here.
 */
export function spendUpTo(products, chosen, budget, { locked = new Set() } = {}) {
  const ORDER = ['gpu', 'cpu', 'ram', 'monitor', 'storage', 'psu', 'cooling', 'case'];
  for (let guard = 0; guard < 24; guard++) {
    const spare = budget - spentOn(chosen);
    // Chasing the last few dinars just churns the build for no real gain.
    if (spare < Math.max(25, budget * 0.02)) break;
    const fits = fitsWith(chosen);

    let best = null;
    for (const sub of ORDER) {
      const current = chosen[sub];
      if (!current || locked.has(sub)) continue;
      const ok = fits[sub] || (() => true);
      const now = capability(sub, current);

      for (const x of products) {
        if (x.sub !== sub || !ok(x)) continue;
        let extra = x.price - current.price;
        if (extra <= 0) continue;
        const gain = capability(sub, x) - now;
        if (gain <= 0) continue;
        // A bigger card may need a bigger supply, and that is part of its cost.
        let psu = null;
        if (sub === 'gpu' && (chosen.psu?.specs?.wattage || 0) < gpuWatts(x.specs) + 150) {
          psu = products
            .filter((q) => q.sub === 'psu' && (q.specs?.wattage || 0) >= gpuWatts(x.specs) + 150)
            .sort((m, n) => m.price - n.price)[0];
          if (!psu) continue;
          extra += Math.max(0, psu.price - (chosen.psu?.price || 0));
        }
        if (extra > spare) continue;
        // Per-dinar, so a small sensible step beats a huge indulgent one - but
        // weighted, because measuring purely per-dinar always bought the cheap
        // upgrade. A better screen would win over a better card every time,
        // which is not how anyone spends money on a gaming PC.
        const worth = (gain * (UPGRADE_WEIGHT[sub] || 1)) / extra;
        if (!best || worth > best.worth) best = { sub, product: x, worth, psu };
      }
    }

    if (!best) break;
    chosen[best.sub] = best.product;
    if (best.psu) chosen.psu = best.psu;
  }
  return chosen;
}

/** Of options with a cost and a tier, only those better than every cheaper one. */
function frontier(list) {
  const out = [];
  for (const o of [...list].sort((a, b) => a.cost - b.cost || b.tier - a.tier)) {
    if (!out.length || o.tier > out[out.length - 1].tier) out.push(o);
  }
  return out;
}

/**
 * Put a whole machine together inside a budget.
 *
 * `withMonitor` adds a screen to the build. Asking for "a PC for 1700 with
 * the monitor" and getting eight parts and no screen back is not an answer to
 * the question that was asked, so the screen takes its own slice of the money
 * rather than being quietly dropped.
 */
export function buildPC(products, budget, { withMonitor = false, constraints = {}, avoid = null, jitter = null } = {}) {
  const suspect = suspiciouslyCheap(products);
  products = products.filter((p) => !BUILD_SUBS.has(p.sub) || (fitsSlot(p) && !suspect.has(p.id)));
  const floor = floorPrice(products);
  const taste = { avoid, jitter };

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

  /* ------------------------------------------------------------------
   * The graphics card and the processor, chosen together.
   *
   * This used to hand each part a fixed share of the money and then spend
   * what was left one cheapest-gain-per-dinar step at a time. Both halves
   * were wrong for a gaming PC at a real budget. The shares ignored what
   * things actually cost here, and the step-by-step spending bought a nicer
   * SSD and a gold power supply for 20 JOD each before it ever reached the
   * 34 JOD that turns a Ryzen 3 into a Ryzen 5 - so a 600 JOD machine came
   * out with a quad-core from 2020 behind its graphics card.
   *
   * Now: every sensible graphics card is tried against every sensible
   * processor platform (processor, board and the memory that board takes),
   * with a proper SSD, a trustworthy power supply sized for that card, a case
   * and a cooler, and the best-balanced pair that fits the money wins. The
   * card counts most, because it decides frame rate; the processor has to be
   * good enough not to hold it back, and a pair where it would is marked
   * down hard.
   * ------------------------------------------------------------------ */
  const inSub = (sub) => products.filter((p) => p.sub === sub);
  const cheapest = (list) => list.reduce((a, b) => (!a || b.price < a.price ? b : a), null);

  // What every machine gets, scaled to the money - with a step down allowed
  // for each, at a cost. A 256GB SSD instead of 512GB is a small loss; the
  // RTX 3050 it pays for, over a GTX 1650, is a big gain. Fixing the sizes
  // made that trade impossible and a 600 JOD build missed the better card by
  // three dinars.
  const wantRam = forParts >= 1400 ? 32 : 16;
  const wantDisk = forParts >= 1800 ? 2048 : forParts >= 750 ? 1024 : 512;
  const disks = inSub('storage');
  const diskOf = (gb) => cheapest(disks.filter((p) => /nvme/i.test(p.specs?.type || '') && (p.specs?.capacity || 0) >= gb * 0.93))
    || cheapest(disks.filter((p) => (p.specs?.capacity || 0) >= gb * 0.93));
  const diskChoices = [
    { disk: diskOf(wantDisk), penalty: 0 },
    // 512GB fills up fast once a few modern games are installed.
    { disk: diskOf(wantDisk / 2), penalty: wantDisk >= 1024 ? 6 : 3 },
  ].filter((d) => d.disk);
  if (!diskChoices.length && disks.length) diskChoices.push({ disk: cheapest(disks), penalty: 8 });

  const box = rank(inSub('case').filter((p) => capability('case', p) >= 40), Math.max(35, forParts * 0.045), 'case', taste)[0]
    || cheapest(inSub('case'));
  const coolers = inSub('cooling');

  const kitOf = (ddr, gb) => cheapest(inSub('ram').filter((p) => p.specs?.ddr === ddr && (p.specs?.capacity || 0) >= gb));
  const ramChoices = [[wantRam, 0], ...(wantRam > 16 ? [[16, 3]] : [])];

  // Processor platforms: the cheapest way to get each class of processor
  // running - board, memory and a cooler included.
  const boardFor = new Map();
  for (const b of inSub('motherboard')) {
    const k = `${b.specs.socket}|${b.specs.memory}`;
    if (!boardFor.has(k) || b.price < boardFor.get(k).price) boardFor.set(k, b);
  }
  const plainCooler = cheapest(coolers.filter((p) => capability('cooling', p) >= 40)) || cheapest(coolers);
  const strongCooler = cheapest(coolers.filter((p) => capability('cooling', p) >= 55)) || plainCooler;

  const platforms = [];
  for (const [gb, penalty] of ramChoices) {
    const best = new Map();
    for (const cpu of inSub('cpu')) {
      const tier = cpuClass(cpu);
      const cooler = tier >= 58 ? strongCooler : plainCooler;
      for (const ddr of ['DDR4', 'DDR5']) {
        const board = boardFor.get(`${cpu.specs.socket}|${ddr}`);
        const ram = kitOf(ddr, gb);
        if (!board || !ram) continue;
        const cost = cpu.price + board.price + ram.price + (cooler?.price || 0);
        if (!best.has(tier) || cost < best.get(tier).cost) best.set(tier, { cpu, board, ram, cooler, tier, cost, penalty });
      }
    }
    platforms.push(...frontier(best.values()));
  }

  // Graphics: the cheapest listing of each chip, with a supply that can run it.
  const psus = inSub('psu');
  const psuFor = (watts) => cheapest(psus.filter((p) => (p.specs?.wattage || 0) >= watts && capability('psu', p) >= 50))
    || cheapest(psus.filter((p) => (p.specs?.wattage || 0) >= watts));
  const cards = new Map();
  for (const g of wanted ? [wanted] : inSub('gpu')) {
    const k = String(g.specs?.chipset || g.id).toUpperCase();
    if (!cards.has(k) || g.price < cards.get(k).gpu.price) cards.set(k, { gpu: g, tier: gpuClass(g.specs) });
  }
  for (const c of cards.values()) {
    c.psu = psuFor(gpuWatts(c.gpu.specs) + 150 + (c.tier >= 80 ? 100 : 0));
    c.cost = c.psu ? c.gpu.price + c.psu.price : Infinity;
  }
  const gpus = frontier([...cards.values()].filter((c) => Number.isFinite(c.cost)));

  // The card counts most, because it decides frame rate. The processor has to
  // be at least about three quarters of the card's class, or the card sits
  // waiting on it - a pair like that is marked down hard.
  const scoreOf = (g, p, d) => {
    const held = Math.max(0, g.tier * 0.75 - p.tier);
    return g.tier + p.tier * 0.5 - held * 1.5 - p.penalty - d.penalty;
  };

  let pick = null;
  for (const d of diskChoices) {
    const fixed = d.disk.price + (box?.price || 0);
    for (const g of gpus) {
      for (const p of platforms) {
        const cost = g.cost + p.cost + fixed;
        if (cost > forParts) continue;
        const score = scoreOf(g, p, d);
        if (!pick || score > pick.score || (score === pick.score && cost < pick.cost)) pick = { g, p, d, cost, score };
      }
    }
  }
  // Nothing fits: the cheapest real machine, and the trim below does the rest.
  if (!pick) {
    const g = gpus[0];
    const p = [...platforms].sort((a, b) => a.cost - b.cost)[0];
    const d = diskChoices[diskChoices.length - 1];
    if (!g || !p || !d) return { ok: false, reason: 'too-low', floor, budget };
    pick = { g, p, d };
  }

  Object.assign(chosen, {
    gpu: pick.g.gpu,
    psu: pick.g.psu,
    cpu: pick.p.cpu,
    motherboard: pick.p.board,
    ram: pick.p.ram,
    cooling: pick.p.cooler,
    storage: pick.d.disk,
    case: box,
  });
  for (const [sub, p] of Object.entries(chosen)) if (!p) delete chosen[sub];

  // Nothing above guarantees the total fits, so trim until it does, then
  // spend whatever is left. A card the question named is locked in both.
  const locked = new Set(wanted ? ['gpu'] : []);
  trimTo(products, chosen, budget, { locked });
  spendUpTo(products, chosen, budget, { locked });

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

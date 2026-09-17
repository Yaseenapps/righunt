// Changing a build that has already been shown.
//
// "A better graphics card", "a faster processor", "more storage", "make it
// cheaper" - said straight after a build, each of these is about THAT machine.
// Answering by building a new machine from nothing lets the builder rebalance
// everything, and it did: asked for a better card, it paid for one by quietly
// swapping the i7 for an i3. Nobody asking to change one part expects the
// others to move.
//
// So a change starts from the parts on screen and touches only what it has
// to: the part asked about, plus a knock-on change only when the machine
// would not work without it (a bigger supply for a hungrier card, a new board
// when a faster processor needs a different socket).

import { capability, fitsSlot, fitsWith, suspiciouslyCheap, gpuClass, gpuWatts, checkCompatibility, trimTo, spendUpTo } from './builder.js';

const LABEL = {
  gpu: 'Graphics card', cpu: 'Processor', motherboard: 'Motherboard', ram: 'Memory',
  storage: 'Storage', psu: 'Power supply', case: 'Case', cooling: 'Cooling', monitor: 'Monitor',
};

const NAME = {
  gpu: 'graphics card', cpu: 'processor', motherboard: 'motherboard', ram: 'memory',
  storage: 'storage', psu: 'power supply', case: 'case', cooling: 'cooler', monitor: 'monitor',
};

/** A short, readable name for a part: the chip where there is one. */
export function partName(sub, p) {
  if (!p) return 'nothing';
  const s = p.specs || {};
  if (sub === 'gpu' && s.chipset) return s.chipset;
  if (sub === 'ram' && s.capacity) return `${s.capacity}GB ${s.ddr || ''}`.trim();
  if (sub === 'storage' && s.capacity) return `${s.capacity >= 1024 ? `${Math.round(s.capacity / 1024)}TB` : `${s.capacity}GB`} ${s.type || ''}`.trim();
  if (sub === 'psu' && s.wattage) return `${s.wattage}W`;
  if (sub === 'cpu') {
    const model = p.title.match(/\b(i[3579][\s-]?\d{4,5}[a-z]*|ryzen\s*[3579]\s*\d{4}[a-z0-9]*|ultra\s*[3579]\s*\d{3}[a-z]*)\b/i)?.[0];
    if (model) return (/^ryzen/i.test(model) ? `Ryzen ${model.replace(/^ryzen\s*/i, '')}` : `Core ${model}`).replace(/\s+/g, ' ');
  }
  // Otherwise the brand and model: the first few words, before any spec list.
  return p.title.split(/\s[-–|(]\s?|,|\s(?=\d+(gb|mm|w)\b)/i)[0].split(/\s+/).slice(0, 4).join(' ');
}

const usable = (products) => {
  const suspect = suspiciouslyCheap(products);
  return products.filter((p) => p.price > 0 && fitsSlot(p) && !suspect.has(p.id));
};

/**
 * The graphics chip one clear step faster, or slower, than the one given - by
 * real speed, among cards actually in stock.
 *
 * "One step" is the whole point. Asked for "better" with nothing to measure
 * against, the answer is the fastest card that exists; measured against the
 * card already in the build, it is the next one up, at a price that still
 * makes sense next to everything else in the machine.
 */
export function gpuStep(products, fromChipset, direction, fromPrice = 0) {
  if (!fromChipset) return null;
  const current = gpuClass({ chipset: fromChipset });

  const chips = new Map();
  for (const p of products) {
    if (p.sub !== 'gpu' || !p.specs?.chipset || !(p.price > 0)) continue;
    const tier = gpuClass(p.specs);
    if (tier < 12) continue;
    const c = chips.get(p.specs.chipset);
    if (!c || p.price < c.from) chips.set(p.specs.chipset, { chipset: p.specs.chipset, tier, from: p.price });
  }

  // A step has to be one somebody would notice. The very next card on the
  // ranking is often a sidegrade - "better than an RTX 5060" landed on an older
  // RTX 4060 Ti, four points quicker and no real improvement.
  const MIN_STEP = 6;
  const ladder = [...chips.values()];
  const pickFrom = (list, up) => list.sort((a, b) => (up ? a.tier - b.tier : b.tier - a.tier) || a.from - b.from)[0];

  // An upgrade that costs less than the card it replaces is usually old stock
  // that ranks well on speed and badly on everything else.
  const notCheaper = (c) => !fromPrice || c.from >= fromPrice * 0.95;

  if (direction === 'better') {
    return pickFrom(ladder.filter((c) => c.tier >= current + MIN_STEP && notCheaper(c)), true)
      || pickFrom(ladder.filter((c) => c.tier >= current + MIN_STEP), true)
      || pickFrom(ladder.filter((c) => c.tier > current), true)
      || null;
  }
  return pickFrom(ladder.filter((c) => c.tier <= current - MIN_STEP && c.from < fromPrice), false)
    || pickFrom(ladder.filter((c) => c.tier < current), false)
    || null;
}

/** Does this chipset name the same card as that one? "RTX 5070" is not "RTX 5070 Ti". */
function sameChip(a, b) {
  const norm = (x) => String(x || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const A = norm(a);
  const B = norm(b);
  if (A === B) return true;
  const digits = A.match(/\d{3,4}/)?.[0];
  if (!digits || !B.includes(digits)) return false;
  const tail = (x) => x.replace(/.*\d{3,4}\s*/, '').trim();
  return tail(A) === tail(B);
}

/**
 * The next thing up (or down) in one category, for a part that is not a
 * graphics card. A clear step rather than the next listing along - otherwise
 * "better memory" can mean the same kit in a different colour.
 */
function stepOf(sub, pool, current, direction) {
  const now = capability(sub, current);
  const s = current.specs || {};

  if (direction === 'better') {
    let options;
    if (sub === 'ram') {
      options = pool.filter((p) => (p.specs?.capacity || 0) > (s.capacity || 0));
      if (!options.length) options = pool.filter((p) => (p.specs?.capacity || 0) === (s.capacity || 0) && (p.specs?.speed || 0) > (s.speed || 0) && p.price > current.price);
      return options.sort((a, b) => (a.specs.capacity - b.specs.capacity) || a.price - b.price)[0] || null;
    }
    if (sub === 'storage') {
      options = pool.filter((p) => (p.specs?.capacity || 0) > (s.capacity || 0)
        || ((p.specs?.capacity || 0) === (s.capacity || 0) && /nvme/i.test(p.specs?.type || '') && !/nvme/i.test(s.type || '')));
      return options.sort((a, b) => (a.specs.capacity - b.specs.capacity) || a.price - b.price)[0] || null;
    }
    if (sub === 'cpu') {
      // A real step: another six points is roughly a tier (i5 to i7, or a
      // generation newer at the same tier), not two more threads.
      options = pool.filter((p) => capability(sub, p) >= now + 6 && p.price >= current.price * 0.95);
      if (!options.length) options = pool.filter((p) => capability(sub, p) > now);
      return options.sort((a, b) => (capability(sub, a) - capability(sub, b)) || a.price - b.price)[0] || null;
    }
    // Power supplies, coolers, cases, boards, screens: more capable, or the
    // same class at a noticeably better price point.
    options = pool.filter((p) => capability(sub, p) > now && p.price > current.price);
    if (sub === 'psu') options = options.filter((p) => (p.specs?.wattage || 0) >= (s.wattage || 0));
    if (options.length) return options.sort((a, b) => (capability(sub, a) - capability(sub, b)) || a.price - b.price)[0];
    options = pool.filter((p) => capability(sub, p) >= now && p.price >= current.price * 1.25);
    return options.sort((a, b) => a.price - b.price)[0] || null;
  }

  // Cheaper: the best thing that costs clearly less, without falling off a
  // cliff - memory stays at 16GB and storage at 500GB where the build had them.
  let options = pool.filter((p) => p.price <= current.price * 0.9);
  if (sub === 'ram' && (s.capacity || 0) >= 16) options = options.filter((p) => (p.specs?.capacity || 0) >= 16);
  if (sub === 'storage' && (s.capacity || 0) >= 500) options = options.filter((p) => (p.specs?.capacity || 0) >= 500);
  return options.sort((a, b) => (capability(sub, b) - capability(sub, a)) || b.price - a.price)[0] || null;
}

function result(parts, chosen, changed, extra = {}) {
  const list = parts
    .map((p) => ({ ...p, product: chosen[p.sub] }))
    .filter((p) => p.product)
    .sort((a, b) => b.product.price - a.product.price);
  const total = list.reduce((s, x) => s + x.product.price, 0);
  return {
    ok: true,
    parts: list,
    total,
    budget: total,
    leftover: 0,
    overBudget: false,
    problems: checkCompatibility(chosen),
    stores: [...new Set(list.map((x) => x.product.storeName))],
    changed,
    ...extra,
  };
}

/**
 * Change one part of a shown build.
 *
 * `parts` is the build as shown ({ sub, label, product }[]). `sub` is the part
 * to change; `direction` is 'better' or 'cheaper'; `chipset` names an exact
 * graphics card instead of a step.
 *
 * Returns a build shaped like buildPC()'s, plus `changed`: every part that
 * moved, from and to. Or { ok: false, reason } when there is no such step.
 */
export function changePart(products, parts, sub, { direction = 'better', chipset = null } = {}) {
  const pool = usable(products);
  const chosen = Object.fromEntries(parts.map((p) => [p.sub, p.product]));
  const current = chosen[sub];
  if (!current) return { ok: false, reason: 'not-in-build', sub };

  let next = null;

  if (sub === 'gpu') {
    let chip = chipset;
    if (!chip) {
      const step = gpuStep(pool, current.specs?.chipset, direction, current.price);
      if (!step) return { ok: false, reason: direction === 'better' ? 'top' : 'bottom', sub };
      chip = step.chipset;
    }
    // The cheapest listing of that chip: the step is the chip, not the brand.
    next = pool.filter((p) => p.sub === 'gpu' && sameChip(p.specs?.chipset, chip))
      .sort((a, b) => a.price - b.price)[0];
    if (!next) return { ok: false, reason: 'missing', sub, chipset: chip };
    if (next.id === current.id) return { ok: false, reason: 'same', sub };
  } else {
    const fits = fitsWith(chosen)[sub] || (() => true);
    const sameSlot = pool.filter((p) => p.sub === sub && p.id !== current.id);
    next = stepOf(sub, sameSlot.filter(fits), current, direction);

    // A faster processor that needs a different socket: move the board with
    // it, and the memory only if the new board takes another kind.
    if (!next && sub === 'cpu' && direction === 'better') {
      return changePlatform(pool, parts, chosen, current);
    }
    if (!next) return { ok: false, reason: direction === 'better' ? 'top' : 'bottom', sub };
  }

  const changed = [{ sub, from: current, to: next }];
  chosen[sub] = next;

  // A hungrier card needs the supply to keep up. Nothing else moves.
  if (sub === 'gpu') {
    const need = gpuWatts(next.specs) + 150;
    if ((chosen.psu?.specs?.wattage || 0) < need) {
      const psu = pool.filter((p) => p.sub === 'psu' && (p.specs?.wattage || 0) >= need).sort((a, b) => a.price - b.price)[0];
      if (!psu) return { ok: false, reason: 'no-psu', sub };
      changed.push({ sub: 'psu', from: chosen.psu, to: psu });
      chosen.psu = psu;
    }
  }

  return result(parts, chosen, changed);
}

function changePlatform(pool, parts, chosen, currentCpu) {
  const now = capability('cpu', currentCpu);
  const cpus = pool.filter((p) => p.sub === 'cpu' && capability('cpu', p) >= now + 6)
    .sort((a, b) => (capability('cpu', a) - capability('cpu', b)) || a.price - b.price);

  for (const cpu of cpus) {
    const boards = pool.filter((p) => p.sub === 'motherboard' && p.specs?.socket === cpu.specs?.socket)
      .sort((a, b) => a.price - b.price);
    if (!boards.length) continue;
    const ddr = chosen.ram?.specs?.ddr;
    const board = boards.find((b) => b.specs?.memory === ddr) || boards[0];
    let ram = chosen.ram;
    if (board.specs?.memory !== ddr) {
      const want = Math.max(16, chosen.ram?.specs?.capacity || 0);
      ram = pool.filter((p) => p.sub === 'ram' && p.specs?.ddr === board.specs?.memory && (p.specs?.capacity || 0) >= want)
        .sort((a, b) => a.price - b.price)[0];
      if (!ram) continue;
    }
    const changed = [
      { sub: 'cpu', from: currentCpu, to: cpu },
      { sub: 'motherboard', from: chosen.motherboard, to: board },
    ];
    if (ram !== chosen.ram) changed.push({ sub: 'ram', from: chosen.ram, to: ram });
    Object.assign(chosen, { cpu, motherboard: board, ram });
    return result(parts, chosen, changed, { platformChanged: true });
  }
  return { ok: false, reason: 'top', sub: 'cpu' };
}

/**
 * The same build moved to a new budget.
 *
 * More money is spent on upgrades to the parts already there - nothing is
 * swapped for anything weaker, so a bigger budget can never cost the build its
 * processor. Less money is found by the cuts that hurt least. Returns null
 * when the new figure is out of reach without starting again.
 */
export function rebudget(products, parts, budget) {
  const pool = usable(products);
  const chosen = Object.fromEntries(parts.map((p) => [p.sub, p.product]));
  const before = { ...chosen };
  const total = parts.reduce((s, p) => s + p.product.price, 0);

  if (budget >= total) spendUpTo(pool, chosen, budget);
  else if (!trimTo(pool, chosen, budget)) return null;

  const changed = Object.keys(chosen)
    .filter((sub) => chosen[sub]?.id !== before[sub]?.id)
    .map((sub) => ({ sub, from: before[sub], to: chosen[sub] }));
  const out = result(parts, chosen, changed);
  out.budget = budget;
  out.leftover = budget - out.total;
  return out;
}

/** "the graphics card from RTX 5060 to RTX 5070; the power supply from 550W to 750W" */
export function describeChanges(changed) {
  return changed.map((c) => `the ${NAME[c.sub] || c.sub} from ${partName(c.sub, c.from)} to ${partName(c.sub, c.to)}`).join('; ');
}

export { LABEL as PART_LABELS, NAME as PART_NAMES };

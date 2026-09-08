// Regression tests for the classifier.
//
// Every case here is a real product title from one of the shops that was
// filed in the wrong category at some point. The shops that hand us a
// category path hid most of these; City Center does not publish one, so the
// title has to carry the product on its own.
//
// Run with: node scripts/test-taxonomy.mjs
import { classify, sanitize, extractSpecs, isHidden } from '../scraper/lib/taxonomy.js';
import { parsePrice } from '../scraper/lib/text.js';

const CASES = [
  // [expected sub, title, why it used to go wrong]
  ['gpu', 'GIGABYTE Radeon RX 7800 XT Gaming OC 16G Graphics Card, 3x WINDFORCE Fans',
    'cards advertise their fans, and "fans" vetoed the graphics-card rule'],
  ['gpu', 'MSI GeForce RTX 5060 Ti GAMING OC 8GB GDDR7 128-Bit Memory Graphics Card'],
  ['gpu', 'ASUS Dual GeForce RTX 4060 Ti OC Edition 8GB GDDR6 Video Card'],
  ['cooling', 'Thermalright Frozen Magic 360 Scenic V2 Water CPU Cooler ARGB'],
  ['cooling', 'Xigmatek SC RGB Fan Controller For 8 Devices',
    '"controller" made it a gamepad'],

  ['monitor', 'MSI PRO MP273AP 27" IPS Full HD 100Hz Less Blue Light Monitor with Built-in Speakers',
    '"speakers" and "blue light" both vetoed the monitor rule'],
  ['monitor', 'ASUS ROG Swift PG42UQ 42" 4K OLED 138Hz 0.1ms HDMI 2.1 Gaming Monitor',
    '"Swift" is an Acer laptop line, so this became a gaming laptop'],
  ['monitor', 'Samsung Odyssey G8 G80HF 27-inch IPS 5K 180 Hz Gaming Monitor'],
  ['speakers', 'Redragon GS520 Anvil RGB Desktop Gaming Speakers'],

  ['case', 'DeepCool CL6600 Computer Case, Pre-installed 360mm ARGB Liquid Cooler, Tempered Glass',
    'the bundled cooler vetoed the case rule'],
  ['case', 'LIAN LI Lancool 216RX MESH High Airflow ARGB Mesh Front Panel Mid Tower PC Case',
    'the mesh front panel vetoed the case rule'],
  ['case', 'GameMax G563 Mid-Tower ATX Gaming Case BK'],

  ['headset', 'Razer Kraken V3 HyperSense Wired USB RGB Gaming Headset with Microphone',
    'the mention of its microphone won over the word headset'],
  ['microphone', 'Yanmai Q3B USB Condenser Microphone for Streaming'],

  ['motherboard', 'ASUS B650E MAX GAMING WIFI ATX AM5 Motherboard with Wi-Fi 6E & 2.5Gb Ethernet'],
  ['cpu', 'AMD RYZEN 5 7500F 6-Core 3.7GHz (5.0 GHz Max Boost) Socket AM5 Processor'],
  ['ram', 'Kingston FURY Beast 32GB (1 x 32GB) 5600MHz DDR5 RAM'],
  ['storage', 'Kingston NV3 2TB M.2 2280 NVMe PCIe Gen 4x4 Internal SSD'],
  ['psu', 'Thermalright TG-1000-W 1000W 80 PLUS Gold Full-Modular Power Supply'],
  ['keyboard', 'Logitech G510S Wired USB Gaming Keyboard'],
  ['mouse', 'Razer Basilisk V3 Pro 35K Wireless Gaming Mouse'],
  ['chair', 'Razer Iskur Gaming Chair Multi-Layer Synthetic Leather'],
  ['prebuilt', 'POWER BY ASUS POWER 107 Performance Gaming PC w/ 12Gen Intel Core i5-12400F, RTX 4060, Air Cooler'],
  ['gaming-laptop', 'ASUS ROG Strix G16 (2025) G614PR 9Gen AMD Ryzen 9 RTX 5060 16-inch 165Hz'],

  // "Switch" means three different things across these shops.
  ['console', 'Nintendo Switch OLED Model Console White'],
  ['controller', 'Nintendo Switch 2 Joy-Con Controller Pair'],
  ['networking', 'TP-Link TL-SG2428P Jetstream 24 Port Gigabit Smart Managed PoE Switch',
    'a network switch was filed under console accessories'],
  ['networking', 'TP-Link TL-SG1008D 8-Port Gigabit Desktop Switch'],
  ['other', 'TP-Link Tapo Smart Light Switch 1 Gang 1 Way S210',
    'a smart light switch reached the Console aisle'],

  // A build sheet is a whole computer, not the parts it lists.
  ['prebuilt', 'INTEL CORE I5 12400F // GT 1030 2GB // 8GB RAM - Low Budget Build',
    'the graphics model in the middle won, so a whole PC sat in Graphics Cards - and the assistant bought one as a card'],
  ['prebuilt', 'CC Power 9070XT-108 Gaming PC Ryzen 7 9800X3D RX 9070 XT 32GB DDR5 1TB SSD'],

  // Phones quote memory and storage exactly the way a memory kit does.
  ['other', 'Oppo A5 CPH2727 APAC 256GB 8GB RAM - Multicolor',
    'this phone was picked as the memory in a 1,700 JOD build'],
  ['other', 'Samsung Galaxy A16 128GB 6GB RAM Blue Smartphone'],
  ['other', 'CX08 Pro Cell Phone Type-C Magnetic Fan Powerful and Quiet Cooling',
    'a clip-on phone cooler was sitting in Cooling & Fans'],
  // Earbuds stay: Headsets & Audio already holds Anker and Skullcandy, and
  // people do game with them. Only PC-part aisles reject phone kit.
  ['headset', 'Anker Soundcore V40i Open-Ear Wireless Headphones'],

  // Manufacturers reuse the same name for different things.
  ['gpu', 'XFX Swift AMD Radeon RX 9060 XT OC Triple Fan Gaming Edition 16GB Graphics Card',
    '"Swift" is an Acer laptop line, so this card was sold as a gaming laptop'],
  ['gaming-laptop', 'Acer Swift X 14 Gaming Laptop RTX 4050 Core i7',
    'and the rule for ROG Swift monitors sent every Acer Swift into Monitors'],
  ['gaming-laptop', 'Lenovo IdeaPad Gaming 3 Ryzen 5 5600H RTX 3050',
    'a laptop whose family was not in one hand-written list became a desktop'],

  // City Center's spec tables describe what a cooler fits, not what it is.
  ['cooling', 'DeepCool FK120 3x 120mm 1850RPM 69CFM 4-Pin PWM High Performance Fan'],
  ['other', 'DeepCool Fan Hub Control 4PWM Fan Speed Supports Fan 3Pin/4Pin'],
  ['other', 'IOGEAR GUC2015V USB 2.0 External VGA Video Card',
    'a USB display dongle is not a graphics card'],
  ['other', 'Kingston HyperX Replacement Mic For Cloud Revolver'],
  ['other', 'ONIKUMA L7 RGB Home Karaoke Machine Bluetooth-compatible Speaker'],
  ['other', 'Dobe Controller Decorative Grip for Switch 2'],
  ['controller', 'Sony DualSense Wireless Controller for PlayStation 5 - White'],

  // Things that must NOT reach a browsable category.
  ['networking', 'Mercusys MR60X AX1500 Wi-Fi 6 Router, Dual-Band'],
];

/** Prices printed twice by a shop's theme must not be read as one number. */
const PRICES = [
  [1299, 'JOD 1,299.00'],
  [159.5, '159.500 د.ا'],
  [295, '295 JOD 295 JOD'],
  [139, '139 JOD139 JOD'],
  [475, '475 JOD'],
  [1.5, '1,50'],
];

/**
 * Capacity has to come from the product's own name. Descriptions list the
 * other models in the range and the drive's endurance rating, and reading
 * across both made a 250GB drive look like 2TB and a 240GB drive 94,208GB.
 */
const CAPACITIES = [
  [250, 'Wd black sn750 nvme m.2 2280 250gb', 'Also in 500GB, 1TB and 2TB. Endurance 200TBW.'],
  [240, 'Kingston A400 240GB SSD ( SA400S37/240G )', 'Total bytes written 92TBW.'],
  [1024, 'Kingston NV3 1TB PCIe 4.0 NVMe SSD M.2 2280', 'Up to 6000/4000 MB/s'],
  [2048, 'Samsung 990 PRO 2TB PCIe 4.0 NVMe M.2 SSD', ''],
  [4096, 'Seagate Barracuda 4TB 3.5 inch SATA Hard Drive', ''],
  [500, 'Crucial P3 Plus 500GB M.2 2280 NVMe SSD', ''],
];

let failed = 0;
for (const [want, title, why] of CASES) {
  const { sub, certain } = classify({ title });
  const got = certain ? sub : (sanitize(sub, title, extractSpecs(sub, title, '')) || sub);
  // "other" here means "must not be published". Which hidden bucket it lands
  // in - other, cables, networking - makes no difference to a visitor.
  if (got === want || (want === 'other' && isHidden(got))) continue;
  failed++;
  console.log(`FAIL  want ${want.padEnd(14)} got ${String(got).padEnd(14)} ${title.slice(0, 60)}`);
  if (why) console.log(`      (${why})`);
}

// The shop's own spec table must outrank the title, not merely tie with it.
const certainCase = classify({
  title: 'GIGABYTE Radeon RX 7800 XT Gaming OC 16G, 3x WINDFORCE Fans, Triple Fan Cooler',
  certain: 'gpu',
});
if (certainCase.sub !== 'gpu' || !certainCase.certain) {
  failed++;
  console.log(`FAIL  a certain sub was overruled: got ${certainCase.sub}`);
}

for (const [want, title, desc] of CAPACITIES) {
  const got = extractSpecs('storage', title, desc).capacity;
  if (got !== want) {
    failed++;
    console.log(`FAIL  capacity want ${want} got ${got}  ${title.slice(0, 52)}`);
  }
}

for (const [want, text] of PRICES) {
  const got = parsePrice(text);
  if (got !== want) { failed++; console.log(`FAIL  price want ${want} got ${got}  from ${JSON.stringify(text)}`); }
}

// Hidden categories are the ones we deliberately do not show.
for (const h of ['networking', 'cables', 'power', 'laptop', 'other']) {
  if (!isHidden(h)) { failed++; console.log(`FAIL  ${h} should be a hidden category`); }
}

const TOTAL = CASES.length + CAPACITIES.length + PRICES.length + 6;
console.log(failed ? `\n${failed} of ${TOTAL} checks failed` : `\nALL PASS - ${TOTAL} checks`);
process.exit(failed ? 1 : 0);

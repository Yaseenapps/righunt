// Category tree + product classification + spec extraction.
// Everything here works off text the retailer already published
// (title, store category path, description) - nothing is invented.

export const CATEGORIES = [
  {
    id: 'components', name: 'PC Components', icon: 'cpu',
    blurb: 'Build or upgrade your rig',
    subs: [
      { id: 'gpu',         name: 'Graphics Cards' },
      { id: 'cpu',         name: 'Processors' },
      { id: 'motherboard', name: 'Motherboards' },
      { id: 'ram',         name: 'Memory (RAM)' },
      { id: 'storage',          name: 'Storage (SSD & HDD)' },
      // Portable drives, memory cards and flash drives. Kept alongside
      // internal storage rather than hidden: a console or a handheld is
      // expanded with exactly these.
      { id: 'external-storage', name: 'External & Portable Storage' },
      { id: 'psu',         name: 'Power Supplies' },
      { id: 'case',        name: 'Cases' },
      { id: 'cooling',     name: 'Cooling & Fans' },
    ],
  },
  {
    id: 'prebuilt', name: 'Gaming PCs', icon: 'tower',
    blurb: 'Complete builds, ready to play',
    subs: [
      { id: 'prebuilt', name: 'Pre-Built PCs' },
    ],
  },
  {
    id: 'peripherals', name: 'Gaming Peripherals', icon: 'keyboard',
    blurb: 'Keyboards, mice, headsets and more',
    subs: [
      { id: 'keyboard',   name: 'Keyboards' },
      { id: 'mouse',      name: 'Mice' },
      { id: 'headset',    name: 'Headsets & Audio' },
      { id: 'mousepad',   name: 'Mousepads' },
      { id: 'controller', name: 'Controllers' },
      { id: 'microphone', name: 'Microphones' },
      { id: 'webcam',     name: 'Webcams & Streaming' },
      { id: 'speakers',   name: 'Speakers' },
    ],
  },
  {
    id: 'monitors', name: 'Monitors', icon: 'monitor',
    blurb: 'From 75Hz office panels to 360Hz esports',
    subs: [
      { id: 'monitor', name: 'Monitors' },
    ],
  },
  {
    id: 'laptops', name: 'Gaming Laptops', icon: 'laptop',
    blurb: 'Portable rigs with real graphics',
    subs: [
      { id: 'gaming-laptop', name: 'Gaming Laptops' },
    ],
  },
  {
    id: 'furniture', name: 'Setup', icon: 'chair',
    blurb: 'Chairs and desks',
    subs: [
      { id: 'chair', name: 'Gaming Chairs' },
      { id: 'desk',  name: 'Gaming Desks' },
    ],
  },
  {
    id: 'console', name: 'Console', icon: 'gamepad',
    blurb: 'PlayStation, Xbox, Nintendo',
    subs: [
      { id: 'console',           name: 'Consoles' },
      { id: 'console-accessory', name: 'Console Accessories' },
      { id: 'video-game',        name: 'Video Games' },
    ],
  },
];

// Still classified, so office and household stock has somewhere to go - but
// never published. This site is gaming and PC building only: no printers,
// no routers, no office laptops, no kettles.
export const HIDDEN_SUBS = [
  'laptop', 'networking', 'cables', 'power', 'other',
];

export const SUB_TO_CAT = (() => {
  const m = {};
  for (const c of CATEGORIES) for (const s of c.subs) m[s.id] = c.id;
  for (const s of HIDDEN_SUBS) m[s] = 'hidden';
  return m;
})();

export const isHidden = (sub) => SUB_TO_CAT[sub] === 'hidden';

export const SUB_NAME = (() => {
  const m = {};
  for (const c of CATEGORIES) for (const s of c.subs) m[s.id] = s.name;
  return m;
})();

// Ordered rules. First match wins, so the most specific signals sit first.
// `no` is a veto list: if it matches, the rule is skipped.
const RULES = [
  // Things that mention component names but are NOT components.
  {
    sub: 'prebuilt',
    // "Desktop Computer Memory" is a RAM stick, so the machine phrases must
    // not be followed by a component noun.
    yes: [
      /\bpre[\s-]?built\b/i, /\bready\s*(to\s*(play|go)|made)\b/i,
      /\bgaming\s+(pc|desktop|system|rig|tower)\b(?!\s*(memory|ram|module|case|casing|fan|cooler|psu|power|monitor|keyboard|mouse|speaker|headset|chair|desk|cable))/i,
      /\bdesktop\s+(pc|computer|system)\b(?!\s*(memory|ram|module|case|casing|fan|cooler|psu|power|monitor|keyboard|mouse|speaker|headset|chair|desk|cable))/i,
      /\bmini\s*pc\b/i, /\bcustom\s+build\b/i, /\bpc\s+bundle\b/i, /\ball[\s-]in[\s-]one\b/i, /\bbarebone\b/i,
      /\bbusiness\s+desktop\b/i,
      // Desktop product families that never say "PC" in the title.
      /\b(thinkcentre|ideacentre|optiplex|prodesk|elitedesk|vostro\s+desktop|imac|mac\s+mini|nuc)\b/i,
      // Compu Jordan names its own builds "PC-041 [ Ultra 9 / Z890 / ... ]".
      /^\s*PC[\s-]?\d{2,3}\b/i,
    ],
    // A real build lists its own RAM, SSD and GPU in the title, so those are
    // NOT vetoes here. What disqualifies a listing is being an accessory
    // *for* a PC, or being one specific part.
    no: [
      /\bfor\s+(a\s+)?(desktop|gaming|your)\b/i, /\bcompatible\s+with\b/i,
      /\bcases?\b/i, /\bcasing\b/i, /\bchassis\b/i, /\bchairs?\b/i, /\bdesks?\b/i, /\btables?\b/i,
      /\bcoolers?\b/i, /\bcooling\b/i, /\bfans?\b/i, /\bradiator\b/i, /\bthermal\b/i,
      /\bmonitors?\b/i, /\bkeyboards?\b/i, /\bmouse\b/i, /\bheadsets?\b/i, /\bheadphones?\b/i,
      /\bspeakers?\b/i, /\bwebcams?\b/i, /\bmicrophones?\b/i, /\bnumpad\b/i,
      // Note: "power supply" and "motherboard" are NOT vetoes - a build's
      // title lists them. The "for ..." guard above catches real accessories.
      /\bcables?\b/i, /\badapt[oe]rs?\b/i,
      /\b(wi[\s-]?fi|sound|network|capture|tv)\s+cards?\b/i, /\bdongle\b/i, /\breceiver\b/i,
      /\bbags?\b/i, /\bstands?\b/i, /\bmounts?\b/i, /\bstickers?\b/i, /\blicen[cs]e\b/i,
    ],
  },

  {
    sub: 'gaming-laptop',
    yes: [/\bgaming\s+(laptop|notebook)\b/i, /\b(rog|tuf|nitro|predator|legion|loq|omen|victus|katana|raider|vector|stealth|titan|alienware|helios|blade)\b[\s\S]*\blaptop\b/i],
    // "Gaming Laptop Cooling Pad" is an accessory, not a laptop.
    no: [/\bstands?\b/i, /\bbags?\b/i, /\bsleeves?\b/i, /\bcoolers?\b/i, /\bcooling\b/i, /\bpads?\b/i, /\bbackpacks?\b/i, /\bcases?\b/i, /\bskins?\b/i, /\bchargers?\b/i],
  },
  {
    sub: 'laptop',
    yes: [/\blaptop\b/i, /\bnotebook\b/i, /\bultrabook\b/i, /\bmacbook\b/i, /\bchromebook\b/i],
    no: [/\bstands?\b/i, /\bbags?\b/i, /\bsleeves?\b/i, /\bcoolers?\b/i, /\bcooling\b/i, /\bpads?\b/i, /\bbackpacks?\b/i, /\bcases?\b/i, /\bram\b/i, /\bmemory\b/i, /\bchargers?\b/i, /\badapt[oe]rs?\b/i, /\bskins?\b/i],
  },

  {
    sub: 'monitor',
    yes: [/\bmonitors?\b/i, /\b(curved|gaming)\s+screens?\b/i],
    // "Speakers" is deliberately absent: half the monitors on the market
    // advertise built-in ones, and vetoing on the word filed every single
    // one of them under Speakers. The speakers rule below stands aside for
    // anything that calls itself a monitor instead.
    // "Lights" was too broad on its own: every second panel advertises "Less
    // Blue Light" or "Low Blue Light", and that filed them all out of
    // Monitors. Only the lamps that clip ONTO a monitor veto it.
    no: [/\bstands?\b/i, /\bmounts?\b/i, /\barms?\b/i, /\bcables?\b/i, /\bcleaners?\b/i, /\bscreen\s*bar\b/i, /\bmonitor\s+lights?\b/i, /\blamps?\b/i, /\blight\s*bar\b/i, /\bcameras?\b/i, /\bhoods?\b/i, /\bhubs?\b/i, /\bdocking\b/i, /\bdocks?\b/i, /\bswitchs?\b/i, /\bsplitters?\b/i],
  },

  // Consumer electronics that merely MENTION components ("TV box - 4GB RAM",
  // "tablet LCD screen"). Caught here so they never reach the component rules.
  { sub: 'webcam', yes: [/\bweb\s*cams?\b/i, /\bcapture\s+cards?\b/i, /\bstream\s*decks?\b/i, /\bring\s+lights?\b/i] },
  {
    // `final` means the store's category path may NOT override this. A Roku
    // filed by a shop under "Displays" is still not a monitor.
    sub: 'other',
    final: true,
    yes: [
      /\bsmart\s*watch\b/i, /\bsmartwatch\b/i, /\btv\s*box\b/i, /\bandroid\s*(tv|box)\b/i, /\bstreamer\b/i,
      /\bstreaming\s+(device|stick)\b/i, /\bmedia\s+player\b/i, /\broku\b/i,
      /\bprojector\b/i, /\bprinter\b/i, /\bscanner\b/i, /\btoner\b/i,
      /\bcartridge\b/i, /\bbatter(y|ies)\b/i, /\bspare\s*parts?\b/i, /\blcd\s*(display|screen|panel)\b/i,
      /\btouch\s*screen\b/i, /\btablets?\b/i, /\bgalaxy\s+tab\b/i, /\bipad\b/i, /\b(honor|mi|lenovo|huawei)\s+pad\b/i, /\btab\s+[a-z]?\d{1,2}\b/i,
      /\bsmart\s*phones?\b/i, /\bmobile\s+phones?\b/i, /\bdrones?\b/i,
      /\bscales?\b/i, /\bvacuum\b/i, /\bair\s*(fryer|purifier)\b/i, /\bkettle\b/i, /\btelevision\b/i,
      /\bservers?\b/i, /\bpoweredge\b/i, /\brack\s*mount\b/i, /\bnas\b/i,
      /\bpapers?\b/i, /\breceipt\s*rolls?\b/i, /\bpos\s+(terminal|printer|roll)/i,
      /\bpower\s*bank\b/i, /\bcar\s+charger\b/i, /\bsticker\b/i, /\bscreen\s+protector\b/i,
      // General electronics shops carry phones and kitchen goods whose names
      // collide with PC parts: "Food Processor", "Magnetic Case iPhone".
      /\biphone\b/i, /\bgalaxy\s+[szaf]\d/i, /\bairpods?\b/i, /\bapple\s+watch\b/i,
      /\bfood\s+processor\b/i, /\bblender\b/i, /\bmicrowave\b/i, /\bcoffee\s+(maker|machine)\b/i,
      // "Cooker" is one letter from "cooling" and turns up in general shops.
      /\bcookers?\b/i, /\bovens?\b/i, /\bstoves?\b/i, /\bhobs?\b/i, /\bgas\s+(cooker|oven|range)\b/i,
      /\btoasters?\b/i, /\bwashing\s+machine\b/i, /\brefrigerators?\b/i, /\bfreezers?\b/i,
      /\bheaters?\b/i, /\biron(ing)?\s+(board|machine)?\b/i, /\bmixers?\b/i, /\bjuicers?\b/i,
      /\bmagnetic\s+case\b/i, /\bphone\s+(case|cover|holder)\b/i,
      /\baction\s+figure\b/i, /\bfunko\b/i, /\bamiibo\b/i, /\bbackpack\b/i, /\b(laptop|camera)\s+bag\b/i,
    ],
    no: [/\bmonitor\b/i, /\bgaming\s+chair\b/i, /\bprinter\s+cable\b/i],
  },

  { sub: 'chair', yes: [/\bchairs?\b/i, /\bgaming\s+seat\b/i], no: [/\barmrests?\b/i, /\bpads?\b/i, /\bcovers?\b/i, /\bcasters?\b/i, /\bwheels?\b/i, /\bcushions?\b/i, /\bmats?\b/i] },
  {
    sub: 'desk',
    yes: [/\bgaming\s+(desk|table)\b/i, /\bdesks?\b/i, /\bcomputer\s+table\b/i],
    // "for desk" marks a desk accessory, not a desk.
    no: [/\bfor\s+desk\b/i, /\bdesktop\b/i, /\bmats?\b/i, /\bpads?\b/i, /\blamps?\b/i, /\bmounts?\b/i, /\borganizers?\b/i, /\bholders?\b/i, /\bclips?\b/i, /\bstands?\b/i, /\bcables?\b/i, /\bplants?\b/i, /\bfans?\b/i, /\bcontrollers?\b/i, /\bknobs?\b/i, /\bclamps?\b/i, /\bspeakers?\b/i],
  },

  { sub: 'mousepad', yes: [/\bmouse\s*pads?\b/i, /\bmousepads?\b/i, /\bdesk\s*(mat|pad)s?\b/i] },
  // Plurals matter more than they look: a shop writing "MSI Monitors 24in"
  // or "Gaming Keyboards" was missed entirely by the singular form, and only
  // its category path saved it. City Center publishes no category path.
  { sub: 'keyboard', yes: [/\bkeyboards?\b/i, /\bkeycaps?\b/i, /\bswitches?\s+(set|pack)\b/i] },
  { sub: 'mouse', yes: [/\bmouse\b/i, /\bmice\b/i], no: [/\bpad\b/i, /\bbungee\b/i] },
  { sub: 'headset', yes: [/\bhead\s*sets?\b/i, /\bhead\s*phones?\b/i, /\bear\s*(buds?|phones?)\b/i] },
  // A headset that mentions its microphone is still a headset.
  { sub: 'microphone', yes: [/\bmicrophone\b/i, /\bmic\b/i, /\bpodcast\b/i], no: [/\bhead\s*(set|phone)s?\b/i, /\bearphones?\b/i, /\bearbuds?\b/i] },
  { sub: 'webcam', yes: [/\bweb\s*cams?\b/i, /\bcapture\s+cards?\b/i, /\bstream\s*decks?\b/i, /\bring\s+lights?\b/i] },
  // Screens and headsets both advertise built-in speakers; neither is one.
  { sub: 'speakers', yes: [/\bspeakers?\b/i, /\bsound\s*bar\b/i, /\bsubwoofer\b/i], no: [/\bmonitors?\b/i, /\bdisplays?\b/i, /\bhead\s*(set|phone)s?\b/i, /\bearbuds?\b/i, /\b\d{2,3}\s*hz\b/i] },
  // "Fan Controller", "RGB Controller" and "USB Controller Card" are not
  // things you play games with.
  {
    sub: 'controller',
    yes: [/\bcontroller\b/i, /\bgame\s*pad\b/i, /\bjoy\s*stick\b/i, /\bjoy[\s-]?con\b/i, /\bracing\s+wheel\b/i, /\bsteering\s+wheel\b/i, /\bflight\s+stick\b/i, /\bpedals?\b/i],
    no: [/\b(fan|rgb|argb|led|lighting|hub|usb|sata|raid|nvme|pci-?e|domain|smart\s*home)\s+controller\b/i],
  },

  // Core components.
  {
    // A product that calls itself a graphics card is one. Nearly every card
    // sold advertises its fans and its cooler in the title, so those words
    // cannot be allowed to veto the rule the way they do below - that filed
    // "Radeon RX 7800 XT Gaming OC, 3x WINDFORCE Fans" under Cooling.
    sub: 'gpu',
    final: true,
    yes: [/\bgraphics?\s+cards?\b/i, /\bvideo\s+cards?\b/i, /\bvga\s+cards?\b/i],
    // What is left are the things that attach TO a card and name it - plus
    // the USB dongles that call themselves "external video card" and plug a
    // second screen into a laptop.
    no: [/\blaptop\b/i, /\bnotebook\b/i, /\bholders?\b/i, /\bbrackets?\b/i, /\bsupports?\b/i, /\brisers?\b/i, /\bwater\s*block\b/i, /\bbackplates?\b/i, /\bmounts?\b/i, /\bstands?\b/i, /\bthermal\s+(paste|pad|compound|grease)\b/i, /\bcables?\b/i, /\bmouse\s*pad\b/i, /\bsleeves?\b/i, /\bextenders?\b/i, /\busb\s*[\d.]*\s*(external|to)\b/i, /\bexternal\s+(vga|dvi|hdmi|video|graphics)\b/i],
  },
  {
    sub: 'gpu',
    // Radeon desktop models start at RX 4xx / RX 5xxx, so "RX 120" (a fan
    // model number) cannot be mistaken for a graphics card.
    yes: [/\bgpu\b/i, /\b(rtx|gtx)\s*\d{3,4}\b/i, /\brx\s*([4-9]\d{2}|[5-9]\d{3})\s*(xt|gre|xtx)?\b/i, /\barc\s+[ab]\d{3}\b/i, /\bgt\s*(6[13]0|7[13]0|1030)\b/i],
    // A bare model number is much weaker evidence, so here the parts that
    // merely support a card - coolers, cases, pastes - do veto the rule.
    no: [/\blaptop\b/i, /\bnotebook\b/i, /\bholder\b/i, /\bbracket\b/i, /\bsupport\b/i, /\briser\b/i, /\bfans?\b/i, /\bcooler\b/i, /\bradiator\b/i, /\bcables?\b/i, /\bmouse\s*pad\b/i, /\bcase\b/i, /\bcasing\b/i, /\bchassis\b/i, /\bthermal\b/i, /\bpastes?\b/i, /\bwater\s*block\b/i, /\bbackplate\b/i, /\bmounts?\b/i, /\bpower\s*supply\b/i, /\bmotherboard\b/i],
  },
  {
    sub: 'cpu',
    yes: [/\bprocessors?\b/i, /\bcpu\b/i, /\b(core\s+)?i[3579][\s-]?\d{4,5}[a-z]{0,3}\b/i, /\bryzen\s+[3579]\b/i, /\bthreadripper\b/i, /\bcore\s+ultra\b/i, /\bxeon\b/i],
    // "Supports Intel Core 14th gen" describes a board, and a "Food Processor"
    // is not a processor at all.
    no: [/\bcoolers?\b/i, /\bcooling\b/i, /\bfans?\b/i, /\bthermal\b/i, /\bpaste\b/i, /\bheat\s*sink\b/i, /\bbrackets?\b/i, /\blaptop\b/i, /\bmotherboards?\b/i, /\bmainboard\b/i, /\bbundle\b/i, /\bpsu\b/i, /\bpower\s*supply\b/i, /\bcases?\b/i, /\bsupports?\b/i, /\bchipset\b/i, /\bsocket\s+lga\b/i, /\bfood\b/i, /\brouters?\b/i, /\bwireless\b/i, /\bwi[\s-]?fi\b/i, /\bkitchen\b/i, /\bblender\b/i],
  },
  // Boards are tested before RAM, so "H810M - DDR5 - LGA1851 socket - Micro
  // ATX" is filed as a motherboard rather than as memory.
  {
    sub: 'motherboard',
    // A board is often named only by its chipset ("H610M H V3 DDR4"), with
    // "Intel Core" appearing merely as what it supports - which otherwise
    // reads as a processor.
    yes: [
      /\bmother\s*board\b/i, /\bmainboard\b/i, /\bmobo\b/i, /\b(LGA\s?\d{4}|AM[45])\s+socket\b/i,
      /\b[ZBHXA]\d{3}[A-Z]?\s*M?\b(?=[\s\S]*\b(ddr[345]|atx|lga|am[45]|socket|wifi|chipset)\b)/i,
    ],
  },
  {
    sub: 'ram',
    yes: [/\bddr[345]\b/i, /\bso[\s-]?dimm\b/i, /\bdimm\b/i, /\bram\b/i, /\bmemory\s+module\b/i],
    // "Battle Ram Gaming Combo" is a keyboard-and-mouse bundle, not memory.
    no: [/\bcard\s*reader\b/i, /\bflash\b/i, /\bmemory\s+card\b/i, /\bmicro\s*sd\b/i, /\bgraphics?\b/i, /\bvram\b/i, /\busb\b/i, /\bssd\b/i, /\brouter\b/i, /\bconsole\b/i, /\bcombo\b/i, /\bkeyboard\b/i, /\bmouse\b/i, /\bheadset\b/i, /\bmother\s*board\b/i, /\bsocket\b/i, /\blga\s?\d{3,4}\b/i, /\bform\s*factor\b/i, /\bmicro\s*atx\b/i, /\bchipset\b/i, /\bpci[\s-]?e\b/i],
  },
  {
    sub: 'psu',
    yes: [/\bpower\s*supply\b/i, /\bpsu\b/i, /\b80\s*plus\b/i, /\bsmps\b/i],
    // A USB hub "with power supply" is not a power supply.
    no: [/\bups\b/i, /\blaptop\b/i, /\badapt[oe]rs?\b/i, /\bchargers?\b/i, /\bcables?\b/i, /\bextension\b/i, /\bhubs?\b/i, /\busb\b/i, /\btype[\s-]?c\b/i, /\bdocks?\b/i],
  },
  {
    sub: 'storage',
    yes: [/\bssd\b/i, /\bhdd\b/i, /\bhard\s*(disk|drive)\b/i, /\bnvme\b/i, /\bm\.2\b/i, /\bsolid\s*state\b/i],
    // PCIe adapter cards, cables and storage boxes are not drives. "PCIe" on
    // its own is not evidence of any of those - every NVMe drive made states
    // its PCIe generation - so only the adapter phrasing vetoes.
    no: [/\bexternal\b/i, /\bportable\b/i, /\benclosures?\b/i, /\bcaddy\b/i, /\bdocks?\b/i, /\blaptop\b/i, /\bcards?\b/i, /\bcables?\b/i, /\bbox\b/i, /\bpci[\s-]?e\s+(adapt[oe]r|riser|expansion|converter)\b/i, /\badapt[oe]rs?\b/i, /\bbrackets?\b/i],
  },
  {
    sub: 'case',
    yes: [/\bcasing\b/i, /\bchassis\b/i, /\bcase\b/i],
    // A drive enclosure and a phone case are both "cases" - neither is a PC case.
    no: [/\bphone\b/i, /\blaptop\b/i, /\bfans?\b/i, /\bpsu\b/i, /\bsleeves?\b/i, /\bheadsets?\b/i, /\bwatch\b/i, /\benclosures?\b/i, /\bexternal\b/i, /\bsata\b/i, /\bhdd\b/i, /\bssd\b/i, /\bcables?\b/i, /\bcarry\b/i, /\bstorage\b/i, /\bgame\b/i, /\bswitch\b/i, /\bethernet\b/i, /\bbox\b/i, /\bcamera\b/i],
  },
  {
    sub: 'cooling',
    // "Cooler Master" is a brand name, so `cooler` must not be followed by it.
    yes: [/\bcoolers?\b(?!\s*master)/i, /\bcooling\b/i, /\baio\b/i, /\bliquid\s+cool/i, /\bwater\s+cool/i, /\bheat\s*sink\b/i, /\bthermal\s+(paste|compound|grease)\b/i, /\bfans?\b/i, /\bradiator\b/i],
    // Fan hubs, splitters and the fittings and tubing a water loop is
    // plumbed with are all parts for cooling, not cooling.
    no: [/\bcases?\b/i, /\bchassis\b/i, /\bpapers?\b/i, /\bpos\b/i, /\breceipts?\b/i, /\brolls?\b/i, /\bprinter\b/i, /\bfan\s+hubs?\b/i, /\bhub\s+control\b/i, /\b(soft|hard)\s+tube\b/i, /\bfittings?\b/i, /\bcompression\s+fitting\b/i, /\bcoolant\b/i, /\breservoirs?\b/i, /\bg1\/4\b/i],
  },

  // Console.
  {
    sub: 'console',
    yes: [/\bplaystation\s*[45]\b/i, /\bps[45]\s+(console|slim|pro|digital|standard)\b/i, /\bxbox\s+(series|one)\b/i, /\bnintendo\s+switch\s*(2|oled|lite)?\s*(console)?\b/i, /\bsteam\s*deck\b/i, /\brog\s+ally\b/i, /\bconsole\b/i],
    no: [/\bcontroller\b/i, /\bgame\b/i, /\bcase\b/i, /\bstand\b/i, /\bcharg/i, /\bskin\b/i, /\bcable\b/i, /\bheadset\b/i],
  },
  { sub: 'video-game', yes: [/\b(ps[45]|xbox|switch|nintendo)\s+game\b/i, /\bgame\s+(disc|card)\b/i, /\bfc\s*2[5-9]\b/i, /\bcall\s+of\s+duty\b/i, /\bblack\s+ops\b/i, /\bmario\b/i, /\bzelda\b/i, /\bgift\s+card\b/i, /\bdigital\s+card\b/i] },
  // "Switch" is a games console and a piece of network kit. A managed PoE
  // switch with 24 gigabit ports is plainly the second one.
  {
    sub: 'console-accessory',
    yes: [/\b(ps[45]|xbox|switch|nintendo|playstation)\b/i],
    // Network switches, and the light switches a smart-home aisle sells,
    // are both "switch" and neither is a Nintendo.
    no: [
      /\b(gigabit|ethernet|poe|managed|unmanaged|network|kvm|rack|port)\b.{0,30}\bswitch\b/i,
      /\bswitch\b.{0,30}\b(gigabit|ethernet|poe|ports?|rj-?45|uplink|rack)\b/i,
      /\b(light|wall|dimmer|smart|touch|toggle|rocker|power|kill)\s+switch(es)?\b/i,
      /\bswitch(es)?\b.{0,20}\b(gang|way)\b/i,
    ],
  },

  // Accessories.
  { sub: 'external-storage', yes: [/\bexternal\s+(ssd|hdd|drive|storage)\b/i, /\bportable\s+(ssd|hdd|drive)\b/i, /\bflash\s+(drive|disk|memory)\b/i, /\busb\s+(drive|stick)\b/i, /\bmemory\s+card\b/i, /\bmicro\s*sd\b/i, /\benclosure\b/i] },
  { sub: 'networking', yes: [/\brouter\b/i, /\bwi[\s-]?fi\b/i, /\bethernet\b/i, /\bnetwork\b/i, /\bmesh\b/i, /\bextender\b/i, /\baccess\s+point\b/i, /\b(gigabit|poe|managed|unmanaged|rack|kvm|\d+[\s-]?port)\b.{0,30}\bswitch\b/i, /\bswitch\b.{0,30}\b(gigabit|poe|ports?|rj-?45|uplink)\b/i] },
  { sub: 'cables', yes: [/\bcable\b/i, /\badapter\b/i, /\bhub\b/i, /\bdock(ing)?\b/i, /\bconverter\b/i, /\bhdmi\b/i, /\bdisplay\s*port\b/i, /\bextension\b/i] },
  { sub: 'power', yes: [/\bups\b/i, /\bpower\s*bank\b/i, /\bcharger\b/i, /\bsurge\b/i, /\bpower\s*(socket|strip)\b/i, /\bstabilizer\b/i] },
];

// Signals from the store's own category path. Retailers file products
// deliberately, so this breaks ties the title alone cannot.
const PATH_HINTS = [
  // "Flash Memory" and "Memory Cards" are storage, not RAM - these must be
  // tested before the RAM hint or they steal every flash drive.
  [/flash|memory[\s_-]*cards?|usb[\s_-]*(flash|drives?|stick)|external[\s_-]*(storage|drive|ssd|hdd)|portable[\s_-]*(ssd|hdd|drive)/i, 'external-storage'],
  [/power[\s_-]*suppl|\bpsu\b/i, 'psu'],
  [/\bram\b|\bddr\b|memory[\s_-]*modules?|^\s*memor(y|ies)\s*$/i, 'ram'],
  [/graphic|video[\s_-]*card|\bgpu\b|\bvga\b/i, 'gpu'],
  [/processor|\bcpu\b/i, 'cpu'],
  [/mother[\s_-]*board|mainboard/i, 'motherboard'],
  [/storage|\bssd\b|hard[\s_-]*(disk|drive)|\bhdd\b/i, 'storage'],
  [/\bcase(s|ing)?\b|chassis|cabinet/i, 'case'],
  // "thermal" alone also matches thermal printer paper, so it is qualified.
  [/cool(ing|er)|\bfans?\b|thermal\s*(paste|compound|grease)/i, 'cooling'],
  [/monitor|display/i, 'monitor'],
  [/keyboard/i, 'keyboard'],
  [/mouse[\s_-]*pad|deskmat/i, 'mousepad'],
  [/\bmouse\b|\bmice\b/i, 'mouse'],
  [/head[\s_-]*(set|phone)|earphone|earbud/i, 'headset'],
  [/microphone|\bmic\b/i, 'microphone'],
  [/speaker|\baudio\b/i, 'speakers'],
  [/controller|gamepad|joystick/i, 'controller'],
  [/chair/i, 'chair'],
  [/\bdesks?\b|\btables?\b/i, 'desk'],
  [/pre[\s-]*built|gaming[\s_-]*pc|desktop[\s_-]*(pc|computer)|system[\s_-]*unit|bundle/i, 'prebuilt'],
  [/gaming[\s_-]*laptop/i, 'gaming-laptop'],
  [/laptop|notebook/i, 'laptop'],
  [/router|network|wifi/i, 'networking'],
  [/cable|adapter/i, 'cables'],
  [/\bups\b|power[\s_-]*bank/i, 'power'],
  [/webcam|streaming|capture/i, 'webcam'],
  [/console|playstation|xbox|nintendo/i, 'console-accessory'],
  [/video[\s_-]*games?/i, 'video-game'],
  [/external|flash|usb[\s_-]*drive/i, 'external-storage'],
];

function matchRules(text) {
  for (const r of RULES) {
    if (r.no && r.no.some((n) => n.test(text))) continue;
    if (r.yes.some((y) => y.test(text))) return { sub: r.sub, final: !!r.final };
  }
  return null;
}

// Subcategories that are catch-alls: if the store's own path disagrees
// with one of these, the store wins.
const WEAK = new Set(['other', 'console-accessory']);

// Products that ARE a complete machine, versus the parts they contain.
const WHOLE_MACHINE = new Set(['gaming-laptop', 'laptop', 'prebuilt']);
const COMPONENT_SUBS = new Set(['gpu', 'cpu', 'ram', 'motherboard', 'psu', 'storage', 'case', 'cooling']);

// The aisles that only ever hold parts that go inside a desktop PC. Nothing
// made for a phone can legitimately appear in one of these.
const PC_PART_SUBS = new Set([...COMPONENT_SUBS, 'monitor', 'external-storage']);

// Anything that can be a part OF a laptop. A "MacBook Air ... Backlit Magic
// Keyboard" is a laptop, not a keyboard.
const PART_SUBS = new Set([
  ...COMPONENT_SUBS, 'keyboard', 'mouse', 'headset', 'mousepad', 'speakers', 'microphone', 'webcam', 'monitor',
]);

// Laptop model families, so a machine is never filed as one of its parts.
// "ROG Swift" is Asus's monitor line and "Acer Swift" is a laptop, so `swift`
// only counts when ROG is not in front of it.
/**
 * Does this title read as a list of the parts inside one machine?
 *
 * Three different component families named together - a processor, a graphics
 * card and an amount of memory - is a build sheet, not a part. Two is not
 * enough: a motherboard legitimately names its socket and its memory type,
 * and a graphics card names its own VRAM.
 */
/**
 * A portable machine rather than a desktop one.
 *
 * Saying it outright counts on its own. A family name does not: "Swift" is an
 * Acer laptop AND an XFX graphics card line, so a bare family name has to be
 * backed by something only a computer has - a processor, or a screen size.
 * Without that, an "XFX Swift RX 9060 XT" was protected from every rule that
 * would have filed it as a graphics card.
 */
function looksLikeALaptop(title) {
  if (/\b(laptop|notebook|ultrabook)\b/i.test(title)) return true;

  const family = LAPTOP_FAMILY.test(title)
    || /\b(nitro|predator|legion|loq|omen|victus|katana|cyborg|raider|vector|stealth|titan|alienware|blade|zephyrus|scar|tuf\s+f?\d{2}|gf\d{2}|gp\d{2}|gl\d{2})\b/i.test(title);
  const screen = /\b1[2-8](\.\d)?\s*(inch|["”″])/i.test(title);
  const processor = /\b(ryzen|core\s*i[3579]|core\s*ultra|ultra\s*[579]|celeron|pentium|snapdragon|apple\s*m[1-4]|i[3579][\s-]\d{4,5})\b/i.test(title);

  return (family && (screen || processor)) || (screen && processor);
}

function countsAsWholeSystem(title) {
  const t = ` ${title} `;
  const families = [
    /\b(core\s*i[3579][\s-]*\d{4,5}|ryzen\s*[3579]\s*\d{4}|i[3579][\s-]?\d{4,5}[a-z]{0,2})\b/i,
    /\b((rtx|gtx)\s*\d{3,4}|rx\s*[5-9]\d{3}|gt\s*\d{3,4}|arc\s+[ab]\d{3})\b/i,
    /\b\d{1,3}\s*gb\s*(ram|ddr[45]|memory)\b|\b(ddr[45])\s*\d{1,3}\s*gb\b/i,
    /\b\d{3,4}\s*gb\s*(ssd|nvme|hdd)\b|\b\d\s*tb\s*(ssd|nvme|hdd)\b/i,
  ].filter((re) => re.test(t)).length;

  if (families >= 3) return true;
  // Two families plus the shop calling it a build is enough on its own.
  return families >= 2 && /\b(build|bundle|system|combo\s+pc|full\s+set)\b/i.test(t);
}

const LAPTOP_FAMILY = /\b(zenbook|vivobook|expertbook|proart|ideapad|yoga|thinkpad|thinkbook|macbook|pavilion|envy|inspiron|latitude|aspire|(?<!rog\s)swift|extensa|travelmate|nitro\s*v|rog\s+(strix\s+)?(flow|g\d+|zephyrus|scar|ally)|tuf\s+gaming\s+[af]\d+|legion\s+\d+|loq|omen\s+\d+|victus\s+\d+|katana|cyborg|bravo|modern\s+\d+|prestige|summit|galaxy\s+book|matebook|note?book)\b/i;

/**
 * Decide the subcategory for a product.
 * Title is trusted most; the store's category path breaks ties.
 */
// A store's own product_type, when it is an exact, unambiguous label.
// "PC" is the important one: a whole computer whose title lists a CPU and a
// GPU would otherwise be filed as one of its own parts.
const EXACT_TYPE = {
  pc: 'prebuilt', 'gaming pc': 'prebuilt', desktop: 'prebuilt', 'desktop pc': 'prebuilt',
  ram: 'ram', memory: 'ram', storage: 'storage', ssd: 'storage', case: 'case', cases: 'case',
  cpu: 'cpu', processor: 'cpu', 'graphic cards': 'gpu', 'graphics card': 'gpu', gpu: 'gpu',
  motherboard: 'motherboard', motherboards: 'motherboard', 'power supply': 'psu', psu: 'psu',
  monitor: 'monitor', monitors: 'monitor', keyboard: 'keyboard', keyboards: 'keyboard',
  mouse: 'mouse', mice: 'mouse', headset: 'headset', headsets: 'headset', mousepad: 'mousepad',
  microphone: 'microphone', speakers: 'speakers', chair: 'chair', 'gaming chair': 'chair',
  desk: 'desk', 'gaming desk': 'desk', laptop: 'laptop', laptops: 'laptop', cooling: 'cooling',
  controller: 'controller', console: 'console',
};

export function classify({ title = '', storePath = '', productType = '', description = '', certain = '' }) {
  // Some shops publish a structured spec table - "CPU Socket Type", "Chipset",
  // "Refresh Rate", "Panel Type". An adapter that recognises one of those
  // fingerprints knows what the product is on the shop's own authority, which
  // beats anything we could infer from a marketing title. A graphics card
  // whose title advertises its three cooling fans is still a graphics card.
  if (certain && SUB_TO_CAT[certain]) return { sub: certain, cat: SUB_TO_CAT[certain], certain: true };

  // A shop calling something a "PC" outranks anything we could read off the
  // title, so this short-circuits before the component rules can misfire.
  const exact = EXACT_TYPE[productType.trim().toLowerCase()];
  const isAddOn = /\b(stands?|mounts?|brackets?|holders?|arms?|bags?|sleeves?|skins?|stickers?|cables?|adapt[oe]rs?|dongles?|cooling|pads?)\b/i.test(title);
  // Some shops tag loose parts as "PC" too, so the title still has to name a
  // whole machine before we take their word for it.
  const looksLikeAMachine =
    /\b(gaming\s+(pc|desktop|rig|tower)|desktop\s+(pc|computer)|mini\s*pc|pre[\s-]?built|nuc|cubi|barebone|all[\s-]in[\s-]one|workstation|tower)\b/i.test(title)
    || /\bPC\s*[—–|-]/.test(title)   // "iGeek Everyday Essential PC — Intel..."
    || /\bPC$/i.test(title.trim());
  if (exact === 'prebuilt' && looksLikeAMachine && !isAddOn) {
    return { sub: 'prebuilt', cat: SUB_TO_CAT.prebuilt };
  }

  // A listing that spells out a processor AND a graphics card AND its memory
  // is describing a whole computer, whatever aisle it sits in. Shops write
  // these as "INTEL CORE I5 12400F // GT 1030 2GB // 8GB RAM - Low Budget
  // Build", and the graphics model in the middle used to win, which put an
  // entire PC in Graphics Cards - and let the build assistant buy one as if
  // it were a card.
  if (!isAddOn && countsAsWholeSystem(title)) {
    // A laptop's spec list looks exactly the same, so decide which kind of
    // machine it is before answering. Without this an "Acer Nitro V 15 -
    // Core i5-13420H - RTX 2050 - 8GB" became a desktop and then, failing to
    // mention a tower, disappeared from the site altogether.
    const machine = looksLikeALaptop(title)
      ? (/\b(rtx|gtx|radeon\s+rx|gaming)\b/i.test(title) ? 'gaming-laptop' : 'laptop')
      : 'prebuilt';
    return { sub: machine, cat: SUB_TO_CAT[machine] };
  }

  const byTitle = matchRules(` ${title} `);

  let byPath = exact || null;
  if (!byPath) {
    const pathText = `${storePath} ${productType}`;
    for (const [re, sub] of PATH_HINTS) {
      if (re.test(pathText)) { byPath = sub; break; }
    }
  }

  let sub = byTitle?.sub || byPath;

  // The store's own filing breaks ties, but only for our catch-all buckets
  // and never against a rule that declared itself final.
  if (byPath && byTitle && !byTitle.final && byPath !== byTitle.sub && WEAK.has(byTitle.sub)) {
    sub = byPath;
  }

  // A whole machine listed under "Gaming Laptops" stays a laptop even though
  // its title names the graphics card and processor inside it. But a loose
  // CPU sold in a "Gaming PC" aisle is still a CPU, so a title that plainly
  // names one part keeps its own answer.
  const namesOnePart = /\b(processors?|graphics?\s+card|video\s+card|mother\s*board|power\s*supply|memory\s+module|hard\s*(disk|drive)|\bssd\b|\bhdd\b|\bcpu\b|\bpsu\b|\bram\b|cooler|fan)\b/i.test(title);
  if (byPath && WHOLE_MACHINE.has(byPath) && COMPONENT_SUBS.has(sub) && !namesOnePart) {
    sub = byPath;
  }
  if (!sub) sub = matchRules(` ${description.slice(0, 400)} `)?.sub || 'other';
  if (!SUB_TO_CAT[sub]) sub = 'other';

  return { sub, cat: SUB_TO_CAT[sub] };
}

// Common RAM kit sizes. Anything else parsed out of a title (a "3GB tablet",
// a "128GB flash drive") is a sign we mis-read the product.
const RAM_SIZES = new Set([1, 2, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 512]);

/**
 * Phones and tablets. They quote a storage size and a memory size in the
 * title exactly the way a memory kit does, so without this an Oppo handset
 * reads as 256GB of desktop RAM - and the build assistant will happily put
 * one in a gaming PC. It did.
 */
const IS_PHONE_OR_TABLET = new RegExp([
  '\\b(smart\\s*phones?|mobile\\s+phones?|cell\\s*phones?|handsets?)\\b',
  '\\bfor\\s+(mobile|phones?|smart\\s*phones?)\\b',
  '\\b(i[Pp]hone|i[Pp]ad|galaxy\\s+(a|s|z|note|tab)\\s*\\d|redmi|poco|realme|oppo|vivo|infinix|tecno|honor\\s+\\d|huawei\\s+(nova|mate|p\\d)|oneplus|nokia\\s+[a-z]?\\d)\\b',
  '\\b(dual\\s+sim|nano\\s+sim|esim)\\b',
  // Model codes phones use and components do not: "CPH2727", "SM-A165F".
  '\\b(cph|sm-[a-z]|rmx|v\\d{4}[a-z]{2})\\d{3,4}\\b',
].join('|'), 'i');

// Categories where a "mount"/"bracket"/"stand" in the title almost always
// means an accessory for the part, not the part. Deliberately excludes
// prebuilt/laptop, whose long spec titles often mention such words.
const ACCESSORY_PRONE = new Set(['gpu', 'cpu', 'motherboard', 'ram', 'psu', 'storage', 'monitor', 'case']);

// Peripherals whose accessories are usually named after them, so the title
// alone would file the accessory in the peripheral's category.
const PERIPHERAL_SUBS = new Set([
  'headset', 'microphone', 'speakers', 'controller', 'keyboard', 'mouse', 'webcam', 'mousepad',
]);

const CONNECTIVITY_ACCESSORY = new RegExp([
  'adapt[oe]rs?', 'converters?', 'splitters?',
  'extension\\s+(cable|cord|lead)s?',
  'charging\\s+(cable|dock|station|stand)s?',
  '(data|aux|out|audio|type-?c)\\s+cables?',
  '(boom|microphone|mic)\\s+arms?',
  // Bare connectors and patch leads: "Audio jack male 3.5mm to 2x female",
  // "AUX 3.5mm Male to XLR 3 Pole Male".
  'jacks?', 'xlr', 'male\\s+to\\s+(male|female)', 'female\\s+to\\s+(male|female)',
  '\\d\\s*pole', 'couplers?', 'patch\\s+(cable|lead)s?',
  // Lens and camera covers, and the tripods they sit on.
  'shutters?', 'privacy\\s+covers?', 'tripods?', 'webcam\\s+covers?', 'anti-?spy',
].map((p) => `\\b${p}\\b`).join('|'), 'i');

// Nouns that name an accessory rather than a product we list. Deliberately
// excludes "cooler"/"fan"/"pad", which are real products in their own
// categories (Cooling, Mousepads).
const ACCESSORY_NOUNS = new RegExp([
  'light\\s*strips?', 'led\\s*strips?', 'light\\s*bars?', 'lamps?', 'lighting\\s+kit',
  'stickers?', 'skins?', 'screen\\s+protectors?', 'cleaners?', 'dust\\s+(covers?|filters?)',
  'cable\\s+(clips?|ties?|management|sleeves?|combs?)', 'clips?', 'zip\\s+ties?',
  'organizers?', 'enclosures?', 'caddys?', 'caddies', 'docking\\s+stations?',
  'splitters?', 'converters?', 'extenders?', 'armrests?', 'cushions?', 'casters?',
  'screws?', 'standoffs?', 'thermal\\s+(paste|compound|grease|pads?)', 'anti[\\s-]?static',
  'carry\\s+cases?', 'travel\\s+cases?', 'holders?', 'hangers?',
  // Parts and spares for a peripheral, which read as the peripheral itself.
  // A "mouse wrist rest" is not a mouse and "mouse skates" are not a mouse.
  'wrist\\s*rests?', 'palm\\s*rests?', 'wrist\\s*pads?',
  'skates?', 'glides?', 'mouse\\s*feet',
  'key\\s*caps?', 'keycaps?', 'puller', 'switch\\s*sets?',
  '(mechanical|keyboard|hot[\\s-]?swap)\\s+switch(es)?', 'switch(es)?\\s+(tester|opener|lube)',
  'ear\\s*(pads?|cushions?|tips?|hooks?)', 'replacement\\s+(pads?|cushions?|tips?)',
  'thumb\\s*grips?', 'analog\\s+caps?', 'joystick\\s+caps?',
  'decorations?', 'decals?', 'faceplates?', 'shells?',
  'dust\\s*plugs?', 'silicone\\s+covers?', 'protective\\s+films?',
].map((p) => `\\b${p}\\b`).join('|'), 'i');

/**
 * Second opinion after specs are extracted. If a product was filed as a
 * component but shows none of that component's fingerprints, demote it to
 * "other" rather than pollute a filterable category with a wrong item.
 */
export function sanitize(sub, title, specs) {
  const t = ` ${title} `;
  const keep = (ok) => (ok ? sub : 'other');

  // Compu Jordan's own builds are named "PC-041 [ CPU / board / RAM / ... ]".
  // The bracket lists every part, so only the name itself is reliable.
  if (/^\s*PC[\s-]?\d{2,3}\b/i.test(title)) return 'prebuilt';

  // Nothing made for a phone belongs in a PC component aisle: not the handset
  // whose title lists "256GB 8GB RAM" like a memory kit, and not the magnetic
  // clip-on cooler that reads as a CPU cooler. Peripherals are left alone -
  // earbuds and mobile controllers are real things people gaming with.
  if (PC_PART_SUBS.has(sub) && IS_PHONE_OR_TABLET.test(t)) return 'other';

  // Nor does home security or smart-home kit belong in any gaming aisle.
  // Surveillance cameras were reaching Storage, and a smart plug reached
  // Controllers because it came with a remote.
  if (/\b(surveillance\s+camera|security\s+camera|ip\s+camera|cctv|dvr\b|nvr\b|door\s*bell|smart\s+(plug|bulb|lock|light)|baby\s+monitor)\b/i.test(t)) {
    return 'other';
  }

  // A screen size plus a refresh rate plus a processor is a laptop, whatever
  // component the rest of the title happens to name.
  if (COMPONENT_SUBS.has(sub)
      && /\b1[2-8](\.\d)?\s*["”]/.test(title)
      && /\b\d{2,3}\s*hz\b/i.test(title)
      && /\b(ryzen|core|ultra|intel|amd)\b/i.test(title)) {
    return /\b(rtx|gtx)\b/i.test(title) ? 'gaming-laptop' : 'laptop';
  }

  // One rule instead of a veto per category: if the thing being sold is an
  // accessory, it does not matter which component it names. "ARGB light
  // strip for motherboard" is lighting; "enclosure external case" is an
  // enclosure; "cable clip for desk" is a clip.
  if (ACCESSORY_NOUNS.test(t)) return 'other';
  if (ACCESSORY_PRONE.has(sub) && /\b(arms?|mounts?|brackets?|risers?|stands?|holders?|connectors?|screws?|standoffs?|adapt[oe]rs?)\b/i.test(t)) {
    return 'other';
  }

  // Leads, adapters and charging docks that name the peripheral they plug
  // into. Note there is no bare "cable" here on purpose: "Keyboard K100 -
  // 1.5m cable length" and "wired controller - 2.5M cable" are real products
  // describing their own lead.
  if (PERIPHERAL_SUBS.has(sub) && CONNECTIVITY_ACCESSORY.test(t)) return 'other';

  // No graphics card lists a processor, and no processor lists a graphics
  // card. A title naming both is a complete machine sold as a spec list -
  // "AMD Ryzen 9 9950X3D // RTX 5090 // 64GB RAM".
  // Shops write "Core™ i7", so the trademark symbols have to be tolerated.
  if (COMPONENT_SUBS.has(sub)
      && /\b(ryzen[\s™®]*[3579]|core[\s™®]*i[3579]|(core[\s™®]*)?ultra[\s™®]*[579][\s-]?\d{3}[a-z]*|i[3579][\s-]\d{4,5}[a-z]*|threadripper)/i.test(t)
      && /\b(rtx|gtx)[\s™®]*\d{3,4}\b|\brx\s*[5-9]\d{3}\b/i.test(t)) {
    // Same question as everywhere else - portable or desktop - so it uses the
    // same answer. Spelling the families out separately here meant an
    // "IdeaPad Gaming 3 Ryzen 5 5600H RTX 3050" was called a desktop.
    return looksLikeALaptop(t)
      ? 'gaming-laptop'
      : 'prebuilt';
  }

  // Laptop product families. A "Zenbook ... Core Ultra 7 Processor" is a
  // laptop, not a processor - the word "Processor" describes what is inside.
  //
  // Unless the product says outright what it is. Manufacturers reuse names
  // across completely different things: "Swift" is an Acer laptop and an XFX
  // graphics card line, and "XFX Swift RX 9060 XT Triple Fan Gaming Edition"
  // was being sold on the site as a gaming laptop.
  //
  // A family name on its own is not enough either. Monitors borrow them too -
  // Twisted Minds sells a "Prestige X Series 27in QHD 280Hz", and MSI sells
  // Prestige laptops - so a machine has to name a processor or call itself a
  // laptop as well. Without that, the monitor was moved into Gaming Laptops
  // and back again on every refresh.
  const namesItself = /\b(graphics?\s+cards?|video\s+cards?|motherboards?|power\s+supply|memory\s+module)\b/i.test(t);
  // A processor MODEL, not a chip maker's name: "XFX Swift AMD Radeon RX
  // 9060 XT" says AMD, and counting that as evidence of a computer sent every
  // one of those cards into Gaming Laptops.
  const hasMachineGuts = /\b(ryzen|core\s*i[3579]|core\s*ultra|ultra\s*[579]|laptop|notebook|celeron|pentium|snapdragon|apple\s*m[1-4]|i[3579][\s-]\d{4,5})\b/i.test(t);
  if (PART_SUBS.has(sub) && LAPTOP_FAMILY.test(t) && hasMachineGuts && !namesItself) {
    return /\b(rtx|gtx)\b|\brog\b|\btuf\b|\bnitro\b|\blegion\b|\bloq\b|\bomen\b|\bvictus\b|\bkatana\b|\bcyborg\b|\bpredator\b|\bgaming\b/i.test(t)
      ? 'gaming-laptop'
      : 'laptop';
  }

  // A laptop with a discrete gaming GPU or a gaming model name is a gaming
  // laptop even when the shop never types the word "gaming".
  if (sub === 'laptop' && /\b(rtx|gtx)\s*\d{3,4}\b|\brx\s*\d{4}m?\b|\b(rog|tuf|nitro|predator|legion|loq|omen|victus|katana|raider|vector|stealth|titan|alienware|helios|blade|cyborg|crosshair|pulse|sword)\b/i.test(t)) {
    return 'gaming-laptop';
  }

  switch (sub) {
    case 'ram':
      // Phones and tablets list their memory in the title - "Oppo A5 256GB
      // 8GB RAM" - and one of them ended up as the memory in a build.
      if (IS_PHONE_OR_TABLET.test(t)) return 'other';
      if (specs.capacity && !RAM_SIZES.has(specs.capacity)) return 'other';
      // "Battle Ram Gaming Combo Set" is a keyboard and mouse. The word "ram"
      // in a product name is not memory.
      if (/\bcombo\b|\bbundle\b|\bkeyboard\b|\bmouse\b|\bheadset\b|\bgaming\s+set\b/i.test(t)) return 'other';
      return keep(!!specs.ddr || /\bdimm\b|\bddr[345]\b|\bram\b|\bmemory\s+module\b/i.test(t));
    case 'gpu':
      // A bare "GPU" is not enough - it is usually a compatibility note.
      return keep(!!specs.chipset || /\bgraphics?\s+card\b|\bvideo\s+card\b|\bvga\s+card\b/i.test(t));
    case 'psu':
      // "PoE Injector - 15.4W Power Supply" powers a network camera, not a PC.
      if (/\bpoe\b|\binjectors?\b|\bups\b|\bpower\s*banks?\b|\bsurge\b|\badapt[oe]rs?\b/i.test(t)) return 'other';
      return keep(!!specs.wattage || /\bpower\s*supply\b|\bpsu\b|\b80\s*plus\b/i.test(t));
    case 'cpu':
      // A CPU cooler's spec sheet lists the processor sockets it fits, which
      // reads exactly like a processor's own. Those are coolers, not CPUs,
      // and they belong in Cooling rather than being thrown away.
      if (/\b(fans?|coolers?|cooling|heat\s*sinks?|radiators?|water\s*block)\b/i.test(t)) return 'cooling';
      return keep(!!specs.series || !!specs.socket || /\bprocessor\b|\bcpu\b/i.test(t));
    case 'motherboard':
      // Fans and coolers reach this category through shop category paths.
      if (/\bfans?\b|\bcoolers?\b|\bcooling\b|\bradiators?\b/i.test(t)) return 'other';
      return keep(/\bmother\s*board\b|\bmainboard\b|\bmobo\b|\b(lga\s?\d{4}|am[45])\b/i.test(t));
    case 'monitor':
      // A handheld console has a screen and a refresh rate; it is not a
      // monitor. Neither is a phone or a tablet.
      if (/\bhandhelds?\b|\bretro\s+(gaming\s+)?console\b|\bgame\s*boy\b|\bportable\s+console\b/i.test(t)) return 'other';
      // Nor is a television. Forty-nine 32-inch FHD TVs were listed as gaming
      // monitors; a set that never says "monitor" is not one.
      if (/\b(smart\s*)?tvs?\b|\btelevisions?\b/i.test(t) && !/\bmonitors?\b/i.test(t)) return 'other';
      // A "4K 60Hz" HDMI adapter is not a monitor - it needs a screen size
      // or to actually call itself one.
      return keep(/\bmonitor\b/i.test(t) || (!!specs.size && !/\badapter\b|\bcable\b|\bconverter\b|\bmount\b|\bstand\b|\bsplitter\b/i.test(t)));
    case 'storage':
      // A drive you plug into a USB port is not the drive that goes inside
      // the machine, and the build assistant must never fit one as internal
      // storage. It fitted a WD My Passport once.
      if (/\bexternal\b|\bportable\s+(hard|hdd|ssd|drive)\b|\bmy\s*passport\b|\bcanvio\b|\bexpansion\s+drive\b/i.test(t)) {
        return 'external-storage';
      }
      // A "2.5/3.5 HDD Dock" holds a drive, it is not one.
      if (/\bdocks?\b|\bdocking\b|\benclosures?\b|\bcadd(y|ies)\b|\breaders?\b|\bconverters?\b|\bbays?\b/i.test(t)) return 'other';
      return keep(!!specs.type || /\bssd\b|\bhdd\b|\bnvme\b|\bhard\s*(disk|drive)\b/i.test(t));
    case 'prebuilt':
      // "Intel Core i7-12700KF Gaming Desktop Processor" is a processor that
      // says "desktop", and a stream keypad is not a computer.
      //
      // A title naming a graphics card as well is a build sheet, not a loose
      // processor: "N1 PC GAMING BUILD N242 - RTX 3060 12G GPU INTEL I5
      // 12400F" was moved to Processors, sent back next refresh, and bounced
      // between the two for ever.
      if (/\bprocessors?\b|\bcpu\b/i.test(t)
          // Shops write "GeForce RTX™ 4070", so the trademark symbol has to
          // be tolerated or the veto never fires.
          && !/\b(rtx|gtx)[\s™®]*\d{3,4}\b|\brx[\s™®]*[5-9]\d{3}\b|\bgpu\b|\bbuild\b|\bgeforce\b|\bradeon\b/i.test(t)
          && !/\b(gaming\s+pc|desktop\s+(pc|computer)|tower\s+pc|pre[\s-]?built|barebone|mini\s*pc|all[\s-]in[\s-]one)\b/i.test(t)) {
        return 'cpu';
      }
      if (/\bkeypads?\b|\bstream\s+(controller|deck)\b/i.test(t)) return 'other';
      return keep(/\bpc\b|\bdesktop\b|\bsystem\b|\brig\b|\btower\b|\bbuild\b/i.test(t));
    case 'gaming-laptop':
      // A product that describes itself as a component is that component,
      // whatever laptop family its brand name collides with. The XFX Swift
      // RX 9060 XT never says "graphics card" - it says GDDR6, boost clock
      // and stream processors, which no laptop listing does - and it was on
      // sale here as a gaming laptop.
      // ...but not when it is plainly a laptop describing what is inside it.
      // "ThinkPad P16v Mobile Workstation ... RTX 1000 Ada 6GB Graphic Card
      // & HUGE Battery" says "Graphic Card" about its own chip, and was sent
      // to Graphics Cards and back on every refresh.
      if (!looksLikeALaptop(t)) {
        if (/\b(graphics?|video)\s+cards?\b/i.test(t)) return 'gpu';
        if (/\bmotherboards?\b/i.test(t)) return 'motherboard';
      }
      // Vetoed by the same laptop test used everywhere else. Checking only
      // for the words "laptop" and "notebook" was not enough: a ThinkPad P16v
      // Mobile Workstation lists the GDDR6 on its own graphics chip, so it
      // was moved to Graphics Cards, moved back next refresh, and bounced
      // between the two for ever.
      if (/\b(gddr\d|boost\s+clock|stream\s+processors?|memory\s+clock|bus\s+width|\d{3}-bit\b)/i.test(t)
          && !looksLikeALaptop(t)) {
        return 'gpu';
      }
      // "ROG Swift PG259QN 24.5in 360Hz" is a monitor: ASUS uses ROG for both
      // its screens and its laptops. It has to be ROG Swift, though - a bare
      // "Swift" sent every Acer Swift laptop into Monitors.
      // A refresh rate and a screen size with no processor is also a screen.
      // Again, not for something that is plainly a laptop: a "Zenbook Pro 14
      // Duo ... Dual Monitor" is a two-screen laptop, not a screen.
      if (!looksLikeALaptop(t)
          && (/\brog\s+swift\b|\bmonitors?\b/i.test(t)
            || (/\b\d{2,3}\s*hz\b/i.test(t) && !/\b(ryzen|core|ultra|intel|amd|i[3579])\b/i.test(t)))) {
        return 'monitor';
      }
      // Without a gaming graphics chip or a gaming model name it is an
      // ordinary laptop, which this site does not publish.
      return /\b(rtx|gtx)\b|\b(rog|tuf|nitro|predator|legion|loq|omen|victus|katana|cyborg|alienware|raider|stealth|blade)\b|\bgaming\b/i.test(t)
        ? sub
        : 'laptop';
    case 'chair':
      // A "Gaming Chair Floor Mat" goes under a chair, it is not one.
      if (/\bfloor\s*mats?\b|\bmats?\b|\bcovers?\b|\bcushions?\b|\bcasters?\b/i.test(t)) return 'other';
      return keep(/\bchairs?\b|\bseat\b/i.test(t));
    case 'desk':
      // A desk mat covers a desk; it is not one. SteelSeries sells them with
      // "TO COVER DESK" in the name.
      if (/\bdesk\s*(mats?|pads?)\b|\bmouse\s*pads?\b|\bcover\s+desk\b/i.test(t)) return 'mousepad';
      // Monitor mounting hardware reaches this category through the shop's
      // own path rather than its title. Kept narrow so a real "Sit-Stand
      // Height Adjustable" desk is not caught with it.
      if (/\bmonitor\s+(stand|arm|mount)\b|\bdesk\s+mount\b|\bfoot\s*rests?\b|\brisers?\b|\bfloor\s*mats?\b|\borganisers?\b/i.test(t)) return 'other';
      // A "table clamp" and a "table top football" are not desks.
      return keep(/\bdesks?\b|\b(computer|gaming|office|study)\s+tables?\b/i.test(t) && !/\bdesktop\b/i.test(t));
    case 'case': {
      // Cases are sold on their glass side panel and their bundled fans, so
      // those words are only evidence against when nothing in the title says
      // "case" outright. Checked first, or a Lancool 216RX advertising its
      // mesh front panel stops being a case.
      // "...For Computer Case & Liquid Radiator" is a fan sold FOR a case.
      // That phrasing made the case test pass and kept every one of them here.
      if (/\bfor\s+(a\s+)?(pc|computer|gaming|desktop)?\s*(case|casing|chassis)\b/i.test(t)) return 'other';
      // "Kingston DataTraveler 128GB USB Flash Drive - Slim Metal Casing" is
      // a flash drive describing its shell.
      if (/\b(flash\s*drives?|usb\s*(stick|drive)|memory\s*cards?|micro\s*sd|datatraveler)\b/i.test(t)) return 'external-storage';
      const namesACase = /\b(pc|computer|gaming|desktop|mid[\s-]?tower|full[\s-]?tower|mini[\s-]?tower|atx|itx)\s*(case|casing|chassis)\b/i.test(t)
        || /\b(case|casing|chassis)\b[^.]{0,40}\b(mid|full|mini)[\s-]?tower\b/i.test(t)
        || /\b(mid|full|mini)[\s-]?tower\b[^.]{0,40}\b(case|casing|chassis)\b/i.test(t);
      // "Building Block Chassis Fan" says chassis but is a fan.
      if (!namesACase && /\bfans?\b|\bcoolers?\b|\bradiators?\b|\bfilters?\b|\bpanels?\b/i.test(t)) return 'other';
      // A "PC Case Bag" carries a case; it is not one.
      if (/\bi?phones?\b|\bgalaxy\b|\bipad\b|\btablet\b|\bmagnetic\b|\bsilicone\b|\bbags?\b|\bbackpacks?\b|\bsleeves?\b/i.test(t)) return 'other';
      // Needs to name itself a PC case. A bare "PC" is not enough: a phone
      // case model number like "PC-30" contains it.
      return keep(
        /\b(pc|computer|gaming|desktop)\s+(case|casing|chassis|tower)\b/i.test(t)
        || /\b(mid|full|mini)[\s-]?tower\b/i.test(t)
        || /\b(e-?atx|matx|micro[\s-]?atx|mini[\s-]?itx|itx)\b/i.test(t)
        || /\bchassis\b/i.test(t)
        || /\bcasing\b/i.test(t),
      );
    }
    // These three are reached mostly through a shop's own category path, so
    // the title has to back it up. Without that, an office superstore's
    // sharpeners and sticky notes land in Console Accessories and Controllers.
    // Peripherals had no checks at all, so anything the rules guessed stayed
    // guessed. A Bluetooth beanie hat sat in Headsets, and a phone lead sat
    // in Speakers, both at about 2 JOD.
    case 'headset':
      if (/\b(hats?|caps?|beanies?|beanie|scarf|gloves?|masks?)\b/i.test(t)) return 'other';
      if (/\b(stands?|hooks?|hangers?|splitters?|extension)\b/i.test(t)) return 'other';
      // A Lightning plug only fits an iPhone. Nobody games on one of these.
      if (/\blightning\b/i.test(t) && !/\bpc\b|\bgaming\b|\bconsole\b/i.test(t)) return 'other';
      return keep(/\b(head\s*(set|phone)s?|ear\s*(phone|bud)s?|earphones?|earbuds?|headsets?|gaming\s+audio)\b/i.test(t));
    case 'keyboard':
      // "Kingston 8GB USB 2.0 Music Keyboard Shape" is a flash drive that
      // looks like a keyboard.
      if (/\b(usb\s*\d|flash\s*drive|\d{1,3}\s*gb)\b/i.test(t) && /\bshape[ds]?\b/i.test(t)) return 'external-storage';
      return keep(/\b(keyboards?|keypads?|keeb)\b/i.test(t));
    case 'mouse':
      // "Mouse pad", "mouse bungee" and "mouse skates" all say mouse.
      if (/\b(pads?|mats?|bungees?|holders?|grips?)\b/i.test(t)) return 'other';
      return keep(/\b(mouse|mice)\b/i.test(t));
    case 'mousepad':
      return keep(/\b(mouse\s*pads?|mousepads?|desk\s*mats?|mouse\s*mats?|gaming\s+(pad|mat|surface))\b/i.test(t));
    case 'speakers':
      // Leads named after what they plug into: "REMAX IPh to 3.5mm 1.2M".
      if (/\bto\s*3\.5\s*mm\b|\b3\.5\s*mm\s*to\b|\baux\b|\bjacks?\b/i.test(t)) return 'other';
      if (/\bkaraoke\b/i.test(t)) return 'other';
      // "Smart Monitor w/ Speakers" is a monitor that has speakers.
      if (/\bmonitors?\b/i.test(t)) return 'monitor';
      // Living-room audio, not desk audio.
      if (/\bhome\s*theat(re|er)\b|\bsound\s*bar\s+for\s+tv\b|\btv\s+speakers?\b/i.test(t)) return 'other';
      return keep(/\b(speakers?|sound\s*bars?|soundbars?|subwoofers?)\b/i.test(t));
    case 'webcam':
      return keep(/\b(web\s*cams?|webcams?|capture\s+cards?|stream\s*decks?)\b/i.test(t));
    // Cases, protectors and card holders are things you keep games in, not
    // games. Video Games should be games.
    case 'video-game':
      // Only the things games are kept IN are excluded. Requiring the word
      // "game" in the title emptied the category, because almost no game is
      // named that way - "Elden Ring - PS5" says nothing about being a game.
      if (/\b(cases?|protectors?|holders?|slots?|covers?|skins?|pouch(es)?|wallets?|stands?|card\s+box)\b/i.test(t)) return 'other';
      if (/\bthumb\s*sticks?\b|\b\w*grips?\b|\bkontrolfreek\b/i.test(t)) return 'other';
      // A Mario figure is a toy, not a game.
      if (/\bfigures?\b|\bfigurines?\b|\bamiibo\b|\bstatues?\b|\bplush\b|\bkeychains?\b/i.test(t)) return 'other';
      return sub;
    // Card readers and the pouches a drive travels in are not storage.
    case 'external-storage':
      if (/\b(readers?|cases?|protection|pouch(es)?|sleeves?|adapt[oe]rs?|hubs?|docks?)\b/i.test(t)) return 'other';
      return keep(/\b(ssd|hdd|drives?|flash|memory\s*cards?|micro\s*sd|sd\s*cards?|storage|usb\s*(stick|drive))\b/i.test(t));
    case 'console-accessory':
      if (/\bmonitors?\b|\b\d{2,3}\s*hz\b/i.test(t)) return 'monitor';
      return keep(/\b(playstation|ps[45]|xbox|nintendo|switch|joy-?con|dualsense|dualshock|steam\s*deck|controller|gamepad|console)\b/i.test(t));
    case 'controller':
      // The grips, charging kits and thumbstick caps sold for a controller
      // are not controllers.
      if (/\b\w*grips?\b|\bcharge\s+(and|&)\s+play\b|\bcharging\s+(kit|dock|station)\b|\bfreek\b|\bthumb\s*sticks?\b|\bskins?\b|\bshells?\b|\bbattery\s+packs?\b|\bfire\s*stick\b|\btriggers?\b/i.test(t)) return 'other';
      return keep(/\b(controller|game\s*pad|gamepad|joy\s*stick|joy-?con|dualsense|dualshock|racing\s+wheel|steering\s+wheel|flight\s+stick|pedals?)\b/i.test(t));
    case 'microphone':
      // The things a microphone sits on or in front of are not microphones.
      if (/\b(stands?|arms?|booms?|mounts?|holders?|pop\s*filters?|shock\s*mounts?|wind\s*screens?|foams?|clips?)\b/i.test(t)) return 'other';
      // A karaoke machine is a party speaker, and a spare mic for a headset
      // is a spare part.
      if (/\bkaraoke\b/i.test(t)) return 'other';
      if (/\breplacement\b/i.test(t)) return 'other';
      return keep(/\b(microphones?|mics?|podcast|lavalier|condenser)\b/i.test(t));

    case 'console':
      // A monitor that mentions console compatibility is still a monitor.
      if (/\bmonitors?\b|\bhz\b|\bcurved\b|\bips\b|\bva panel\b/i.test(t)) return 'monitor';
      // "USB handbrake for PS5" is an accessory, not a console.
      return /\bfor\s+(the\s+)?(ps[45]|xbox|nintendo|switch|playstation)\b/i.test(t)
        ? 'console-accessory'
        : keep(/\b(playstation|ps[45]|xbox|nintendo\s+switch|switch\s*2|steam\s*deck|rog\s+ally|console)\b/i.test(t));
    default:
      return sub;
  }
}

const BRANDS = [
  'ASUS', 'ROG', 'TUF', 'MSI', 'Gigabyte', 'AORUS', 'ASRock', 'NVIDIA', 'AMD', 'Intel', 'Zotac', 'Palit', 'Galax', 'PNY', 'Inno3D', 'Sapphire', 'PowerColor', 'XFX', 'Colorful', 'Maxsun',
  'Corsair', 'Kingston', 'HyperX', 'G.Skill', 'Crucial', 'Micron', 'Samsung', 'ADATA', 'XPG', 'TeamGroup', 'Patriot', 'Lexar', 'Western Digital', 'Seagate', 'SanDisk', 'Kioxia', 'Netac', 'Silicon Power',
  'Cooler Master', 'NZXT', 'Lian Li', 'Thermaltake', 'be quiet!', 'Deepcool', 'Antec', 'Fractal Design', 'Phanteks', 'Arctic', 'Noctua', 'SilverStone', 'Aerocool', 'Xigmatek', '1stPlayer', 'Montech', 'Darkflash', 'Zalman', 'Jonsbo', 'Segotep', 'Raidmax',
  'Seasonic', 'EVGA', 'FSP', 'Super Flower', 'Gamdias', 'Redragon', 'Fantech', 'Marvo', 'Logitech', 'Razer', 'SteelSeries', 'Glorious', 'Ducky', 'Keychron', 'Akko', 'Cougar', 'Havit', 'A4Tech', 'Bloody', 'Genius', 'Rapoo', 'Meetion', 'Rampage',
  'Sony', 'PlayStation', 'Microsoft', 'Xbox', 'Nintendo', 'Anker', 'Baseus', 'UGREEN', 'Belkin', 'TP-Link', 'Tenda', 'D-Link', 'Mercusys',
  'HP', 'Dell', 'Lenovo', 'Acer', 'Predator', 'Apple', 'LG', 'BenQ', 'ViewSonic', 'AOC', 'Philips', 'Xiaomi', 'Huawei', 'Alienware', 'Omen', 'Victus', 'Legion',
  'Elgato', 'Rode', 'Shure', 'Trust', 'Sades', 'Onikuma', 'Edifier', 'JBL', 'Bose', 'Sennheiser', 'Audio-Technica', 'Divoom', 'Promate', 'Moza', 'Thrustmaster', 'Secretlab', 'DXRacer', 'AndaSeat', 'Sihoo', 'Astrum', 'Vinnfier',
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BRAND_RX = BRANDS
  .slice()
  .sort((a, b) => b.length - a.length)
  .map((b) => [b, new RegExp(`(^|[^a-z0-9])${esc(b)}([^a-z0-9]|$)`, 'i')]);

export function detectBrand(title, vendorHint = '') {
  const hint = (vendorHint || '').trim();
  if (hint && hint.length < 30 && !/^(default|generic|n\/?a|unknown|other|none|no\s*brand|brand|misc|various)$/i.test(hint)) {
    for (const [name, re] of BRAND_RX) if (re.test(hint)) return name;
    return hint;
  }
  for (const [name, re] of BRAND_RX) if (re.test(title)) return name;
  return null;
}

/**
 * Pull structured, filterable specs out of the retailer's own text.
 * Only what is actually stated is returned - missing values stay absent
 * so the UI can say "not specified" rather than guess.
 */
export function extractSpecs(sub, title, description = '') {
  const T = `${title} ${description}`.replace(/\s+/g, ' ');
  const s = {};
  const has = (re) => re.test(T);

  // The title names THIS product; the description often lists every model in
  // the range ("also available as 2x16GB"). So read the title first and only
  // fall back to the description when the title is silent.
  const cap = (re) => title.match(re) || T.match(re);

  switch (sub) {
    case 'ram': {
      const ddr = cap(/\bDDR([345])L?\b/i);
      if (ddr) s.ddr = `DDR${ddr[1]}`;
      else if (has(/\bLPDDR5X?\b/i)) s.ddr = 'DDR5';

      s.formFactor = has(/\bso[\s-]?dimm\b|\blaptop\b|\bnotebook\b/i) ? 'Laptop (SO-DIMM)' : 'Desktop (DIMM)';

      const kit = cap(/\b(\d)\s*[x×]\s*(\d{1,3})\s*GB\b/i);
      const single = cap(/\b(\d{1,3})\s*GB\b/i);
      if (kit) {
        s.sticks = parseInt(kit[1], 10);
        s.capacity = parseInt(kit[1], 10) * parseInt(kit[2], 10);
      } else if (single) {
        s.capacity = parseInt(single[1], 10);
        s.sticks = 1;
      }
      const sp = cap(/\b(\d{4,5})\s*(?:MHz|MT\/?s)\b/i) || cap(/\bDDR[345][\s-](\d{4,5})\b/i);
      if (sp) s.speed = parseInt(sp[1], 10);
      if (has(/\brgb\b/i)) s.rgb = true;
      const cl = cap(/\bCL\s?(\d{2})\b/i);
      if (cl) s.cas = parseInt(cl[1], 10);
      break;
    }

    case 'psu': {
      const w = cap(/\b(\d{3,4})\s*[Ww](?:att)?\b/);
      if (w) s.wattage = parseInt(w[1], 10);
      const eff = cap(/\b80\s*\+?\s*(?:plus\s*)?(white|standard|bronze|silver|gold|platinum|titanium)\b/i);
      if (eff) s.efficiency = '80+ ' + eff[1][0].toUpperCase() + eff[1].slice(1).toLowerCase();
      if (has(/\bfully?[\s-]?modular\b/i)) s.modular = 'Full Modular';
      else if (has(/\bsemi[\s-]?modular\b/i)) s.modular = 'Semi Modular';
      else if (has(/\bnon[\s-]?modular\b/i)) s.modular = 'Non Modular';
      if (has(/\bSFX[\s-]?L?\b/i)) s.formFactor = 'SFX';
      else if (has(/\bTFX\b/i)) s.formFactor = 'TFX';
      else if (has(/\bATX\b/i)) s.formFactor = 'ATX';
      if (has(/\bATX\s*3\.[01]\b|\bPCIe?\s*5\.[01]\b|\b12VHPWR\b|\b12V-2x6\b/i)) s.atx3 = true;
      break;
    }

    case 'gpu': {
      const nv = cap(/\b(?:GeForce\s+)?(RTX|GTX)\s*(\d{3,4})\s*(Ti\s*SUPER|SUPER|Ti)?\b/i);
      const amd = cap(/\b(?:Radeon\s+)?RX\s*([4-9]\d{2}|[5-9]\d{3})\s*(XTX|XT|GRE)?\b/i);
      const arc = cap(/\bArc\s+([AB]\d{3})\b/i);
      const gt = cap(/\bGT\s*(6[13]0|7[13]0|1030)\b/i);
      if (nv) s.chipset = `${nv[1].toUpperCase()} ${nv[2]}${nv[3] ? ' ' + nv[3].toUpperCase().replace(/\s+/g, ' ') : ''}`.trim();
      else if (amd) s.chipset = `RX ${amd[1]}${amd[2] ? ' ' + amd[2].toUpperCase() : ''}`;
      else if (arc) s.chipset = `Arc ${arc[1].toUpperCase()}`;
      else if (gt) s.chipset = `GT ${gt[1]}`;
      if (s.chipset) s.gpuBrand = /RTX|GTX/i.test(s.chipset) ? 'NVIDIA' : /^RX/.test(s.chipset) ? 'AMD' : 'Intel';
      const v = cap(/\b(\d{1,2})\s*GB\b/i);
      if (v) s.vram = parseInt(v[1], 10);
      break;
    }

    case 'cpu': {
      if (has(/\bryzen\b|\bathlon\b|\bthreadripper\b/i)) s.cpuBrand = 'AMD';
      else if (has(/\bintel\b|\bcore\b|\bpentium\b|\bceleron\b|\bxeon\b/i)) s.cpuBrand = 'Intel';
      const ry = cap(/\bRyzen\s+([3579])\b/i);
      const ci = cap(/\b(?:Core\s+)?i([3579])[\s-]?\d{4,5}/i);
      const cu = cap(/\bCore\s+Ultra\s+([579])\b/i);
      if (ry) s.series = `Ryzen ${ry[1]}`;
      else if (cu) s.series = `Core Ultra ${cu[1]}`;
      else if (ci) s.series = `Core i${ci[1]}`;
      const sock = cap(/\b(AM5|AM4|sTRX4|sTR5|LGA\s?1700|LGA\s?1851|LGA\s?1200|LGA\s?1151)\b/i);
      if (sock) s.socket = sock[1].toUpperCase().replace(/\s+/g, '');
      const c = cap(/\b(\d{1,2})[\s-]?cores?\b/i);
      if (c) s.cores = parseInt(c[1], 10);
      break;
    }

    case 'motherboard': {
      const sock = cap(/\b(AM5|AM4|LGA\s?1700|LGA\s?1851|LGA\s?1200|LGA\s?1151)\b/i);
      if (sock) s.socket = sock[1].toUpperCase().replace(/\s+/g, '');
      const chip = cap(/\b([XZBHA][3-9]\d{2}[A-Z]?)\b/);
      if (chip) s.chipset = chip[1].toUpperCase();
      if (has(/\bmini[\s-]?itx\b|\bm[\s-]?itx\b/i)) s.formFactor = 'Mini-ITX';
      else if (has(/\bmicro[\s-]?atx\b|\bm[\s-]?atx\b|\bmatx\b/i)) s.formFactor = 'Micro-ATX';
      else if (has(/\be[\s-]?atx\b/i)) s.formFactor = 'E-ATX';
      else if (has(/\batx\b/i)) s.formFactor = 'ATX';
      if (has(/\bDDR5\b/i)) s.memory = 'DDR5';
      else if (has(/\bDDR4\b/i)) s.memory = 'DDR4';
      if (has(/\bwi[\s-]?fi\b/i)) s.wifi = true;
      break;
    }

    case 'storage': {
      // Capacity is decided from the title as a whole, or from the
      // description as a whole - never half from each. Checking "TB" and then
      // "GB" separately let a drive whose title says 250GB take a "2TB" out
      // of the description's list of other models in the range, and a 240GB
      // drive take its "92TBW" endurance figure - which came out as 94,208GB
      // and made it the best storage in the catalogue.
      const sizeIn = (text) => {
        const tb = text.match(/\b(\d{1,2})(?:\.(\d))?\s*TB\b(?!W)/i);
        const gb = text.match(/\b(\d{3,5})\s*GB\b(?!W)/i);
        // Whichever appears first is the one naming this product.
        if (tb && gb) return tb.index < gb.index ? tbVal(tb) : parseInt(gb[1], 10);
        if (tb) return tbVal(tb);
        if (gb) return parseInt(gb[1], 10);
        return null;
      };
      const tbVal = (m) => Math.round((parseInt(m[1], 10) + (m[2] ? Number(`0.${m[2]}`) : 0)) * 1024);
      const size = sizeIn(title) ?? sizeIn(T);
      if (size) s.capacity = size;
      if (has(/\bnvme\b|\bm\.2\b/i)) s.type = 'NVMe SSD';
      else if (has(/\bssd\b/i)) s.type = 'SATA SSD';
      else if (has(/\bhdd\b|\bhard\s*(disk|drive)\b/i)) s.type = 'Hard Drive';
      const g = cap(/\bgen\s*([345])\b/i) || cap(/\bPCIe?\s*([345])\.\d\b/i);
      if (g) s.pcie = `PCIe Gen${g[1]}`;
      if (has(/\b2\.5["”]|\b2\.5\s*inch\b/i)) s.formFactor = '2.5 inch';
      else if (has(/\b3\.5["”]|\b3\.5\s*inch\b/i)) s.formFactor = '3.5 inch';
      else if (has(/\bm\.2\s*2280\b/i)) s.formFactor = 'M.2 2280';
      const rd = cap(/\b(\d{3,5})\s*MB\/s\b/i);
      if (rd) s.readSpeed = parseInt(rd[1], 10);
      break;
    }

    case 'case': {
      if (has(/\bfull[\s-]?tower\b/i)) s.size = 'Full Tower';
      else if (has(/\bmid[\s-]?tower\b/i)) s.size = 'Mid Tower';
      else if (has(/\bmini[\s-]?tower\b|\bitx\b|\bsff\b/i)) s.size = 'Mini / ITX';
      if (has(/\btempered\s+glass\b/i)) s.panel = 'Tempered Glass';
      else if (has(/\bmesh\b/i)) s.panel = 'Mesh';
      if (has(/\bargb\b|\brgb\b/i)) s.rgb = true;
      const f = cap(/\b(\d)\s*[x×]?\s*fans?\b/i);
      if (f) s.includedFans = parseInt(f[1], 10);
      break;
    }

    case 'cooling': {
      if (has(/\baio\b|\bliquid\b|\bwater\s*cool/i)) s.type = 'Liquid / AIO';
      else if (has(/\bthermal\s+(paste|compound|grease)\b/i)) s.type = 'Thermal Paste';
      else if (has(/\bcooler\b|\bheat\s*sink\b/i)) s.type = 'Air Cooler';
      else s.type = 'Case Fan';
      const rad = cap(/\b(120|140|240|280|360|420)\s*mm\b/i);
      if (rad) s.size = `${rad[1]}mm`;
      if (has(/\bargb\b|\brgb\b/i)) s.rgb = true;
      break;
    }

    case 'monitor': {
      const inch = cap(/\b(\d{2}(?:\.\d)?)\s*(?:inch|["”″])/i);
      if (inch) s.size = parseFloat(inch[1]);
      const hz = cap(/\b(\d{2,3})\s*hz\b/i);
      if (hz) s.refresh = parseInt(hz[1], 10);
      if (has(/\b3840\s*[x×]\s*2160\b|\b4k\b|\buhd\b/i)) s.resolution = '4K UHD';
      else if (has(/\b3440\s*[x×]\s*1440\b|\buwqhd\b/i)) s.resolution = 'UWQHD';
      else if (has(/\b2560\s*[x×]\s*1440\b|\bqhd\b|\bwqhd\b|\b1440p\b/i)) s.resolution = 'QHD 1440p';
      else if (has(/\b1920\s*[x×]\s*1080\b|\bfhd\b|\bfull\s*hd\b|\b1080p\b/i)) s.resolution = 'FHD 1080p';
      if (has(/\boled\b/i)) s.panel = 'OLED';
      else if (has(/\bips\b/i)) s.panel = 'IPS';
      else if (has(/\bva\b/i)) s.panel = 'VA';
      else if (has(/\btn\b/i)) s.panel = 'TN';
      if (has(/\bcurved\b|\b\d{4}R\b/i)) s.curved = true;
      const ms = cap(/\b(\d(?:\.\d)?)\s*ms\b/i);
      if (ms) s.responseTime = parseFloat(ms[1]);
      break;
    }

    case 'keyboard': {
      if (has(/\bhall\s*effect\b|\bmagnetic\s+switch/i)) s.switchType = 'Hall Effect';
      else if (has(/\boptical\b/i)) s.switchType = 'Optical';
      else if (has(/\bmechanical\b/i)) s.switchType = 'Mechanical';
      else if (has(/\bmembrane\b/i)) s.switchType = 'Membrane';
      if (has(/\b60\s*%/)) s.layout = '60%';
      else if (has(/\b65\s*%/)) s.layout = '65%';
      else if (has(/\b75\s*%/)) s.layout = '75%';
      else if (has(/\btkl\b|\b87\s*keys?\b|\btenkeyless\b/i)) s.layout = 'TKL';
      else if (has(/\b10[4-9]\s*keys?\b|\bfull\s*size\b/i)) s.layout = 'Full Size';
      s.connection = has(/\bwireless\b|\bbluetooth\b|\b2\.4\s*g(hz)?\b|\btri[\s-]?mode\b/i) ? 'Wireless' : 'Wired';
      if (has(/\brgb\b|\bbacklit\b/i)) s.rgb = true;
      if (has(/\barabic\b/i)) s.arabic = true;
      break;
    }

    case 'mouse': {
      s.connection = has(/\bwireless\b|\bbluetooth\b|\b2\.4\s*g(hz)?\b|\btri[\s-]?mode\b/i) ? 'Wireless' : 'Wired';
      const dpi = cap(/\b(\d{4,6})\s*dpi\b/i);
      if (dpi) s.dpi = parseInt(dpi[1], 10);
      const wt = cap(/\b(\d{2,3})\s*g(?:ram)?s?\b(?![a-z])/i);
      if (wt) {
        const g = parseInt(wt[1], 10);
        if (g >= 30 && g <= 200) s.weight = g;
      }
      if (has(/\brgb\b/i)) s.rgb = true;
      break;
    }

    case 'headset': {
      s.connection = has(/\bwireless\b|\bbluetooth\b|\b2\.4\s*g(hz)?\b/i) ? 'Wireless' : 'Wired';
      if (has(/\b7\.1\b/)) s.surround = '7.1 Surround';
      else if (has(/\bstereo\b/i)) s.surround = 'Stereo';
      if (has(/\bnoise\s*cancel/i)) s.anc = true;
      if (has(/\bear\s*buds?\b|\bin[\s-]?ear\b/i)) s.style = 'Earbuds';
      else s.style = 'Over-Ear';
      break;
    }

    case 'chair': {
      if (has(/\bmesh\b/i)) s.material = 'Mesh';
      else if (has(/\bfabric\b/i)) s.material = 'Fabric';
      else if (has(/\bleather\b|\bpu\b/i)) s.material = 'Leather / PU';
      if (has(/\bfoot\s*rest\b|\bfootrest\b/i)) s.footrest = true;
      if (has(/\bmassage\b/i)) s.massage = true;
      break;
    }

    case 'desk': {
      const w = cap(/\b(\d{2,3})\s*[x×]\s*(\d{2,3})\b/);
      if (w) s.size = `${w[1]}x${w[2]}cm`;
      if (has(/\bheight\s*adjust|\bstanding\b|\bsit[\s-]?stand\b/i)) s.adjustable = true;
      if (has(/\brgb\b|\bled\b/i)) s.rgb = true;
      break;
    }

    case 'prebuilt':
    case 'gaming-laptop':
    case 'laptop': {
      const nv = cap(/\b(?:GeForce\s+)?(RTX|GTX)\s*(\d{3,4})\s*(Ti\s*SUPER|SUPER|Ti)?\b/i);
      if (nv) s.gpu = `${nv[1].toUpperCase()} ${nv[2]}${nv[3] ? ' ' + nv[3].toUpperCase() : ''}`.trim();
      const ry = cap(/\bRyzen\s+([3579])\b/i);
      const ci = cap(/\b(?:Core\s+)?i([3579])[\s-]?\d{4,5}/i);
      const cu = cap(/\bCore\s+Ultra\s+([579])\b/i);
      if (ry) s.cpu = `Ryzen ${ry[1]}`;
      else if (cu) s.cpu = `Core Ultra ${cu[1]}`;
      else if (ci) s.cpu = `Core i${ci[1]}`;
      const ram = cap(/\b(\d{1,3})\s*GB\s*(?:DDR[345]|RAM|memory)/i) || cap(/\b(?:RAM|memory)\D{0,12}(\d{1,3})\s*GB\b/i);
      if (ram) s.ram = parseInt(ram[1], 10);
      const tb = cap(/\b(\d)\s*TB\b/i);
      const gb = cap(/\b(256|512)\s*GB\s*(?:SSD|NVMe|M\.2)/i);
      if (tb) s.storage = parseInt(tb[1], 10) * 1024;
      else if (gb) s.storage = parseInt(gb[1], 10);
      if (sub !== 'prebuilt') {
        const inch = cap(/\b(1[3-8](?:\.\d)?)\s*(?:inch|["”″])/i);
        if (inch) s.screen = parseFloat(inch[1]);
        const hz = cap(/\b(\d{2,3})\s*hz\b/i);
        if (hz) s.refresh = parseInt(hz[1], 10);
      }
      break;
    }

    case 'controller': {
      if (has(/\bps5\b|\bplaystation\s*5\b|\bdualsense\b/i)) s.platform = 'PlayStation 5';
      else if (has(/\bps4\b|\bplaystation\s*4\b|\bdualshock\b/i)) s.platform = 'PlayStation 4';
      else if (has(/\bxbox\b/i)) s.platform = 'Xbox';
      else if (has(/\bswitch\b|\bnintendo\b/i)) s.platform = 'Nintendo Switch';
      else if (has(/\bpc\b/i)) s.platform = 'PC';
      s.connection = has(/\bwireless\b|\bbluetooth\b/i) ? 'Wireless' : 'Wired';
      break;
    }

    case 'external-storage': {
      const tb = cap(/\b(\d{1,2})\s*TB\b/i);
      const gb = cap(/\b(\d{2,4})\s*GB\b/i);
      if (tb) s.capacity = parseInt(tb[1], 10) * 1024;
      else if (gb) s.capacity = parseInt(gb[1], 10);
      if (has(/\bssd\b/i)) s.type = 'External SSD';
      else if (has(/\bflash\b|\busb\s*(drive|stick)\b/i)) s.type = 'Flash Drive';
      else if (has(/\bmicro\s*sd\b|\bsd\s*card\b|\bmemory\s*card\b/i)) s.type = 'Memory Card';
      else s.type = 'External HDD';
      break;
    }
  }

  // Universal: colour, when the retailer states one.
  const col = title.match(/\b(black|white|pink|blue|red|green|purple|silver|grey|gray|yellow|orange|beige|lavender|mint|titanium|gold)\b/i);
  if (col) s.color = col[1][0].toUpperCase() + col[1].slice(1).toLowerCase();

  return s;
}

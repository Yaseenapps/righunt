// The Jordanian retailers we aggregate. `adapter` picks how we read them:
// shopify / woocommerce use the shop's own public JSON API; opencart and
// custom adapters parse the public catalogue pages.

export const STORES = [
  {
    id: 'igeek',
    name: 'iGeek Megastore',
    base: 'https://igeekjo.com',
    adapter: 'shopify',
    color: '#e63946',
    enabled: true,
  },
  {
    id: 'gameon',
    name: 'GameOn JO',
    base: 'https://gameonjo.com',
    adapter: 'shopify',
    color: '#8338ec',
    enabled: true,
  },
  {
    id: 'pccircle',
    name: 'PC Circle',
    base: 'https://pccircle.com',
    adapter: 'woocommerce',
    color: '#0077b6',
    enabled: true,
  },
  {
    id: 'compujordan',
    name: 'Compu Jordan',
    base: 'https://compujordan.com',
    adapter: 'opencart',
    color: '#f77f00',
    enabled: true,
    roots: [
      '/gaming-rampage',
      '/pc-and-laptops',
      '/computer-hardware',
      '/monitor-and-display',
      '/electronics',
    ],
  },
  {
    // DISABLED: citycenter.jo answers our crawler with HTTP 403. That is the
    // shop deliberately refusing automated access, so we do not work around
    // it. Flip `enabled` back to true to retry - if the block is lifted the
    // adapter works unchanged.
    id: 'citycenter',
    name: 'City Center Computers',
    base: 'https://citycenter.jo',
    adapter: 'opencart',
    color: '#06d6a0',
    enabled: false,
    roots: [
      '/gaming',
      '/pc-and-laptops',
      '/computer-hardware',
      '/networking',
      '/electronics',
    ],
  },
  {
    id: 'orientalstore',
    name: 'Oriental Store',
    base: 'https://os-jo.com',
    adapter: 'opencart',
    color: '#ffb703',
    enabled: true,
    roots: [
      '/computer-systems',
      '/components',
      '/accessories',
      '/gaming-in-jordan',
      '/custom-cooling',
      '/bundles',
      '/network',
    ],
  },
  {
    // Instagram and Facebook sellers, curated by hand in social-listings.json.
    // See that file's notes: the platforms cannot be read automatically.
    id: 'social',
    name: 'Instagram & Facebook sellers',
    base: 'https://www.instagram.com',
    adapter: 'social',
    color: '#e1306c',
    enabled: true,
  },
  {
    id: 'whiteangel',
    name: 'White Angel',
    base: 'https://whiteangeljo.com',
    adapter: 'woocommerce',
    color: '#14b8a6',
    enabled: true,
  },
  {
    id: 'compume',
    name: 'Compu Me',
    base: 'https://www.compume.jo',
    adapter: 'shopify',
    color: '#ec4899',
    enabled: true,
  },
  {
    id: 'numberone',
    name: 'Number One Store',
    base: 'https://numberonestore.net',
    adapter: 'opencart',
    color: '#84cc16',
    enabled: true,
    // Its sitemap lists individual products at the top level alongside real
    // categories, so the sections are named explicitly.
    roots: [
      '/components',
      '/Computer-Accessories',
      '/audio',
      '/gaming-headset',
      '/Gaming-Controllers',
      '/gaming-keyboard',
      '/gaming-mouse',
      '/gaming-chair',
      '/gaming-desk',
      '/gaming-gear-accessories',
      '/game-pad',
    ],
  },
  {
    id: 'midas',
    name: 'Midas Computer Center',
    base: 'https://mcc-jo.com',
    adapter: 'midas',
    color: '#3a86ff',
    enabled: true,
    roots: [
      '/category/components',
      '/category/gaming',
      '/category/accessories',
      '/category/monitors',
      '/category/desktop-computers',
      '/category/laptops',
      '/category/networking',
    ],
  },
];

export const byId = (id) => STORES.find((s) => s.id === id);

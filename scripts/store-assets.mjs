// Generates Chrome Web Store images and site screenshots from the real dist/ build.
// Every recipe and page shown is synthetic; no third-party content appears.
// Run: npm run store:assets
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, ROOT, sleep } from '../tests/e2e/harness.mjs';

const STORE = join(ROOT, 'store/assets');
const SITE = join(ROOT, 'docs/assets');
const RAW = join(ROOT, 'work/store-raw');
for (const d of [STORE, SITE, RAW]) mkdirSync(d, { recursive: true });

const HOST = 'https://www.kitchen.example';
const recipes = [
  {
    slug: 'lemon-rice', name: 'Weeknight Lemon Rice', yield: '4 servings', prep: 'PT10M', cook: 'PT20M',
    ing: ['1 ½ cups long-grain rice', '2 ¼ cups water', '2 tablespoons olive oil', '1 lemon, zested and juiced', '¼ cup chopped parsley', '1 teaspoon salt'],
    steps: ['Rinse the rice until the water runs clear.', 'Simmer the rice in the water, covered, for 18 minutes.', 'Rest for 5 minutes, then stir in the oil, lemon, parsley and salt.'],
  },
  {
    slug: 'tomato-soup', name: 'Roasted Tomato Soup', yield: '6 servings', prep: 'PT15M', cook: 'PT45M',
    ing: ['3 pounds ripe tomatoes, halved', '1 large onion, sliced', '4 garlic cloves', '3 tablespoons olive oil', '2 cups vegetable stock', '1 teaspoon salt'],
    steps: ['Roast the tomatoes, onion and garlic with the oil at 400°F for 40 minutes.', 'Simmer with the stock for 5 minutes.', 'Blend until smooth and season with the salt.'],
  },
  {
    slug: 'oat-cookies', name: 'Brown Butter Oat Cookies', yield: '24 cookies', prep: 'PT20M', cook: 'PT12M',
    ing: ['1 cup butter', '1 ½ cups brown sugar', '2 large eggs', '1 ½ cups flour', '3 cups rolled oats', '1 teaspoon baking soda'],
    steps: ['Brown the butter and cool it slightly.', 'Whisk in the sugar and eggs, then fold in the dry ingredients.', 'Bake spoonfuls at 350°F for 12 minutes.'],
  },
  {
    slug: 'black-beans', name: 'Sunday Black Beans', yield: '8 servings', prep: 'PT10M', cook: 'PT2H',
    ing: ['1 pound dried black beans', '1 green pepper, diced', '1 onion, diced', '3 garlic cloves, minced', '2 bay leaves', '2 teaspoons salt'],
    steps: ['Soak the beans overnight and drain them.', 'Simmer everything except the salt in fresh water for 2 hours.', 'Stir in the salt and simmer for 10 more minutes.'],
  },
];

const story = [
  'The first time I made this I was standing in my aunt’s kitchen, in the summer of the big storm, wearing a borrowed apron and absolutely no shoes.',
  'Before we get to the food, let me tell you about that apron. It had belonged to three generations of very opinionated cooks.',
  'My kids say this is the best thing I make. My kids also say that about cereal, so please take that with a grain of salt. Speaking of salt…',
  'Anyway, this recipe changed my life, and over the next nine paragraphs I will explain exactly how.',
];

const blogPage = (r) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${r.name} | Example Kitchen</title>
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org', '@type': 'Recipe', name: r.name, author: { '@type': 'Person', name: 'Rae Tester' },
  publisher: { '@type': 'Organization', name: 'Example Kitchen' }, recipeYield: r.yield, prepTime: r.prep, cookTime: r.cook,
  recipeIngredient: r.ing, recipeInstructions: r.steps.map((text) => ({ '@type': 'HowToStep', text })),
})}</script>
<style>
body{margin:0;font:18px/1.7 Georgia,serif;color:#333;background:#fff}
nav{display:flex;gap:22px;padding:16px 32px;border-bottom:1px solid #ddd;font:600 14px system-ui}
nav b{margin-right:auto;font:700 22px Georgia}
.ad{background:repeating-linear-gradient(45deg,#eee,#eee 12px,#e4e4e4 12px,#e4e4e4 24px);color:#888;display:grid;place-items:center;font:600 13px system-ui}
.top{height:90px;margin:16px 32px}
main{max-width:620px;margin:0 auto;padding:0 32px}
h1{font-size:38px;line-height:1.15;margin:.5em 0 .2em}
.by{font:14px system-ui;color:#777}
.mid{height:170px;margin:22px 0}
.modal{position:fixed;right:24px;bottom:24px;width:300px;padding:18px;background:#fff;border:1px solid #bbb;box-shadow:0 12px 30px #0003;font:15px/1.4 system-ui}
.modal b{display:block;font-size:18px;margin-bottom:6px}
.modal span{display:block;margin-top:10px;background:#c0392b;color:#fff;padding:9px;text-align:center;font-weight:700;border-radius:4px}
</style></head><body>
<nav><b>Example Kitchen</b><span>Recipes</span><span>About me</span><span>My story</span><span>Shop</span></nav>
<div class="ad top">Advertisement</div>
<main><h1>The BEST ${r.name} You’ll Ever Make</h1><p class="by">By Rae Tester, 14 minute read, 2,381 comments</p>
<p>${story[0]}</p><div class="ad mid">Advertisement</div><p>${story[1]}</p><p>${story[2]}</p><p>${story[3]}</p></main>
<div class="modal"><b>Wait! Before you go…</b>Join 80,000 home cooks and get my free ebook.<span>Sign me up</span></div>
</body></html>`;

const png = (f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`;

const TOKENS = `:root{--paper:#FAF6EC;--card:#FFFDF7;--ink:#1F2A26;--green:#1F5C45;--deep:#174A37;--tomato:#B23A23;--line:#D8CFBA}
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}
body{font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;color:var(--ink)}
.gingham{background-color:#F4EFE2;background-image:linear-gradient(90deg,rgb(31 92 69/.26) 50%,transparent 50%),linear-gradient(rgb(31 92 69/.26) 50%,transparent 50%);background-size:56px 56px}`;

/** Caption on the left, real product capture on the right. */
const captioned = (title, body, img, { width = 400, top = 44 } = {}) => `<!doctype html><meta charset="utf-8"><style>${TOKENS}
.s{display:grid;grid-template-columns:440px 1fr;height:800px}
.c{background:var(--deep);color:#FFFDF7;padding:0 44px;display:flex;flex-direction:column;justify-content:center}
h1{font-size:50px;line-height:1.06;margin:0 0 20px;font-weight:700;letter-spacing:-.01em}
p{font:22px/1.42 system-ui,sans-serif;margin:0;color:#DDE9E0}
.p{overflow:hidden;display:flex;justify-content:center;align-items:flex-start;padding-top:${top}px}
.p img{display:block;width:${width}px;height:auto;border-radius:12px 12px 0 0;box-shadow:0 18px 40px rgb(23 50 40/.42)}
</style><div class="s"><div class="c"><h1>${title}</h1><p>${body}</p></div><div class="p gingham"><img src="${img}"></div></div>`;

const h = await launch();
const { ctx } = h;
await ctx.route(`${HOST}/**`, (route) => {
  const r = recipes.find((x) => route.request().url().includes(x.slug));
  return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: r ? blogPage(r) : 'not found' });
});

async function read(page) {
  await h.clickToolbar(page);
  await sleep(250);
  if (await h.pv(() => /Welcome to Recipe Pocket/.test(window.__rp.snapshot().h1))) {
    await h.pv(() => window.__rp.markLoading());
    await h.pv(() => window.__rp.click('Read recipe'));
  }
  return h.waitReadDone(15000);
}

try {
  // The page as the reader sees it, next to the real side panel, before anything is saved.
  const reader = await ctx.newPage();
  await reader.setViewportSize({ width: 880, height: 800 });
  await reader.goto(`${HOST}/${recipes[0].slug}`);
  const first = await read(reader);
  if (first.h1 !== recipes[0].name) throw new Error(`read "${first.h1}"`);
  await reader.screenshot({ path: join(RAW, 'blog.png') });
  await h.panelScreenshot(join(RAW, 'panel.png'), 400, 800);

  // Scaled and converted, scrolled so the changed amounts are in view.
  const setUnits = (v) => h.pv((value) => {
    const sel = document.querySelector('.units-field select');
    sel.value = value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, v);
  await h.pv(() => window.__rp.setInput('.servings-input', '8'));
  await setUnits('metric');
  await sleep(250);
  await h.panel.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 760, deviceScaleFactor: 1, mobile: false });
  await sleep(150);
  await h.pv(() => {
    document.querySelector('main h1').scrollIntoView({ block: 'start' });
    return true;
  });
  await sleep(150);
  const { data } = await h.panel.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(RAW, 'panel-scaled.png'), Buffer.from(data, 'base64'));
  await h.panel.send('Emulation.clearDeviceMetricsOverride');
  await h.pv(() => window.__rp.click('Reset'));
  await setUnits('original');

  // Cook mode, in the same side panel.
  await h.pv(() => window.__rp.click('Cook mode'));
  await sleep(300);
  await h.panelScreenshot(join(RAW, 'panel-cook.png'), 400, 800);
  await h.pv(() => window.__rp.click('Exit cook mode'));
  await sleep(200);

  // Save the first recipe and the others, then add one to the shopping list.
  await h.pv(() => window.__rp.click('Save'));
  await sleep(350);
  await h.pv(() => window.__rp.click('Add to shopping list'));
  await h.waitPanel(() => !!window.__rp.btn('Add ingredients') || !!window.__rp.btn('Add to list'), null, 3000, 'add form');
  await h.pv(() => window.__rp.click(window.__rp.btn('Add ingredients') ? 'Add ingredients' : 'Add to list'));
  await h.waitPanel(() => window.__rp.snapshot().notices.find((t) => /Added \d+ ingredients?/.test(t)), null, 5000, 'added notice');
  for (const r of recipes.slice(1)) {
    const page = await ctx.newPage();
    await page.goto(`${HOST}/${r.slug}`);
    const snap = await read(page);
    if (snap.h1 !== r.name) throw new Error(`read "${snap.h1}", expected "${r.name}"`);
    await h.pv(() => window.__rp.click('Save'));
    await sleep(350);
    await page.close();
  }

  const lib = await ctx.newPage();
  await lib.setViewportSize({ width: 900, height: 800 });
  await lib.goto(h.extUrl('ui/library.html'));
  await lib.getByText('Weeknight Lemon Rice').first().waitFor({ timeout: 5000 });
  await sleep(200);
  await lib.screenshot({ path: join(RAW, 'library.png') });
  await lib.goto(h.extUrl('ui/library.html#lists'));
  const listLink = lib.getByRole('link', { name: 'Shopping list', exact: true });
  await listLink.waitFor({ timeout: 5000 });
  await listLink.click();
  await sleep(500);
  await lib.screenshot({ path: join(RAW, 'list.png') });

  // Compose at exactly the store's sizes.
  const stage = await ctx.newPage();
  const render = async (html, width, height, file) => {
    await stage.setViewportSize({ width, height });
    await stage.setContent(html, { waitUntil: 'load' });
    await sleep(120);
    await stage.screenshot({ path: file });
  };

  await render(
    `<!doctype html><meta charset="utf-8"><style>${TOKENS}.s{display:flex;height:800px;background:var(--paper)}.s img{display:block}.b{filter:saturate(.75)}.p{width:400px;border-left:1px solid #bbb;background:var(--paper)}</style>
     <div class="s"><img class="b" width="880" height="800" src="${png(join(RAW, 'blog.png'))}"><div class="p"><img width="399" src="${png(join(RAW, 'panel.png'))}"></div></div>`,
    1280, 800, join(STORE, 'screenshot-1-reader.png'));
  await render(captioned('Double it. Switch to metric.', 'Amounts scale with exact fractions and convert between US and metric.', png(join(RAW, 'panel-scaled.png')), { width: 440, top: 0 }), 1280, 800, join(STORE, 'screenshot-2-scale.png'));
  await render(captioned('Keep the ones you’ll make again.', 'Search, tags and collections, saved in your browser.', png(join(RAW, 'library.png')), { width: 760, top: 96 }), 1280, 800, join(STORE, 'screenshot-3-library.png'));
  await render(captioned('Shop from one list.', 'Send a recipe’s ingredients to a list, sorted by aisle, and check them off.', png(join(RAW, 'list.png')), { width: 760, top: 96 }), 1280, 800, join(STORE, 'screenshot-4-list.png'));
  await render(captioned('Cook without scrolling back.', 'One step at a time in large text, with ingredients to check off.', png(join(RAW, 'panel-cook.png')), { width: 440, top: 36 }), 1280, 800, join(STORE, 'screenshot-5-cook.png'));

  const promo = (width, height, h1, p) => `<!doctype html><meta charset="utf-8"><style>${TOKENS}
    .s{width:${width}px;height:${height}px;display:flex;align-items:center;padding:${height * 0.1}px}
    .k{background:var(--card);border-top:${height * 0.018}px solid var(--tomato);box-shadow:0 14px 30px rgb(23 50 40/.38);padding:${height * 0.08}px ${height * 0.11}px;transform:rotate(-1.5deg)}
    h1{font-size:${h1}px;line-height:1.04;margin:0;letter-spacing:-.01em}p{font:${p}px/1.3 system-ui,sans-serif;margin:.55em 0 0;color:#46524C}
    </style><div class="s gingham"><div class="k"><h1>Recipe Pocket</h1><p>Read the recipe, skip the life story.</p></div></div>`;
  await render(promo(440, 280, 46, 19), 440, 280, join(STORE, 'promo-small-440x280.png'));
  await render(promo(1400, 560, 104, 38), 1400, 560, join(STORE, 'promo-marquee-1400x560.png'));

  // Site images: the real panel and pages, cropped by the page layout.
  for (const [from, to] of [['panel-scaled', 'panel-scaled'], ['library', 'library'], ['list', 'list'], ['panel-cook', 'panel-cook']]) {
    writeFileSync(join(SITE, `${to}.png`), readFileSync(join(RAW, `${from}.png`)));
  }
  writeFileSync(join(SITE, 'og.png'), readFileSync(join(STORE, 'promo-marquee-1400x560.png')));
  writeFileSync(join(SITE, 'icon128.png'), readFileSync(join(ROOT, 'dist/icons/icon128.png')));
  if (h.errors.length) throw new Error(`extension errors: ${JSON.stringify(h.errors).slice(0, 500)}`);
  console.log('Store and site images written.');
} finally {
  await h.close();
}

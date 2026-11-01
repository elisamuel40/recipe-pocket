// End-to-end suite for Recipe Pocket in a real Chromium. Run with `npm run e2e`.
// Writes qa/e2e-results.json and screenshots to qa/screenshots/.
// Options (env): E2E_SKIP_LIVE=1 skips the 12 live sites; E2E_ONLY=fixtures,library,... limits sections.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { launch, startFixtureServer, ROOT, DIST, sleep } from './harness.mjs';

const QA = join(ROOT, 'qa');
const SHOTS = join(QA, 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const only = process.env.E2E_ONLY ? new Set(process.env.E2E_ONLY.split(',')) : null;
const want = (s) => !only || only.has(s);

const results = [];
let current = null;
async function check(id, name, fn) {
  const rec = { id, name, status: 'not_run', expected: '', actual: '', evidence: [] };
  current = rec;
  const started = Date.now();
  try {
    const out = (await fn(rec)) ?? {};
    Object.assign(rec, out);
    if (rec.status === 'not_run') rec.status = 'pass';
  } catch (e) {
    rec.status = 'fail';
    rec.actual = rec.actual ? `${rec.actual} | ERROR: ${e.message}` : `ERROR: ${e.message}`;
  }
  rec.ms = Date.now() - started;
  results.push(rec);
  console.log(`[${rec.status.toUpperCase()}] ${id} ${name}${rec.status !== 'pass' ? ` — ${String(rec.actual).slice(0, 400)}` : ''}`);
  return rec;
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const shot = (name) => {
  const f = join(SHOTS, name);
  current?.evidence.push(`qa/screenshots/${name}`);
  return f;
};

const h = await launch();
const fx = await startFixtureServer([join(ROOT, 'tests/fixtures/extraction'), join(ROOT, 'tests/e2e/fixtures')]);
let tabCounter = 0;
const fixtureUrl = (f) => `${fx.origin}/${f}?tab=${++tabCounter}`;
const meta = {
  date: new Date().toISOString(),
  chromium: h.version.product,
  userAgent: h.version.userAgent,
  commit: (() => {
    try {
      return execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim() + (execSync('git status --porcelain src', { cwd: ROOT }).toString().trim() ? ' (+uncommitted src changes)' : '');
    } catch {
      return 'unknown';
    }
  })(),
  extensionId: h.extId,
  dist: DIST,
};

/** Click the toolbar icon on `page` and wait for the read (dismissing onboarding if shown). */
async function toolbarRead(page, timeout = 15000) {
  await h.clickToolbar(page);
  await sleep(200);
  if (await h.pv(() => /Welcome to Recipe Pocket/.test(window.__rp.snapshot().h1))) {
    await h.pv(() => window.__rp.markLoading());
    await h.pv(() => window.__rp.click('Read recipe'));
  }
  return h.waitReadDone(timeout);
}

/** Open `url` in a new tab, click the toolbar icon, wait for the read to finish. */
async function readPage(url, { waitUntil = 'load' } = {}) {
  const page = await h.ctx.newPage();
  if (url) await page.goto(url, { waitUntil, timeout: 45000 }).catch((e) => (page.__gotoError = e.message));
  const snap = await toolbarRead(page);
  return { page, snap };
}

// ---------------------------------------------------------------- load
await check('load.sw', 'Extension loads; service worker registers with the expected manifest', async () => {
  const m = await h.sw.evaluate(() => chrome.runtime.getManifest());
  assert(m.manifest_version === 3, 'not MV3');
  assert(JSON.stringify(m.permissions) === JSON.stringify(['activeTab', 'scripting', 'sidePanel']), `permissions ${JSON.stringify(m.permissions)}`);
  assert(!m.host_permissions, 'host_permissions present');
  return { expected: 'MV3 SW running; permissions = activeTab, scripting, sidePanel; no host_permissions', actual: `SW ${h.sw.url()}; permissions ${m.permissions.join(', ')}; host_permissions ${m.host_permissions ?? 'none'}` };
});

let lemonPage = null;
if (want('fixtures')) {
  // ------------------------------------------------------------ onboarding + complete JSON-LD
  await check('panel.onboarding', 'Toolbar click opens side panel with onboarding', async () => {
    lemonPage = await h.ctx.newPage();
    await lemonPage.goto(fixtureUrl('jsonld-array.html'));
    await h.clickToolbar(lemonPage);
    const s = await h.pv(() => window.__rp.snapshot());
    await h.panelScreenshot(shot('01-onboarding.png'), 400, 700);
    assert(/Welcome to Recipe Pocket/.test(s.h1), `h1=${s.h1}`);
    return { expected: 'Side panel opens; onboarding "Welcome to Recipe Pocket" with Read recipe', actual: `h1="${s.h1}", buttons=${s.buttons.join('|')}` };
  });

  await check('extract.jsonld-complete', 'Read recipe → complete JSON-LD fixture', async () => {
    await h.pv(() => window.__rp.markLoading());
    await h.pv(() => window.__rp.click('Read recipe'));
    const s = await h.waitReadDone();
    await h.panelScreenshot(shot('02-jsonld-complete.png'));
    assert(s.h1 === 'Weeknight Lemon Rice', `h1=${s.h1}`);
    assert(s.ingredients.length === 4, `ingredients=${s.ingredients.length}`);
    assert(s.steps.length === 3, `steps=${s.steps.length}`);
    assert(s.steps[0].startsWith('Rinse the rice'), `step1=${s.steps[0]}`);
    return { expected: 'Weeknight Lemon Rice, 4 ingredients, 3 ordered steps', actual: `${s.h1}; ${s.ingredients.length} ingredients [${s.ingredients.join('; ')}]; ${s.steps.length} steps; meta: ${s.meta}` };
  });

  await check('scale.servings', 'Servings 0.5x / 2x / reset (rational, from original)', async () => {
    const first = () => window.__rp.snapshot().ingredients[0];
    const orig = await h.pv(first);
    await h.pv(() => window.__rp.setInput('.servings-input', '2'));
    const half = await h.pv(first);
    await h.pv(() => window.__rp.setInput('.servings-input', '8'));
    const dbl = await h.pv(first);
    await h.panelScreenshot(shot('03-scaled-2x.png'));
    await h.pv(() => window.__rp.click('Reset'));
    const reset = await h.pv(first);
    const actual = `orig="${orig}" 0.5x="${half}" 2x="${dbl}" reset="${reset}"`;
    assert(/^(¾|3\/4) cup/.test(half), `half: ${half}`);
    assert(/^3 cups/.test(dbl), `double: ${dbl}`);
    assert(reset === orig, 'reset differs');
    return { expected: '1 ½ cups → ¾ (or 3/4) cup (2 servings) → 3 cups (8 servings) → reset 1 ½ cups', actual };
  });

  await check('units.switch', 'Unit switch to metric and US', async () => {
    const pick = (v) => {
      const sel = document.querySelector('.units-field select');
      sel.value = v;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return window.__rp.snapshot().ingredients.slice(0, 2);
    };
    const metric = await h.pv(pick, 'metric');
    await h.panelScreenshot(shot('04-metric.png'));
    const us = await h.pv(pick, 'us');
    const orig = await h.pv(pick, 'original');
    assert(metric.some((t) => /\b(ml|mL|l|L)\b/.test(t)), `metric: ${metric}`);
    assert(us.some((t) => /cup/.test(t)), `us: ${us}`);
    return { expected: 'Metric shows mL; US shows cups; no cup→gram conversion', actual: `metric=${JSON.stringify(metric)} us=${JSON.stringify(us)} original=${JSON.stringify(orig)}` };
  });

  await check('save.first', 'Save stores the recipe', async () => {
    await h.pv(() => window.__rp.click('Save'));
    const s = await h.waitPanel(() => (window.__rp.btn('✓ Saved') ? window.__rp.snapshot() : null), null, 5000, 'saved');
    return { expected: 'Button becomes "✓ Saved" and "Saved on this device." notice', actual: `buttons=${s.buttons.slice(0, 7).join('|')}; notices=${s.notices.join(' / ')}` };
  });

  await check('save.duplicate', 'Second save of the same page shows duplicate detection', async () => {
    await h.clickToolbar(lemonPage);
    await h.waitReadDone();
    await h.pv(() => window.__rp.click('Save'));
    const n = await h.waitPanel(() => window.__rp.snapshot().notices.find((t) => /already saved/.test(t)), null, 5000, 'duplicate notice');
    await h.panelScreenshot(shot('05-duplicate.png'), 400, 600);
    return { expected: '"You already saved a recipe from this page" with Open saved / Save anyway', actual: n };
  });

  await check('print.draft', 'Print view from unsaved draft (print.html via side panel draft)', async () => {
    await h.pv(() => window.__rp.setInput('.servings-input', '8'));
    const pagePromise = h.ctx.waitForEvent('page', { timeout: 5000 });
    await h.pv(() => window.__rp.click('Print'));
    const p = await pagePromise;
    await p.waitForLoadState();
    await p.waitForSelector('h1', { timeout: 5000 });
    await sleep(300);
    const info = await p.evaluate(() => ({ url: location.pathname + location.search, h1: document.querySelector('h1')?.textContent, text: document.body.innerText.slice(0, 600) }));
    await p.screenshot({ path: shot('06-print-draft.png'), fullPage: true });
    await p.close();
    await h.pv(() => window.__rp.click('Reset'));
    assert(info.h1 === 'Weeknight Lemon Rice', `h1=${info.h1} text=${info.text}`);
    assert(/3 cups/.test(info.text), 'scaled amounts missing in print');
    return { expected: 'Print page shows the draft, scaled to 8 servings', actual: `${info.url} h1=${info.h1}; contains "3 cups"=${/3 cups/.test(info.text)}` };
  });

  await check('list.add', 'Add to shopping list from the reader', async () => {
    await h.pv(() => window.__rp.click('Add to shopping list'));
    await h.waitPanel(() => !!window.__rp.btn('Add ingredients') || !!window.__rp.btn('Add to list'), null, 3000, 'add form');
    const btns = await h.pv(() => window.__rp.buttons());
    await h.pv(() => window.__rp.click(window.__rp.btn('Add ingredients') ? 'Add ingredients' : 'Add to list'));
    const n = await h.waitPanel(() => window.__rp.snapshot().notices.find((t) => /Added \d+ ingredients?/.test(t)), null, 5000, 'added notice');
    return { expected: 'Notice "Added 4 ingredients to “Shopping list”"', actual: `${n} (form buttons: ${btns.join('|')})` };
  });

  await check('extract.multiple', 'Multiple-recipe fixture shows a picker; choosing one shows it', async () => {
    const { snap } = await readPage(fixtureUrl('jsonld-multiple.html'));
    await h.panelScreenshot(shot('07-multiple-picker.png'), 400, 900);
    assert(snap.candidates.length === 2, `candidates=${snap.candidates}`);
    await h.pv(() => {
      document.querySelector('.candidate-list > li button').click();
      return true;
    });
    const s = await h.waitPanel(() => (document.querySelector('.recipe-section.ingredients') ? window.__rp.snapshot() : null), null, 3000, 'chosen recipe');
    assert(s.h1 === 'Herb Yogurt Dip', `h1=${s.h1}`);
    return { expected: 'Picker with 2 recipes (Herb Yogurt Dip, Smoky Bean Dip); choosing first shows it', actual: `candidates=${snap.candidates.join(', ')}; chosen h1=${s.h1}, ${s.ingredients.length} ingredients, ${s.steps.length} steps` };
  });

  await check('extract.dom-fallback', 'Empty JSON-LD Recipe + DOM fallback fixture', async () => {
    const { snap: s } = await readPage(fixtureUrl('empty-recipe-dom-fallback.html'));
    await h.panelScreenshot(shot('08-dom-fallback.png'));
    assert(s.h1 === 'The Chewiest Oat Cookies', `h1=${s.h1}`);
    assert(s.ingredients.length === 4 && s.steps.length === 3, `${s.ingredients.length}/${s.steps.length}`);
    assert(!/Not a step|chocolate chips|spread too much/.test(s.text), 'related/comment text leaked');
    return { expected: 'Chewiest Oat Cookies, 4 ingredients, 3 steps, no related/comments text', actual: `${s.h1}; ${s.ingredients.length} ingredients; ${s.steps.length} steps; notices=${s.notices.join(' / ')}` };
  });

  await check('extract.variants', 'Smitten-Kitchen-like fixture: variants kept, comments excluded', async () => {
    const { snap: s } = await readPage(fixtureUrl('variants-no-jsonld.html'));
    await h.panelScreenshot(shot('09-variants.png'));
    const groups = s.ingredientGroups.join(' | ');
    assert(s.h1 === 'Homemade toaster pastries', `h1=${s.h1}`);
    assert(/Cinnamon filling/.test(groups) && /jam filling/.test(groups), `groups=${groups}`);
    assert(s.steps.length === 4, `steps=${s.steps.length}`);
    assert(!/Reader \d|2 cups of jam|Share this|popular/i.test(s.text), 'comments leaked');
    return { expected: 'Groups Pastry / Cinnamon filling / Or, jam filling / To finish; 4 steps; no comments', actual: `groups=${groups}; ${s.ingredients.length} ingredients; ${s.steps.length} steps` };
  });

  await check('extract.underline-runin', 'Older-blog layout fixture (<u> group headings, run-in step labels, trailing notes)', async () => {
    const { snap: s } = await readPage(fixtureUrl('underline-runin-variants.html'));
    await h.panelScreenshot(shot('09b-underline-runin.png'));
    const groups = s.ingredientGroups.join(' | ');
    assert(groups === 'Crust | Apple Filling (fills 8 pies) | Cherry Filling | Other fillings', `groups=${groups}`);
    assert(s.steps.length === 6, `steps=${s.steps.length}: ${s.steps.join(' // ')}`);
    assert(!/Synthetic Reader|affiliate|First published|Share this/.test(s.text), 'comments/footer leaked');
    return { expected: '4 groups incl. "Other fillings"; 6 steps; tips/variations in notes; no comments/footer', actual: `groups=${groups}; ${s.ingredients.length} ingredients; ${s.steps.length} steps` };
  });

  await check('extract.no-recipe', 'No-recipe page', async () => {
    const { snap: s } = await readPage(fixtureUrl('no-recipe.html'));
    await h.panelScreenshot(shot('10-no-recipe.png'), 400, 500);
    assert(s.h1 === 'No recipe found', `h1=${s.h1}`);
    return { expected: '"No recipe found" with Try again / Enter recipe manually', actual: `h1=${s.h1}; buttons=${s.buttons.join('|')}` };
  });

  for (const url of ['chrome://version', 'about:blank']) {
    await check(`extract.restricted.${url}`, `Restricted page ${url} → RESTRICTED_PAGE message`, async () => {
      const page = await h.ctx.newPage();
      await page.goto(url).catch(() => undefined);
      await h.clickToolbar(page);
      const s = await h.waitReadDone();
      await page.close();
      if (url === 'chrome://version') await h.panelScreenshot(shot('11-restricted.png'), 400, 500);
      assert(s.h1 === 'This page can’t be read', `h1=${s.h1}`);
      return { expected: '"This page can’t be read" (RESTRICTED_PAGE)', actual: `h1=${s.h1}` };
    });
  }
}

// ---------------------------------------------------------------- library
let libPage = null;
let savedId = null;
if (want('library')) {
  await check('library.list', 'Library shows the saved recipe', async () => {
    libPage = await h.ctx.newPage();
    await libPage.goto(h.extUrl('ui/library.html'));
    await libPage.getByText('Weeknight Lemon Rice').first().waitFor({ timeout: 5000 });
    await libPage.screenshot({ path: shot('12-library.png'), fullPage: true });
    const titles = await libPage.locator('main').innerText();
    return { expected: 'Weeknight Lemon Rice listed', actual: titles.slice(0, 300).replace(/\s+/g, ' ') };
  });

  await check('library.search', 'Library search filters recipes', async () => {
    const search = libPage.locator('#rp-search');
    await search.fill('lemon');
    await sleep(400);
    const hit = await libPage.getByText('Weeknight Lemon Rice').count();
    await search.fill('zzzqqq');
    await sleep(400);
    const none = await libPage.getByText('No recipes match').count();
    await search.fill('');
    await sleep(300);
    assert(hit > 0 && none > 0, `hit=${hit} none=${none}`);
    return { expected: '"lemon" finds it; nonsense shows "No recipes match"', actual: `lemon hits=${hit}; nonsense no-match message=${none}` };
  });

  await check('library.edit', 'Edit a saved recipe in the library', async () => {
    await libPage.getByRole('link', { name: /Weeknight Lemon Rice/ }).first().click().catch(async () => libPage.getByText('Weeknight Lemon Rice').first().click());
    await libPage.waitForFunction(() => /recipe=/.test(location.hash), null, { timeout: 5000 });
    savedId = decodeURIComponent(/recipe=([^&]+)/.exec(await libPage.evaluate(() => location.hash))[1]);
    await libPage.getByRole('button', { name: 'Edit', exact: true }).click();
    const title = libPage.getByLabel(/^Title/).first();
    await title.fill('Weeknight Lemon Rice (edited)');
    await libPage.screenshot({ path: shot('13-library-edit.png'), fullPage: true });
    await libPage.getByRole('button', { name: /^Save/ }).first().click();
    await libPage.getByRole('heading', { name: 'Weeknight Lemon Rice (edited)' }).first().waitFor({ timeout: 5000 });
    return { expected: 'Title saved as "Weeknight Lemon Rice (edited)"', actual: `recipe ${savedId} heading updated` };
  });

  await check('print.saved', 'Print view via ?recipe= for a saved recipe', async () => {
    const p = await h.ctx.newPage();
    await p.goto(h.extUrl(`ui/print.html?recipe=${encodeURIComponent(savedId)}`));
    await p.waitForSelector('h1');
    const info = await p.evaluate(() => ({ h1: document.querySelector('h1')?.textContent, steps: document.querySelectorAll('ol li').length }));
    await p.screenshot({ path: shot('14-print-saved.png'), fullPage: true });
    await p.close();
    assert(info.h1 === 'Weeknight Lemon Rice (edited)', `h1=${info.h1}`);
    return { expected: 'Print page renders the saved (edited) recipe', actual: `h1=${info.h1}; list items=${info.steps}` };
  });

  await check('list.view', 'Shopping list exists in the library with the added items', async () => {
    await libPage.goto(h.extUrl('ui/library.html#lists'));
    const link = libPage.getByRole('link', { name: 'Shopping list', exact: true });
    await link.waitFor({ timeout: 5000 });
    await link.click();
    await sleep(500);
    const text = (await libPage.locator('main').innerText()).replace(/\s+/g, ' ');
    await libPage.screenshot({ path: shot('15-shopping-list.png'), fullPage: true });
    assert(/rice/i.test(text), 'rice not in list');
    return { expected: 'List "Shopping list" contains the lemon rice ingredients', actual: text.slice(0, 400) };
  });
}

// ---------------------------------------------------------------- accessibility
if (want('a11y')) {
  await check('a11y.panel-keyboard', 'Side panel keyboard tab order and visible focus', async () => {
    const page = await h.ctx.newPage();
    await page.goto(fixtureUrl('jsonld-array.html'));
    await h.clickToolbar(page);
    await h.waitReadDone();
    await h.pv(() => {
      document.activeElement?.blur();
      window.focus();
      return true;
    });
    const order = [];
    for (let i = 0; i < 14; i++) {
      await h.panel.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await h.panel.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      order.push(
        await h.pv(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return { label: '(body)', visible: false };
          const cs = getComputedStyle(el);
          const visible = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
          return { label: `${el.tagName.toLowerCase()}:${(el.getAttribute('aria-label') || el.textContent || el.id || '').trim().slice(0, 30)}`, visible, focusVisible: el.matches(':focus-visible') };
        }),
      );
    }
    await page.close();
    const noFocus = order.filter((o) => o.label !== '(body)' && !o.visible);
    assert(order.filter((o) => o.label !== '(body)').length >= 8, 'too few focusable controls reached');
    assert(noFocus.length === 0, `no visible focus on: ${noFocus.map((o) => o.label).join(', ')}`);
    return { expected: 'Logical order through header, scale controls, actions; each with a visible focus indicator', actual: order.map((o) => `${o.label}${o.visible ? '' : ' [NO FOCUS RING]'}`).join(' → ') };
  });

  await check('a11y.library-keyboard', 'Library keyboard tab order and visible focus', async () => {
    const p = await h.ctx.newPage();
    await p.goto(h.extUrl('ui/library.html'));
    await sleep(500);
    const order = [];
    for (let i = 0; i < 12; i++) {
      await p.keyboard.press('Tab');
      order.push(
        await p.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return { label: '(body)', visible: false };
          const cs = getComputedStyle(el);
          const visible = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
          return { label: `${el.tagName.toLowerCase()}:${(el.getAttribute('aria-label') || el.textContent || el.id || '').trim().slice(0, 30)}`, visible };
        }),
      );
    }
    await p.close();
    const noFocus = order.filter((o) => o.label !== '(body)' && !o.visible);
    assert(noFocus.length === 0, `no visible focus on: ${noFocus.map((o) => o.label).join(', ')}`);
    assert(/skip/i.test(order[0].label), `first stop is not skip link: ${order[0].label}`);
    return { expected: 'Skip link first, then nav, search, filters; visible focus', actual: order.map((o) => `${o.label}${o.visible ? '' : ' [NO FOCUS RING]'}`).join(' → ') };
  });

  await check('a11y.zoom-200-360', '200% zoom at 360px width: no horizontal overflow (panel, library, options, print)', async () => {
    // 360 device px at 200% zoom = 180 CSS px layout viewport.
    const res = {};
    const page = await h.ctx.newPage();
    await page.goto(fixtureUrl('variants-no-jsonld.html'));
    await h.clickToolbar(page);
    await h.waitReadDone();
    await h.panel.send('Emulation.setDeviceMetricsOverride', { width: 180, height: 800, deviceScaleFactor: 2, mobile: false });
    await sleep(300);
    res.panel = await h.pv(() => {
      const de = document.documentElement;
      const offenders = [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > de.clientWidth + 1).slice(0, 5).map((e) => `${e.tagName}.${e.className}`);
      return { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, offenders };
    });
    const { data } = await h.panel.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(shot('19-panel-200pct-360.png'), Buffer.from(data, 'base64'));
    await h.panel.send('Emulation.clearDeviceMetricsOverride');
    await page.close();
    for (const [name, path] of [
      ['library', 'ui/library.html'],
      ['options', 'ui/options.html'],
      ['print', savedId ? `ui/print.html?recipe=${encodeURIComponent(savedId)}` : 'ui/print.html'],
    ]) {
      const p = await h.ctx.newPage();
      await p.setViewportSize({ width: 180, height: 800 });
      await p.goto(h.extUrl(path));
      await sleep(500);
      res[name] = await p.evaluate(() => {
        const de = document.documentElement;
        const offenders = [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > de.clientWidth + 1).slice(0, 5).map((e) => `${e.tagName}.${e.className}`);
        return { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, offenders };
      });
      if (name === 'library') await p.screenshot({ path: shot('20-library-200pct-360.png'), fullPage: true });
      await p.close();
    }
    const bad = Object.entries(res).filter(([, v]) => v.scrollWidth > v.clientWidth);
    assert(bad.length === 0, `overflow: ${JSON.stringify(Object.fromEntries(bad))}`);
    return { expected: 'scrollWidth <= clientWidth on every page at 180 CSS px', actual: JSON.stringify(res) };
  });

  await check('a11y.dark-mode', 'Dark mode via prefers-color-scheme', async () => {
    await h.panel.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await sleep(300);
    const bg = await h.pv(() => getComputedStyle(document.body).backgroundColor);
    const fg = await h.pv(() => getComputedStyle(document.body).color);
    await h.panelScreenshot(shot('21-panel-dark.png'), 400, 900);
    await h.panel.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    const p = await h.ctx.newPage();
    await p.emulateMedia({ colorScheme: 'dark' });
    await p.goto(h.extUrl('ui/library.html'));
    const libBg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await p.screenshot({ path: shot('22-library-dark.png') });
    await p.close();
    const lum = (c) => {
      const [r, g, b] = c.match(/\d+(\.\d+)?/g).map(Number);
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    };
    assert(lum(bg) < 0.3 && lum(libBg) < 0.3, `bg not dark: panel ${bg}, library ${libBg}`);
    assert(lum(fg) > 0.6, `text not light: ${fg}`);
    return { expected: 'Dark background, light text on panel and library', actual: `panel bg=${bg} fg=${fg}; library bg=${libBg}` };
  });
}

// ---------------------------------------------------------------- settings
async function idbSnapshot(page) {
  return page.evaluate(async () => {
    const out = {};
    for (const info of await indexedDB.databases()) {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open(info.name);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      out[info.name] = {};
      for (const store of db.objectStoreNames) {
        const all = await new Promise((res) => {
          const t = db.transaction(store, 'readonly').objectStore(store).getAll();
          t.onsuccess = () => res(t.result);
          t.onerror = () => res(['<error>']);
        });
        out[info.name][store] = JSON.stringify(all);
      }
      db.close();
    }
    return out;
  });
}
const countRecords = (snap) =>
  Object.fromEntries(Object.entries(snap).flatMap(([db, stores]) => Object.entries(stores).map(([s, v]) => [`${db}.${s}`, JSON.parse(v).length])));

let optPage = null;
if (want('settings')) {
  let backupPath = null;
  await check('settings.export', 'Export backup downloads a JSON file', async () => {
    optPage = await h.ctx.newPage();
    await optPage.goto(h.extUrl('ui/options.html'));
    const dl = optPage.waitForEvent('download', { timeout: 5000 });
    await optPage.getByRole('button', { name: 'Export backup' }).click();
    const d = await dl;
    backupPath = join(h.userDataDir, 'backup.json');
    await d.saveAs(backupPath);
    const data = JSON.parse(readFileSync(backupPath, 'utf8'));
    const recipes = data.recipes?.length ?? data.data?.recipes?.length;
    assert(recipes >= 1, `recipes in backup: ${recipes}`);
    return { expected: 'Backup JSON with saved recipes', actual: `file ${d.suggestedFilename()}, keys=${Object.keys(data).join(',')}, recipes=${recipes}` };
  });

  await check('settings.import-skip', 'Import the backup; conflicts preview, Skip', async () => {
    await optPage.locator('#rp-import').setInputFiles(backupPath);
    await optPage.getByRole('heading', { name: 'Review the import' }).waitFor({ timeout: 5000 });
    const preview = (await optPage.locator('.import-preview').innerText()).replace(/\s+/g, ' ');
    await optPage.screenshot({ path: shot('16-import-preview.png'), fullPage: true });
    await optPage.getByRole('button', { name: 'Import', exact: true }).click();
    const status = await optPage.getByText(/Import finished/).first().innerText({ timeout: 5000 });
    assert(/0 added/.test(status), status);
    return { expected: 'Preview lists conflicts; Skip → 0 added, N skipped', actual: `${status} | preview: ${preview.slice(0, 250)}` };
  });

  await check('settings.import-duplicate', 'Import again choosing "Import them as copies"', async () => {
    await optPage.locator('#rp-import').setInputFiles(backupPath);
    await optPage.getByRole('heading', { name: 'Review the import' }).waitFor({ timeout: 5000 });
    await optPage.getByLabel('Import them as copies').check();
    await optPage.getByRole('button', { name: 'Import', exact: true }).click();
    await optPage.waitForFunction(() => /Import finished: [1-9]/.test(document.body.innerText), null, { timeout: 5000 }).catch(() => undefined);
    const status = await optPage.getByText(/Import finished/).first().innerText({ timeout: 5000 });
    assert(/[1-9]\d* added/.test(status), status);
    return { expected: 'Copies imported (N added)', actual: status };
  });

  await check('settings.delete-all', 'Delete all local data with confirmation showing counts', async () => {
    await optPage.getByRole('button', { name: 'Delete all local data…' }).click();
    const dialog = optPage.getByRole('dialog');
    await dialog.waitFor({ timeout: 5000 });
    const text = (await dialog.innerText()).replace(/\s+/g, ' ');
    await optPage.screenshot({ path: shot('17-delete-confirm.png'), fullPage: true });
    assert(/\d+ recipes?/.test(text), 'no counts in dialog');
    await dialog.getByRole('button', { name: /^Delete / }).click();
    await sleep(1500);
    const after = countRecords(await idbSnapshot(optPage));
    const nonEmpty = Object.entries(after).filter(([k, n]) => n > 0 && !/pref|setting|meta/i.test(k));
    assert(nonEmpty.length === 0, `stores not empty: ${JSON.stringify(after)}`);
    return { expected: 'Dialog lists counts; after confirm, all recipe/list/collection/image stores are empty', actual: `dialog: ${text.slice(0, 300)} | after: ${JSON.stringify(after)}` };
  });

  await check('settings.session-only', 'Session-only mode leaves IndexedDB unchanged after save + reload', async () => {
    await optPage.reload();
    await optPage.locator('#rp-session').check();
    await optPage.getByText(/Session-only mode is on/).first().waitFor({ timeout: 5000 });
    await sleep(300);
    const before = await idbSnapshot(optPage);
    // Reload the side panel so it picks up the mode, then read + try to save.
    await h.panel.send('Page.reload');
    await sleep(1500);
    await h.panel.eval(() => delete window.__rp);
    const page = await h.ctx.newPage();
    await page.goto(fixtureUrl('jsonld-array.html'));
    await h.clickToolbar(page);
    const s = await h.waitReadDone();
    let saveOutcome = 'no save button';
    if (await h.pv(() => !!window.__rp.btn('Save'))) {
      await h.pv(() => {
        const b = window.__rp.btn('Save');
        if (!b.disabled) b.click();
        return true;
      });
      await sleep(800);
      saveOutcome = (await h.pv(() => window.__rp.snapshot())).notices.join(' / ') || (await h.pv(() => window.__rp.buttons().slice(0, 6).join('|')));
    }
    await h.panelScreenshot(shot('18-session-only.png'), 400, 700);
    await h.panel.send('Page.reload');
    await sleep(1500);
    await optPage.reload();
    const after = await idbSnapshot(optPage);
    const same = JSON.stringify(before) === JSON.stringify(after);
    const changed = Object.keys({ ...before, ...after }).flatMap((db) =>
      Object.keys({ ...(before[db] ?? {}), ...(after[db] ?? {}) }).filter((st) => before[db]?.[st] !== after[db]?.[st]).map((st) => `${db}.${st}`),
    );
    // Turn session-only back off for later sections.
    await optPage.locator('#rp-session').uncheck();
    await h.panel.send('Page.reload');
    await sleep(1200);
    await h.panel.eval(() => delete window.__rp);
    assert(same, `IndexedDB changed: ${changed.join(', ')}`);
    return { expected: 'Read works; save writes nothing; IndexedDB identical before/after reload', actual: `read h1=${s.h1}; save outcome: ${saveOutcome}; stores=${JSON.stringify(countRecords(after))}; identical=${same}` };
  });
}

// ---------------------------------------------------------------- live sites
const live = [];
if (want('live') && !process.env.E2E_SKIP_LIVE) {
  const urls = JSON.parse(readFileSync(join(ROOT, 'site-probe-results.json'), 'utf8')).map((x) => x.url);
  const contentJs = readFileSync(join(DIST, 'content.js'), 'utf8');
  for (const url of urls) {
    const host = new URL(url).hostname.replace(/^www\./, '');
    await check(`live.${host}`, `Live site ${url}`, async (rec) => {
      const page = await h.ctx.newPage();
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => ({ error: e.message }));
      await page.waitForLoadState('load', { timeout: 15000 }).catch(() => undefined);
      await sleep(1500);
      const http = resp?.status?.() ?? null;
      const pageTitle = await page.title().catch(() => '');
      const bodyText = await page.evaluate(() => document.body?.innerText.slice(0, 3000) ?? '').catch(() => '');
      const challenged =
        (http && http >= 400) ||
        /just a moment|verify you are human|access denied|attention required|are you a robot|captcha|request blocked|forbidden/i.test(pageTitle + ' ' + bodyText.slice(0, 600));
      const entry = { url, http, pageTitle: pageTitle.slice(0, 120) };
      if (resp?.error || challenged) {
        entry.status = 'blocked';
        entry.reason = resp?.error ?? `HTTP ${http}; title "${pageTitle.slice(0, 80)}"`;
        live.push(entry);
        await page.screenshot({ path: shot(`live-${host}.png`) }).catch(() => undefined);
        await page.close();
        rec.status = 'blocked';
        return { expected: 'Readable page', actual: entry.reason };
      }
      // Real path: toolbar click → side panel.
      let snap = await toolbarRead(page, 20000);
      if (snap.candidates.length) {
        await h.pv(() => {
          document.querySelector('.candidate-list > li button').click();
          return true;
        });
        await sleep(300);
        snap = await h.pv(() => window.__rp.snapshot());
      }
      // Same bundled extractor, evaluated for the full candidate record (method, groups).
      const direct = await page.evaluate(`${contentJs}; globalThis.__recipePocketExtract()`).catch((e) => ({ error: e.message }));
      const c = direct?.candidates?.[0];
      entry.panelH1 = snap.h1;
      entry.ingredients = snap.ingredients.length;
      entry.steps = snap.steps.length;
      entry.ingredientGroups = snap.ingredientGroups;
      entry.stepGroups = snap.stepGroups;
      entry.method = c?.extraction?.method ?? null;
      entry.candidates = direct?.candidates?.length ?? 0;
      entry.warnings = c?.extraction?.warnings ?? [];
      entry.firstIngredients = snap.ingredients.slice(0, 4);
      entry.lastIngredients = snap.ingredients.slice(-3);
      entry.firstSteps = snap.steps.slice(0, 2).map((s) => s.slice(0, 120));
      entry.lastStep = (snap.steps.at(-1) ?? '').slice(0, 160);
      entry.notesSample = (c?.notes ?? '').slice(0, 200);
      entry.commentLeak = /\b(reply|said|commented|posted|thank you so much|i made this|5 stars|loved it)\b/i.test(snap.steps.join(' ') + ' ' + snap.ingredients.join(' '));
      entry.status =
        snap.h1 === 'No recipe found' ? 'no recipe' : snap.ingredients.length && snap.steps.length ? 'ok' : snap.ingredients.length || snap.steps.length ? 'partial' : 'no recipe';
      if (/can’t be read|Couldn’t read|took too long/.test(snap.h1)) entry.status = `error: ${snap.h1}`;
      live.push(entry);
      await h.panelScreenshot(shot(`live-${host}.png`), 400, 1400);
      await page.close();
      rec.status = entry.status === 'ok' && !entry.commentLeak ? 'pass' : 'fail';
      return { expected: 'Real ingredients and ordered steps; no comments', actual: JSON.stringify(entry).slice(0, 1500) };
    });
  }
}

// ---------------------------------------------------------------- network + errors
await check('privacy.zero-network', 'Zero external requests from extension pages / service worker across all flows', async () => {
  const ext = h.net.external();
  const total = h.net.requests.length;
  assert(ext.length === 0, `external requests: ${JSON.stringify(ext.slice(0, 10))}`);
  return { expected: '0 external requests', actual: `${total} extension-initiated requests recorded, all chrome-extension://${h.extId}/ or data:/blob:; external=0` };
});

await check('errors.extension-pages', 'No uncaught errors / console errors on extension pages and service worker', async () => {
  assert(h.errors.length === 0, JSON.stringify(h.errors.slice(0, 10)));
  return { expected: '0 errors', actual: '0 errors captured (side panel, SW, library, options, print)' };
});

writeFileSync(join(QA, 'e2e-results.json'), JSON.stringify({ meta, results, live, network: { total: h.net.requests.length, external: h.net.external() }, errors: h.errors }, null, 2) + '\n');
const summary = results.reduce((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {});
console.log('\nSummary:', JSON.stringify(summary), '\nWrote qa/e2e-results.json');
await fx.close();
await h.close();


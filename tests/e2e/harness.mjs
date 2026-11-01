// E2E harness for the built extension in a real Chromium (Chrome for Testing).
//
// The real dist/ is loaded unpacked, with no extra permissions. The toolbar
// action is triggered through the CDP `Extensions.triggerAction` method, which
// behaves like a real toolbar click: chrome.action.onClicked fires, the side
// panel opens and activeTab is granted for that tab. This needs Chromium's
// `--enable-unsafe-extension-debugging` flag and is test-only.
//
// The side panel and service worker are not Playwright pages, so they are
// driven through a raw CDP WebSocket (see cdp.mjs).
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, normalize, extname } from 'node:path';
import { CdpClient } from './cdp.mjs';

export const ROOT = new URL('../..', import.meta.url).pathname;
export const DIST = join(ROOT, 'dist');

const DEFAULT_CHROMIUM = join(
  homedir(),
  'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
);

export function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  if (existsSync(DEFAULT_CHROMIUM)) return DEFAULT_CHROMIUM;
  return chromium.executablePath();
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freePort() {
  return new Promise((resolve) => {
    const s = createNetServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** Serves synthetic fixtures (never real site HTML) from local directories. */
export async function startFixtureServer(dirs) {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
    for (const dir of dirs) {
      const file = normalize(join(dir, path));
      if (!file.startsWith(dir) || !existsSync(file) || !extname(file)) continue;
      res.writeHead(200, { 'content-type': extname(file) === '.html' ? 'text/html; charset=utf-8' : 'application/octet-stream' });
      res.end(readFileSync(file));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { origin: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

/** Records every request whose initiator is an extension page or the service worker. */
export class NetworkRecorder {
  constructor(extId) {
    this.extId = extId;
    this.requests = [];
  }
  add(source, url) {
    this.requests.push({ source, url });
  }
  isInternal(url) {
    return (
      url.startsWith(`chrome-extension://${this.extId}/`) ||
      url.startsWith('data:') ||
      url.startsWith('blob:') ||
      url === 'about:blank'
    );
  }
  external() {
    return this.requests.filter((r) => !this.isInternal(r.url));
  }
}

export async function launch() {
  const userDataDir = mkdtempSync(join(tmpdir(), 'recipe-pocket-e2e-'));
  const port = await freePort();
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    executablePath: chromiumPath(),
    headless: true,
    acceptDownloads: true,
    viewport: { width: 1200, height: 900 },
    colorScheme: 'light',
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      '--headless=new',
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      '--enable-unsafe-extension-debugging',
      `--remote-debugging-port=${port}`,
      '--no-first-run',
    ],
  });
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 15000 }));
  const extId = new URL(sw.url()).host;
  // Give the initial blank tab a unique URL so about:blank tabs can be mapped to CDP tab targets.
  await ctx.pages()[0]?.goto('data:text/html,<title>start</title>').catch(() => undefined);
  const browserSession = await ctx.browser().newBrowserCDPSession();
  const version = await browserSession.send('Browser.getVersion');
  const h = new Harness({ ctx, sw, extId, port, browserSession, version, userDataDir });
  await h.init();
  return h;
}

export class Harness {
  constructor(o) {
    Object.assign(this, o);
    this.net = new NetworkRecorder(this.extId);
    /** @type {{source:string,text:string}[]} */
    this.errors = [];
    this.panel = null;
    this.swClient = null;
  }

  extUrl(path) {
    return `chrome-extension://${this.extId}/${path}`;
  }

  async init() {
    const isExt = (u) => typeof u === 'string' && u.startsWith(`chrome-extension://${this.extId}/`);
    // Playwright-visible traffic: extension tab pages and the service worker.
    this.ctx.on('request', (req) => {
      let source = null;
      try {
        if (req.serviceWorker()) source = 'service-worker(pw)';
      } catch {
        /* ignore */
      }
      if (!source) {
        try {
          const f = req.frame();
          if (isExt(f.url()) || isExt(f.page()?.url())) source = `page:${f.page()?.url()}`;
        } catch {
          /* ignore */
        }
      }
      if (source) this.net.add(source, req.url());
    });
    const watchPage = (page) => {
      page.on('pageerror', (err) => {
        if (isExt(page.url())) this.errors.push({ source: page.url(), text: `pageerror: ${err.message}` });
      });
      page.on('console', (msg) => {
        if (msg.type() === 'error' && isExt(page.url())) this.errors.push({ source: page.url(), text: `console.error: ${msg.text()}` });
      });
    };
    this.ctx.pages().forEach(watchPage);
    this.ctx.on('page', watchPage);
    this.sw.on('console', (msg) => {
      if (msg.type() === 'error') this.errors.push({ source: 'service-worker', text: `console.error: ${msg.text()}` });
    });
    // Raw CDP on the service worker too (network + exceptions).
    const swTarget = (await this.listTargets()).find((t) => t.type === 'service_worker' && isExt(t.url));
    if (swTarget) this.swClient = await this.attachRaw(swTarget, 'service-worker');
  }

  async listTargets() {
    const res = await fetch(`http://127.0.0.1:${this.port}/json/list`);
    return res.json();
  }

  async attachRaw(target, label) {
    const c = await CdpClient.connect(target.webSocketDebuggerUrl);
    c.on('Network.requestWillBeSent', (p) => this.net.add(label, p.request.url));
    c.on('Runtime.exceptionThrown', (p) =>
      this.errors.push({ source: label, text: `exception: ${p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text}` }),
    );
    c.on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error') this.errors.push({ source: label, text: `console.error: ${p.args.map((a) => a.value ?? a.description).join(' ')}` });
    });
    c.on('Log.entryAdded', (p) => {
      if (p.entry.level === 'error') this.errors.push({ source: label, text: `log: ${p.entry.text} ${p.entry.url ?? ''}` });
    });
    await c.send('Runtime.enable').catch(() => undefined);
    await c.send('Network.enable').catch(() => undefined);
    await c.send('Log.enable').catch(() => undefined);
    return c;
  }

  /** CDP tab-target id for a Playwright page (needed by Extensions.triggerAction). */
  async tabTargetId(page) {
    const s = await this.ctx.newCDPSession(page);
    const { targetInfo } = await s.send('Target.getTargetInfo');
    await s.detach().catch(() => undefined);
    const { targetInfos } = await this.browserSession.send('Target.getTargets', { filter: [{ type: 'tab' }] });
    if (targetInfo.parentId) {
      const byParent = targetInfos.find((t) => t.targetId === targetInfo.parentId);
      if (byParent) return byParent.targetId;
    }
    const matches = targetInfos.filter((t) => t.url === page.url());
    if (matches.length !== 1) throw new Error(`cannot map page to a unique tab target (${matches.length} matches for ${page.url()})`);
    return matches[0].targetId;
  }

  /** Equivalent of the user clicking the Recipe Pocket toolbar icon on `page`. */
  async clickToolbar(page) {
    await page.bringToFront();
    const targetId = await this.tabTargetId(page);
    if (this.panel) await this.panel.eval(installHelpers).catch(() => undefined);
    if (this.panel) await this.panel.eval(() => window.__rp.markLoading());
    await this.browserSession.send('Extensions.triggerAction', { id: this.extId, targetId });
    if (!this.panel) this.panel = await this.waitForPanel();
  }

  async waitForPanel(timeout = 10000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const t = (await this.listTargets()).find((x) => x.url.startsWith(this.extUrl('ui/sidepanel.html')));
      if (t) {
        const c = await this.attachRaw(t, 'side-panel');
        c.target = t;
        await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }).catch(() => undefined);
        // Wait for the app to mount.
        for (let i = 0; i < 100; i++) {
          const ok = await c.eval(() => !!document.querySelector('#app h1')).catch(() => false);
          if (ok) break;
          await sleep(100);
        }
        await c.eval(installHelpers);
        return c;
      }
      await sleep(100);
    }
    throw new Error('side panel did not open');
  }

  /** Evaluate `fn(arg)` inside the side panel with the DOM helpers installed. */
  async pv(fn, arg) {
    await this.panel.eval(installHelpers);
    return this.panel.eval(fn, arg);
  }

  async waitPanel(fn, arg, timeout = 8000, what = 'condition') {
    const end = Date.now() + timeout;
    let last;
    while (Date.now() < end) {
      last = await this.pv(fn, arg).catch((e) => `ERR ${e.message}`);
      if (last && !(typeof last === 'string' && last.startsWith('ERR'))) return last;
      await sleep(100);
    }
    const snap = await this.pv(() => window.__rp.snapshot()).catch(() => null);
    throw new Error(`timeout waiting for ${what}; last=${JSON.stringify(last)}; panel=${JSON.stringify(snap)?.slice(0, 600)}`);
  }

  /** Wait until a read started after markLoading() has finished. */
  async waitReadDone(timeout = 10000) {
    await this.waitPanel(() => window.__rp.readDone(), null, timeout, 'read to finish');
    return this.pv(() => window.__rp.snapshot());
  }

  async panelScreenshot(file, width = 400, height = 1200) {
    await this.panel.send('Emulation.setDeviceMetricsOverride', { width, height: 600, deviceScaleFactor: 1, mobile: false });
    await sleep(150);
    const full = await this.panel.eval(() => document.documentElement.scrollHeight);
    await this.panel.send('Emulation.setDeviceMetricsOverride', { width, height: Math.min(Math.max(full, 300), height), deviceScaleFactor: 1, mobile: false });
    await sleep(150);
    const { data } = await this.panel.send('Page.captureScreenshot', { format: 'png' });
    await this.panel.send('Emulation.clearDeviceMetricsOverride');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(file, Buffer.from(data, 'base64'));
  }

  async close() {
    this.panel?.close();
    this.swClient?.close();
    await this.ctx.close();
  }
}

/** Installed into the side panel; must be self-contained (serialized with toString). */
export function installHelpers() {
  if (window.__rp) return true;
  const vis = (el) => !!el && el.getClientRects().length > 0;
  const txt = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const rp = {
    sawLoading: false,
    markLoading() {
      rp.sawLoading = false;
      if (!rp.obs) {
        rp.obs = new MutationObserver((records) => {
          for (const r of records)
            for (const n of r.addedNodes)
              if (n.nodeType === 1 && (n.matches?.('[aria-busy="true"]') || n.querySelector?.('[aria-busy="true"]'))) rp.sawLoading = true;
        });
        rp.obs.observe(document.body, { childList: true, subtree: true });
      }
      return true;
    },
    readDone() {
      return rp.sawLoading && !document.querySelector('[aria-busy="true"]') && !!document.querySelector('main h1');
    },
    buttons() {
      return [...document.querySelectorAll('button')].filter(vis).map((b) => txt(b) || b.getAttribute('aria-label'));
    },
    btn(label) {
      const all = [...document.querySelectorAll('button, a[href]')].filter(vis);
      return (
        all.find((b) => txt(b) === label || b.getAttribute('aria-label') === label) ??
        all.find((b) => txt(b).startsWith(label))
      );
    },
    click(label) {
      const b = rp.btn(label);
      if (!b) throw new Error(`no button "${label}"; visible: ${rp.buttons().join(' | ')}`);
      if (b.disabled) throw new Error(`button "${label}" is disabled`);
      b.click();
      return true;
    },
    setInput(selector, value) {
      const el = document.querySelector(selector);
      if (!el) throw new Error(`no input ${selector}`);
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    snapshot() {
      return {
        h1: txt(document.querySelector('main h1')),
        ingredientGroups: [...document.querySelectorAll('.recipe-section.ingredients .group-title')].map(txt),
        ingredients: [...document.querySelectorAll('.recipe-section.ingredients li.ingredient .ing-text')].map(txt),
        stepGroups: [...document.querySelectorAll('.recipe-section.instructions .group-title')].map(txt),
        steps: [...document.querySelectorAll('.recipe-section.instructions li.step')].map(txt),
        candidates: [...document.querySelectorAll('.candidate-list > li h2')].map(txt),
        notices: [...document.querySelectorAll('.notice')].filter(vis).map(txt),
        meta: txt(document.querySelector('.recipe-meta')),
        source: txt(document.querySelector('.recipe-source, .source')),
        buttons: rp.buttons(),
        text: txt(document.querySelector('main')).slice(0, 4000),
      };
    },
  };
  window.__rp = rp;
  return true;
}

// Zero-network and permission audit of the built extension (release gate helper).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const dist = new URL('../dist', import.meta.url).pathname;
const errors = [];
const files = [];
const walk = (d) => readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : files.push(join(d, f))));
walk(dist);

const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
const allowed = new Set(['activeTab', 'scripting', 'sidePanel']);
for (const p of manifest.permissions ?? []) if (!allowed.has(p)) errors.push(`manifest: unexpected permission "${p}"`);
for (const key of ['host_permissions', 'optional_host_permissions', 'externally_connectable', 'content_scripts', 'web_accessible_resources'])
  if (manifest[key]) errors.push(`manifest: "${key}" must not be present`);
const csp = manifest.content_security_policy?.extension_pages ?? '';
if (!csp.includes("connect-src 'none'")) errors.push("manifest: CSP must include connect-src 'none'");

const forbiddenJs = [
  [/\bfetch\s*\(/, 'fetch('],
  [/XMLHttpRequest/, 'XMLHttpRequest'],
  [/\bWebSocket\b/, 'WebSocket'],
  [/sendBeacon/, 'sendBeacon'],
  [/EventSource/, 'EventSource'],
  [/\beval\s*\(/, 'eval('],
  [/new Function\s*\(/, 'new Function('],
  [/\.innerHTML\s*=/, 'innerHTML assignment'],
  [/insertAdjacentHTML/, 'insertAdjacentHTML'],
  [/document\.write/, 'document.write'],
  [/chrome\.storage\.sync/, 'chrome.storage.sync'],
  [/importScripts\s*\(/, 'importScripts('],
];
for (const f of files) {
  const rel = relative(dist, f);
  if (f.endsWith('.js')) {
    const text = readFileSync(f, 'utf8');
    for (const [re, label] of forbiddenJs) if (re.test(text)) errors.push(`${rel}: forbidden ${label}`);
  }
  if (f.endsWith('.html') || f.endsWith('.css')) {
    const text = readFileSync(f, 'utf8');
    if (/(src|href)\s*=\s*["']?\s*(https?:)?\/\//i.test(text)) errors.push(`${rel}: remote resource reference`);
    if (/@import\s+url\(\s*["']?https?:/i.test(text) || /url\(\s*["']?https?:/i.test(text)) errors.push(`${rel}: remote CSS url()`);
    if (f.endsWith('.html') && /<script(?![^>]*\bsrc=)[^>]*>/i.test(text)) errors.push(`${rel}: inline <script>`);
  }
}

if (errors.length) {
  console.error('dist audit FAILED:\n- ' + errors.join('\n- '));
  process.exit(1);
}
console.log(`dist audit passed (${files.length} files, permissions: ${[...(manifest.permissions ?? [])].join(', ')})`);

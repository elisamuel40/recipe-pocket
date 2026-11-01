// Reproducible bundled build: src/ -> dist/ (load dist/ with "Load unpacked").
import * as esbuild from 'esbuild';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { iconPng } from './icons.mjs';

const root = new URL('..', import.meta.url).pathname;
const src = join(root, 'src');
const dist = join(root, 'dist');
const watch = process.argv.includes('--watch');

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'ui'), { recursive: true });
mkdirSync(join(dist, 'icons'), { recursive: true });

const uiDir = join(src, 'ui');
const uiEntries = readdirSync(uiDir)
  .filter((f) => f.endsWith('.html'))
  .map((f) => f.replace(/\.html$/, ''))
  .filter((name) => existsSync(join(uiDir, `${name}.ts`)));

const entryPoints = {
  background: join(src, 'background/service-worker.ts'),
  content: join(src, 'content/content.ts'),
  ...Object.fromEntries(uiEntries.map((n) => [`ui/${n}`, join(uiDir, `${n}.ts`)])),
};

const options = {
  entryPoints,
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: 'chrome116',
  platform: 'browser',
  sourcemap: false,
  minify: false,
  legalComments: 'eof',
  logLevel: 'info',
  charset: 'utf8',
};

function copyStatic() {
  for (const f of readdirSync(uiDir)) {
    if (f.endsWith('.html') || f.endsWith('.css')) cpSync(join(uiDir, f), join(dist, 'ui', f));
  }
  const manifest = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8'));
  manifest.version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  writeFileSync(join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  for (const s of [16, 32, 48, 128]) writeFileSync(join(dist, 'icons', `icon${s}.png`), iconPng(s));
  cpSync(join(root, 'LICENSE'), join(dist, 'LICENSE'));
  const notices = join(root, 'THIRD_PARTY_NOTICES.md');
  if (existsSync(notices)) cpSync(notices, join(dist, 'THIRD_PARTY_NOTICES.md'));
}

if (watch) {
  copyStatic();
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('Watching src/ (static files copied once; re-run for HTML/CSS changes)');
} else {
  await esbuild.build(options);
  copyStatic();
  console.log(`Built ${Object.keys(entryPoints).length} bundles into dist/`);
}

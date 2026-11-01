// Builds a deterministic ZIP of dist/ plus its SHA-256 checksum into release/.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const dist = join(root, 'dist');
const out = join(root, 'release');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const zipName = `recipe-pocket-${version}.zip`;

mkdirSync(out, { recursive: true });
rmSync(join(out, zipName), { force: true });
const files = [];
const walk = (d) => readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : files.push(join(d, f))));
walk(dist);
files.sort();
const fixed = new Date('2026-01-01T00:00:00Z');
for (const f of files) utimesSync(f, fixed, fixed);
execFileSync('zip', ['-X', '-q', join(out, zipName), ...files.map((f) => relative(dist, f))], { cwd: dist });
const sha = createHash('sha256').update(readFileSync(join(out, zipName))).digest('hex');
writeFileSync(join(out, `${zipName}.sha256`), `${sha}  ${zipName}\n`);
console.log(`${zipName}\nsha256 ${sha}`);

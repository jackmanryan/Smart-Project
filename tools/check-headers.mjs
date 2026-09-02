/**
 * Fails the build when a generated bundle would ask for capabilities it does not use,
 * or uses a GM_* API it never declared. Keeps meta/*.json honest without hand-auditing.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = process.cwd();
let failed = false;
const fail = (msg) => { console.error(`  ✗ ${msg}`); failed = true; };

const metas = (await readdir(join(ROOT, 'meta'))).filter((f) => f.endsWith('.json'));

for (const file of metas) {
  const name = file.replace(/\.json$/, '');
  const meta = JSON.parse(await readFile(join(ROOT, 'meta', file), 'utf8'));
  let built;
  try {
    built = await readFile(join(ROOT, 'dist', `${name}.user.js`), 'utf8');
  } catch {
    fail(`${name}: dist/${name}.user.js missing — run npm run build first`);
    continue;
  }
  console.log(`${name}:`);

  const body = built.slice(built.indexOf('==/UserScript=='));
  const used = new Set([...body.matchAll(/\bGM_[A-Za-z]+/g)].map((m) => m[0]));
  const declared = new Set(meta.grant || []);

  for (const api of used) {
    if (!declared.has(api)) fail(`${name}: uses ${api} but meta does not grant it`);
  }
  for (const api of declared) {
    if (!used.has(api)) fail(`${name}: grants ${api} but never uses it`);
  }
  if (!(meta.match || []).length) fail(`${name}: no @match patterns`);
  for (const m of meta.match || []) {
    if (/^https:\/\/\*\./.test(m) && !m.includes('extranet')) {
      fail(`${name}: wildcard-subdomain match "${m}" is broader than intended`);
    }
  }
  if ((meta.connect || []).includes('*')) fail(`${name}: @connect * is too broad; list real hosts`);
  if (!failed) console.log('  ✓ grants, matches and connects agree with the bundle');
}

process.exit(failed ? 1 : 0);

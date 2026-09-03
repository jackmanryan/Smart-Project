/**
 * Keeps meta/<bundle>.json honest against what the built bundle actually does.
 *
 * The core services probe for each GM_* API before using it (`typeof GM_addStyle ===
 * 'function'`) and fall back to a plain DOM path when the grant is absent. So a bare
 * mention of an identifier does not mean the bundle needs the grant, and the check
 * distinguishes three cases:
 *
 *   required  referenced with no typeof probe anywhere — the bundle breaks without it
 *   optional  probed before use — granting it is right, omitting it merely degrades
 *   dead      granted but the identifier is nowhere in the bundle
 *
 * Only `required` and `dead` are errors. That way a grant can be added in the same
 * commit as the module that needs it, and a stale grant cannot linger.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = process.cwd();
let failed = false;

const metas = (await readdir(join(ROOT, 'meta'))).filter((f) => f.endsWith('.json'));

for (const file of metas) {
  const name = file.replace(/\.json$/, '');
  const meta = JSON.parse(await readFile(join(ROOT, 'meta', file), 'utf8'));
  const problems = [];
  const fail = (msg) => problems.push(msg);

  let built;
  try {
    built = await readFile(join(ROOT, 'dist', `${name}.user.js`), 'utf8');
  } catch {
    console.log(`${name}:`);
    console.error(`  ✗ dist/${name}.user.js missing — run npm run build first`);
    failed = true;
    continue;
  }

  // Everything after the header block: the code itself.
  const body = built.slice(built.indexOf('==/UserScript=='));

  const mentioned = new Set([...body.matchAll(/\bGM_[A-Za-z]+/g)].map((m) => m[0]));
  const probed = new Set([...body.matchAll(/typeof\s+(GM_[A-Za-z]+)/g)].map((m) => m[1]));
  const required = [...mentioned].filter((api) => !probed.has(api));
  const declared = new Set(meta.grant || []);

  for (const api of required) {
    if (!declared.has(api)) fail(`uses ${api} unguarded but meta does not grant it`);
  }
  for (const api of declared) {
    if (!mentioned.has(api)) fail(`grants ${api} but the bundle never references it`);
  }

  if (!(meta.match || []).length) fail('no @match patterns');
  for (const pattern of meta.match || []) {
    if (/^https:\/\/\*\./.test(pattern) && !pattern.includes('extranet')) {
      fail(`wildcard-subdomain match "${pattern}" is broader than intended`);
    }
  }
  if ((meta.connect || []).includes('*')) fail('@connect * is too broad; list the real hosts');

  console.log(`${name}:`);
  if (problems.length) {
    failed = true;
    for (const p of problems) console.error(`  ✗ ${p}`);
  } else {
    const optional = [...declared].filter((api) => probed.has(api));
    console.log(`  ✓ grants, matches and connects agree with the bundle`);
    if (required.length) console.log(`    required: ${required.join(', ')}`);
    if (optional.length) console.log(`    optional (probed before use): ${optional.join(', ')}`);
  }
}

process.exit(failed ? 1 : 0);

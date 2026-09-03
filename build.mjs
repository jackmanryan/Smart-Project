/**
 * Builds every bundle described by meta/<name>.json into:
 *   dist/<name>.user.js        the bundled script body, with a full userscript header
 *   dist/<name>.stub.user.js   a loader you install once in Tampermonkey; it @requires the file above
 *
 * The stub carries the grants and matches, so both files are generated from the same
 * metadata and cannot drift apart. See README.md for the install steps.
 */
import { build, context } from 'esbuild';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
const WATCH = process.argv.includes('--watch');

/** Metadata keys in the order Tampermonkey conventionally lists them. */
const ORDER = ['name', 'namespace', 'version', 'description', 'author', 'match', 'exclude', 'run-at', 'grant', 'connect', 'require', 'noframes'];

function headerBlock(meta, { requireUrl = null, versionSuffix = '' } = {}) {
  const rows = [];
  const push = (k, v) => rows.push([k, v]);
  for (const key of ORDER) {
    if (key === 'require') continue;
    const value = meta[key];
    if (value == null || value === false) continue;
    if (key === 'version') push(key, value + versionSuffix);
    else if (key === 'noframes') push(key, '');
    else if (Array.isArray(value)) value.forEach((v) => push(key, v));
    else push(key, value);
  }
  if (requireUrl) push('require', requireUrl);
  const pad = Math.max(...rows.map(([k]) => k.length)) + 2;
  const lines = rows.map(([k, v]) => `// @${k}${' '.repeat(pad - k.length)}${v}`.trimEnd());
  return ['// ==UserScript==', ...lines, '// ==/UserScript=='].join('\n');
}

function stubFor(meta, name) {
  const target = pathToFileURL(join(DIST, `${name}.user.js`)).href;
  return [
    headerBlock(meta, { requireUrl: target, versionSuffix: '-local' }),
    '',
    '/* Loader stub. The code lives in the @require above; rebuild with `npm run build`',
    '   and reload the page. Reinstall this stub only when meta/' + name + '.json changes. */',
    '',
  ].join('\n');
}

async function loadMetas() {
  const files = (await readdir(join(ROOT, 'meta'))).filter((f) => f.endsWith('.json'));
  return Promise.all(
    files.map(async (f) => {
      const name = f.replace(/\.json$/, '');
      const meta = JSON.parse(await readFile(join(ROOT, 'meta', f), 'utf8'));
      return { name, meta };
    }),
  );
}

async function run() {
  await mkdir(DIST, { recursive: true });
  const metas = await loadMetas();

  for (const { name, meta } of metas) {
    const options = {
      entryPoints: [resolve(ROOT, 'src/bundles', `${name}.js`)],
      outfile: join(DIST, `${name}.user.js`),
      bundle: true,
      format: 'iife',
      target: ['chrome110'],
      charset: 'utf8',
      legalComments: 'none',
      loader: { '.css': 'text', '.html': 'text', '.svg': 'text' },
      define: { __BUNDLE_NAME__: JSON.stringify(meta.name), __BUNDLE_VERSION__: JSON.stringify(meta.version) },
      banner: { js: headerBlock(meta) + '\n' },
      logLevel: 'info',
    };

    if (WATCH) {
      const ctx = await context(options);
      await ctx.watch();
      console.log(`[build] watching ${name}`);
    } else {
      await build(options);
    }
    await writeFile(join(DIST, `${name}.stub.user.js`), stubFor(meta, name), 'utf8');
    console.log(`[build] ${name} -> dist/${name}.user.js (+ stub)`);
  }

  if (WATCH) console.log('[build] watching for changes; Ctrl-C to stop');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

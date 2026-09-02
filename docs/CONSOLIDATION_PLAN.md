# Tampermonkey consolidation plan

Rebuild 26 Tampermonkey userscripts (about 13,000 lines) into one private GitHub repo with a real build, ship them from a local checkout, and retire the stale contents of this repo.

Source of truth for the inventory: the `ACTIVE_SCRIPTS.zip` Tampermonkey export dated 2026-09 (26 `.user.js` files plus their `.options.json` and `.storage.json`).

---

## 1. Findings that shape the plan

1. **This repo is public.** `jackmanryan/Smart-Project` has `visibility: public`. It already contains the ExtraNav navbar source (HTML, CSS, 2,776 lines of JS) targeting the company extranet, plus Google Apps Script for a customer database. Flip it to private before committing anything else. A scan of every commit in history for key, token, and password patterns found nothing beyond CSS "design tokens" and vendored jQuery, so no secret rotation is needed.
2. **Tampermonkey cannot log in to GitHub.** `@updateURL` and `@downloadURL` are plain unauthenticated fetches. There is no header, cookie, or token support, and `raw.githubusercontent.com` answers `404` for private files. "Private repo plus auto-update" therefore needs one of the delivery paths in section 3. The recommended one needs no hosting at all.
3. **The live ExtraNav script depends on this repo through jsDelivr.** It fetches `ExtraNav.html`, `ExtraNav.css`, and `nav-ux.js` from `cdn.jsdelivr.net/gh/jackmanryan/Smart-Project@6a85cca…`. jsDelivr keeps commit-pinned files in permanent storage even if the repo is deleted or made private, so flipping to private will not break the navbar. But that URL can never be updated again, and the three files are frozen at a November 2025 commit. Phase 3 inlines them into the bundle and removes the dependency.
4. **The scripts are less coupled than they look.** `window.SCX` is built inside ExtraClaims and `window.SCORD` inside the SC FAB, both guarded as globals — but a call-site scan shows nothing outside those two files ever calls `SCX.*` or `SCORD.*`. The apparent cross-references were CSS class prefixes (`scx-btn`, `scx-panel`). Both therefore become module-local libraries (`orders/lib/order-data.js`, `lib/orders-api.js`), not core services. Eleven globals are still assigned across the set and all of them can go.
5. **Twenty scripts each run their own `MutationObserver` on the page.** Two scripts (TabName and TurboKit) independently monkey-patch `fetch` and `XMLHttpRequest` at `document-start`. Nine scripts repeat the same `quotes_editor` exclude list. Four scripts implement theme detection separately.
6. **Tampermonkey stores `GM_setValue` data per script.** Extranet 2FA uses it as a cross-tab channel between the extranet page and Gmail, so both halves must stay in the same installed script after consolidation.
7. **A few headers are wider than they should be.** Gmail Quote Search matches `https://*.google.com/*` (all of Google). TurboKit declares `@connect *`. ExtraNav's Tampermonkey options carry hand-added excludes for chatgpt.com, github.com, primevideo.com and Google, which is a symptom of the `/*` match being too broad for a `document-start` script.

---

## 2. Decision summary

| Question | Decision |
|---|---|
| Where does the code live? | This repo, made private, renamed to `sc-extranet-tools` (optional; GitHub redirects the old name). |
| How many installed scripts after the rebuild? | Two: `sc-extranet.user.js` (everything on the extranet) and `sc-gmail-bridge.user.js` (Gmail Quote Search plus both halves of 2FA). |
| How do scripts get from GitHub into Tampermonkey? | Local git checkout plus a `file://` loader stub per bundle. `git pull` and rebuild is the deploy. See section 3. |
| Build tool | esbuild with a 60-line `build.mjs`. No framework. |
| What happens to the Apps Script folder? | Moves to its own private repo (`smart-project-gs`). It is a different product. |
| What happens to `assets/`? | Deleted. It is a vendored copy of the extranet's own Bootstrap, jQuery and DataTables. Three hand-written files are kept under `docs/site-reference/` because they document the target site's DOM. |
| What happens to the 26 originals? | Committed to `legacy/` after the repo is private, used as the parity spec, deleted in the final PR. |

---

## 3. Delivery: does a private repo actually work with Tampermonkey?

Yes, but not the way a public repo does. Ranked options:

### Option A (recommended): local checkout plus `file://` loader stubs

1. Clone the repo to a fixed path, for example `C:\dev\sc-extranet-tools`.
2. In Chrome: Extensions → Tampermonkey → Details → enable **Allow access to file URLs**.
3. Install a stub per bundle. The stub holds the real header and one `@require` line:

```js
// ==UserScript==
// @name         SC Extranet Tools
// @namespace    sc.extranet
// @version      0.0.0-local
// @match        https://extranet.strip-curtains.com/*
// @run-at       document-start
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// @connect      extranet.strip-curtains.com
// @require      file:///C:/dev/sc-extranet-tools/dist/sc-extranet.user.js
// ==/UserScript==
```

4. `npm run watch` while developing, or `npm run build` after `git pull`. Reload the page and the new bundle runs.

Why this is the right fit: it is fully private, needs no hosting, and PR review happens on GitHub while the browser only ever sees your local disk. The build generates the stubs from the same metadata file as the bundles, so grants and matches cannot drift.

Caveats:
- `@grant` and `@match` come from the installed stub, not from the required file. When a bundle's metadata changes (rare), paste the regenerated stub into Tampermonkey again.
- Chrome and Edge only. Firefox does not support `file://` in `@require`.
- On first setup, edit the built file, reload the page and confirm the change shows. If it does not, set Tampermonkey → Settings → Externals → Update interval to **Always**.
- Violentmonkey can also install straight from a `file://` URL and track the file for changes, if you ever switch engines.

### Option B: CI mirror to a secret gist (for a second machine or a colleague)

A GitHub Action builds on every merge to `main` and pushes `dist/*.user.js` into a secret gist. The stub's `@updateURL` and `@downloadURL` point at `https://gist.githubusercontent.com/jackmanryan/<gist-id>/raw/sc-extranet.user.js`. Secret gists are unlisted, not access-controlled: anyone holding the URL can read the script. Acceptable for internal tooling with no secrets in it. Add this only when someone other than you needs updates.

### Option C: token embedded in the raw URL (not recommended)

`https://<fine-grained-token>@raw.githubusercontent.com/...` works from `curl`, but a browser only sends URL credentials after a `401` challenge and GitHub answers `404`. This path is unverified in Tampermonkey and puts a live token into every script header and every export. Skip it.

### Rejected

- Keep the repo public and use jsDelivr (today's approach). Not private.
- GitHub Pages: needs GitHub Pro for private repos and the published site is public anyway.
- Tampermonkey cloud sync (Drive, Dropbox, OneDrive, WebDAV): syncs your installed scripts between your own browsers. It is not a review workflow, but it does carry the stubs to a second machine if the checkout path matches.

**Plan note.** Branch protection and rulesets on a private repo need GitHub Pro. On the Free plan the "everything goes through a PR" rule is self-enforced. CI still runs on PRs and reports status; it just cannot block a direct push.

---

## 4. Inventory of the 26 scripts

Line counts are from the export. "Scope" is the effective page scope after `@match` and `@exclude`. Ports are grouped into the module folders described in section 5.

| # | Script | Lines | Run at | Scope | GM grants | Depends on | Port to |
|---|---|---|---|---|---|---|---|
| 1 | ExtraNav - NAVBAR MAIN STYLE | 1,295 | start | all extranet, excl. quotes_editor, quotepayment | addStyle, xmlhttpRequest | jsDelivr files from this repo | `modules/nav` (inline HTML/CSS/nav-ux) |
| 2 | Message Center | 1,581 | idle | `?p=messagecenter` | addStyle | — | `modules/messages` |
| 3 | Hamilton The Hamster (and Lizard) | 1,180 | start | all extranet | addStyle, get/setValue, get/saveTab | — | `modules/loader` (emits `hamilton:loading`) |
| 4 | ExtraRight | 889 | end | orders-view | setClipboard | order-data helpers | `modules/orders/context-menu` |
| 5 | Adaptive Table Filters + Column Menu | 837 | idle | all extranet | addStyle | DataTables | `modules/tables/filters` |
| 6 | Bubble Text | 746 | idle | all extranet | addStyle | ExtraNav switches, theme | `modules/tables/bubbles` |
| 7 | SideDock | 555 | idle | all, excl. quotes_editor | addStyle | ExtraNav, Message Center (46 refs) | `modules/dock` |
| 8 | ExtraClaims | 545 | idle | orders-view | none | defines `window.SCX` (used only here) | helpers → `modules/orders/lib/order-data.js`; composer → `modules/orders/claims` |
| 9 | SC TurboKit | 528 | start | all extranet | xmlhttpRequest, `@connect *` | patches fetch/XHR | `core/net-tap` + `modules/perf` |
| 10 | Legacy Form (Consolidated & Hardened) | 521 | start | all, excl. quotes_editor | none | ExtraNav shadow host, Hamilton | `modules/nav/search` |
| 11 | SC FAB — Message & Sales Viewer | 469 | idle | all extranet | none | defines `window.SCORD` (used only here) | data client → `modules/lib/orders-api.js`; UI → `modules/fab` |
| 12 | Order Products Panel | 445 | idle | all, excl. quotes_editor | none (no `use strict`) | — | `modules/orders/products-panel` |
| 13 | Extranet 2FA | 360 | idle | `?p=verify_2fa` + mail.google.com | get/setValue, addValueChangeListener, saveTab | cross-tab via GM storage | `sc-gmail-bridge` bundle, `modules/twofa` |
| 14 | fileBUBBLE | 350 | idle | orders-view | none | ExtraNav | `modules/orders/radial-menu` |
| 15 | Order Info Panels | 329 | default | all, excl. review, quotes_editor | none | — | `modules/orders/info-panels` |
| 16 | Tracking Panel — Layout Restyle | 329 | idle | all extranet | addStyle | SideDock sizing | `modules/orders/tracking-panel` |
| 17 | Gmail Quote Search | 280 | end | mail.google.com **and all `*.google.com`** | none | — | `sc-gmail-bridge`, `modules/gmail-links`; narrow match |
| 18 | Copy Buttons | 267 | idle | all extranet | none | ExtraNav "Copy Buttons" switch | `modules/tables/copy-buttons` |
| 19 | ExtraClean | 267 | start | all, excl. orders-review | none | — | `modules/hygiene/clean` |
| 20 | SC Auto Review (rereview batch) | 264 | idle | all, acts only on orders-review with `#sc-autoreview` | none | — | `modules/automation/auto-review` (stays hash-gated) |
| 21 | ExtraLinks | 261 | idle | all, excl. quotes_editor | none | — | `modules/orders/links` |
| 22 | Order Timeline & Overview | 199 | idle | all, excl. review, quotes_editor | addStyle (no `use strict`) | — | `modules/orders/timeline` |
| 23 | Orders Review | 191 | idle | orders-review | addStyle | — | `modules/orders/review` |
| 24 | TabName | 144 | start | all extranet | none | replaces `window.XMLHttpRequest` | `core/net-tap` + `modules/tab-title` |
| 25 | Kill custom.css | 102 | idle | all, excl. quotes_editor | none | — | `modules/hygiene/kill-custom-css` |
| 26 | ExtraSort | 72 | start | all, excl. quotes_editor | none | DataTables | `modules/tables/default-sort` |

Shared state that must survive the port (keys are kept verbatim, only the accessor moves into `core/settings`):
`ui:theme`, `scx.filters.v3`, `scx.colmenu.v1`, `scord:recent:v1`, `sc:rightDrawerState`, `sc:rightDrawerActiveKey`, `sc:instant-back`, `tmx:search:extra`, `tmx:auto-open-from-gmail`, `strip2fa:*` (localStorage mirror), and the ExtraNav switches.

Cross-script events that become core APIs: `tm:route` (ExtraNav, listened to by 6 scripts), `hamilton:loading`, `sc:instant-back`.

---

## 5. Target architecture

```
sc-extranet-tools/
├── package.json            esbuild, eslint, prettier
├── build.mjs               src/bundles/*.js → dist/*.user.js + dist/*.stub.user.js
├── meta/
│   ├── sc-extranet.json    name, version, match, exclude, run-at, grant, connect
│   └── sc-gmail-bridge.json
├── src/
│   ├── core/               the runtime every module gets as `ctx`
│   │   ├── page.js         one place for ?p= detection and the quotes_editor / quotepayment excludes
│   │   ├── observe.js      one MutationObserver, rAF-batched, subscribe(selector, cb)
│   │   ├── route.js        history/hash tap, emits `tm:route`
│   │   ├── net-tap.js      one fetch + XHR patch with subscribers (replaces TabName and TurboKit patches)
│   │   ├── style.js        addStyle for light DOM and shadow roots; CSS files imported as text
│   │   ├── theme.js        data-theme + ui:theme, single source
│   │   ├── settings.js     namespaced store over localStorage/GM storage, key migration table
│   │   └── log.js          prefixed console + per-module error boundary
│   ├── modules/            one folder per feature, index.js + styles.css
│   │   ├── hygiene/  loader/  perf/  tab-title/  nav/  dock/  messages/
│   │   ├── orders/   tables/  fab/   automation/ gmail-links/  twofa/
│   └── bundles/
│       ├── sc-extranet.js      imports and registers every extranet module
│       └── sc-gmail-bridge.js  registers gmail-links + twofa
├── legacy/                 the 26 exported originals, frozen (deleted in the final PR)
├── docs/                   this plan, site-reference/, module notes
└── .github/workflows/ci.yml   lint, build, header check on every PR
```

Module contract (every feature implements this and nothing else touches `window`):

```js
export default {
  id: 'orders.tracking-panel',
  title: 'Tracking panel layout',
  runAt: 'idle',                       // 'start' | 'end' | 'idle' — core defers as needed
  enabledByDefault: true,
  pages: ['orders-view'],              // from core/page; [] means all
  init(ctx) { /* ctx.observe, ctx.style, ctx.settings, ctx.route, ctx.scx … */ },
};
```

Why two bundles instead of one or seven:
- One `document-start` extranet bundle guarantees load order and lets `core/` own the single observer and the single network tap, which is what removes the real duplication.
- The Gmail bridge must be its own installed script because 2FA's two halves share per-script GM storage, and because Gmail should never load the 13,000-line extranet bundle.
- Splitting further (nav, orders, tables…) is possible later: it is just more entries in `meta/`. Start with two.

Design rules the refactor enforces (put these in `CLAUDE.md` / `AGENTS.md` so PR-writing agents follow them):
- No new `window.*` globals. Modules talk through `ctx` and `ctx.events`.
- No module creates its own `MutationObserver`, patches `fetch`, or wraps `XMLHttpRequest`. Use `ctx.observe` and `ctx.net`.
- CSS lives in `.css` files next to the module, imported by the build. No CSS strings in JS.
- Every module runs inside the core error boundary; one broken module never stops the others.
- Existing storage keys are preserved. A key rename goes through `settings.js`'s migration table.
- Automation modules (auto-review, 2FA submit) keep their explicit arm/gate and default to the legacy behaviour.

Fixes to make while porting, each its own bullet in the module's PR:
- Gmail Quote Search: `@match` only `https://mail.google.com/*`.
- TurboKit: replace `@connect *` with the hosts it actually calls.
- Hamilton: stop overwriting `window.HTMLDialogElement`.
- TabName: stop replacing `window.XMLHttpRequest`; subscribe to `core/net-tap`.
- Order Products Panel, Order Timeline & Overview: add `'use strict'`, declare `@grant none` behaviour explicitly.
- The `//?p=orders-view` double-slash match in three scripts becomes a single normaliser in `core/page`.

---

## 6. Migration sequence

Each phase is one or more PRs against `main`. Every module PR ships side by side with the legacy script: install the new bundle, disable the matching legacy script in Tampermonkey, compare, then merge.

### Phase 0 — Safety (no code, ~1 hour)

1. Tag today's `main` as `v0-legacy` and create a GitHub Release with a zip of the repo. This is the archive.
2. Flip the repo to private (Settings → General → Danger Zone → Change visibility). ExtraNav keeps working through jsDelivr's permanent cache.
3. Optionally rename to `sc-extranet-tools`. Update the remote in your local clone.
4. Commit the 26 originals plus their `.options.json` under `legacy/`. Leave the `.storage.json` files out; the 2FA one contains a stale code and they carry no logic.
5. Add `CLAUDE.md` / `AGENTS.md` with the architecture and rules from section 5, a PR template with the parity checklist from section 7, and `.gitignore` for `dist/` and `node_modules/`.

### Phase 1 — Archive and wipe (PR 1)

| Path | Action | Reason |
|---|---|---|
| `Smart Project GS/*.gs` (5 files, 3,317 lines) | Move to a new private repo `smart-project-gs` via `git subtree split` so its history travels with it, then delete here | Separate product (Call Log / Customer DB Apps Script) |
| `assets/css/*`, `assets/js/*.min.js`, `assets/img/*`, `assets/assets/data.bin` (empty) | Delete | Vendored copies of the extranet's own Bootstrap, jQuery, DataTables |
| `assets/css/custom.css`, `assets/js/orders-review.js`, `assets/js/functions.js` | Move to `docs/site-reference/` | Hand-written site code that documents server-rendered DOM the modules target |
| `ExtraNav/collapsible-panel.js`, `panel-demo.*` | Delete | Demo from the one previous PR; never used by the userscript |
| `ExtraNav/ExtraNav.html`, `ExtraNav.css`, `nav-ux.js`, `sc_icon.svg` | Move to `src/modules/nav/` unchanged for now | Consumed by ExtraNav via jsDelivr; becomes the inlined source in Phase 3 |

Result: `main` contains `docs/`, `legacy/`, `src/modules/nav/` and the repo scaffolding. Nothing else.

### Phase 2 — Scaffold (PR 2, ~half a day)

- `package.json`, `build.mjs` (esbuild, one entry per `meta/*.json`, CSS-as-text loader, header banner, stub generator).
- `src/core/*` with `page`, `observe`, `route`, `style`, `theme`, `settings`, `log`. Empty `modules/`.
- ESLint + Prettier, CI workflow: `npm ci && npm run lint && npm run build && npm run check:headers`.
- README with the Option A setup steps and the exact stub text.
- Acceptance: the empty `sc-extranet` bundle installs via the stub, logs its version on an extranet page, and the theme attribute is set before first paint.

### Phase 3 — Port modules (one PR each, dependency order)

| PR | Ports | Size | Notes |
|---|---|---|---|
| 3 | ExtraClean, Kill custom.css, ExtraSort, TabName | M | Establishes `core/net-tap` |
| 4 | SC TurboKit | M | Second subscriber to `net-tap`; prove the two taps compose |
| 5 | Hamilton loader | M | Emits `hamilton:loading`; drop `HTMLDialogElement` override |
| 6 | ExtraNav + inlined HTML/CSS/nav-ux | L | Biggest PR. `nav-ux.js` currently runs through `eval` inside a window/document proxy; turn it into a real module that receives the shadow root |
| 7 | Legacy Form search | M | Mounts into the nav shadow host; uses loader |
| 8 | SideDock + Tracking Panel + Message Center | L | SideDock embeds Message Center views, so they move together |
| 9 | Order Info Panels, Order Products Panel, Order Timeline & Overview, Orders Review | M | Pure DOM/layout modules |
| 10 | ExtraLinks, ExtraRight, ExtraClaims composer, fileBUBBLE, SC FAB | L | SCORD becomes `modules/lib/orders-api.js` |
| 11 | Adaptive Table Filters, Bubble Text, Copy Buttons | L | Validate the `scx.filters.v3` / `scx.colmenu.v1` persistence keys |
| 12 | SC Auto Review | S | Keep hash gate; add an explicit "armed" indicator |
| 13 | `sc-gmail-bridge`: Gmail Quote Search + Extranet 2FA | M | Narrow the Google match; keep the 5-minute freshness window and arm timeout exactly |

### Phase 4 — Cutover (PR 14)

1. Export Tampermonkey one last time (Utilities → Export) and attach the zip to the `v0-legacy` release.
2. Uninstall the 26 legacy scripts. Install the two stubs.
3. Delete `legacy/`. History keeps it.
4. Tag `v1.0.0`.

### Phase 5 — Optional distribution (only if a second person or machine needs it)

Add `release.yml`: on push to `main`, build and publish `dist/*.user.js` to a secret gist; add `@updateURL`/`@downloadURL` to the generated stubs. Bump `version` in `meta/*.json` per release so Tampermonkey sees updates.

---

## 7. Parity checklist for every module PR

- Which legacy script(s) this retires, by name and version.
- Pages exercised, listed as `?p=` values.
- Before/after screenshots for anything visual.
- Storage keys read or written, and confirmation the values carried over.
- Settings switches added to the nav settings panel, with defaults matching legacy behaviour.
- Any behaviour intentionally changed, called out in its own section. Silent changes are bugs.
- `npm run lint && npm run build` green; header check green.

---

## 8. Open questions

1. Does anyone besides you run these scripts? Decides whether Phase 5 happens at all.
2. Is the Apps Script project still live in Google? If yes, its new repo should get `clasp` so pushes deploy. If no, it just gets archived with the release zip.
3. Chrome or Edge on every machine? Firefox rules out Option A.
4. Keep the `Smart-Project` name or rename? Renaming is one click and GitHub redirects.

---

## 9. What this does not change

- No behaviour changes to the extranet automation (auto-review, PO send, 2FA submit) beyond keeping their gates. Any change to what they do is a separate, explicitly reviewed PR.
- No change to how the extranet itself is accessed. The scripts remain browser-side enhancements.

---

## 10. Execution log

Recorded as the plan was carried out, so the doc and the repo do not drift.

| Step | Outcome |
|---|---|
| Archive point | Branch `archive/v0-legacy` pins the pre-rebuild tree at `10c99e0`. An annotated tag was intended, but the session's git proxy rejects tag pushes, so a branch ref serves the same purpose. |
| Repo visibility | **Still public — this is the one step only you can do.** Settings → General → Danger Zone → Change visibility. Nothing in the rebuild depends on it, and ExtraNav keeps working either way, but the plan assumes it. |
| Apps Script extraction | Moved to `legacy/apps-script/gs` rather than a separate repo. Creating `smart-project-gs` and pushing to it needs a repo that does not exist yet and would not be in this session's GitHub App installation. Extract it with `git subtree split --prefix=legacy/apps-script/gs` once the repo exists. |
| Branch protection | Not configured: rulesets on a private repo need GitHub Pro. CI reports on every PR but cannot block a direct push. |
| PR structure | The rebuild lands as phase-separated commits on one branch rather than 14 branches, because this session is scoped to a single working branch. Each commit maps to a phase above. |

### Port status

All 26 scripts are ported, both bundles are wired, and `npm run check` is green.

**Verification is incomplete, and this is the main thing outstanding.** The port ran as
26 agents, each followed by an adversarial parity check against its legacy original. The
ports finished; every parity check died when the session's agent limit was reached. So no
module has been independently diffed against the script it replaces.

What *was* verified, by hand:

| Check | Result |
|---|---|
| Rule sweep across all 26 modules | No `window.*` assignments, no private `MutationObserver`, no `fetch`/XHR patching, no CSS in JS |
| Storage keys vs legacy | All 14 load-bearing keys present verbatim |
| `npm run check` | lint, build and header check green |
| Headless Chromium load, 6 page scopes + both bundles | Zero console errors |

The browser run found three real defects, all fixed: a `document-start` module appending
to `document.documentElement` before the parser created it (killed the loader and
TurboKit), `insertAdjacentHTML` called on a `ShadowRoot`, and a startup banner that
counted only the document-start stage.

None of that substitutes for a parity diff. Before uninstalling any legacy script, run
each module side by side with the original on the real site — the checklist in section 7
is the standard. The riskiest are the ones with the least mechanical ports: `nav`
(rewritten from an `eval`-through-a-proxy design), `messages`, `tables/filters`, and both
safety-critical modules, `automation/auto-review` and `twofa`.

# Working in this repo

Consolidated Tampermonkey userscripts for the strip-curtains extranet. Read `README.md`
for the module contract and `docs/CONSOLIDATION_PLAN.md` for why the repo is shaped this
way. `AGENTS.md` is a symlink to this file.

## Non-negotiables

1. **Never add a `window.*` global.** Cross-module communication goes through
   `ctx.events`. The legacy scripts leaked eleven globals and it made load order matter.
2. **One observer, one network tap.** Never construct a `MutationObserver`, never assign
   to `window.fetch` or `window.XMLHttpRequest` in a module. `ctx.observe` and `ctx.net`
   are the only sanctioned paths.
3. **Preserve user state.** Storage keys from the legacy scripts are load-bearing —
   `ui:theme`, `scx.filters.v3`, `scx.colmenu.v1`, `scord:recent:v1`,
   `sc:rightDrawerState`, `sc:rightDrawerActiveKey`, `sc:instant-back`,
   `tmx:search:extra`, `tmx:auto-open-from-gmail`, `strip2fa:*`. Read them verbatim.
4. **Automation keeps its gate.** `automation/auto-review` only acts behind its
   `#sc-autoreview` hash; the 2FA relay keeps its arm window and freshness check. Do not
   widen either without saying so explicitly in the PR.
5. **Keep headers narrow.** No `@connect *`, no `*.google.com`. `npm run check:headers`
   enforces this.

## Before pushing

```bash
npm run check
```

## Porting a legacy script

The original is in `legacy/userscripts/<slug>.user.js` and stays there until the port is
verified on the real site. Behaviour parity is the goal: same DOM output, same storage
keys, same defaults. Fixes worth making while porting (dropping a global, narrowing a
match, adding `'use strict'`) belong in the PR description, one bullet each — a silent
behaviour change is a bug even when it is an improvement.

/**
 * Message Center — the inline overlay on `?p=messagecenter`.
 *
 * Clicking an order link on the message centre list opens a modal over the page instead
 * of navigating: the order's conversation index on the left, one conversation on the
 * right, and Reply / Add Conversation as inline compose modals stacked above it. Thread
 * bodies come from `/ajax/sales/loadMessages.php` and are cached for two minutes, with a
 * simulated progress bar covering the first scrape.
 *
 * Ported from legacy/userscripts/message-center.user.js (v3.8.1). Differences from the
 * original are listed here rather than hidden in the code:
 *
 *  - No `window.__mcInlineInstalledFastInlineCompose_3_8_1` flag. The registry starts a
 *    module once, so the guard has nothing left to guard.
 *  - The `@match` on `?p=messagecenter` is the `pages` declaration below; nothing
 *    re-checks `location` at runtime.
 *  - All three fetches go through `ctx.net.request`, so they run over
 *    GM_xmlhttpRequest when the bundle has it. That API takes no AbortSignal, so the
 *    per-thread AbortController is gone with it: superseded thread loads are no longer
 *    cancelled (`latestShownThreadId` still stops a stale response from painting), and
 *    the 10s cap on the thread endpoint now rides on `timeoutMs` — honoured on the GM
 *    path, ignored on the plain-fetch fallback. Loading a compose modal picks up
 *    ctx.net's default timeout where the legacy fetch had none.
 *  - Cell text is normalised with `ctx.dom.norm` and interpolated with `ctx.dom.esc`
 *    rather than the script's own two copies. `norm` also folds non-breaking spaces,
 *    which these table cells are full of; `esc` escapes `'` on top of the four the
 *    legacy escaped.
 *  - The list pane's delegation is bound when the overlay is built rather than after
 *    every render, and lives in closure state instead of a `__mcDelegated` expando on
 *    the element. The pane itself is never replaced — only its innerHTML — so this is
 *    the same single binding.
 *  - The per-anchor click handlers `renderChatHeadActions` used to attach are gone. The
 *    document-level capture listener below them ran first and called `stopPropagation`,
 *    so those handlers never fired; the delegated listener does the same work.
 *  - Reopening the overlay mid-load stops the previous progress simulation instead of
 *    orphaning its timer loop, which recursed forever once its overlay went away.
 *  - `ctx.events` carries `messages:open`, so the dock can put an order's conversations
 *    on screen without either side reaching into the other. A signal naming a
 *    conversation selects that thread once the index renders instead of the newest one.
 *  - Debug tracing goes through `ctx.log` (`console.debug`, so it is behind the
 *    console's verbose filter) rather than the script's own DEBUG flag and console.time
 *    pairs.
 */

import css from './styles.css';

/* ------------------------------------------------------------------ config */

const STYLE_ID = 'messages';
const OVERLAY_ID = 'mc-inline-overlay';
const COMPOSE_ID = 'mc-compose-overlay';

const CFG = {
  THREAD_ENDPOINT: '/ajax/sales/loadMessages.php',
  CACHE_TTL_MS: 2 * 60 * 1000, // cache freshness 2 min
  TIMEOUT_MS: 10 * 1000,
  PREFETCH_COUNT: 4,
  HOVER_PREFETCH_DELAY: 250,

  // simulated progress bar timing
  PROGRESS_FULL_MS: 22000,
  PROGRESS_TICK_MIN: 200,
  PROGRESS_TICK_RAND: 200,
  PROGRESS_CAP_BEFORE_FINISH: 92,
};

/* ------------------------------------------------------------------ markup */

const LIST_SKELETON_HTML = `
      <div class="mc-skel-line" style="width:80%"></div>
      <div class="mc-skel-line" style="width:40%"></div>
      <div class="mc-skel-line" style="width:60%"></div>
    `;

const CHAT_SKELETON_HTML = `
      <div class="mc-bubble mc-bubble-loading">
        <div class="mc-skel-line" style="width:90%"></div>
        <div class="mc-skel-line" style="width:70%"></div>
        <div class="mc-skel-line" style="width:60%"></div>
      </div>
    `;

const OVERLAY_HTML = `
      <div class="mc-backdrop"></div>
      <div class="mc-card" role="dialog" aria-modal="true" aria-label="Message Center">
        <header class="mc-head">
          <div class="mc-head-left">
            <div class="mc-head-row1">
              <div class="mc-head-icon"></div>
              <div class="mc-head-title">Message Center</div>
            </div>
            <a class="mc-order-link" id="mc-order-link" href="#" target="_blank" rel="noopener noreferrer">Invoice #</a>
          </div>
          <button class="mc-close-btn" id="mc-close-btn" aria-label="Close">×</button>
        </header>

        <div class="mc-body">
          <!-- LEFT COLUMN -->
          <section class="mc-thread-pane">
            <div class="mc-pane-head">Conversations</div>
            <div class="mc-threads-list" id="mc-thread-list">${LIST_SKELETON_HTML}</div>
          </section>

          <!-- RIGHT COLUMN -->
          <section class="mc-chat-pane">
            <header class="mc-chat-head">
              <div class="mc-chat-head-main">
                <div class="mc-chat-subject" id="mc-chat-subject">Loading…</div>
                <div class="mc-chat-meta" id="mc-chat-meta"></div>
                <div class="mc-progress-wrap" id="mc-progress-wrap">
                  <div class="mc-progress-bar" id="mc-progress-bar" style="width:0%"></div>
                </div>
              </div>

              <div class="mc-chat-head-actions" id="mc-chat-head-actions">
                <!-- Reply / New get injected here -->
              </div>
            </header>

            <div class="mc-chat-history" id="mc-chat-history">${CHAT_SKELETON_HTML}</div>
          </section>
        </div>
      </div>
    `;

const COMPOSE_HTML = `
      <div class="mc-compose-backdrop"></div>
      <div class="mc-compose-card" role="dialog" aria-modal="true" aria-label="Compose Message">
        <header class="mc-compose-head">
          <div class="mc-compose-title" id="mc-compose-title">Compose</div>
          <button class="mc-compose-close" id="mc-compose-close" aria-label="Close">×</button>
        </header>
        <div class="mc-compose-body" id="mc-compose-body">
          <div style="font-size:13px;line-height:1.4;color:#6b7280;">
            Loading…
          </div>
        </div>
      </div>
    `;

const COMPOSE_LOADING_HTML = '<div style="font-size:13px;line-height:1.4;color:#6b7280;">Loading…</div>';
const COMPOSE_FAILED_HTML = '<div style="color:#b91c1c;font-size:13px;">Failed to load.</div>';
const THREAD_FAILED_HTML = '<div style="font-size:12px;color:#b91c1c;">Failed to load conversation.</div>';
const NO_THREADS_HTML = '<div style="font-size:12px;color:#6b7280;padding:12px;">No conversations.</div>';

/* ----------------------------------------------------------------- helpers */

function absUrl(href) {
  try {
    return new URL(href, location.origin).href;
  } catch {
    return href || '';
  }
}

function parseOrderIdFromUrl(u) {
  try {
    return new URL(u, location.origin).searchParams.get('view');
  } catch {
    const m = String(u || '').match(/view=(\d+)/);
    return m ? m[1] : null;
  }
}

const shouldInterceptOrderLink = (href) => !!href && href.includes('?p=orders-view');

/**
 * Infer the invoice link for a click that was not directly on the `<a>`: find the
 * closest row and scan inside it.
 */
function findOrderRowAnchor(target) {
  // don't hijack clicks that happened inside the MC overlay
  if (target.closest && target.closest(`#${OVERLAY_ID}`)) return null;

  // go up to a row-like container (table row or anything)
  const row = target.closest?.('tr, .order-row, .orderRow, .row');
  if (!row) return null;

  // inside that row, find the anchor that would normally open the order view
  return row.querySelector?.('a[href*="?p=orders-view"]') || null;
}

/**
 * Last resort for an order whose HTML never arrived: load the page in a hidden frame and
 * read the message block straight out of it. Same-origin, so contentDocument is readable.
 */
function iframeExtractMessageTable(orderUrl) {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.style.position = 'absolute';
    frame.style.left = '-99999px';
    frame.style.top = '-99999px';
    frame.style.width = '800px';
    frame.style.height = '600px';
    frame.style.visibility = 'hidden';
    frame.onload = () => {
      try {
        const b = frame.contentDocument.querySelector('#MessageCenter-Block, #MessageCentre-Block');
        resolve(b ? b.innerHTML : null);
      } catch {
        resolve(null);
      } finally {
        frame.remove();
      }
    };
    frame.src = orderUrl;
    document.body.appendChild(frame);
  });
}

/**
 * The overlay opens long before the order's HTML lands, so the bar is a fiction: it
 * creeps toward PROGRESS_CAP_BEFORE_FINISH and only reaches 100% when the real load
 * finishes. `stop()` ends the tick loop without touching the bar, for when a second
 * overlay open supersedes this run.
 */
function createProgressSim(wrap, bar) {
  const t0 = performance.now();
  let done = false;

  function tick() {
    if (done) return;
    const elapsed = performance.now() - t0;
    const pctTarget = Math.min(CFG.PROGRESS_CAP_BEFORE_FINISH, (elapsed / CFG.PROGRESS_FULL_MS) * CFG.PROGRESS_CAP_BEFORE_FINISH);
    const cur = parseFloat(bar.style.width) || 0;
    if (pctTarget > cur) bar.style.width = `${pctTarget.toFixed(2)}%`;
    setTimeout(tick, CFG.PROGRESS_TICK_MIN + Math.random() * CFG.PROGRESS_TICK_RAND);
  }
  tick();

  return {
    stop() {
      done = true;
    },
    completeEarly() {
      if (done) return;
      done = true;
      bar.style.transition = 'width .15s linear';
      bar.style.width = '100%';
      setTimeout(() => {
        wrap.style.display = 'none';
      }, 300);
    },
  };
}

/** The order a `messages:open` signal is about, or null when it does not name one. */
function orderUrlFromDetail(detail) {
  const raw = detail?.orderUrl || detail?.order || detail?.href || '';
  if (typeof raw !== 'string' || !shouldInterceptOrderLink(raw)) return null;
  return absUrl(raw);
}

/* --------------------------------------------------------- message centre */

function createMessageCenter(ctx) {
  const { dom, events, log, net } = ctx;
  const { $, $$, esc, norm } = dom;

  /** orderUrl -> { ts, threadsArr[], newHrefAbs?, inflight?, iframeTried? } */
  const orderTableCache = new Map();
  /** convoId -> { ts, html, inflight? } */
  const threadCache = new Map();

  const state = {
    currentOrderUrl: null,
    currentOrderId: null,
    currentInvoiceText: null,

    latestShownThreadId: null,

    // these drive header actions "Reply / New"
    activeThreadReplyHrefAbs: null, // reply for currently selected convo
    newConvHrefAbs: null, // "Add Conversation" for the order

    // a conversation asked for over ctx.events, selected once the index renders
    pendingThreadId: null,

    progressSim: null,
  };

  /** The two overlays, built on first use. */
  let overlay = null;
  let compose = null;

  const cellText = (td) => (td ? norm(td.textContent) : '');

  /* --------------------------------------------------------- main overlay */

  const isMainOpen = () => !!overlay && overlay.classList.contains('mc-open');

  function buildMainOverlayIfNeeded() {
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.innerHTML = OVERLAY_HTML;
    document.body.appendChild(overlay);

    $('#mc-close-btn', overlay)?.addEventListener('click', closeMainOverlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay.querySelector('.mc-backdrop')) closeMainOverlay();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (isComposeOpen()) closeComposeOverlay();
      else if (isMainOpen()) closeMainOverlay();
    });

    // The list pane is reused for every render, so one binding covers all of them.
    installListDelegation();
    return overlay;
  }

  function openMainOverlay(orderUrl, invoiceText) {
    buildMainOverlayIfNeeded();

    state.currentOrderUrl = orderUrl;
    state.currentOrderId = parseOrderIdFromUrl(orderUrl);
    state.currentInvoiceText = invoiceText || `Invoice #${state.currentOrderId || ''}`;

    state.activeThreadReplyHrefAbs = null;
    state.newConvHrefAbs = null;
    renderChatHeadActions(); // clears header buttons initially

    overlay.classList.add('mc-open');
    document.body.classList.add('mc-no-scroll');

    // header link
    const linkEl = $('#mc-order-link', overlay);
    if (linkEl) {
      linkEl.textContent = state.currentInvoiceText;
      linkEl.href = orderUrl;
    }

    // reset right pane placeholders
    $('#mc-chat-subject', overlay).textContent = 'Loading…';
    $('#mc-chat-meta', overlay).textContent = '';
    $('#mc-chat-history', overlay).innerHTML = CHAT_SKELETON_HTML;

    // reset progress bar & start ticking immediately
    startProgressSimulation();

    // reset left pane skeleton
    $('#mc-thread-list', overlay).innerHTML = LIST_SKELETON_HTML;

    // load convos for this order
    log.guard(() => loadOrderMessageTableProgressive(orderUrl));
  }

  function closeMainOverlay() {
    if (!overlay) return;
    overlay.classList.remove('mc-open');
    document.body.classList.remove('mc-no-scroll');
    // also close compose if it's up
    closeComposeOverlay();
  }

  /* ------------------------------------ compose overlay (Reply / New) ---- */

  const isComposeOpen = () => !!compose && compose.classList.contains('mc-open');

  function buildComposeOverlayIfNeeded() {
    if (compose) return compose;

    compose = document.createElement('div');
    compose.id = COMPOSE_ID;
    compose.innerHTML = COMPOSE_HTML;
    document.body.appendChild(compose);

    $('#mc-compose-close', compose)?.addEventListener('click', closeComposeOverlay);
    compose.addEventListener('click', (e) => {
      if (e.target === compose.querySelector('.mc-compose-backdrop')) closeComposeOverlay();
    });
    return compose;
  }

  function openComposeOverlay() {
    buildComposeOverlayIfNeeded();
    compose.classList.add('mc-open');
  }

  function closeComposeOverlay() {
    if (!compose) return;
    compose.classList.remove('mc-open');
  }

  /** Pull the site's own modal page in and mount its panel inside our compose card. */
  async function openComposeOverlayAbsUrl(absHref, fallbackTitle) {
    openComposeOverlay();

    const titleEl = $('#mc-compose-title', compose);
    const bodyEl = $('#mc-compose-body', compose);

    titleEl.textContent = fallbackTitle || 'Compose';
    bodyEl.innerHTML = COMPOSE_LOADING_HTML;

    let htmlText = '';
    try {
      htmlText = (await net.request(absHref)).text;
    } catch (err) {
      log.warn('compose fetch failed', err);
      bodyEl.innerHTML = COMPOSE_FAILED_HTML;
      return;
    }

    const doc = new DOMParser().parseFromString(htmlText, 'text/html');

    // try to find panel markup
    const panel = doc.querySelector('.panel.panel-default') || doc.body || doc.documentElement;

    // update title from remote heading if present
    const ph = panel.querySelector('.panel-heading');
    if (ph) {
      const t = norm(ph.textContent);
      if (t) titleEl.textContent = t;
    }

    // inject cloned panel body into our compose-body
    bodyEl.innerHTML = '';
    bodyEl.appendChild(panel.cloneNode(true));

    // also run their inline scripts (ajax submit, etc)
    for (const orig of $$('script', doc)) {
      const s = document.createElement('script');
      if (orig.src) s.src = orig.src;
      else s.textContent = orig.textContent || '';
      bodyEl.appendChild(s);
    }
  }

  /* ------------------------------------------- thread index parse / render */

  function parseThreadsFromHTML(rawHTML) {
    const doc = new DOMParser().parseFromString(rawHTML, 'text/html');
    const block = doc.querySelector('#MessageCenter-Block, #MessageCentre-Block');
    if (!block) return { threadsArr: [], newHrefAbs: null };

    // detect "new conversation" link in the fetched HTML
    // look for /views/modal/add_conversation.php?id=...
    let newHrefAbs = null;
    const newCand =
      block.querySelector('a[href*="add_conversation"]') || block.querySelector('a[href*="add_sales_messagecenter"]');
    if (newCand) newHrefAbs = absUrl(newCand.getAttribute('href'));

    const threadsArr = [];
    for (const tr of block.querySelectorAll('tbody tr')) {
      const tds = tr.children;
      if (!tds || tds.length < 5) continue;

      // subject anchor with grabMessages()
      const subjA = tr.querySelector('a[onclick*="grabMessages"]');
      if (!subjA) continue;
      const m = (subjA.getAttribute('onclick') || '').match(/grabMessages\s*\(\s*(\d+)\s*\)/);
      if (!m) continue;

      // reply link for this thread
      const replyA = tr.querySelector('a[href*="reply_message.php"]');

      threadsArr.push({
        id: m[1],
        subject: norm(subjA.textContent),
        from: cellText(tds[1]),
        to: cellText(tds[2]),
        cc: cellText(tds[3]), // not currently shown but we keep it
        date: cellText(tds[5]),
        replyHrefAbs: replyA ? absUrl(replyA.getAttribute('href') || '') : null,
      });
    }

    return { threadsArr, newHrefAbs };
  }

  function renderThreadListFromArr(threadsArr) {
    const listPane = $('#mc-thread-list', overlay);
    if (!listPane) return;

    if (!threadsArr || !threadsArr.length) {
      listPane.innerHTML = NO_THREADS_HTML;
      return;
    }

    listPane.innerHTML = threadsArr
      .map(
        (th) => `
        <div class="mc-thread-row"
             data-id="${esc(th.id || '')}"
             data-subj="${esc(th.subject || '')}"
             data-from="${esc(th.from || '')}"
             data-to="${esc(th.to || '')}"
             data-date="${esc(th.date || '')}">
          <div class="mc-thread-main">
            <div class="mc-thread-subj">${esc(th.subject || '(no subject)')}</div>
            <div class="mc-thread-route">
              ${esc(th.from || '')} → ${esc(th.to || '')}
            </div>
          </div>
          <div class="mc-thread-side">
            <div class="mc-thread-date">${esc(th.date || '')}</div>
            ${th.replyHrefAbs ? `<a class="mc-btn" data-mc-inline-reply="1" data-href="${esc(th.replyHrefAbs)}">Reply</a>` : ''}
          </div>
        </div>
      `,
      )
      .join('');
  }

  /**
   * Open a thread as soon as the index exists: the one a `messages:open` signal asked
   * for, otherwise the first (most recent) row.
   */
  function autoSelectThreadAfterList(threadsArr) {
    if (!threadsArr || !threadsArr.length) return;

    const wanted = state.pendingThreadId;
    state.pendingThreadId = null;
    const first = (wanted && threadsArr.find((t) => String(t.id) === wanted)) || threadsArr[0];
    if (!first) return;

    // set active reply link so header actions (Reply/New) are correct
    state.activeThreadReplyHrefAbs = first.replyHrefAbs || null;
    renderChatHeadActions();

    // build the tiny header meta string for right pane
    const routeText = `From: ${first.from || ''} → ${first.to || ''}` + (first.date ? ` · ${first.date}` : '');

    // actually load that thread into the chat pane
    loadThread(first.id, {
      subject: first.subject || '',
      route: routeText,
      replyHrefAbs: first.replyHrefAbs || null,
    });
  }

  /* ------------------------------------------------- order table: caching */

  function freshOrderTable(orderUrl) {
    const entry = orderTableCache.get(orderUrl);
    if (!entry) return null;
    if (Date.now() - entry.ts < CFG.CACHE_TTL_MS && entry.threadsArr && entry.threadsArr.length) return entry;
    return null;
  }

  function saveOrderTable(orderUrl, data) {
    orderTableCache.set(orderUrl, {
      threadsArr: data.threadsArr || [],
      newHrefAbs: data.newHrefAbs || null,
      ts: Date.now(),
    });
  }

  /** fallback new-convo href if HTML didn't expose one */
  function buildAddConvFallback() {
    // /views/modal/add_conversation.php?id=<orderId>
    if (state.currentOrderId) return absUrl(`/views/modal/add_conversation.php?id=${state.currentOrderId}`);
    return null;
  }

  /** Everything that happens once an index — cached, joined or freshly parsed — exists. */
  function paintOrderTable(pack) {
    renderThreadListFromArr(pack.threadsArr);

    // store new-convo href in state
    state.newConvHrefAbs = pack.newHrefAbs || buildAddConvFallback();
    renderChatHeadActions(); // refresh New button

    // immediately open newest thread
    autoSelectThreadAfterList(pack.threadsArr);

    finishProgressEarly();
    prefetchTopNThreads();
  }

  async function loadOrderMessageTableProgressive(orderUrl) {
    const t0 = performance.now();
    const trace = (how) => log.debug(`order threads ${how} in ${(performance.now() - t0).toFixed(1)}ms`, orderUrl);

    const cached = freshOrderTable(orderUrl);
    if (cached) {
      paintOrderTable(cached);
      trace('from cache');
      return;
    }

    let existing = orderTableCache.get(orderUrl);
    if (existing?.inflight) {
      const pack = await existing.inflight;
      if (pack?.threadsArr) paintOrderTable(pack);
      trace('joined in-flight');
      return;
    }

    const inflight = (async () => {
      let rawHTML = '';
      try {
        rawHTML = (await net.request(orderUrl)).text;
      } catch (err) {
        log.warn('orderUrl fetch fail', orderUrl, err);
      }

      // parse final
      let finalPack = { threadsArr: [], newHrefAbs: null };
      if (rawHTML) finalPack = parseThreadsFromHTML(rawHTML);

      // if we still didn't get a "new conversation" link in the HTML, build fallback
      if (!finalPack.newHrefAbs) finalPack.newHrefAbs = buildAddConvFallback();

      if (!finalPack.threadsArr.length) {
        // fallback: iframe attempt (rare)
        if (!existing?.iframeTried) {
          existing = existing || {};
          existing.iframeTried = true;
          orderTableCache.set(orderUrl, existing);

          const iframeHTML = await iframeExtractMessageTable(orderUrl);
          if (iframeHTML) {
            finalPack = parseThreadsFromHTML(`<div>${iframeHTML}</div>`);
            if (!finalPack.newHrefAbs) finalPack.newHrefAbs = buildAddConvFallback();
          }
        }
      }

      saveOrderTable(orderUrl, finalPack);
      paintOrderTable(finalPack);
      return finalPack;
    })();

    orderTableCache.set(orderUrl, { ...(existing || {}), inflight, ts: Date.now() });

    await inflight;
    trace('fetched');
  }

  /* ------------------------------------------ thread fetch / render (right) */

  function cacheGetFreshThread(id) {
    const e = threadCache.get(id);
    if (!e) return null;
    if (Date.now() - e.ts < CFG.CACHE_TTL_MS && e.html) return e;
    return null;
  }

  function saveThread(id, html) {
    threadCache.set(id, { html, ts: Date.now() });
  }

  function fetchThreadHTML(id) {
    const cached = threadCache.get(id);
    if (cached?.inflight) return cached.inflight;

    const inflight = (async () => {
      try {
        const fd = new FormData();
        fd.append('id', id);
        const { text: raw } = await net.request(CFG.THREAD_ENDPOINT, {
          method: 'POST',
          body: fd,
          timeoutMs: CFG.TIMEOUT_MS,
        });
        let data = null;
        try {
          data = JSON.parse(raw);
        } catch { /* a session timeout answers with HTML; treated as a server error */ }
        if (data?.type === 'success') {
          saveThread(id, data.html);
          return data.html;
        }
        throw new Error((data && data.description) || 'Server error');
      } finally {
        const ent = threadCache.get(id);
        if (ent) delete ent.inflight;
      }
    })();

    threadCache.set(id, { ...(cached || {}), inflight });
    return inflight;
  }

  async function prefetchThread(id) {
    if (cacheGetFreshThread(id)) return;
    try {
      await fetchThreadHTML(id);
    } catch { /* a prefetch that fails is retried by the real click */ }
  }

  async function loadThread(convoId, meta = {}) {
    state.latestShownThreadId = String(convoId);

    const subjectEl = $('#mc-chat-subject', overlay);
    const metaEl = $('#mc-chat-meta', overlay);
    const histEl = $('#mc-chat-history', overlay);

    // Fill header right away from clicked row
    if (meta) {
      if (meta.subject) subjectEl.textContent = meta.subject;
      metaEl.textContent = meta.route || '';
      if (meta.replyHrefAbs) state.activeThreadReplyHrefAbs = meta.replyHrefAbs;
      renderChatHeadActions();
    }

    // show cached immediately if any
    const fresh = cacheGetFreshThread(convoId);
    if (fresh) {
      histEl.innerHTML = fresh.html;
      // background refresh (SWR)
      fetchThreadHTML(convoId)
        .then((html) => {
          if (state.latestShownThreadId === String(convoId)) histEl.innerHTML = html;
        })
        .catch(() => {});
      return;
    }

    // skeleton while loading
    histEl.innerHTML = CHAT_SKELETON_HTML;

    try {
      const html = await fetchThreadHTML(convoId);
      if (state.latestShownThreadId === String(convoId)) histEl.innerHTML = html;
      log.debug('thread rendered', convoId);
    } catch (err) {
      if (state.latestShownThreadId === String(convoId)) histEl.innerHTML = THREAD_FAILED_HTML;
      log.warn('thread load failed', convoId, err);
    }
  }

  /** Warm the first few conversations, staggered so they do not fight the visible one. */
  function prefetchTopNThreads() {
    const listPane = $('#mc-thread-list', overlay);
    if (!listPane) return;

    $$('.mc-thread-row', listPane)
      .slice(0, CFG.PREFETCH_COUNT)
      .map((row) => row.getAttribute('data-id'))
      .filter(Boolean)
      .forEach((id, i) => setTimeout(() => prefetchThread(id), 150 + i * 150));
  }

  /* ------------------------------------------ click / hover in the left pane */

  function installListDelegation() {
    const listPane = $('#mc-thread-list', overlay);
    if (!listPane) return;

    let hoverTimer = null;

    listPane.addEventListener(
      'click',
      (ev) => {
        // handle inline Reply in list
        const replyBtn = ev.target.closest('[data-mc-inline-reply]');
        if (replyBtn) {
          ev.preventDefault();
          ev.stopPropagation();
          openComposeOverlayAbsUrl(absUrl(replyBtn.getAttribute('data-href') || ''), 'Reply');
          return;
        }

        // otherwise, load convo on row click
        const row = ev.target.closest('.mc-thread-row');
        if (!row) return;

        ev.preventDefault();
        ev.stopPropagation();

        const convoId = row.getAttribute('data-id');
        if (!convoId) return;

        const fromTxt = row.getAttribute('data-from') || '';
        const toTxt = row.getAttribute('data-to') || '';
        const dateTxt = row.getAttribute('data-date') || '';
        const routeText = `From: ${fromTxt} → ${toTxt}${dateTxt ? ` · ${dateTxt}` : ''}`;

        const replyHrefAbs = row.querySelector('[data-mc-inline-reply]')?.getAttribute('data-href') || null;
        state.activeThreadReplyHrefAbs = replyHrefAbs;
        renderChatHeadActions();

        loadThread(convoId, { subject: row.getAttribute('data-subj') || '', route: routeText, replyHrefAbs });
      },
      { capture: true },
    );

    // mouseenter does not bubble, but it still propagates down the capture path, so one
    // capturing listener on the pane covers every row.
    listPane.addEventListener(
      'mouseenter',
      (ev) => {
        const row = ev.target.closest('.mc-thread-row');
        if (!row) return;
        const id = row.getAttribute('data-id');
        if (!id) return;
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(() => prefetchThread(id), CFG.HOVER_PREFETCH_DELAY);
      },
      true,
    );
  }

  /* ----------------------------------- header actions (Reply / New buttons) */

  function renderChatHeadActions() {
    const act = overlay && $('#mc-chat-head-actions', overlay);
    if (!act) return;

    const replyHref = state.activeThreadReplyHrefAbs;
    const newHref = state.newConvHrefAbs;

    // Clicks are handled by the delegated listener in installComposeSafetyNet, which
    // sees them first anyway.
    act.innerHTML =
      (replyHref ? `<a class="mc-btn" data-mc-action="reply" data-href="${esc(replyHref)}">Reply</a>` : '') +
      (newHref ? `<a class="mc-btn mc-btn-secondary" data-mc-action="new" data-href="${esc(newHref)}">New</a>` : '');
  }

  /* --------------------------------------------------------- progress bar */

  function startProgressSimulation() {
    const wrap = $('#mc-progress-wrap', overlay);
    const bar = $('#mc-progress-bar', overlay);
    if (!wrap || !bar) return;

    // A previous run has to stop ticking, or its timer loop outlives the overlay it was
    // drawing for and both runs write to this bar.
    state.progressSim?.stop();

    wrap.style.display = 'block';
    bar.style.transition = 'width .2s linear';
    bar.style.width = '0%';

    state.progressSim = createProgressSim(wrap, bar);
  }

  function finishProgressEarly() {
    if (!state.progressSim) return;
    state.progressSim.completeEarly();
    state.progressSim = null;
  }

  /* ------------------------------------------------------- page intercepts */

  function deriveInvoiceTextFromAnchor(a) {
    const raw = norm(a.textContent);
    if (raw) return raw;
    const id = parseOrderIdFromUrl(a.href || '');
    return id ? `Invoice #${id}` : 'Invoice';
  }

  /** Clicking "Invoice #123456" — or anywhere on its row — opens the overlay instead. */
  function installPageDelegation() {
    document.addEventListener(
      'click',
      (e) => {
        // 1. First try: was the user actually clicking an <a>?
        let a = e.target.closest?.('a') || null;

        // 2. If not, try to treat the entire row as clickable.
        //    We'll "promote" the click to the row's invoice link.
        if (!a) a = findOrderRowAnchor(e.target);
        if (!a) return; // nothing to do

        // special case: this is the header invoice link inside the open overlay.
        // let it behave normally (open in new tab etc).
        if (a.id === 'mc-order-link') return;

        const href = a.getAttribute('href') || '';
        if (!shouldInterceptOrderLink(href)) return;

        // allow ctrl/cmd/shift/alt/middle click to open new tab/window normally
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;

        e.preventDefault();
        e.stopPropagation();

        const urlAbs = absUrl(href);
        const invoiceText = deriveInvoiceTextFromAnchor(a);

        log.debug('open MC overlay for', urlAbs, 'invoice:', invoiceText);
        openMainOverlay(urlAbs, invoiceText);
      },
      { capture: true },
    );
  }

  /**
   * If anything inside the main overlay tries to open reply_message.php or
   * add_conversation.php in a new tab, intercept it and open the compose overlay.
   */
  function installComposeSafetyNet() {
    document.addEventListener(
      'click',
      (ev) => {
        if (!isMainOpen()) return;

        const link = ev.target.closest?.('a[data-mc-action="reply"], a[data-mc-action="new"]');
        if (!link || !overlay.contains(link)) return;

        ev.preventDefault();
        ev.stopPropagation();
        const isReply = link.getAttribute('data-mc-action') === 'reply';
        openComposeOverlayAbsUrl(absUrl(link.getAttribute('data-href') || '#'), isReply ? 'Reply' : 'Add Conversation');
      },
      { capture: true },
    );
  }

  /* ------------------------------------------------------------------ start */

  return {
    start() {
      installPageDelegation();
      installComposeSafetyNet();

      // The dock (or anything else) asking for an order's conversations. A signal that
      // does not name an order is not ours to act on.
      events.on('messages:open', (detail) => {
        if (detail?.source === 'messages') return; // our own signal, coming back
        const orderUrl = orderUrlFromDetail(detail);
        if (!orderUrl) {
          log.debug('messages:open without an orders-view url, ignored', detail);
          return;
        }
        state.pendingThreadId = String(detail.conversation || detail.thread || '').replace(/^#?conversation/i, '') || null;
        openMainOverlay(orderUrl, detail.invoice || detail.label || null);
      });

      log.debug('delegation armed');
    },
  };
}

/* ------------------------------------------------------------------ module */

export default {
  id: 'messages',
  title: 'Message Center overlay',
  runAt: 'idle',
  pages: ['messagecenter'],
  enabledByDefault: true,

  init(ctx) {
    ctx.style.add(css, { id: STYLE_ID });
    createMessageCenter(ctx).start();
  },
};

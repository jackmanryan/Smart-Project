/** ========================
 * GLOBALS (clean)
 * ======================== */

/** ========================
* COLUMN PRUNE SPECS
* ======================== */
const CALL_ARCHIVE_REMOVE_HEADERS = Object.freeze([
  'First Invoice Related Call (Date)',
  'Invoice Related Calls (Total)',
  'Customer Calls (Week)',
  'Customer Calls (2 Weeks)',
  'Customer Calls (Total)',
  'Tracking Notification'
]);

// Remove legacy manual fields from *Customer Database* (not Archive)
const CUSTOMER_DB_REMOVE_HEADERS = Object.freeze([
  'Aggro Scale (1–5)',
  'Do Not Contact (DNC)',
  'Notes'
]);

/**
 * Delete columns by exact header names (case/diacritics/punct normalized via canonHeader_).
 * Safe: only deletes when headers match; deletes right→left to avoid index shifts.
 * @return {number} count of columns removed
 */
function pruneColumnsByHeader_(sheetName, headersToRemove) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEETS.MAIN_ID);
  const sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error(`Sheet "${sheetName}" not found.`);
  if (sh.getLastRow() === 0 || sh.getLastColumn() === 0) return 0;

  const canon = canonHeader_;
  const want = new Set(headersToRemove.map(h => canon(h)));
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  const cols = [];
  for (let i = 0; i < head.length; i++) {
    if (want.has(canon(String(head[i] ?? '')))) cols.push(i + 1);
  }
  cols.sort((a, b) => b - a).forEach(c => sh.deleteColumn(c));
  return cols.length;
}

/**
 * One-time migration: remove obsolete columns from Call Archive and Customer Database.
 * - Keeps any "X has tracking" column because it is not in the removal list.
 * - Idempotent: running again is a no-op.
 */
function oneTime_migrate_2025_11_03_PruneColumns() {
  const rmArchive = pruneColumnsByHeader_(CONFIG.SHEETS.CALL_ARCHIVE_TAB, CALL_ARCHIVE_REMOVE_HEADERS);
  const rmCust = pruneColumnsByHeader_(CONFIG.SHEETS.CUSTOMER_DB_TAB, CUSTOMER_DB_REMOVE_HEADERS);
  Log.info(`Pruned columns → Call Archive: ${rmArchive}, Customer Database: ${rmCust}`);
}
const TZ = Session.getScriptTimeZone() || 'America/Vancouver';

const RE = Object.freeze({
  PO_NAME: /^PO_(\d+)/i,
  SO_NAME: /^SO[\s_-]?\d+\.pdf$/i,
  PO_TOTAL: /Total\s+Amount:\s*US\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i
});
const VENDOR_SENDER_RE = /@extruflex(?:na|usa)?\.com$/i;

const CONFIG = Object.freeze({
  NA_VALUE: 'n / a',

  RUN: Object.freeze({
    LOOKBACK_DAYS: 10,
    MAX_THREADS_PER_VENDOR: 15,
    REQUIRE_SINGLE_MESSAGE: true,
    DRY_RUN: false
  }),

  PURCHASE_ORDER: Object.freeze({
    SUBJECT_PREFIX: 'Purchase Order 2363-',
    BODY_MARKER: 'If you are unable to view the attached purchase order, please contact us immediately.',
    FORWARD_BODY_HTML: 'Please Confirm :)'
  }),

  VENDORS: Object.freeze([
    {
      name: 'Extruflex',
      labelSource: 'Vendor/Extruflex/PO',
      labelForwarded: 'Vendor/Extruflex/PO/Forwarded',
      forwardTo: ['m.santos@extruflex.com', 't.delacruz@extruflex.com', 'info@extruflexna.com']
    },
    {
      name: 'Midland Covers',
      labelSource: 'Vendor/Midland Covers/PO',
      labelForwarded: 'Vendor/Midland Covers/PO/Forwarded',
      forwardTo: ['quotes@midlandcovers.com']
    },
    {
      name: 'Singer Safety',
      labelSource: 'Vendor/Singer Safety/PO',
      labelForwarded: 'Vendor/Singer Safety/PO/Forwarded',
      forwardTo: ['teizik@singersafety.com']
    }
  ]),

  LABELS: Object.freeze({
    EX_FWD: 'Vendor/Extruflex/PO/Forwarded',
    EX_CNF: 'Vendor/Extruflex/PO/Confirmed',
    EX_OOR: 'Vendor/Extruflex/OOR',
    TRACKING_VENDOR: 'Vendor/Extruflex/Tracking',         // fixed
    MID_FWD: 'Vendor/Midland Covers/PO/Forwarded',
    MID_CNF: 'Vendor/Midland Covers/PO/Confirmed',
    SINGER_OOR: 'Vendor/Singer Safety/OOR',                   // added
    CUSTOMER: 'Customer',
    NEEDS_TRACKING: 'Customer/Needs/Tracking',                      // pointed to existing label
    RESOLVED: 'System/resolved',                                     // fixed (top-level)
    TWO_FA: 'System/ZZZ ~~~ 2FA ~~~ ZZZ'                             // fixed (top-level)
  }),

  ADDRESSES: Object.freeze({
    ME: 'order-management@strip-curtains.com',
    OOR_FROM: 'm.santos@extruflex.com',
    MIDLAND_DOMAIN: '@midlandcovers.com',
    VENDOR_DOMAIN: '@extruflex.com',
    SINGER_DOMAIN: '@singersafety.com'                        // added
  }),

  SHEETS: Object.freeze({
    MAIN_ID: '1hGjEM_A11HL6FHI5OkGEnh4Rmk9x7GhGRnuKt_DVrrM',
    TRACKING_ID: '1hGjEM_A11HL6FHI5OkGEnh4Rmk9x7GhGRnuKt_DVrrM',
    MAIN_TAB: 'Extruflex',
    MIDLAND_TAB: 'Midland Covers',
    CALL_INTERFACE_TAB: 'Call Interface',
    CALL_LOG_TAB: 'Call Log',
    CUSTOMER_DB_TAB: 'Customer Database',
    CALL_ARCHIVE_TAB: 'Call Archive',
    EXPORT_TAB: 'Export',
    TRACKING_LOG: 'Tracking Log',
    WEB_INTAKE: 'AKON'                              // added
  }),

  EXPORT_PUSH: Object.freeze({
    TARGET_SPREADSHEET_ID: '1DS_z6raFdmblqyTn2Y-AMZdfC-5FrITO-_jALoOLuwQ',
    TARGET_SHEET_NAME: null,     // use active
    SOURCE_SHEET_NAME: 'Export',
    SOURCE_START_ROW: 3,         // Export!A3
    TARGET_START_ROW: 2,         // A2
    TARGET_COLUMN: 1             // A
  }),

  CALL_IFRAME: Object.freeze({
    CI_COL_START: 2,             // B
    CI_COL_END: 11,              // K
    CL_WRITE_WIDTH: 17           // A..Q
  }),

  ONEDIT: Object.freeze({
    TRIGGER_COL: 11,             // K
    TRIGGER_MIN_ROW: 2,
    TRIGGER_MAX_ROW: 4,
    SRC_START_COL: 2,            // B
    SRC_WIDTH: 10                // B..K
  }),

  MAINTENANCE: Object.freeze({
    WINDOW_ROWS: 500,
    SORT_ENABLED: true,
    SORT_LAST_COL: 17,
    SORT_MAX_ROWS: 5000
  }),

  INVOICE_RULES: Object.freeze({
    MIN_DIGITS: 5,
    MAX_DIGITS: 20
  }),

  OCR: Object.freeze({ LANG: 'en', MAX_RETRIES: 3, COOLDOWN_MS: 1000, CACHE: true })
});

// Text normalization helpers
const NA_VALUE = CONFIG?.NA_VALUE ?? '—';
const _trim = v => String(v ?? '').trim();
const NA_REGEX = /^(?:n\s*\/?\s*a|na|#n\/a|na_value)$/i;
const normalizeNA = v => (NA_REGEX.test(_trim(v)) ? NA_VALUE : _trim(v));
const naIfBlank = v => (_trim(v) === '' ? NA_VALUE : normalizeNA(v));
const isNewCustomerInvoice = v => _trim(v).toLowerCase().replace(/[^a-z]/g, '').startsWith('newcust');
const NA_ERROR_STRINGS = new Set(['#N/A', 'N/A', 'NA', 'na', 'n/a']);

// Logging
const Log = {
  ts() { return new Date().toISOString(); },
  info(msg, ...a) { Logger.log(`[INFO  ${this.ts()}] ${msg}`, ...a); },
  warn(msg, ...a) { Logger.log(`[WARN  ${this.ts()}] ${msg}`, ...a); },
  err(msg, ...a) { Logger.log(`[ERROR ${this.ts()}] ${msg}`, ...a); }
};

// Row config for the Call Interface
const ROW_CONFIGS = Object.freeze({
  2: { key: 'r2', receiver: '3 Peter' },
  3: { key: 'r3', receiver: '6 Daniel' },
  4: { key: 'r4', receiver: '8 Jack' }
});

// Runtime flags
const APPEND_AT_TOP = false;
const LOCK_MS = 700;

// Back-compat aliases (keep while refactoring)
const CI_SHEET = CONFIG.SHEETS.CALL_INTERFACE_TAB;
const CL_SHEET = CONFIG.SHEETS.CALL_LOG_TAB;
const CUSTOMER_DB_SHEET = CONFIG.SHEETS.CUSTOMER_DB_TAB;
const SHEET_ARCHIVE = CONFIG.SHEETS.CALL_ARCHIVE_TAB;
const SHEET_DB = CONFIG.SHEETS.CUSTOMER_DB_TAB;

const TARGET_SPREADSHEET_ID = CONFIG.EXPORT_PUSH.TARGET_SPREADSHEET_ID;
const TARGET_SHEET_NAME = CONFIG.EXPORT_PUSH.TARGET_SHEET_NAME;
const SOURCE_SHEET_NAME = CONFIG.EXPORT_PUSH.SOURCE_SHEET_NAME;
const SOURCE_START_ROW = CONFIG.EXPORT_PUSH.SOURCE_START_ROW;
const TARGET_START_ROW = CONFIG.EXPORT_PUSH.TARGET_START_ROW;
const TARGET_COLUMN = CONFIG.EXPORT_PUSH.TARGET_COLUMN;

const SPREADSHEET_ID = CONFIG.SHEETS.MAIN_ID;
const SOURCE_SHEET = CONFIG.SHEETS.CALL_INTERFACE_TAB;
const TARGET_SHEET = CONFIG.SHEETS.CALL_LOG_TAB;

const TRIGGER_COL = CONFIG.ONEDIT.TRIGGER_COL;
const TRIGGER_MIN_ROW = CONFIG.ONEDIT.TRIGGER_MIN_ROW;
const TRIGGER_MAX_ROW = CONFIG.ONEDIT.TRIGGER_MAX_ROW;
const SRC_START_COL = CONFIG.ONEDIT.SRC_START_COL;
const SRC_WIDTH = CONFIG.ONEDIT.SRC_WIDTH;

const CI_COL_START = CONFIG.CALL_IFRAME.CI_COL_START;
const CI_COL_END = CONFIG.CALL_IFRAME.CI_COL_END;
const CL_WRITE_WIDTH = CONFIG.CALL_IFRAME.CL_WRITE_WIDTH;

const MAINT_WINDOW_ROWS = CONFIG.MAINTENANCE.WINDOW_ROWS;
const MAINT_SORT = CONFIG.MAINTENANCE.SORT_ENABLED;
const SORT_LAST_COL = CONFIG.MAINTENANCE.SORT_LAST_COL;
const SORT_MAX_ROWS = CONFIG.MAINTENANCE.SORT_MAX_ROWS;

const MIN_INVOICE_DIGITS = CONFIG.INVOICE_RULES.MIN_DIGITS;
const MAX_INVOICE_DIGITS = CONFIG.INVOICE_RULES.MAX_DIGITS;

// Persisted property keys
const DP_DRAFT_ROW = 'CL_DRAFT_ROW';
const DP_DRAFT_MS = 'CL_DRAFT_MS';
const SUPPRESS_PROP = 'SUPPRESS_HANDLEEDIT_CLEAR';
const DEFERRED_PUSH_HANDLER = 'deferredPush_';
const PUSH_TRIGGER_FLAG = 'PUSH_TRIGGER_ACTIVE';

// Header alias
const _canonHeader_ = canonHeader_;

/** ---------------------------------------
 *  Optional: sanity-check your Globals
 *  (Run once from Script Editor → Logs)
 * --------------------------------------*/
function validateGlobals_() {
  const problems = [];

  // Labels that must exist
  const MUST_LABELS = [
    CONFIG.LABELS.EX_FWD, CONFIG.LABELS.EX_CNF, CONFIG.LABELS.EX_OOR,
    CONFIG.LABELS.TRACKING_VENDOR, CONFIG.LABELS.MID_FWD, CONFIG.LABELS.MID_CNF,
    CONFIG.LABELS.SINGER_OOR, CONFIG.LABELS.RESOLVED, CONFIG.LABELS.TWO_FA,
    CONFIG.LABELS.CUSTOMER, CONFIG.LABELS.NEEDS_TRACKING
  ];

  for (const name of MUST_LABELS) {
    const ok = !!GmailApp.getUserLabelByName(name);
    if (!ok) problems.push(`Missing Gmail label: "${name}"`);
  }

  // Sheets sanity
  const ss = SpreadsheetApp.openById(CONFIG.SHEETS.MAIN_ID);
  ['MAIN_TAB', 'MIDLAND_TAB', 'CALL_INTERFACE_TAB', 'CALL_LOG_TAB', 'CUSTOMER_DB_TAB', 'CALL_ARCHIVE_TAB', 'EXPORT_TAB']
    .forEach(k => {
      const nm = CONFIG.SHEETS[k];
      if (!ss.getSheetByName(nm)) problems.push(`Missing sheet/tab: ${k}="${nm}"`);
    });

  if (problems.length) {
    Log.warn('Globals validation found issues:\n - ' + problems.join('\n - '));
  } else {
    Log.info('Globals look good ✓');
  }
}

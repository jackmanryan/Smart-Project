const CI_SHEET = 'Call Interface';
const CL_SHEET = 'Call Log';
const CI_COL_START = 2;  // B
const CI_COL_END   = 11; // K (inclusive)
const CL_WRITE_WIDTH = 17; // A..Q

const CUSTOMER_DB_SHEET = 'Customer Database';
const DP_DRAFT_ROW = 'CL_DRAFT_ROW';
const DP_DRAFT_MS  = 'CL_DRAFT_MS';

/***** CONFIG *****/
const SHEET_ARCHIVE = 'Call Archive';
const SHEET_DB      = 'Customer Database';
const TZ            = Session.getScriptTimeZone() || 'America/Vancouver';

/***** CONFIG *****/
const TARGET_SPREADSHEET_ID = '1DS_z6raFdmblqyTn2Y-AMZdfC-5FrITO-_jALoOLuwQ'; // Target file
const TARGET_SHEET_NAME     = null;  // null = target's active tab; or set a tab name, e.g. 'Calls'

const SOURCE_SHEET_NAME     = 'Export';
const SOURCE_START_ROW      = 3;     // Export!A3
const TARGET_START_ROW      = 2;     // write to A2 in target
const TARGET_COLUMN         = 1;     // column A

const NA_VALUE = 'n / a';
const MAINT_WINDOW_ROWS = 500;     // only touch the newest N rows; set to null for “all”
const MAINT_SORT     = true;   // set false to skip sorting
const SORT_LAST_COL  = 17;     // 17 = A:Q; use sh.getLastColumn() if you truly need full width
const SORT_MAX_ROWS  = 5000;   // safety throttle; set null to disable
const _trim = v => String(v ?? '').trim();
const normalizeNA = v => (/^n\s*\/?\s*a$/i.test(_trim(v)) ? NA_VALUE : _trim(v));
const naIfBlank  = v => (_trim(v) === '' ? NA_VALUE : normalizeNA(v));

// Robust match for “New Customer” (case-insensitive, ignores spaces/dashes/ punctuation)
const isNewCustomerInvoice = v => _trim(v).toLowerCase().replace(/[^a-z]/g,'').startsWith('newcust');


/** ---------------------------------
 *  CONFIG
 * ----------------------------------*/
const CONFIG = {
  RUN: {
    LOOKBACK_DAYS: 10,
    MAX_THREADS_PER_VENDOR: 15,
    REQUIRE_SINGLE_MESSAGE: true, // original logic
    DRY_RUN: false                // set true to simulate (no label/forward changes)
  },
  PURCHASE_ORDER: {
    SUBJECT_PREFIX: 'Purchase Order 2363-',
    BODY_MARKER: 'If you are unable to view the attached purchase order, please contact us immediately.',
    FORWARD_BODY_HTML: 'Please Confirm :)'
  },
  // Central place for all vendor routing + labels
  VENDORS: [
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
      forwardTo: ['nscieszinski@singersafety.com', 'teizik@singersafety.com']
    }
  ],

  // Existing constants carried over (rename where helpful)
  LABELS: {
    EX_FWD: 'Vendor/Extruflex/PO/Forwarded',
    EX_CNF: 'Vendor/Extruflex/PO/Confirmed',
    MID_FWD: 'Vendor/Midland Covers/PO/Forwarded',
    MID_CNF: 'Vendor/Midland Covers/PO/Confirmed',
    EX_OOR: 'Vendor/Extruflex/OOR',
    CUSTOMER: 'Customer',
    NEEDS_TRACKING: 'Customer/Needs/Tracking',
    RESOLVED: 'System/resolved',
    TWO_FA: 'System/ZZZ ~~~ 2FA ~~~ ZZZ',
    TRACKING_VENDOR: 'Vendor/Extruflex/Tracking'
  },
  ADDRESSES: {
    ME: 'order-management@strip-curtains.com',
    OOR_FROM: 'm.santos@extruflex.com',
    MIDLAND_DOMAIN: '@midlandcovers.com',
    VENDOR_DOMAIN: '@extruflex.com'
    
  },
  SHEETS: {
    MAIN_ID: '1hGjEM_A11HL6FHI5OkGEnh4Rmk9x7GhGRnuKt_DVrrM',
    TRACKING_ID: '1hGjEM_A11HL6FHI5OkGEnh4Rmk9x7GhGRnuKt_DVrrM',
    MIDLAND_TAB: 'Midland Covers',
    MAIN_TAB: 'Extruflex'
  },
  OCR: {
    LANG: 'en',
    MAX_RETRIES: 3,
    COOLDOWN_MS: 1000,
    CACHE: true
  }
};
const VENDOR_SENDER_RE = /@extruflex(?:na|usa)?\.com$/i;
/** ---------------------------------
 *  LOGGING
 * ----------------------------------*/
const Log = {
  ts() { return new Date().toISOString(); },
  info(msg, ...a) { Logger.log(`[INFO  ${this.ts()}] ${msg}`, ...a); },
  warn(msg, ...a) { Logger.log(`[WARN  ${this.ts()}] ${msg}`, ...a); },
  err (msg, ...a) { Logger.log(`[ERROR ${this.ts()}] ${msg}`, ...a); }
};


// Per-form-row configuration
const ROW_CONFIGS = {
  2: { key: 'r2', receiver: "'+3 Peter" },
  3: { key: 'r3', receiver: "'+6 Daniel" },
  4: { key: 'r4', receiver: "'+8 Jack" }
};


const SPREADSHEET_ID = '1hGjEM_A11HL6FHI5OkGEnh4Rmk9x7GhGRnuKt_DVrrM';
const SOURCE_SHEET   = 'Call Interface';
const TARGET_SHEET   = 'Call Log';
const TRIGGER_COL = 11;      // K
const TRIGGER_MIN_ROW = 2;
const TRIGGER_MAX_ROW = 4;
const SRC_START_COL = 2;     // B
const SRC_WIDTH = 10;        // B..K
// Accept only strictly numeric invoice IDs (no letters/symbols), with a sane length gate.
const MIN_INVOICE_DIGITS = 5;  // adjust if needed
const MAX_INVOICE_DIGITS = 20;
const SUPPRESS_PROP = 'SUPPRESS_HANDLEEDIT_CLEAR';
const DEFERRED_PUSH_HANDLER = 'deferredPush_';
const PUSH_TRIGGER_FLAG = 'PUSH_TRIGGER_ACTIVE';

/***** FAST PATH FLAGS *****/
const APPEND_AT_TOP = false;   // true = insert a new row 2; false = append at bottom
const LOCK_MS       = 700;     // how long we try to take the document lock

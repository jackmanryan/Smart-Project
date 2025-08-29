function resolveTimestamp_(aVal, bVal) {
  // Full Date object in B
  if (bVal instanceof Date && !isNaN(bVal)) {
    // If A is a date-only and B is time-only, combine; else B already has full datetime.
    if (aVal instanceof Date && !isNaN(aVal)) {
      const timeOnly = isDateAtMidnightWithTime(bVal) ? bVal : bVal;
      // Heuristic: if B has a non-midnight time but also a valid date, just return B.
      // (Sheets stores times with date 1899-12-30 sometimes; combine if year < 1905)
      if (bVal.getFullYear() < 1905) return combineDateAndTime_(aVal, bVal);
    }
    return new Date(bVal);
  }

  // Numeric serial (0..1 = fraction of a day)
  if (typeof bVal === 'number' && isFinite(bVal)) {
    if (aVal instanceof Date && !isNaN(aVal)) {
      const base = new Date(aVal);
      base.setHours(0, 0, 0, 0);
      const ms = Math.round(bVal * 24 * 60 * 60 * 1000);
      return new Date(base.getTime() + ms);
    }
    return null;
  }

  // Time string
  if (typeof bVal === 'string' && bVal.trim()) {
    const t = parseTimeString_(bVal.trim());
    if (!t) return null;
    if (aVal instanceof Date && !isNaN(aVal)) {
      const d = new Date(aVal);
      d.setHours(t.h, t.m, t.s || 0, 0);
      return d;
    }
    return null;
  }

  return null;
}

function combineDateAndTime_(dateOnly, timeOnly) {
  const d = new Date(dateOnly);
  d.setHours(timeOnly.getHours(), timeOnly.getMinutes(), timeOnly.getSeconds(), timeOnly.getMilliseconds());
  return d;
}

function parseTimeString_(s) {
  const m = s.match(/^\s*(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*([APap][Mm])?\s*$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const sec = m[3] ? parseInt(m[3], 10) : 0;
  const mer = m[4];
  if (mer) {
    const isPM = mer.toUpperCase() === 'PM';
    if (h === 12) h = isPM ? 12 : 0;
    else if (isPM) h += 12;
  }
  if (h < 0 || h > 23 || min < 0 || min > 59 || sec < 0 || sec > 59) return null;
  return { h, m: min, s: sec };
}

function isDateAtMidnightWithTime(d) {
  return d instanceof Date && !isNaN(d) && d.getHours() + d.getMinutes() + d.getSeconds() + d.getMilliseconds() > 0;
}

function isDigitsOnly_(val) {
  const s = String(val ?? '').trim();
  return s.length > 0 && /^\d+$/.test(s);
}

function normalizePhone_(v) {
  const d = String(v || '').replace(/[^\d]/g, '');
  // Strip leading 1 for NANP-style 11-digit numbers
  return (d.length === 11 && d.startsWith('1')) ? d.slice(1) : d;
}

function normalizePhone10_(v) {
  const d = String(v==null?'':v).replace(/\D+/g,'');
  if (d.length === 11 && d.startsWith('1')) return d.slice(1);
  if (d.length === 10) return d;
  return ''; // invalid; skip
}

function canonLocal_(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function parseDateTime_(dateVal, timeVal) {
  // Handle actual Date objects
  if (dateVal instanceof Date) {
    const d = new Date(dateVal.getTime());
    if (timeVal instanceof Date) {
      d.setHours(timeVal.getHours(), timeVal.getMinutes(), timeVal.getSeconds(), 0);
    } else if (typeof timeVal === 'number') {
      // Time as Excel fraction (rare in Sheets)
      const ms = Math.round(24*60*60*1000 * timeVal);
      d.setHours(0,0,0,0);
      d.setTime(d.getTime() + ms);
    } else if (typeof timeVal === 'string' && timeVal) {
      const t = timeVal.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
      if (t) d.setHours(+t[1], +t[2], +(t[3]||0), 0);
    }
    return d;
  }

  // String date parsing: try DD/MM/YYYY then MM/DD/YYYY
  const s = safeStr_(dateVal);
  if (!s) return null;
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (!m) return null;

  let dd = +m[1], mm = +m[2], yy = +m[3];
  if (mm > 12 && dd <= 12) { // if swapped
    [dd, mm] = [mm, dd];
  }
  const d = new Date(yy, mm-1, dd);
  if (timeVal) {
    if (timeVal instanceof Date) d.setHours(timeVal.getHours(), timeVal.getMinutes(), timeVal.getSeconds(), 0);
    else if (typeof timeVal === 'string') {
      const t = timeVal.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
      if (t) d.setHours(+t[1], +t[2], +(t[3]||0), 0);
    }
  }
  return d;
}

function toDateOnly_(d) {
  if (!d) return '';
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays_(d, n) {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
}


function safeStr_(v){ return (v==null) ? '' : String(v).trim(); }

function isValidEmail_(val) {
  if (!val) return false;
  const s = String(val).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
function pickRandom_(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function _isTruthyBoolean(v) {
  if (v === true) return true;
  if (typeof v === 'string') return v.trim().toLowerCase() === 'true';
  if (typeof v === 'number') return v === 1;
  return false;
}
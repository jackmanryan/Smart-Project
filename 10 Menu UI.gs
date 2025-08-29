function onEdit(e) {
  try {
    if (!e) return;
    const sh = e.range.getSheet();
    if (sh.getName() !== CI_SHEET) return;

    const row = e.range.getRow();
    const col = e.range.getColumn();
    if (!(row in ROW_CONFIGS)) return; // only rows 2,3,4
    if (col < CI_COL_START || col > CI_COL_END) return; // only B:K

    processInterfaceRow_(row, ROW_CONFIGS[row].receiver, ROW_CONFIGS[row].key);
  } catch (err) {
    console.error('[onEdit] ' + err);
  }
}

// Optional manual runners (independent functions)
function runRow2() { processInterfaceRow_(2, ROW_CONFIGS[2].receiver, ROW_CONFIGS[2].key); }
function runRow3() { processInterfaceRow_(3, ROW_CONFIGS[3].receiver, ROW_CONFIGS[3].key); }
function runRow4() { processInterfaceRow_(4, ROW_CONFIGS[4].receiver, ROW_CONFIGS[4].key); }

function processInterfaceRow_(ciRow, receiverText, key) {
  const ss = SpreadsheetApp.getActive();
  const ci = ss.getSheetByName(CI_SHEET);
  const cl = ss.getSheetByName(CL_SHEET);
  if (!ci || !cl) throw new Error('Required sheets not found.');

  // Read B:K of the specified CI row
  const srcVals = ci.getRange(ciRow, CI_COL_START, 1, CI_COL_END - CI_COL_START + 1).getValues()[0];
  // Indices within srcVals (0-based from B..K)
  const vB = srcVals[0];  // Phone
  autoFillCIFromPhone_(ci, ciRow, vB);
  const vC = srcVals[1];  // Name
  const vD = srcVals[2];  // Invoice/ID (may be non-numeric)
  autoFillCIFromInvoice_(ci, ciRow, vD);
  const vE = srcVals[3];  // Subject
  const vF = srcVals[4];  // Email
  const vG = srcVals[5];  // Message
  const vH = srcVals[6];  // Provided Info
  const vI = srcVals[7];  // To Transfer
  const vJ = srcVals[8];  // Follow-up offset (days)
  const vK = srcVals[9];  // Status
  const finalizing = (vK !== '' && vK !== null);
  const isDelete = finalizing && String(vK).trim().toUpperCase() === 'DELETE';

  const anyTyped = srcVals.some(v => v !== '' && v !== null);
  if (!anyTyped && !vK) return; // nothing to do

  const draftRow = getOrCreateDraftRow_(cl, key);
  // Read current A..Q to preserve untouched columns
  const rowRange = cl.getRange(draftRow, 1, 1, CL_WRITE_WIDTH);
  const dest = rowRange.getValues()[0];

  // Helpers
  const setIfProvided = (colIndex0, val) => {
    if (val !== '' && val !== null) dest[colIndex0] = val;
  };
  const literalize_ = (val) => {
    if (val === '' || val === null || val === undefined) return val;
    const s = String(val);
    const first = s.charAt(0);
    if (first === '+' || first === '-' || first === '=') return "'" + s;
    return s;
  };

  // Map source → destination (0-based indices in dest for A..Q)
  // A,B set on creation only (handled in getOrCreateDraftRow_)
  setIfProvided(2, vB); // C (2) ← Phone
  setIfProvided(4, vC); // E (4) ← Name

  // F (5) ← Invoice/ID, but ONLY if digits-only
  if (vD !== '' && vD !== null && isDigitsOnly_(vD)) {
    dest[5] = String(vD).trim();
  }

  setIfProvided(6, vF);  // G (6) ← Email
  setIfProvided(8, vK);  // I (8) ← Status
  setIfProvided(9, vE);  // J (9) ← Subject
  setIfProvided(11, vG); // L (11) ← Message
  setIfProvided(12, vH); // M (12) ← Provided Info

  // N (13) ← TODAY + (J days)
  if (vJ !== '' && vJ !== null && !isNaN(Number(vJ))) {
    const days = Number(vJ);
    const today = new Date();
    const followDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
    dest[13] = followDate;
  }

  // P (15) := hardcoded receiver (keep leading + as text)
  dest[15] = receiverText;
  // Q (16) ← To Transfer (coerce to literal if starts with + / - / =)
  setIfProvided(16, literalize_(vI));

  // --- Finalization behavior ---
  if (finalizing) {
    if (isDelete) {
      // DELETE: remove the row from Call Log (no write-back), then clear form + pointer
      cl.deleteRow(draftRow);
      ci.getRange(ciRow, CI_COL_START, 1, CI_COL_END - CI_COL_START + 1).clearContent();
      clearDraft_(key);
      return; // exit early; row is gone
    } else {
      // If Invoice/ID is non-numeric, append it to Message (L) instead, and ensure F is clean.
      const hasInvoice = vD !== '' && vD !== null;
      if (hasInvoice && !isDigitsOnly_(vD)) {
        const invAppend = literalize_(String(vD).trim());
        const prevMsg = String(dest[11] ?? '');
        dest[11] = prevMsg ? (prevMsg + '\n' + invAppend) : invAppend;

        // If F currently contains a non-numeric token (from older drafts), clear it.
        if (dest[5] && !isDigitsOnly_(dest[5])) dest[5] = '';
      }
    }
  }

  // Write back AFTER any finalize-time mutations (unless we deleted the row)
  rowRange.setValues([dest]);

  // If Status is set, finalize: clear the form row and clear this row's draft pointer
  if (finalizing) {
    ci.getRange(ciRow, CI_COL_START, 1, CI_COL_END - CI_COL_START + 1).clearContent();
    clearDraft_(key);
  }
}

function getOrCreateDraftRow_(cl, key) {
  const props = PropertiesService.getDocumentProperties();
  const K_ROW = `CL_DRAFT_ROW_${key}`;
  const K_MS  = `CL_DRAFT_MS_${key}`;

  let draftRow = parseInt(props.getProperty(K_ROW) || '', 10);
  const ms = Number(props.getProperty(K_MS) || '');

  // Validate stored row by timestamp in A
  if (draftRow && ms) {
    const aVal = cl.getRange(draftRow, 1).getValue(); // A
    if (aVal instanceof Date && aVal.getTime() === ms) return draftRow;

    // Try to relocate by ms in column A
    const last = cl.getLastRow();
    if (last >= 2) {
      const aCol = cl.getRange(2, 1, last - 1, 1).getValues();
      for (let i = 0; i < aCol.length; i++) {
        const d = aCol[i][0];
        if (d instanceof Date && d.getTime() === ms) {
          draftRow = i + 2;
          props.setProperty(K_ROW, String(draftRow));
          return draftRow;
        }
      }
    }
  }

  // Create a new draft row
  const newRow = Math.max(cl.getLastRow() + 1, 2);
  const now = new Date();
  // A (Date) and B (Time) both set to now; format in-sheet as desired
  cl.getRange(newRow, 1, 1, 2).setValues([[now, now]]);
  props.setProperty(K_ROW, String(newRow));
  props.setProperty(K_MS, String(now.getTime()));
  return newRow;
}

function clearDraft_(key) {
  const props = PropertiesService.getDocumentProperties();
  props.deleteProperty(`CL_DRAFT_ROW_${key}`);
  props.deleteProperty(`CL_DRAFT_MS_${key}`);
}
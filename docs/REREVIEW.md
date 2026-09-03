# Rereview workflow

The shipping rereview batch, and which parts of it this repo now does.

Compiled 2026-09-02 from the 08-31 batch run log, the `sc-autoreview` userscript (v0.1.4)
and the rules confirmed during that batch.

---

## The process

### A. Batch start

1. Open the shipping rereview email listing Sage invoice numbers.
2. Resolve each invoice to its order page. The Sage invoice number has no relation to the
   extranet `view=` id, so it routes through autosearch:
   `?p=search#autosearch=1&q=<INVOICE>&extra=---`, which lands on
   `?p=orders-review&review=<view id>`.

**Now:** paste the numbers into the rereview queue. It holds the work list, routes each
invoice, and records `invoice → view id` from `#sage_sales_number` the first time a review
page is opened, so the second visit skips the search entirely.

### B. Per order

| Step | Rule | Where it lives now |
|---|---|---|
| Read the order Comments first | Real instructions live there. An address correction means changing the shipping fields *and* appending the text to the ExtruFlex vendor comments. | Comments are pinned beside the shipping address with an acknowledge flag |
| Check prior state | Already reviewed with a PO sent and part still unreviewed: do not redo it. Message Peter, subject "-2 Rereview", list SKU/qty/length, mark the invoice "-2 created" | Manual. Mark the row `skipped` with a note |
| Check shipping country | Non-US stops the run | Manual |
| PO# | Takes the source Order # (2977CDS style), filled only when empty. A customer PO already there stays | Filled automatically, blanks only |
| Shipping email | Copy from billing when blank | Filled automatically, blanks only |
| Shipment type | `$0.00` → Best Way (the UPS Standard default); `$0.01–$100` keeps the default; over `$100` keeps the customer's exact selected method | Shown with its reason, applied by a click — it would otherwise overwrite a customer choice |
| Do not create boxes | Checked | Checked automatically |
| Sourcing | Set For All → ExtruFlex, then flip the Richmond rows. PVC and Polymer Quick Snap → ExtruFlex; other hardware → Richmond; GALV in whole feet → ExtruFlex; partial footage GALV → Richmond | The rule decides every row and shows why; the reviewer flips exceptions |
| Verify each flip | `updateInventorySource` is async and a flip can silently fail | The flip is watched until the PO table agrees. Until it does the row reads *pending* and **Save is blocked** |
| Price check | Every ExtruFlex line against the ExtruFlex 2026 list (effective 2026-04-13). Cut strips take the per-foot price, a full roll takes the roll row. When SKU and description disagree, the SKU wins. Cutting charges are left alone. A MISCSERVICE line with a negative price is a discount and is ignored; a positive price stops the run with "extra notes on po needed" | Checked against `orders/lib/extruflex.js`, with the effective date shown and the vendor part name resolved |
| No list price for a PVC line | Skip the order, list it as "Canada order (no ExtruFlex list price)" | Flagged, never guessed |
| Unit price edits | Need a real key event (triple click, type, Tab) or the total does not recalculate | Writes dispatch `input` and `change` |
| Vendor comments | Short bullets matching the pre-generated styling, stale text replaced rather than the box wiped, submitted before Generate PDF. Customer UPS account orders already carry the extranet's own `*** SHIP ON CUSTOMER UPS ACCOUNT ****` line — add nothing | Automation only (`comment=` / `cut=`) |
| PDF | Delete any existing ExtruFlex PDF (Delete, never Cancel), then Generate PDF, then confirm "PDF generated for ExtruFlex" | Automation only |
| Save | Save Changes → "Continue Reviewing" banner → Yes (sometimes several clicks) → reloads with `popup=0` and shows "Order reviewed" | Automation only |
| Send PO | Send PO to ExtruFlex, confirm "PO sent to ExtruFlex". **No PO goes to Richmond** — saving a line as Richmond routes it to production | Automation only. Once sent, Send PO stops being offered |
| PO already sent and an issue turns up | No delete, no regenerate, no resend. Write a one-line note for the vendor email chain | Manual, by design |
| Log the result | invoice, view id, result, notes | The queue records it |

### C. Batch end

Draft a reply on the Rereviews thread listing every invoice with a terse inline note.
**Draft only, never sent.**

**Now:** "Copy summary" builds that text from the queue, including the warnings review
assist raised. It copies to the clipboard and sends nothing.

---

## What is automated, and what is not

`automation/auto-review` clicks the buttons a reviewer would click, including Send PO. It
only runs behind its `#autoreview=1` hash — that gate is the whole safety story and is not
widened by anything here.

`orders/review-assist` runs on every review screen with no hash. It advises, and the only
form writes it makes are into **empty** fields. Set
`sc.tools.orders.review-assist.autofill` to `"false"` to make it purely advisory.

`automation/rereview-queue` navigates and records. It never fills a field or clicks a
button on the review form.

## Two things a human still has to decide

**Non-US shipping stops the run.** Nothing here checks the country, because the right
response is judgement, not a rule.

**A PO that has already been sent is never touched again.** No delete, no regenerate, no
resend — the fix goes in the vendor email chain.

---

## The price list is incomplete

`orders/lib/extruflex.js` holds only the rows confirmed during the 08-31 batch: four
prices and four SKU aliases. **An unknown SKU returns null and every caller treats that as
stop-and-ask, never as approval.** Filling the list out from the published document is the
single biggest remaining win — it was the manual step on nearly every order in that batch.

Add rows there, keep `EFFECTIVE_DATE` accurate (the review screen prints it, and a stale
date is worse than none), and `npm test` will keep the rules honest.

## What the extranet itself could still change

These need the extranet application, not a userscript, and would retire code here:

- **Hold vendor prices against the published list**, with the effective date on the review
  screen, and block Generate PDF on a `0.00` line. That deletes the price table from this
  repo.
- **Apply the sourcing rule server-side on load**, leaving the reviewer to override
  exceptions. That deletes `sourcing.js`.
- **Make the source flip synchronous**, or refuse Save while a line is pending. That
  deletes the flip-watching here, which is a workaround for a fire-and-forget `$.ajax`.
- **Show the Sage invoice number as a searchable field.** That ends the autosearch route.
- **Confirm Save once.** The banner reappearing and needing up to five Yes clicks costs
  time and invites double submits.

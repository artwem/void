# Income tag write-off order + delete reassignment

Date: 2026-08-11
Status: approved for planning

## Problem

Income tags (`DB.incomeTags`) already have basic CRUD in Settings → «Теги доходов» (add / rename / recolor / delete). Two gaps:

1. **Delete is destructive-only.** `deleteIncomeTag(i)` strips the tag from every affected income (sets `tag: ''`) after a plain `confirm()`. No way to merge into another tag or redirect to a newly created one.
2. **«Из чего накоплено» has no user control over write-off order.** `_savingsBreakdownHtml` (stats.js section) computes which income sources (by tag) count as "saved" vs "spent" by sorting sources by total size descending and having expenses absorb the largest sources first, with `'Без тега'` hardcoded to always absorb first regardless of size. Users can't express "spend from salary first, keep interest income as savings longest" or similar priority — the order is derived from month-to-month totals, not a stable rule.

## Goals

- Deleting a tag lets the user choose: reassign affected incomes to an existing tag, create a new tag and reassign to it, or leave them untagged (current behavior, now explicit instead of implicit).
- A user-editable, drag-reorderable priority list determines write-off order for `_savingsBreakdownHtml`, replacing the size-based sort. Top → bottom = order in which income sources are considered "spent first".
- `'Без тега'` participates in this order like any other entry (previously hardcoded first).
- No change to tag colors, income-add tag chips, or the income-by-tag chart — those keep using `DB.incomeTags`' own array order, untouched by this feature.

## Non-goals

- No change to how tag colors are assigned/stored (still index-keyed into `DB.incomeTags`).
- No change to expense categories or their own settings (separate list, not in scope).
- No change to the consumption *math* in `_savingsBreakdownHtml` (largest-absorbs-first-remaining logic stays) — only which sequence of sources it walks.

## Data model

New field:

```js
DB.incomeTagOrder  // string[] — tag names, plus '' as the sentinel for "Без тега"
                    // top-to-bottom = write-off priority (spent first → last)
```

Independent of `DB.incomeTags` (which stays the CRUD/color/chip source of truth, unreordered by this feature).

**Reconciliation at read time**, not eager maintenance everywhere: a helper

```js
function _incomeTagWriteoffOrder(){
  const known = ['', ...(DB.incomeTags||[])];
  const stored = (DB.incomeTagOrder||[]).filter(t => known.includes(t));
  const seen = new Set(stored);
  const missing = known.filter(t => !seen.has(t));
  return [...stored, ...missing];   // dedup implicit: `known` has no dupes, stored already filtered to known
}
```

reads `DB.incomeTagOrder`, drops any entry whose tag no longer exists (renamed away / deleted without a patched slot), and appends any known tag or `''` missing from it (newly added tag, first-run with no stored order, or an order array that lagged behind a sync merge). This makes the feature self-healing against drift from rename/delete/sync — those mutation sites get a best-effort patch (below) for a stable UX, but correctness never depends on it.

**Sync:** treated like `banks`/`creditBanks` — LWW via `listsMeta.incomeTagOrder`, `touchList('incomeTagOrder')` on every reorder/tag-mutation that touches it, merged with the existing generic `_mergeList(d, 'incomeTagOrder', null)` (no color key). `buildPayload` needs no change — it's a full-DB spread minus an explicit strip list, so the new field is included automatically.

**Migration:** absent field → `_incomeTagWriteoffOrder()`'s fallback path (`stored = []`, everything falls into `missing`) naturally seeds `['', ...DB.incomeTags]` — same first-run order `_savingsBreakdownHtml` effectively used before (Без тега first, then declaration order), until the user drags to customize.

## UI

### «Теги доходов» modal (`modal-income-tags`) — new section below the existing tag list

```
Теги доходов
┌─────────────────────────────┐
│ Оплата труда   [цвет] ✎ ✕   │  ← existing CRUD list, unchanged
│ Продажи        [цвет] ✎ ✕   │
│ Проценты       [цвет] ✎ ✕   │
│ + Добавить тег               │
├─────────────────────────────┤
│ Порядок списания        ⓘ    │  ← new section
│ ⠿ Без тега                   │
│ ⠿ Проценты                   │
│ ⠿ Оплата труда                │
│ ⠿ Продажи                     │
└─────────────────────────────┘
```

- Rows: drag handle `⠿`, colored dot (tag's `getIncomeTagColor`; grey for «Без тега»), name. No inline edit/delete — those stay in the CRUD list above; this section only reorders.
- `ⓘ` → `toast('Расходы списываются с доходов сверху вниз — так считается «Из чего накоплено»', ...)` or equivalent short explainer (info-tone toast, not a full modal).
- Rendered from `_incomeTagWriteoffOrder()` every time the modal (re)opens or a reorder/CRUD change happens, so it always reflects current reality even if `DB.incomeTagOrder` was stale.

### Reordering — Pointer Events, not HTML5 Drag-and-Drop

HTML5 DnD (`draggable="true"`) is unreliable for touch on iOS Safari (primary target platform per CLAUDE.md). Implement with `pointerdown`/`pointermove`/`pointerup` on the handle:

- `pointerdown` on `⠿`: capture pointer (`setPointerCapture`), mark row as dragging (visual lift — slight scale/shadow, matches existing swipe-row transition style).
- `pointermove`: track vertical position; when it crosses the midpoint of a neighboring row, swap the two in the in-memory order array and re-render row positions (index swap, not full modal re-render, to keep the drag smooth).
- `pointerup`: release capture, persist final order to `DB.incomeTagOrder`, `touchList('incomeTagOrder')`, `saveDB()`.

New tag (via «+ Добавить тег») → appended to the end of `DB.incomeTagOrder` at creation time (lowest priority / spent last by default) in addition to `DB.incomeTags`.

### Delete-with-reassignment modal

`deleteIncomeTag(i)` behavior:
- **0 affected incomes** → delete immediately, no dialog (unchanged from today).
- **>0 affected incomes** → open new modal `modal-delete-income-tag` instead of `confirm()`:

```
Удалить тег «Проценты» — 12 доход(ов)
( ) Перенести на другой тег: [select: other existing tags ▾]
( ) Создать новый тег: [text input]
(•) Оставить без тега                    ← default selection
[Отмена]                    [Удалить]
```

On confirm, dispatch by selected radio:
- **Перенести на другой тег**: validate a tag is selected; retag affected incomes (`inc.tag = destTag`, stamp `updatedAt`).
- **Создать новый тег**: validate non-empty name, not already in `DB.incomeTags`; push to `DB.incomeTags` (color auto-derives from new index, same as `addIncomeTag` today — no explicit assignment needed); retag affected incomes to the new name, stamp `updatedAt`.
- **Оставить без тега**: `inc.tag = ''` for affected incomes, stamp `updatedAt` (today's behavior, now explicit instead of the implicit post-confirm strip).

Then, for all three branches: remove the deleted tag from `DB.incomeTags` + existing color-index remap logic (unchanged), and patch `DB.incomeTagOrder`:
- Reassign/create branches: replace the deleted tag's slot in-place with the destination name — *unless* the destination already has its own slot in the order (e.g., reassigning into an existing tag that's already listed elsewhere), in which case just drop the deleted tag's slot (no duplicate entries).
- Leave-untagged branch: drop the deleted tag's slot (`''` already has its own slot elsewhere in the order).

`touchList('incomeTagOrder')` alongside the existing `touchList('incomeTags')` whenever the order array is mutated this way.

## `_savingsBreakdownHtml` change

Replace:
```js
savSources.sort((a,b)=>{
  if(a.name==='Без тега') return -1;
  if(b.name==='Без тега') return 1;
  return b.total-a.total;
});
```
with iteration order from `_incomeTagWriteoffOrder()` — build `savSources` in that order directly (map order → `{name, color, total}`, skip zero-total entries) instead of building unordered-then-sorting. The rest of the function (largest-source-absorbs-first-of-*this*-order consumption loop, stacked bar, rows) is unchanged — it already just walks `savSources` in whatever order it's given.

## Out of scope / deferred

- No bulk "reorder to match current totals" convenience button — pure manual drag for v1.
- No per-period override of the order (global setting only, same as tag colors).
- Excel export / annual report already call `_savingsBreakdownHtml` and inherit the new order for free — no separate changes needed there.

## Version

v1.46.0 (new feature). Bump `index.html` About block + `sw.js` `const V` per deploy checklist.

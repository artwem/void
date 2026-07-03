# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**V.O.I.D. — Visual Overview of Income & Debt** is a Russian-language personal finance PWA (Progressive Web App) built with vanilla JavaScript, no frameworks, no build tools. UI labels and data are in Russian/Cyrillic.

## Development

**No build step required for development.** Serve the root directory:
```bash
python3 -m http.server 8080
# Open http://localhost:8080
```

**Production build** (bundles everything into `dist/index.html`):
```bash
./build.sh
```

**No test suite, no linter.** Manual browser testing is the workflow. Test on Safari (iOS), Chrome (Android), and desktop.

**Deployment**: Push to `main` for GitHub Pages. Or run `./build.sh` and drop `dist/` on Netlify.

## Critical: Two-File Reality

**`index.html` is the authoritative source for dev mode.** The `js/*.js` files are only used by `build.sh` to bundle a production `dist/index.html`. Changes to `js/*.js` have **zero effect** during development — all logic must be edited directly inside `index.html`.

Each JS module is inlined in `index.html` with a section marker comment:
```
// ═══ db.js ═══
// ═══ nav.js ═══
// ═══ budget.js ═══
// ═══ day.js ═══
// ═══ income.js ═══
// ═══ assets.js ═══
// ═══ stats.js ═══
// ═══ calc.js ═══
// ═══ settings.js ═══
// ═══ sync.js ═══
// ═══ init.js ═══
```

Similarly, `nav.html`, `pages.html`, and `modals.html` are partial HTML fragments — they're only used by `build.sh`. The nav/pages/modals content must be edited directly in `index.html`.

## Architecture

### Data Layer — `js/db.js` (inlined in `index.html`)

Single global `DB` object persisted to `localStorage` under `budgetDB_v2`. Every module reads from and writes to `DB`, then calls `saveDB()`. Schema:

```javascript
{
  categories:      ['ЖКУ + аренда', ...],    // ordered list
  catIds:          ['k3x9a1b2', ...],         // stable id per category, same position as categories[]
  catColors:       {0: '#185fa5', ...},       // category index → hex color
  expenses:        [{id, date, cat, catId, amount, comment, _deleted?}, ...],  // catId authoritative; cat = derived index
  incomes:         [{id, date, source, amount, tag?}, ...],  // tag = name string from incomeTags[]
  assets:          [{id, date, bankName, bank, amount, _deleted?}, ...],
  banks:           ['Сбербанк', ...],         // debit bank names
  creditBanks:     [...],                     // credit bank names (subtracted from net worth)
  limits:          {'2026-04': [15000, ...]}, // per-category monthly limits, keyed by monthKey()
  syncUrl:         'https://script.google.com/...',
  goals:           [{id, name, target, saved, deadline, color}, ...],
  templates:       [{id, name, cat, amount, comment, color}, ...],  // cat = category index
  deposits:        [{id, name, amount, rate, openDate, endDate, capitalization, _deleted?}, ...],  // вклады; capitalization: 'monthly'|'end'
  incomeTags:      ['Оплата труда', ...],     // income source tag names
  incomeTagColors: {0: '#185fa5', ...},       // tag index → hex color
  listsMeta:       {categories: 1234567890},  // list name → updatedAt ms; LWW-merge for categories/banks/creditBanks/incomeTags (call touchList(name) on every list mutation)
  notifsEnabled:   false,
  notifThreshold:  90,                        // % of limit that triggers push notification
  _lastSyncedLimits: {},                      // snapshot of limits at last successful sync — 3-way merge baseline (device-local, stripped from payload)
  _dirty:          true/false
}
```

`getLimits(y, m)` — returns limits for a month, falling back to most recent prior month's limits (not defaults).

**Stable category ids (since v1.18.0):** `DB.catIds[i]` is a permanent id for `DB.categories[i]`. Records (`expenses`, `templates`) carry `catId` (authoritative, survives category deletion/reorder and sync) plus `cat` (derived positional index used by all render/aggregation code). `_ensureCatIds()` migrates old data (assigns ids, backfills `catId` from `cat`) and runs in `loadDB()`, after `mergePullData()`, in restore and test-data fill. `_reindexCats()` recomputes every record's `cat` from its `catId`; orphaned `catId` (category deleted) falls back to category 0. Any code creating/editing an expense or template MUST set `catId: DB.catIds[cat]`. `catIds` syncs and follows `categories` in the list LWW merge.

### Tab Modules

Each tab has a `render*()` function called after any data change:

| Tab | Section marker | Responsibility |
|-----|----------------|----------------|
| (nav) | `═══ nav.js ═══` | Tab switching, month/day navigation, sync widget header |
| Budget | `═══ budget.js ═══` | Categories grouped by color, limits, progress bars |
| Day | `═══ day.js ═══` | Daily expense list |
| Income | `═══ income.js ═══` | Income sources, monthly balance |
| Аналитика | `═══ stats.js ═══` | Chart.js graphs (6-month trends, category breakdown, income by tag) |
| Assets | `═══ assets.js ═══` | Bank accounts, credit cards, savings chart, goals, deposits (вклады) |
| Forecast | `═══ calc.js ═══` | Compound interest / savings forecast calculator |

Forecast (`page-calc`) and Deposits (`page-deposits`) have no navbar tab — both open via buttons on the Assets page (`showPage('calc')` / `showPage('deposits')`) and highlight the Assets nav button. Deposits code (renderDeposits, depositValueAt, avgMonthlySavings — average of last 6 *closed* months, current month excluded) lives in the `═══ assets.js ═══` section. Assets page shows an informational «с вкладами: N₽» line under the total (banks + `depositValueAt(d, today())` of live deposits). Matured deposits (endDate passed) get a «↳ Перенести в банк» button → `openCloseDeposit(id)` / `confirmCloseDeposit()`: adds the deposit's current value to a chosen debit bank as a today-dated asset record (extends today's record or carries forward the last known amount) and soft-deletes the deposit.
| Settings | `═══ settings.js ═══` | Category/bank CRUD, sync, backup/restore (JSON + Excel), notifications |

### Sync — `js/sync.js` + `apps-script/Code.gs`

Optional 2-way sync via a deployed Google Apps Script URL stored in `DB.syncUrl`. Data is stored as `nto_data.json` on Google Drive (no spreadsheets).

**All sync entry points (startup, 15s interval, visibilitychange, manual pull/push buttons) go through a single `syncCycle()`** (in `═══ init.js ═══`): pull → merge → push-if-dirty, guarded by one shared in-flight promise. Never push before pulling — the merge protects local edits, while push-first would clobber other devices' unseen changes on Drive. `saveDB()` increments a `_dirtyGen` counter; `syncCycle` clears `DB._dirty` only if the counter is unchanged after the awaits (an edit made mid-sync stays dirty). The interval fires when `DB._dirty` **or** when the last pull is >5 min old (so idle devices still receive peers' edits). After 3 consecutive failures the sync widget shows a red «Ошибка» instead of the amber last-sync time (`_syncFailCount`).

**Optional shared secret (since v1.11.0):** `Code.gs` has a `SECRET` constant (empty = no auth, backward compatible). If set, the same string must be entered in the app's sync modal; it's stored device-locally as `DB.syncToken` (localStorage + sessionStorage + cookie, same pattern as `syncUrl`) and sent as `token` in every `syncRequest`.

**What syncs (both directions):** `expenses`, `incomes`, `assets`, `goals`, `templates`, `deposits`, `categories`, `catColors`, `banks`, `creditBanks`, `limits`, `incomeTags`, `incomeTagColors`.

**What syncs (also):** `listsMeta` — the LWW timestamps for the lists above.

**What does NOT sync:** `syncUrl`, `syncToken`, `notifsEnabled`, `notifThreshold`, `theme`, `privacyMode`, `_lastSyncedLimits` (device-local). `buildPayload()` strips exactly these seven fields plus `_dirty` before pushing.

**`syncUrl` multi-source loading:** iOS PWA has isolated localStorage from Safari. On load, `syncUrl` is read from `localStorage` → `sessionStorage` → cookie (in that priority). `saveSyncUrlEverywhere()` writes to all three to keep them in sync.

**Tombstones + `updatedAt` (since v1.8.0):** every create/edit/delete on `expenses`, `incomes`, `assets`, `goals`, `templates`, `deposits` stamps `updatedAt: Date.now()`. Deletes are **soft** — set `_deleted: true` (amount zeroed) instead of removing, so the deletion propagates on sync. All render/sum/export paths filter `!_deleted`. `loadDB()` purges tombstones older than 90 days. Tombstones are **no longer stripped before push** — they must reach Drive for other devices to learn of the delete.

**Merge logic (`mergePullData`):**
- `expenses`, `incomes`, `assets`, `goals`, `templates`, `deposits`: **last-write-wins by `id`** — for each id keep the record with the strictly greater `updatedAt`; ties keep local (pull precedes push). This propagates edits and deletes, not just inserts. Any code that mutates records in bulk (category-index remap, bank/tag rename) MUST stamp `updatedAt = Date.now()` on each mutated record, or the merge reverts them.
- `categories`/`catColors`, `banks`, `creditBanks`, `incomeTags`/`incomeTagColors`: **LWW by `listsMeta[name]`** (stamped via `touchList(name)` on every add/rename/delete/recolor). Fallback when neither side has a timestamp (pre-v1.17 clients): remote wins if longer.
- `limits`: **3-way merge** — remote wins per month-key only if the local value equals the `_lastSyncedLimits` baseline (i.e. unchanged locally since the last sync); locally-edited months keep the local value and get pushed. `syncCycle` refreshes the baseline after each successful cycle.

**Updating Apps Script:** edit `apps-script/Code.gs` locally → copy contents into the Google Apps Script editor → deploy new version. `build.sh` automatically inlines Code.gs into `dist/index.html`; in dev mode `loadAppsScriptCode()` fetches it from `./apps-script/Code.gs` directly.

**Code.gs v10.3:** writes are serialized with `LockService` (concurrent pushes from two devices queue instead of racing). The data file is located by ID stored in `ScriptProperties` (`dataFileId`), falling back to name lookup — `getFilesByName` alone could pick an arbitrary duplicate. **Wipe guard:** a push whose payload is <30% of the stored file size (and the file is >20 KB) is rejected unless `force:true` — the manual «Выгрузить в Drive» button sends `force`, auto-sync doesn't. **Daily backup:** before overwriting, at most once per 24h, the current file is copied to `nto_data.bak.json` (`bakFileId`/`lastBakTs` in ScriptProperties).

### Excel Export

Settings → "Экспорт Excel" calls `exportExcel()` (in `═══ settings.js ═══`). Uses **SheetJS 0.18.5** loaded from CDN (`xlsx.full.min.js`). Produces a `.xlsx` file with the same visible sheet structure as Google Sheets: По дням YYYY, Шаблон, month sheets, Активы. Hidden sheets (Доходы, Комментарии, etc.) are excluded. For a full data backup use "Резервная копия" (JSON dump of entire `DB`).

### PWA Caching — `sw.js`

Cache-first for assets, network-first for HTML. The `V` timestamp at the top of `sw.js` controls cache invalidation — **bump `V` on every deploy** to force iOS PWA cache refresh. Error responses (non-`ok`) are never cached.

**`css/app.css` is loaded directly** via `<link rel="stylesheet" href="css/app.css?v=X.Y.Z">` (~line 25 of `index.html`) — CSS edits go to `css/app.css` even in dev mode (unlike `js/*.js`). Because iOS caches it separately and sw activation lags, **every `css/app.css` change must bump the `?v=` query string on that link**, otherwise iOS PWAs keep serving the stale CSS.

### Key Globals

- `saveDB()` — persist to localStorage; sets `DB._dirty = true`
- `renderBudget()`, `renderDay()`, `renderAssets()`, `renderSettings()`, etc. — full tab re-render
- `getAllBanks()` — returns `[...DB.banks, ...DB.creditBanks]`; use instead of inline spread
- `isCredit(bankName)` — true if bank is in `DB.creditBanks`
- `fmt(n)` — format as `12 345₽`
- `fmtH(n)` — like `fmt(n)` but wraps in `<span class="prv">` for privacy-mode blurring; use for all monetary values in innerHTML
- `fmtShort(n)` — compact: `12к`, `1.2М`
- `esc(s)` — HTML-escape (always use for user-supplied strings in innerHTML)
- `today()` — `YYYY-MM-DD`
- `monthKey(y, m)` — `YYYY-MM` key used in `limits`
- `getCatColor(idx)` — hex color for category (from `DB.catColors` or `CAT_COLORS` palette)
- `getIncomeTagColor(tagName)` — hex color for income tag (from `DB.incomeTagColors` by index)
- `getCatSpent(idx, y, m)` — sum of non-deleted expenses for category in month
- `_getCurrentAssetsTotal()` / `renderAssets()` total — sum of **each bank's most recent non-deleted entry, regardless of date** (debit − credit; see "Assets Total" section below). To keep this fresh, asset entry uses a per-date snapshot (`openAssetSnapshot` → `openEditAssetDate(date, carryForward=true)`) that pre-fills all banks by **carrying forward** each bank's last known value (`_lastKnownAmount`), flagged "перенесено — проверьте". Editing a historical date from the history table passes `carryForward=false` (only that date's actual records).
- `_makeSwipeable(row, onDelete)` — swipe-left-to-delete on day expense rows; `deleteExpenseById(id)` soft-deletes
- `openModal(id)` / `closeModal(id)` — show/hide `.overlay` modals
- `toast(msg, type?)` — 2.2s bottom toast; `type`: `'ok'` (green), `'err'` (red), or omit for auto-detect from message text
- `uid()` — generates short alphanumeric ID; use for all new entity IDs
- `checkBudgetNotifications()` — call after saving an expense to fire push notifications
- `renderTemplateChips()` — re-renders quick-add template buttons on the Day tab header
- `CAT_COLORS` — 16-color palette for categories
- `GOAL_COLORS` — 7-color palette for goals
- `TEMPLATE_COLORS` — 28-color palette for expense templates (wider range than CAT_COLORS)
- `INCOME_TAG_COLORS` — 8-color palette for income tags
- `_chartColors()` — returns object of theme-aware Chart.js colors read from CSS vars at render time (`.green`, `.red`, `.blue`, `.blueFill`, `.muted`, `.gridLine`, `.mutedBar`, `.mutedDim`, `.mutedFill`, `.mutedMid`); call inside chart creation, not at module level

### UI State Patterns

Session-persisted UI state uses `sessionStorage`:
- `expViewMode` (`'cats'`|`'groups'`) — expense breakdown view in Аналитика; `setExpViewMode(m)` to change
- `statsPeriod` — number of months shown in Аналитика charts

Filter state (module-level variables, reset on tab re-render):
- `_expCatFilter` (`null` | `Set<number>`) — Day tab category multi-select; `null` = show today, Set = filter all DB newest-first
- `_incomeTagFilter` (`null` | `''` | `string`) — Income tab tag filter; `null` = current month, `''` = "без тега", string = specific tag

### Color Picker Pattern

Goals and templates share a single helper:
```javascript
renderColorPicker(elementId, palette, selectedColor, callbackName)
```
Each entity keeps its own `_selectedXxxColor` module-level variable and a thin `_renderXxxColorPicker()` wrapper that calls `renderColorPicker`. Replicate this pattern for any new color-selectable entity.

### Assets Total

`_getCurrentAssetsTotal()` sums each bank's **most recent non-deleted entry** regardless of date. Do not filter by a shared "latest date" — banks updated at different times are all included.

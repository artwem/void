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
  categories:    ['ЖКУ + аренда', ...],    // ordered list
  catColors:     {0: '#185fa5', ...},       // category index → hex color
  expenses:      [{id, date, cat, amount, comment, _deleted?}, ...],
  incomes:       [{id, date, source, amount}, ...],
  assets:        [{id, date, bankName, bank, amount, _deleted?}, ...],
  banks:         ['Сбербанк', ...],         // debit bank names
  creditBanks:   [...],                     // credit bank names (subtracted from net worth)
  limits:        {'2026-04': [15000, ...]}, // per-category monthly limits, keyed by monthKey()
  syncUrl:       'https://script.google.com/...',
  goals:         [{id, name, target, saved, deadline, color}, ...],
  templates:     [{id, name, cat, amount, comment, color}, ...],  // cat = category index
  notifsEnabled: false,
  notifThreshold: 90,                       // % of limit that triggers push notification
  catRenames:    [{from, to}, ...],          // queued for next push
  bankRenames:   [{from, to}, ...],          // queued for next push
  bankDeletions: ['BankName', ...],          // queued for next push
  _lastSyncedLimits: {},                    // baseline for 3-way merge conflict detection
  _dirty:        true/false
}
```

`getLimits(y, m)` — returns limits for a month, falling back to most recent prior month's limits (not defaults).

### Tab Modules

Each tab has a `render*()` function called after any data change:

| Tab | Section marker | Responsibility |
|-----|----------------|----------------|
| (nav) | `═══ nav.js ═══` | Tab switching, month/day navigation, sync widget header |
| Budget | `═══ budget.js ═══` | Categories grouped by color, limits, progress bars |
| Day | `═══ day.js ═══` | Daily expense list |
| Income | `═══ income.js ═══` | Income sources, monthly balance |
| Stats | `═══ stats.js ═══` | Chart.js graphs (6-month trends, category breakdown) |
| Assets | `═══ assets.js ═══` | Bank accounts, credit cards, savings chart, goals |
| Forecast | `═══ calc.js ═══` | Compound interest / savings forecast calculator |
| Settings | `═══ settings.js ═══` | Category/bank CRUD, sync, backup/restore (JSON + Excel), notifications |

### Sync — `js/sync.js` + `apps-script/Code.gs`

Optional 2-way sync via a deployed Google Apps Script URL stored in `DB.syncUrl`. Data is stored as `nto_data.json` on Google Drive (no spreadsheets). Auto-syncs every 15 seconds when `DB._dirty`. On startup: **pull first** to detect conflicts, then push local dirty state if needed. Uses `DB._lastSyncedLimits` as a baseline for 3-way merge conflict detection on limits — if both local and Drive diverged from the baseline, a conflict modal is shown.

**What syncs (both directions):** `expenses`, `assets`, `incomes`, `categories`, `catColors`, `banks`, `creditBanks`, `limits`.

**What does NOT sync:** `syncUrl`, `notifsEnabled`, `notifThreshold`, `goals`, `templates` (device-local).

**`syncUrl` multi-source loading:** iOS PWA has isolated localStorage from Safari. On load, `syncUrl` is read from `localStorage` → `sessionStorage` → cookie (in that priority). `saveSyncUrlEverywhere()` writes to all three to keep them in sync.

**Merge logic for expenses (`mergePullData`):**
- Entries with `gs_` prefix IDs are replaced by the Drive version
- App entries (`uid()` IDs) that match a Drive `cat+date` are dropped (Drive has the summed total)
- `_deleted` entries are cleaned up on merge
- Comments from app entries are preserved if Drive has none

**Merge logic for banks:** additive — new banks from Drive appended to local, except banks in `DB.bankDeletions` queue (intentionally removed locally).

**Rename/delete tracking:** `DB.catRenames`, `DB.bankRenames`, `DB.bankDeletions` queue structural changes to push to Drive on next sync.

**Updating Apps Script:** edit `apps-script/Code.gs` locally → copy contents into the Google Apps Script editor → deploy new version. `build.sh` automatically inlines Code.gs into `dist/index.html`; in dev mode `loadAppsScriptCode()` fetches it from `./apps-script/Code.gs` directly.

### Excel Export

Settings → "Экспорт Excel" calls `exportExcel()` (in `═══ settings.js ═══`). Uses **SheetJS 0.18.5** loaded from CDN (`xlsx.full.min.js`). Produces a `.xlsx` file with the same visible sheet structure as Google Sheets: По дням YYYY, Шаблон, month sheets, Активы. Hidden sheets (Доходы, Комментарии, etc.) are excluded. For a full data backup use "Резервная копия" (JSON dump of entire `DB`).

### PWA Caching — `sw.js`

Cache-first for assets, network-first for HTML. The `V` timestamp at the top of `sw.js` controls cache invalidation — **bump `V` on every deploy** to force iOS PWA cache refresh.

### Key Globals

- `saveDB()` — persist to localStorage; sets `DB._dirty = true`
- `renderBudget()`, `renderDay()`, `renderAssets()`, `renderSettings()`, etc. — full tab re-render
- `getAllBanks()` — returns `[...DB.banks, ...DB.creditBanks]`; use instead of inline spread
- `isCredit(bankName)` — true if bank is in `DB.creditBanks`
- `fmt(n)` — format as `12 345₽`
- `fmtShort(n)` — compact: `12к`, `1.2М`
- `esc(s)` — HTML-escape (always use for user-supplied strings in innerHTML)
- `today()` — `YYYY-MM-DD`
- `monthKey(y, m)` — `YYYY-MM` key used in `limits`
- `getCatColor(idx)` — hex color for category (from `DB.catColors` or `CAT_COLORS` palette)
- `getCatSpent(idx, y, m)` — sum of non-deleted expenses for category in month
- `_getCurrentAssetsTotal()` — sum of each bank's most recent non-deleted value (debit − credit)
- `openModal(id)` / `closeModal(id)` — show/hide `.overlay` modals
- `toast(msg)` — 2.2s bottom toast
- `uid()` — generates short alphanumeric ID; use for all new entity IDs
- `checkBudgetNotifications()` — call after saving an expense to fire push notifications
- `renderTemplateChips()` — re-renders quick-add template buttons on the Day tab header
- `CAT_COLORS` — 16-color palette for categories
- `GOAL_COLORS` — 7-color palette for goals
- `TEMPLATE_COLORS` — 28-color palette for expense templates (wider range than CAT_COLORS)

### Color Picker Pattern

Goals and templates share a single helper:
```javascript
renderColorPicker(elementId, palette, selectedColor, callbackName)
```
Each entity keeps its own `_selectedXxxColor` module-level variable and a thin `_renderXxxColorPicker()` wrapper that calls `renderColorPicker`. Replicate this pattern for any new color-selectable entity.

### Assets Total

`_getCurrentAssetsTotal()` sums each bank's **most recent non-deleted entry** regardless of date. Do not filter by a shared "latest date" — banks updated at different times are all included.

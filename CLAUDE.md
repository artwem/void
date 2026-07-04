# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**V.O.I.D. — Visual Overview of Income & Debt** is a Russian-language personal finance PWA (Progressive Web App) built with vanilla JavaScript, no frameworks, no build tools. UI labels and data are in Russian/Cyrillic. Live at `https://artwem.github.io/void/`.

## Development

**No build step required for development.** Serve the root directory:
```bash
python3 -m http.server 8080
# Open http://localhost:8080
```

**No test suite, no linter.** Manual browser testing is the workflow. Test on Safari (iOS), Chrome (Android), and desktop. A quick parse check for the inline scripts:
```bash
node -e "const html=require('fs').readFileSync('index.html','utf8');const re=/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g;let m,ok=true;while((m=re.exec(html))){try{new Function(m[1])}catch(e){ok=false;console.log('FAIL:',e.message)}};console.log(ok?'syntax OK':'ERRORS')"
```

## Critical: index.html Is the Only Real Source

**`index.html` is the authoritative source.** The `js/*.js`, `nav.html`, `pages.html`, `modals.html` files exist only as inputs to `build.sh` (Netlify single-file bundle) and are **stale** — features since ~v1.16 (deposits, contributions, data audit, annual report…) exist only in `index.html`. Editing `js/*.js` has zero effect on dev or the GitHub Pages deploy. Do not run `./build.sh` expecting a current app until those files are re-synced from `index.html`.

Each JS module is inlined in `index.html` with a section marker comment:
```
// ═══ db.js ═══      // ═══ nav.js ═══     // ═══ budget.js ═══
// ═══ day.js ═══     // ═══ income.js ═══  // ═══ assets.js ═══
// ═══ stats.js ═══   // ═══ calc.js ═══    // ═══ settings.js ═══
// ═══ sync.js ═══    // ═══ init.js ═══
```

**`css/app.css` is the exception** — loaded directly via `<link rel="stylesheet" href="css/app.css?v=X.Y.Z">` (~line 25 of `index.html`), so CSS edits go to `css/app.css` even in dev mode. Every CSS change must bump the `?v=` query string, otherwise iOS PWAs keep serving stale CSS.

## Deployment (GitHub Pages, push to main)

Checklist for every deploy:
1. Bump the visible version in `index.html` (About block, search `v1.`).
2. Bump `const V` in `sw.js` — this is what forces iOS PWA cache refresh.
3. Commit + push to `main`. Pages auto-builds (legacy branch build, workflow «pages build and deployment»).

Deploy verification/ops (gh CLI is installed and authenticated as `artwem`):
```powershell
& "C:\Program Files\GitHub CLI\gh.exe" api repos/artwem/void/pages/builds/latest --jq '{status,commit}'
& "C:\Program Files\GitHub CLI\gh.exe" api -X POST repos/artwem/void/pages/builds   # force fresh build
```
Pages deploys occasionally hang in `building`/`queued` (service-side). Remedies in order: force a fresh build via the API; empty-commit push; delete + recreate the Pages site (`DELETE /repos/artwem/void/pages`, then `POST` with `source[branch]=main`, `source[path]=/`) — same URL, fixes stuck pipelines. **Never bulk-delete old workflow runs**: the live deployment's artifact can go with them, 404ing the site until the next successful build.

## Architecture

### Data Layer — `═══ db.js ═══`

Single global `DB` object persisted to `localStorage` under `budgetDB_v2`. Every module reads from and writes to `DB`, then calls `saveDB()`. Schema:

```javascript
{
  categories:      ['ЖКУ + аренда', ...],    // ordered list
  catIds:          ['k3x9a1b2', ...],         // stable id per category, same position as categories[]
  catColors:       {0: '#185fa5', ...},       // category index → hex color
  expenses:        [{id, date, cat, catId, amount, comment, special?, _deleted?}, ...],  // catId authoritative; cat = derived index
  incomes:         [{id, date, source, amount, tag?}, ...],  // tag = name string from incomeTags[]
  assets:          [{id, date, bankName, bank, amount, _deleted?}, ...],  // point-in-time balance per bank per date
  banks:           ['Сбербанк', ...],         // debit bank names
  creditBanks:     [...],                     // credit bank names (subtracted from net worth)
  limits:          {'2026-04': [15000, ...]}, // per-category monthly limits, keyed by monthKey()
  syncUrl:         'https://script.google.com/...',
  goals:           [{id, name, target, saved, deadline, color}, ...],
  templates:       [{id, name, cat, amount, comment, color}, ...],  // cat = category index
  deposits:        [{id, name, amount, rate, finalAmount?, openDate, endDate, capitalization, contributions?, _deleted?}, ...],
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

**Stable category ids (since v1.18.0):** `DB.catIds[i]` is a permanent id for `DB.categories[i]`. Records (`expenses`, `templates`) carry `catId` (authoritative, survives category deletion/reorder and sync) plus `cat` (derived positional index used by all render/aggregation code). `_ensureCatIds()` migrates old data and runs in `loadDB()`, after `mergePullData()`, in restore and test-data fill. `_reindexCats()` recomputes every record's `cat` from its `catId`; orphaned `catId` falls back to category 0. Any code creating/editing an expense or template MUST set `catId: DB.catIds[cat]`.

### Tab Modules

Each tab has a `render*()` function called after any data change:

| Tab | Section marker | Responsibility |
|-----|----------------|----------------|
| (nav) | `═══ nav.js ═══` | Tab switching, month/day navigation, sync widget header |
| Budget | `═══ budget.js ═══` | Categories grouped by color, limits editor (⌀-hints), progress bars |
| Day | `═══ day.js ═══` | Daily expense list |
| Income | `═══ income.js ═══` | Income sources, monthly balance, tag filter |
| Аналитика | `═══ stats.js ═══` | Chart.js graphs, «День за днём», annual report page |
| Assets | `═══ assets.js ═══` | Bank accounts, credit cards, savings chart, history, goals, deposits |
| Forecast | `═══ calc.js ═══` | Compound interest / savings forecast calculator |
| Settings | `═══ settings.js ═══` | Category/bank CRUD, sync, backup/restore, Excel, notifications, data audit |

**Sub-pages without a navbar tab** (open via buttons, highlight the parent tab's nav button in `showPage`): `page-calc` and `page-deposits` from Assets; `page-report` (annual report: year selector, summary cards, per-month table, expenses-by-category, income-by-tag; `renderReport()` in stats.js section) from Аналитика.

### Deposits (вклады) — in `═══ assets.js ═══`

- `depositValueAt(d, dateStr)` = rounded `_depValueWithRate(d, date, d.rate)`; honors `finalAmount` exactly at/after `endDate`. Principal grows from `openDate`; **each contribution grows from its own date** (before its date it does not exist in the value). `capitalization: 'monthly'` — compound; `'end'` — body only until endDate, simple interest at close.
- `finalAmount` mode («Сумма в конце» toggle, `_depMode`): user enters the closing sum, annual rate is derived by `_calcDepRate(amount, final, open, end, cap, contribs)` — closed form without contributions, **bisection** with them. Rate re-derives on contribution add/delete (`_reDeriveDepRate`).
- Top-ups: «+ Пополнить» on open deposit cards → `openDepContribution`/`saveDepContribution` (validated within `[openDate, endDate]`, sorted, stamps `updatedAt`); edit modal lists contributions with immediate delete. `_depContribsSum(d, date)` = contributions dated ≤ date.
- **Bank↔deposit transfers**: `_bankAdjust(bankName, date, delta)` edits/creates the bank's asset record on that date (base = `_lastKnownAmount`). Used by deposit close (`confirmCloseDeposit`, +value, soft-deletes the deposit) and by optional «Списать из банка» selects in new-deposit and contribution modals (−amount). Keeps period reconciliation clean — always prefer it over hand-written record math.
- Matured deposits show «↳ Перенести в банк»; open ones «+ Пополнить».

### Assets Page & Series

- **«Всего активов» = banks + live deposits at today** (since v1.22.0), with a «счета X · вклады Y» breakdown line. `_getCurrentAssetsTotal()` stays banks-only (feeds calc/goal prefills where deposit interest would double-count). Bank total = each bank's **most recent non-deleted entry regardless of date** — never filter by a shared "latest date".
- Live deposits render as read-only rows at the end of «Текущие счета» (blue «вклад» badge, click → deposits page). Zero/no-data banks hide behind a «Показать нулевые счета (N)» toggle (`_showZeroBanks`).
- **`_buildAssetSeries()`** is the single source for chart, history table and audit: per-snapshot-date `bankSeries` (carry-forward — a bank without a record on a date uses its last known record) and `depSeries` (deposits from `openDate`, soft-deleted ones counted until their local deletion day `_depDelDay(d)` — closing a deposit doesn't retroactively dent history). The «банки / +вклады» chart toggle (`setAssetsChartDeps`, device-local `localStorage.assetsChartDeps`) adds `depSeries` to the line; the history table ignores the toggle and always shows Дата | Счета | Вклады | Всего | Δ.
- **Snapshot modal semantics** (`openAssetSnapshot` → `openEditAssetDate(date, carryForward)`): editable «Дата снимка» field (max today) allows backdated snapshots; pre-fills carry-forward values flagged «↻ перенесено». **Empty input = no record** (carry-forward continues; amber «∅ записи не будет…» tag), **explicit 0 = real zero record** (green «✕ обнулён этой датой» tag, only when the last record before the date was non-zero); per-row round «0» button. On save, all previous records for the date are tombstoned and non-empty inputs re-added.
- Data audit (Settings → «Проверка данных», `openDataAudit`): ghost bank records (merge/delete), duplicate bank+date records (keep max `updatedAt`), deposit/snapshot date warnings, and **period reconciliation** — per snapshot period, asset delta vs (incomes − expenses) with running cumulative; mirrored ±X pairs in adjacent periods mean a date shift (harmless), a persistent cumulative shift means unaccounted money.
- Notifications: `checkBudgetNotifications` (limit threshold, call after saving an expense), `checkAssetNotification` (1st/16th + stale snapshot >14 days, re-fires every 3 days), `checkDepositNotifications` (closes in ≤3 days or matured; 3-day per-deposit stamp). All gated by `DB.notifsEnabled` + granted permission.

### Sync — `═══ sync.js ═══` + `apps-script/Code.gs`

Optional 2-way sync via a deployed Google Apps Script URL stored in `DB.syncUrl`. Data is stored as `nto_data.json` on Google Drive (no spreadsheets).

**All sync entry points (startup, 15s interval, visibilitychange, manual pull/push buttons) go through a single `syncCycle()`** (in `═══ init.js ═══`): pull → merge → push-if-dirty, guarded by one shared in-flight promise. Never push before pulling. `saveDB()` increments a `_dirtyGen` counter; `syncCycle` clears `DB._dirty` only if the counter is unchanged after the awaits. The interval fires when `DB._dirty` **or** when the last pull is >5 min old. After 3 consecutive failures the sync widget shows a red «Ошибка» (`_syncFailCount`).

**Optional shared secret (since v1.11.0):** `Code.gs` has a `SECRET` constant (empty = no auth). If set, the same string is stored device-locally as `DB.syncToken` (localStorage + sessionStorage + cookie, same pattern as `syncUrl`) and sent as `token` in every `syncRequest`.

**What syncs (both directions):** `expenses`, `incomes`, `assets`, `goals`, `templates`, `deposits`, `categories`, `catColors`, `banks`, `creditBanks`, `limits`, `incomeTags`, `incomeTagColors`, plus `listsMeta` (LWW timestamps).

**What does NOT sync:** `syncUrl`, `syncToken`, `notifsEnabled`, `notifThreshold`, `theme`, `privacyMode`, `_lastSyncedLimits` (device-local). `buildPayload()` strips exactly these seven fields plus `_dirty`.

**`syncUrl` multi-source loading:** iOS PWA has isolated localStorage from Safari. On load, `syncUrl` is read from `localStorage` → `sessionStorage` → cookie. `saveSyncUrlEverywhere()` writes to all three.

**Tombstones + `updatedAt` (since v1.8.0):** every create/edit/delete on `expenses`, `incomes`, `assets`, `goals`, `templates`, `deposits` stamps `updatedAt: Date.now()`. Deletes are **soft** — `_deleted: true`, amount zeroed. All render/sum/export paths filter `!_deleted`. `loadDB()` purges tombstones older than 90 days. Tombstones are pushed (other devices must learn of deletes).

**Merge logic (`mergePullData`):**
- Record arrays: **last-write-wins by `id`** — keep the strictly greater `updatedAt`; ties keep local. Any bulk mutation (category remap, bank/tag rename) MUST stamp `updatedAt` on each mutated record, or the merge reverts them.
- Name lists + their colors: **LWW by `listsMeta[name]`** (`touchList(name)` on every mutation). Fallback for pre-v1.17 clients: remote wins if longer.
- `limits`: **3-way merge** — remote wins per month-key only if the local value equals the `_lastSyncedLimits` baseline; locally-edited months keep local and get pushed. `syncCycle` refreshes the baseline after each successful cycle.

**Updating Apps Script:** edit `apps-script/Code.gs` locally → copy into the Google Apps Script editor → deploy new version. In dev mode `loadAppsScriptCode()` fetches it from `./apps-script/Code.gs`.

**Code.gs v10.3:** writes serialized with `LockService`; data file located by ID in `ScriptProperties` (`dataFileId`), falling back to name lookup. **Wipe guard:** a push <30% of the stored file size (file >20 KB) is rejected unless `force:true` — manual «Выгрузить в Drive» sends `force`, auto-sync doesn't. **Daily backup:** at most once per 24h the file is copied to `nto_data.bak.json`.

### Excel Export

Settings → «Экспорт Excel» → `exportExcel()` (settings.js section). Uses **SheetJS 0.18.5** from CDN. Sheets: По дням YYYY, Шаблон, month sheets, Активы, Вклады (live deposits: body, contributions, rate, dates, value now/at close). For a full backup use «Резервная копия» (JSON dump of entire `DB`) — restorable via «Восстановить из файла».

### PWA Caching — `sw.js`

Cache-first for assets, network-first for HTML. The `V` constant controls cache invalidation — **bump on every deploy**. Error responses (non-`ok`) are never cached.

### Key Globals

- `saveDB()` — persist to localStorage; sets `DB._dirty = true`
- `renderBudget()`, `renderDay()`, `renderAssets()`, `renderSettings()`, etc. — full tab re-render
- `getAllBanks()` — `[...DB.banks, ...DB.creditBanks]`; use instead of inline spread
- `isCredit(bankName)` — true if bank is in `DB.creditBanks`
- `fmt(n)` — `12 345₽`; `fmtH(n)` — same wrapped in `<span class="prv">` for privacy-mode blurring (use for ALL monetary values in innerHTML); `fmtShort(n)` — `12к`, `1.2М` (no ₽)
- `esc(s)` — HTML-escape (always for user-supplied strings in innerHTML)
- `today()` — `YYYY-MM-DD`; `monthKey(y, m)` — `YYYY-MM`
- `getCatColor(idx)` / `getIncomeTagColor(tagName)` — hex colors
- `getCatSpent(idx, y, m)` — sum of non-deleted expenses for category in month
- `getMonthExpenses(y, m)` — non-deleted expenses of a month
- `_makeSwipeable(row, onDelete)` — swipe-left-to-delete; `deleteExpenseById(id)` soft-deletes
- `openModal(id)` / `closeModal(id)` — `.overlay` modals
- `toast(msg, type?)` — 2.2s toast, auto-detects ok/err from message text; `toastUndo(msg, onUndo)` — with an Отменить button
- `uid()` — short alphanumeric ID for all new entities
- `renderTemplateChips()` — quick-add template buttons on the Day tab
- `CAT_COLORS` (16), `GOAL_COLORS` (7), `TEMPLATE_COLORS` (28), `INCOME_TAG_COLORS` (8) — palettes
- `_chartColors()` — theme-aware Chart.js colors read from CSS vars at render time; call inside chart creation, not at module level

### UI State Patterns

Session-persisted UI state uses `sessionStorage`:
- `expViewMode` (`'cats'`|`'groups'`), `pieViewMode` — breakdown views in Аналитика
- `statsPeriod` — months shown in Аналитика charts
- `dayInclSpecial` — «Особые» toggle of «День за днём» (the only chart that filters special expenses; everything else includes them)
- `dayAvgMonths` (`3`|`6`|`12`, default 6) — depth of the average line in «День за днём» (`setDayAvgMonths`)
- `limitAvgMonths` (`3`|`6`|`12`, default 3) — depth of «⌀ подставить» hints in the limit editor (`setLimitAvgMonths`); header shows the sum of suggested averages + «подставить все» (`applyAllLimitAvgs`)

Filter state (module-level variables, reset on tab re-render):
- `_expCatFilter` (`null` | `Set<number>`) — Day tab category multi-select
- `_incomeTagFilter` (`null` | `''` | `string`) — Income tab tag filter

### Color Picker Pattern

Goals and templates share `renderColorPicker(elementId, palette, selectedColor, callbackName)`. Each entity keeps its own `_selectedXxxColor` module-level variable and a thin `_renderXxxColorPicker()` wrapper. Replicate for any new color-selectable entity.

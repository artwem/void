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

## Architecture

### Data Layer — `js/db.js`

Single global `DB` object persisted to `localStorage` under `budgetDB_v2`. Every module reads from and writes to `DB`, then calls `saveDB()`. Schema:

```javascript
{
  categories: ['ЖКУ + аренда', ...],   // ordered list
  expenses:   [{id, date, cat, sum, comment, _deleted?}, ...],
  incomes:    [{date, source, sum}, ...],
  assets:     [{date, bankName, sum, _deleted?}, ...],
  banks:      ['Сбербанк', ...],
  creditBanks: [...],
  limits:     {'2026-04': [15000, ...]}, // per-category monthly limits
  catColors:  {0: '#185fa5', ...},       // category index → hex color
  syncUrl:    'https://script.google.com/...',
  _dirty:     true/false
}
```

### Tab Modules — `js/*.js`

Each tab has a corresponding module with a `render*()` function called after any data change:

| Tab | File | Responsibility |
|-----|------|----------------|
| Budget | `budget.js` | Categories grouped by color, limits, progress bars |
| Day | `day.js` | Daily expense list |
| Income | `income.js` | Income sources, monthly balance |
| Stats | `stats.js` | Chart.js graphs (6-month trends, category breakdown) |
| Assets | `assets.js` | Bank accounts, credit cards, savings chart |
| Settings | `settings.js` | Category/bank CRUD, sync URL config |

### Sync — `js/sync.js` + `apps-script/Code.gs`

Optional 2-way sync with Google Sheets via a deployed Google Apps Script URL stored in `DB.syncUrl`. Auto-syncs every 15 seconds when configured. The Apps Script creates/updates sheets named "По дням YYYY", month names in Russian, "Активы", "Доходы", etc. To update sync logic, edit `Code.gs` in the Google Apps Script editor, then paste back.

### PWA Caching — `sw.js`

Cache-first for assets, network-first for HTML. The `V` timestamp at the top of `sw.js` controls cache invalidation — **bump `V` on every deploy** to force iOS PWA cache refresh.

### Key Globals

- `saveDB()` — persist to localStorage
- `renderBudget()`, `renderDay()`, `renderStats()`, etc. — full tab re-render
- `fmt(n)` — format as ₽ currency
- `today()` — returns `YYYY-MM-DD`
- `monthKey(y, m)` — returns `YYYY-MM` key used in `limits`
- `getCatColor(idx)`, `getCatSpent(idx, y, m)` — query helpers

### HTML Structure

`index.html` is the app shell (~3000 lines). `pages.html`, `modals.html`, and `nav.html` are partial HTML files that `build.sh` inlines into the bundle. The bottom navigation bar maps to the 5 tabs.

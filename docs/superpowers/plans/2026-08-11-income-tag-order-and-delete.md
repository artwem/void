# Income tag write-off order + delete reassignment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settings → «Теги доходов» gets (1) a delete flow that lets the user reassign affected incomes to another tag / a new tag / leave untagged instead of silently stripping the tag, and (2) a drag-reorderable «Порядок списания» list that replaces the size-based auto-sort «Из чего накоплено» uses to decide which income sources count as spent vs saved.

**Architecture:** New `DB.incomeTagOrder` field (array of tag names + `''` for «Без тега»), independent of `DB.incomeTags` — reordering it never touches tag colors, the income-add tag chips, or the tag chart, all of which keep using `DB.incomeTags`' own array order. A reconciliation helper (`_incomeTagWriteoffOrder()`) makes the stored order self-healing against rename/delete/sync drift, so no code path is required to eagerly keep it perfectly in sync — mutation sites patch it best-effort for a stable UX, but correctness never depends on that. Drag reordering uses Pointer Events (not HTML5 Drag-and-Drop, unreliable for touch on iOS Safari). All changes live in `index.html` (single JS source per CLAUDE.md).

**Tech Stack:** Vanilla JS, inline in `index.html`. Tests: Node scripts for pure functions (regex-extract + eval, same technique as prior plans), puppeteer-core + system Chrome for DOM/pointer-event-driven UI (no test framework in this project).

## Global Constraints

- `index.html` is the only JS source — all modules inline (CLAUDE.md).
- Every deploy: bump the visible version in `index.html` (About block, search `v1.`) and `const V` in `sw.js`.
- No test suite, no linter in this project — don't introduce a framework or dependency. Syntax check is the node one-liner below; everything else is Node-script asserts on extracted pure functions, or puppeteer for DOM.
- **CSS gotcha:** `css/app.css:104` — global `input,select,textarea{...appearance:none}` makes checkboxes/radios invisible unless given an inline `appearance:auto` override. Every new `<input type="radio">` in this plan MUST carry the inline override (see Task 4).
- Sync fields: any new list-like `DB` field that should sync must (a) be touched via `touchList(name)` on every mutation, (b) be merged in `mergePullData` via `_mergeList(d, name, colorKey)`. `buildPayload` needs no change — it spreads the full `DB` and only deletes an explicit device-local strip list.
- Syntax check (run after every task that touches `index.html`):
  ```bash
  node -e "const html=require('fs').readFileSync('index.html','utf8');const re=/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g;let m,ok=true;while((m=re.exec(html))){try{new Function(m[1])}catch(e){ok=false;console.log('FAIL:',e.message)}};console.log(ok?'syntax OK':'ERRORS')"
  ```
  Expected: `syntax OK`

---

## File Structure

- Modify: `index.html`
  - DB init (`loadDB()`, ~line 1375-1377): add `DB.incomeTagOrder` default.
  - New helpers, inserted before `_savingsBreakdownHtml` (~line 2860): `_incomeTagWriteoffOrder`, `_incomeTagOrderLabel`, `_incomeTagOrderColor`.
  - `_savingsBreakdownHtml` (~line 2864-2908): consume the new order instead of size-sort.
  - `mergePullData` (~line 8336-8339): add `_mergeList(d, 'incomeTagOrder', null)`.
  - `modal-income-tags` HTML (~line 1046-1061): new «Порядок списания» section.
  - `renderIncomeTagsList`/`openIncomeTagsManager`/`addIncomeTag`/`startEditIncomeTag`/`setIncomeTagColor` (~line 6348-6448): wire in the new order list + keep it patched on CRUD.
  - New `modal-delete-income-tag` HTML, inserted after `modal-income-tags` closes.
  - `deleteIncomeTag` (~line 6427-6448): replaced with modal-opening flow + new `_renderDelIncTagAction`, `confirmDeleteIncomeTag`, `_removeIncomeTagAt`.
- Modify: `CLAUDE.md` — DB schema block, sync "What syncs" list.
- Test: temp Node/puppeteer scripts in scratchpad (not committed).

---

## Task 1: Data layer — `DB.incomeTagOrder` + reconciliation helpers + sync

**Files:**
- Modify: `index.html:1375-1377` (DB init in `loadDB()`)
- Modify: `index.html:2858-2860` (insert helpers before `_savingsBreakdownHtml`)
- Modify: `index.html:8336-8339` (`mergePullData` list-merge chain)

**Interfaces:**
- Produces (used by Task 2 and Task 3):
  - `_incomeTagWriteoffOrder(): string[]` — reconciled write-off order; every element is either `''` (Без тега) or a name present in `DB.incomeTags`; every known tag/`''` appears exactly once.
  - `_incomeTagOrderLabel(tag: string): string` — `'Без тега'` for `''`, else `tag`.
  - `_incomeTagOrderColor(tag: string): string` — `'rgba(128,128,128,0.55)'` for `''`, else `getIncomeTagColor(tag)`.
- Consumes: `DB.incomeTags`, `DB.incomeTagOrder`, `getIncomeTagColor` (existing, `index.html:2583`).

- [ ] **Step 1: DB init default**

In `index.html`, find (currently line 1375-1376):
```javascript
  if(!DB.incomeTags || !DB.incomeTags.length) DB.incomeTags = ['Оплата труда','Продажи','Проценты','Кешбек'];
  if(!DB.incomeTagColors) DB.incomeTagColors = {};
```
Replace with:
```javascript
  if(!DB.incomeTags || !DB.incomeTags.length) DB.incomeTags = ['Оплата труда','Продажи','Проценты','Кешбек'];
  if(!DB.incomeTagColors) DB.incomeTagColors = {};
  if(!DB.incomeTagOrder) DB.incomeTagOrder = [];
```

- [ ] **Step 2: Write the reconciliation helpers**

In `index.html`, find the section marker (currently line 2858):
```javascript
// ═══ stats.js ═══

// «Из чего накоплено»: доходы периода по тегам, расходы поглощают крупнейшие
```
Insert new helpers between the marker and that comment, so the result reads:
```javascript
// ═══ stats.js ═══

// Порядок списания тегов доходов для «Из чего накоплено»: DB.incomeTagOrder,
// верх→низ = приоритет списания (спискывается первым = меньше остаётся в
// накоплениях). Хранится ОТДЕЛЬНО от DB.incomeTags — не переставляет цвета/
// чипы добавления дохода/график, те живут в порядке DB.incomeTags как раньше.
// Реконсиляция при чтении, а не эагерная поддержка на каждой мутации:
// неизвестные записи (тег переименован/удалён без патча) выкидываются,
// отсутствующие (новый тег, первый запуск, отставший sync-мердж) дописываются
// в конец — список самовосстанавливается сам, мутирующий код (Task 3/4)
// патчит его для стабильного UX, но корректность от этого не зависит.
function _incomeTagWriteoffOrder(){
  const known = ['', ...(DB.incomeTags||[])];
  const stored = (DB.incomeTagOrder||[]).filter(t => known.includes(t));
  const seen = new Set(stored);
  const missing = known.filter(t => !seen.has(t));
  return [...stored, ...missing];
}

function _incomeTagOrderLabel(tag){ return tag === '' ? 'Без тега' : tag; }
function _incomeTagOrderColor(tag){ return tag === '' ? 'rgba(128,128,128,0.55)' : getIncomeTagColor(tag); }

// «Из чего накоплено»: доходы периода по тегам, расходы поглощают крупнейшие
```
(the rest of the original comment block and `_savingsBreakdownHtml` follow unchanged — Task 2 edits its body.)

- [ ] **Step 3: Wire into sync merge**

In `index.html`, find (currently line 8336-8339):
```javascript
  const listsChanged = catRemoteWon
    | _mergeList(d, 'banks', null)
    | _mergeList(d, 'creditBanks', null)
    | _mergeList(d, 'incomeTags', 'incomeTagColors');
```
Replace with:
```javascript
  const listsChanged = catRemoteWon
    | _mergeList(d, 'banks', null)
    | _mergeList(d, 'creditBanks', null)
    | _mergeList(d, 'incomeTags', 'incomeTagColors')
    | _mergeList(d, 'incomeTagOrder', null);
```

- [ ] **Step 4: Node test on fixtures — write and run**

Create `C:\Users\AANISI~1\AppData\Local\Temp\claude\C--Users-aanisimov-code-nto\48b9aaae-d58c-4b33-b935-17f446234224\scratchpad\test-income-tag-order.js`:
```javascript
const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync(process.argv[2] || 'index.html', 'utf8');
function extract(name){
  const re = new RegExp('function '+name+'\\([\\s\\S]*?\\n}\\n');
  const m = html.match(re);
  if(!m) throw new Error('not found: '+name);
  return m[0];
}
// getIncomeTagColor и DB нужны в scope до вызова извлечённых функций —
// closure резолвится в момент вызова, не в момент eval.
function getIncomeTagColor(tag){ return '#test-'+tag; }
let DB = {};
const src = ['_incomeTagWriteoffOrder'].map(extract).join('\n');
eval(src);

// ── нет сохранённого порядка (первый запуск) — Без тега + порядок incomeTags ──
DB = { incomeTags: ['A','B','C'], incomeTagOrder: [] };
assert.deepStrictEqual(_incomeTagWriteoffOrder(), ['', 'A', 'B', 'C']);

// ── сохранённый порядок частичный (новый тег C появился позже) — C дописан в конец ──
DB = { incomeTags: ['A','B','C'], incomeTagOrder: ['B', '', 'A'] };
assert.deepStrictEqual(_incomeTagWriteoffOrder(), ['B', '', 'A', 'C']);

// ── сохранённый порядок содержит осиротевший тег (переименован/удалён без патча) ──
DB = { incomeTags: ['A','B'], incomeTagOrder: ['OldName', 'A'] };
assert.deepStrictEqual(_incomeTagWriteoffOrder(), ['A', '', 'B']);

// ── DB.incomeTagOrder отсутствует вовсе (пред-миграционные данные) ──
DB = { incomeTags: ['A'] };
assert.deepStrictEqual(_incomeTagWriteoffOrder(), ['', 'A']);

console.log('OK: all income-tag-order tests passed');
```

Run:
```bash
node "C:\Users\AANISI~1\AppData\Local\Temp\claude\C--Users-aanisimov-code-nto\48b9aaae-d58c-4b33-b935-17f446234224\scratchpad\test-income-tag-order.js" "C:\Users\aanisimov\code\nto\index.html"
```
Expected (before Step 2): FAIL `not found: _incomeTagWriteoffOrder`. After Step 2: `OK: all income-tag-order tests passed`.

- [ ] **Step 5: Syntax check**

Run the Global Constraints syntax one-liner. Expected: `syntax OK`.

- [ ] **Step 6: Commit**
```bash
git add index.html
git commit -m "feat(income): DB.incomeTagOrder + reconciliation helper for write-off order"
```

---

## Task 2: `_savingsBreakdownHtml` consumes the write-off order

**Files:**
- Modify: `index.html:2864-2908` (`_savingsBreakdownHtml` — body after Task 1's insertion shifts these line numbers down by ~18; locate by function name)

**Interfaces:**
- Consumes (from Task 1): `_incomeTagWriteoffOrder()`, `_incomeTagOrderColor(tag)`.
- Consumes (existing): `_normTag(inc)` (`index.html:2947`, function-hoisted so forward reference is fine).
- No signature change to `_savingsBreakdownHtml(periodIncs, totalExp)` — same callers (Аналитика summary, annual report, per existing code comment) get the new behavior automatically.

- [ ] **Step 1: Replace the source-building + sort block**

Find:
```javascript
  const savSources = [];
  (DB.incomeTags||[]).forEach(tag=>{
    const total = periodIncs.filter(inc=>inc.tag===tag).reduce((s,inc)=>s+inc.amount,0);
    if(total>0) savSources.push({name:tag, color:getIncomeTagColor(tag), total});
  });
  const noTagTotal = periodIncs.filter(inc=>!_normTag(inc)).reduce((s,inc)=>s+inc.amount,0);
  if(noTagTotal>0) savSources.push({name:'Без тега', color:'rgba(128,128,128,0.55)', total:noTagTotal});
  savSources.sort((a,b)=>{
    if(a.name==='Без тега') return -1;
    if(b.name==='Без тега') return 1;
    return b.total-a.total;
  });
  // Расходы поглощают крупнейшие источники первыми; остаток = вклад в накопления
  let rem = totalExp;
```
Replace with:
```javascript
  const savSources = [];
  _incomeTagWriteoffOrder().forEach(tag=>{
    const total = tag===''
      ? periodIncs.filter(inc=>!_normTag(inc)).reduce((s,inc)=>s+inc.amount,0)
      : periodIncs.filter(inc=>inc.tag===tag).reduce((s,inc)=>s+inc.amount,0);
    if(total>0) savSources.push({name:_incomeTagOrderLabel(tag), color:_incomeTagOrderColor(tag), total});
  });
  // Расходы поглощают источники в заданном порядке списания первыми; остаток = вклад в накопления
  let rem = totalExp;
```
(The rest of the function — the `forEach` absorbing `rem`, `activeSav`, stacked bar, rows — is unchanged; it already just walks `savSources` in whatever order it was given.)

- [ ] **Step 2: Syntax check**

Run the Global Constraints syntax one-liner. Expected: `syntax OK`.

- [ ] **Step 3: Puppeteer check — order actually drives the breakdown**

Create `C:\Users\AANISI~1\AppData\Local\Temp\claude\C--Users-aanisimov-code-nto\48b9aaae-d58c-4b33-b935-17f446234224\scratchpad\test-savings-order.js`:
```javascript
const puppeteer = require('puppeteer-core');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3 });
  const url = 'file://' + path.resolve(__dirname, '../../../nto/index.html').replace(/\\/g, '/');
  await page.goto(url);

  const today = new Date().toISOString().slice(0,10);
  const db = {
    categories: ['Еда'], catIds: ['c1'], catColors: {0:'#185fa5'},
    expenses: [{id:'e1', date: today, cat:0, catId:'c1', amount: 5000, comment:''}],
    incomes: [
      {id:'i1', date: today, source:'Зарплата', amount: 3000, tag:'Оплата труда'},
      {id:'i2', date: today, source:'Проценты', amount: 4000, tag:'Проценты'},
    ],
    banks: ['Сбербанк'], creditBanks: [], limits: {},
    incomeTags: ['Оплата труда','Проценты'], incomeTagColors: {},
    incomeTagOrder: ['Оплата труда', '', 'Проценты'], // зарплата списывается первой
  };
  await page.evaluate((dbJson) => {
    localStorage.setItem('budgetDB_v2', dbJson);
  }, JSON.stringify(db));
  await page.reload();

  const html = await page.evaluate((today) => {
    const [y,m] = [today.slice(0,4)|0, today.slice(5,7)|0 - 1];
    const incs = DB.incomes.filter(i => i.date.startsWith(today.slice(0,7)));
    return _savingsBreakdownHtml(incs, 5000);
  }, today);

  // Списываем 5000 из 3000 (зарплата, списывается первой по заданному порядку) —
  // зарплата уходит целиком (0 в накоплениях), 2000 добираем из процентов,
  // оставшиеся 2000 процентов — в накоплениях. Порядок в HTML должен отразить
  // это: «Проценты» — единственный активный источник накоплений.
  if (!html.includes('Проценты')) throw new Error('FAIL: expected Проценты in breakdown, got: ' + html);
  if (html.includes('Оплата труда')) throw new Error('FAIL: Оплата труда should be fully absorbed (0 saved), got: ' + html);
  console.log('OK: savings breakdown honors incomeTagOrder');

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
```

Run (from scratchpad, after `npm install puppeteer-core` there if not already installed):
```bash
node test-savings-order.js
```
Expected: `OK: savings breakdown honors incomeTagOrder`.

- [ ] **Step 4: Commit**
```bash
git add index.html
git commit -m "feat(income): «Из чего накоплено» honors user-defined write-off order"
```

---

## Task 3: «Порядок списания» drag-reorder UI

**Files:**
- Modify: `index.html:1046-1061` (`modal-income-tags` HTML)
- Modify: `index.html:6348-6425` (`openIncomeTagsManager`, `renderIncomeTagsList`, `setIncomeTagColor`, `startEditIncomeTag`, `addIncomeTag` — add order-list wiring)

**Interfaces:**
- Consumes (from Task 1): `_incomeTagWriteoffOrder()`, `_incomeTagOrderLabel(tag)`, `_incomeTagOrderColor(tag)`.
- Produces (used by Task 4): `renderIncomeTagOrderList()` — re-renders `#income-tag-order-list` from `_incomeTagWriteoffOrder()` and wires dragging; safe to call any time the modal is open or about to open.

- [ ] **Step 1: Add the order-list section to the modal HTML**

Find (currently line 1046-1061):
```html
<!-- MODAL: INCOME TAGS MANAGER -->
<div class="overlay" id="modal-income-tags">
  <div class="sheet" style="position:relative">
    <button class="close-btn" onclick="closeModal('modal-income-tags')">✕</button>
    <h2>Теги доходов</h2>
    <div id="income-tags-list"></div>
    <div class="fgrp" style="margin-top:12px">
      <label class="flbl">Добавить тег</label>
      <div style="display:flex;gap:8px">
        <input type="text" id="new-income-tag-input" placeholder="Название тега"/>
        <button class="btn primary small" onclick="addIncomeTag()">Добавить</button>
      </div>
    </div>
    <div class="btn-row" style="margin-top:8px"><button class="btn primary" onclick="closeModal('modal-income-tags')">Готово</button></div>
  </div>
</div>
```
Replace with:
```html
<!-- MODAL: INCOME TAGS MANAGER -->
<div class="overlay" id="modal-income-tags">
  <div class="sheet" style="position:relative">
    <button class="close-btn" onclick="closeModal('modal-income-tags')">✕</button>
    <h2>Теги доходов</h2>
    <div id="income-tags-list"></div>
    <div class="fgrp" style="margin-top:12px">
      <label class="flbl">Добавить тег</label>
      <div style="display:flex;gap:8px">
        <input type="text" id="new-income-tag-input" placeholder="Название тега"/>
        <button class="btn primary small" onclick="addIncomeTag()">Добавить</button>
      </div>
    </div>
    <div class="fgrp" style="margin-top:16px">
      <label class="flbl">Порядок списания <span style="cursor:pointer;color:var(--muted)" onclick="toast('Расходы списываются с доходов сверху вниз — так считается «Из чего накоплено»')">ⓘ</span></label>
      <div id="income-tag-order-list" style="display:flex;flex-direction:column;gap:4px"></div>
    </div>
    <div class="btn-row" style="margin-top:8px"><button class="btn primary" onclick="closeModal('modal-income-tags')">Готово</button></div>
  </div>
</div>
```

- [ ] **Step 2: Write `renderIncomeTagOrderList` and the pointer-drag wiring**

Find (currently line 6353, right after `openIncomeTagsManager`'s closing `}` at line 6351):
```javascript
function renderIncomeTagsList(){
```
Insert before it:
```javascript
// Секция «Порядок списания» в модале тегов доходов — отдельный drag-список,
// не трогает DB.incomeTags/цвета/чипы. Рендерится из _incomeTagWriteoffOrder(),
// чтобы всегда показывать актуальный (реконсиленный) порядок, даже если
// DB.incomeTagOrder отстал от реальности (rename/delete/sync).
function renderIncomeTagOrderList(){
  const list = document.getElementById('income-tag-order-list');
  if(!list) return;
  const order = _incomeTagWriteoffOrder();
  list.innerHTML = order.map(tag =>
    '<div class="setting-row io-row" style="cursor:default;gap:6px" data-tag="'+esc(tag)+'">'
    + '<span class="io-handle" style="touch-action:none;cursor:grab;color:var(--muted);flex-shrink:0;font-size:16px;padding:2px 4px">⠿</span>'
    + '<span style="width:8px;height:8px;border-radius:50%;background:'+_incomeTagOrderColor(tag)+';flex-shrink:0"></span>'
    + '<span style="flex:1;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(_incomeTagOrderLabel(tag))+'</span>'
    + '</div>'
  ).join('');
  _wireIncomeTagOrderDrag(list);
}

// Reorder через Pointer Events (не HTML5 Drag-and-Drop — ненадёжен для touch
// на iOS Safari, основная платформа юзера). pointerdown на хендле поднимает
// строку; pointermove — как только центр перетаскиваемой строки пересекает
// середину соседней, меняем их местами в DOM (insertBefore) и сбрасываем
// накопленный transform, чтобы строка визуально «осталась под пальцем»;
// pointerup читает финальный порядок прямо из DOM (после всех swap'ов он уже
// верный) и сохраняет.
function _wireIncomeTagOrderDrag(list){
  let dragRow = null, startY = 0, pointerId = null;

  function onMove(e){
    if(!dragRow || e.pointerId !== pointerId) return;
    const dy = e.clientY - startY;
    dragRow.style.transform = 'translateY(' + dy + 'px)';
    const rows = [...list.querySelectorAll('.io-row')];
    const dragIdx = rows.indexOf(dragRow);
    const dragRect = dragRow.getBoundingClientRect();
    const dragMid = dragRect.top + dragRect.height / 2;
    for(let i = 0; i < rows.length; i++){
      const sib = rows[i];
      if(sib === dragRow) continue;
      const r = sib.getBoundingClientRect();
      const sibMid = r.top + r.height / 2;
      if(i < dragIdx && dragMid < sibMid){
        list.insertBefore(dragRow, sib);
        startY = e.clientY; dragRow.style.transform = 'translateY(0px)';
        break;
      }
      if(i > dragIdx && dragMid > sibMid){
        list.insertBefore(dragRow, sib.nextSibling);
        startY = e.clientY; dragRow.style.transform = 'translateY(0px)';
        break;
      }
    }
  }

  function onUp(e){
    if(!dragRow || e.pointerId !== pointerId) return;
    dragRow.style.position = '';
    dragRow.style.zIndex = '';
    dragRow.style.transition = '';
    dragRow.style.transform = '';
    dragRow.style.boxShadow = '';
    const order = [...list.querySelectorAll('.io-row')].map(r => r.dataset.tag);
    DB.incomeTagOrder = order;
    touchList('incomeTagOrder');
    saveDB();
    dragRow = null; pointerId = null;
  }

  list.querySelectorAll('.io-row').forEach(row => {
    const handle = row.querySelector('.io-handle');
    handle.addEventListener('pointerdown', e => {
      dragRow = row;
      pointerId = e.pointerId;
      startY = e.clientY;
      handle.setPointerCapture(e.pointerId);
      row.style.position = 'relative';
      row.style.zIndex = '10';
      row.style.transition = 'none';
      row.style.boxShadow = '0 4px 14px rgba(0,0,0,.18)';
    });
  });
  list.addEventListener('pointermove', onMove);
  list.addEventListener('pointerup', onUp);
  list.addEventListener('pointercancel', onUp);
}

function renderIncomeTagsList(){
```

- [ ] **Step 3: Wire order-list render into `openIncomeTagsManager` and CRUD functions**

Find (currently line 6348-6351):
```javascript
function openIncomeTagsManager(){
  renderIncomeTagsList();
  openModal('modal-income-tags');
}
```
Replace with:
```javascript
function openIncomeTagsManager(){
  renderIncomeTagsList();
  renderIncomeTagOrderList();
  openModal('modal-income-tags');
}
```

Find (currently line 6370-6376):
```javascript
function setIncomeTagColor(i, color){
  if(!DB.incomeTagColors) DB.incomeTagColors = {};
  DB.incomeTagColors[i] = color;
  touchList('incomeTags');
  saveDB();
  renderIncomeTagsList();
}
```
Replace with:
```javascript
function setIncomeTagColor(i, color){
  if(!DB.incomeTagColors) DB.incomeTagColors = {};
  DB.incomeTagColors[i] = color;
  touchList('incomeTags');
  saveDB();
  renderIncomeTagsList();
  renderIncomeTagOrderList(); // dot color in the order list follows the tag's color
}
```

Find, inside `startEditIncomeTag`'s `save` closure (currently line 6393-6404):
```javascript
  const save = () => {
    const newName = inp.value.trim();
    if(!newName){ toast('Введите название'); return; }
    if(newName !== tag && DB.incomeTags.includes(newName)){ toast('Уже существует'); return; }
    // Update tag on all income entries (+ штамп, чтобы rename пережил LWW-merge)
    const now = Date.now();
    (DB.incomes||[]).forEach(inc => { if(inc.tag === tag){ inc.tag = newName; inc.updatedAt = now; } });
    DB.incomeTags[i] = newName;
    touchList('incomeTags');
    saveDB();
    renderIncomeTagsList();
  };
```
Replace with:
```javascript
  const save = () => {
    const newName = inp.value.trim();
    if(!newName){ toast('Введите название'); return; }
    if(newName !== tag && DB.incomeTags.includes(newName)){ toast('Уже существует'); return; }
    // Update tag on all income entries (+ штамп, чтобы rename пережил LWW-merge)
    const now = Date.now();
    (DB.incomes||[]).forEach(inc => { if(inc.tag === tag){ inc.tag = newName; inc.updatedAt = now; } });
    DB.incomeTags[i] = newName;
    touchList('incomeTags');
    // Патчим слот в порядке списания на новое имя, чтобы rename не сбрасывал приоритет в конец
    if(DB.incomeTagOrder){
      const oi = DB.incomeTagOrder.indexOf(tag);
      if(oi >= 0) DB.incomeTagOrder[oi] = newName;
    }
    touchList('incomeTagOrder');
    saveDB();
    renderIncomeTagsList();
    renderIncomeTagOrderList();
  };
```

Find (currently line 6412-6425):
```javascript
function addIncomeTag(){
  const inp = document.getElementById('new-income-tag-input');
  const name = inp.value.trim();
  if(!name){ toast('Введите название'); return; }
  if(!DB.incomeTags) DB.incomeTags = [];
  if(DB.incomeTags.includes(name)){ toast('Уже существует'); return; }
  DB.incomeTags.push(name);
  touchList('incomeTags');
  saveDB();
  inp.value = '';
  renderIncomeTagsList();
  renderSettings();
  toast('Тег добавлен: ' + name);
}
```
Replace with:
```javascript
function addIncomeTag(){
  const inp = document.getElementById('new-income-tag-input');
  const name = inp.value.trim();
  if(!name){ toast('Введите название'); return; }
  if(!DB.incomeTags) DB.incomeTags = [];
  if(DB.incomeTags.includes(name)){ toast('Уже существует'); return; }
  DB.incomeTags.push(name);
  touchList('incomeTags');
  if(!DB.incomeTagOrder) DB.incomeTagOrder = [];
  DB.incomeTagOrder.push(name); // новый тег — низший приоритет списания по умолчанию
  touchList('incomeTagOrder');
  saveDB();
  inp.value = '';
  renderIncomeTagsList();
  renderIncomeTagOrderList();
  renderSettings();
  toast('Тег добавлен: ' + name);
}
```

- [ ] **Step 4: Syntax check**

Run the Global Constraints syntax one-liner. Expected: `syntax OK`.

- [ ] **Step 5: Puppeteer check — drag actually reorders and persists**

Create `C:\Users\AANISI~1\AppData\Local\Temp\claude\C--Users-aanisimov-code-nto\48b9aaae-d58c-4b33-b935-17f446234224\scratchpad\test-drag-order.js`:
```javascript
const puppeteer = require('puppeteer-core');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3 });
  const url = 'file://' + path.resolve(__dirname, '../../../nto/index.html').replace(/\\/g, '/');
  await page.goto(url);

  const db = {
    categories: ['Еда'], catIds: ['c1'], catColors: {0:'#185fa5'},
    expenses: [], incomes: [], banks: ['Сбербанк'], creditBanks: [], limits: {},
    incomeTags: ['A','B','C'], incomeTagColors: {}, incomeTagOrder: ['', 'A', 'B', 'C'],
  };
  await page.evaluate((dbJson) => localStorage.setItem('budgetDB_v2', dbJson), JSON.stringify(db));
  await page.reload();

  await page.evaluate(() => openIncomeTagsManager());
  await new Promise(r => setTimeout(r, 100));

  // Перетащить первую строку («Без тега») на место третьей («B»)
  const rects = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#income-tag-order-list .io-row')];
    return rows.map(r => r.getBoundingClientRect().toJSON());
  });
  const fromHandleX = rects[0].x + 10, fromY = rects[0].y + rects[0].height/2;
  const toY = rects[2].y + rects[2].height/2;

  await page.mouse.move(fromHandleX, fromY);
  await page.mouse.down();
  await page.mouse.move(fromHandleX, (fromY+toY)/2, { steps: 5 });
  await page.mouse.move(fromHandleX, toY + 5, { steps: 5 });
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 100));

  const finalOrder = await page.evaluate(() => DB.incomeTagOrder);
  if (finalOrder[0] === '') throw new Error('FAIL: drag did not move "Без тега" — order: ' + JSON.stringify(finalOrder));
  if (!finalOrder.includes('')) throw new Error('FAIL: "" dropped from order entirely — order: ' + JSON.stringify(finalOrder));
  console.log('OK: drag reordered and persisted to DB.incomeTagOrder =', JSON.stringify(finalOrder));

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
```

Run (`npm install puppeteer-core` in scratchpad first if not already done):
```bash
node test-drag-order.js
```
Expected: `OK: drag reordered and persisted to DB.incomeTagOrder = [...]` with `''` no longer first.

- [ ] **Step 6: Commit**
```bash
git add index.html
git commit -m "feat(income): drag-reorderable «Порядок списания» in tags manager"
```

---

## Task 4: Delete-tag reassignment modal

**Files:**
- Modify: `index.html` — new `modal-delete-income-tag` overlay, inserted immediately after `modal-income-tags` closes (after Task 3's edits, still right before the `<!-- MODAL: SCRIPT VIEWER -->` comment)
- Modify: `index.html:6427-6448` (`deleteIncomeTag` — replaced)

**Interfaces:**
- Consumes (from Task 1/3): `touchList`, `saveDB`, `renderIncomeTagsList`, `renderIncomeTagOrderList`, `renderSettings`, `esc`, `toast`, `openModal`, `closeModal`.
- Produces: `deleteIncomeTag(i)` (same signature/call sites as before — row's `✕` button, `index.html:6365`), `_renderDelIncTagAction()`, `confirmDeleteIncomeTag()`, `_removeIncomeTagAt(i, destTag)`.

- [ ] **Step 1: Add the modal HTML**

Find, in `index.html` (after Task 3's edit, this is the closing `</div>` of `modal-income-tags` followed by the script-viewer modal comment):
```html
    <div class="btn-row" style="margin-top:8px"><button class="btn primary" onclick="closeModal('modal-income-tags')">Готово</button></div>
  </div>
</div>

<!-- MODAL: SCRIPT VIEWER -->
```
Replace with:
```html
    <div class="btn-row" style="margin-top:8px"><button class="btn primary" onclick="closeModal('modal-income-tags')">Готово</button></div>
  </div>
</div>

<!-- MODAL: DELETE INCOME TAG — REASSIGN AFFECTED INCOMES -->
<div class="overlay" id="modal-delete-income-tag">
  <div class="sheet" style="position:relative">
    <button class="close-btn" onclick="closeModal('modal-delete-income-tag')">✕</button>
    <h2 id="del-inc-tag-title">Удалить тег</h2>
    <div class="fgrp">
      <label class="setting-row" style="cursor:pointer;gap:8px;margin-bottom:6px">
        <input type="radio" name="del-inc-tag-action" value="move" onchange="_renderDelIncTagAction()" style="width:18px;height:18px;flex-shrink:0;padding:0;margin:0;accent-color:var(--accent);-webkit-appearance:radio;appearance:auto"/>
        <span style="flex:1">Перенести на другой тег</span>
      </label>
      <select id="del-inc-tag-move-select" class="finp" style="margin:0 0 10px"></select>
      <label class="setting-row" style="cursor:pointer;gap:8px;margin-bottom:6px">
        <input type="radio" name="del-inc-tag-action" value="new" onchange="_renderDelIncTagAction()" style="width:18px;height:18px;flex-shrink:0;padding:0;margin:0;accent-color:var(--accent);-webkit-appearance:radio;appearance:auto"/>
        <span style="flex:1">Создать новый тег</span>
      </label>
      <input type="text" id="del-inc-tag-new-input" placeholder="Название тега" style="margin:0 0 10px"/>
      <label class="setting-row" style="cursor:pointer;gap:8px">
        <input type="radio" name="del-inc-tag-action" value="none" checked onchange="_renderDelIncTagAction()" style="width:18px;height:18px;flex-shrink:0;padding:0;margin:0;accent-color:var(--accent);-webkit-appearance:radio;appearance:auto"/>
        <span style="flex:1">Оставить без тега</span>
      </label>
    </div>
    <div class="btn-row" style="margin-top:8px">
      <button class="btn" onclick="closeModal('modal-delete-income-tag')">Отмена</button>
      <button class="btn danger" onclick="confirmDeleteIncomeTag()">Удалить</button>
    </div>
  </div>
</div>

<!-- MODAL: SCRIPT VIEWER -->
```

- [ ] **Step 2: Replace `deleteIncomeTag` with the modal-opening flow + confirm/apply logic**

Find (currently line 6427-6448):
```javascript
function deleteIncomeTag(i){
  const tag = (DB.incomeTags||[])[i];
  if(!tag) return;
  const tagged = (DB.incomes||[]).filter(inc => !inc._deleted && inc.tag === tag).length;
  if(tagged && !confirm('Удалить тег «' + tag + '»?\n' + tagged + ' доход(ов) останутся без тега.')) return;
  const now = Date.now();
  (DB.incomes||[]).forEach(inc => { if(inc.tag === tag){ inc.tag = ''; inc.updatedAt = now; } });
  DB.incomeTags.splice(i, 1);
  touchList('incomeTags');
  // Remap color indices: shift keys above i down by 1
  const newColors = {};
  Object.entries(DB.incomeTagColors||{}).forEach(([k,v]) => {
    const ki = parseInt(k);
    if(ki < i) newColors[ki] = v;
    else if(ki > i) newColors[ki-1] = v;
  });
  DB.incomeTagColors = newColors;
  saveDB();
  renderIncomeTagsList();
  renderSettings();
  toast('Удалено: ' + tag);
}
```
Replace with:
```javascript
let _deletingIncomeTagIdx = null;

function deleteIncomeTag(i){
  const tag = (DB.incomeTags||[])[i];
  if(!tag) return;
  const tagged = (DB.incomes||[]).filter(inc => !inc._deleted && inc.tag === tag).length;
  if(!tagged){
    _removeIncomeTagAt(i, '');
    toast('Удалено: ' + tag);
    return;
  }
  _deletingIncomeTagIdx = i;
  document.getElementById('del-inc-tag-title').textContent = 'Удалить тег «' + tag + '» — ' + tagged + ' доход(ов)';
  const otherTags = (DB.incomeTags||[]).filter((t, ti) => ti !== i);
  document.getElementById('del-inc-tag-move-select').innerHTML =
    otherTags.map(t => '<option value="'+esc(t)+'">'+esc(t)+'</option>').join('');
  document.getElementById('del-inc-tag-new-input').value = '';
  document.querySelector('input[name="del-inc-tag-action"][value="none"]').checked = true;
  _renderDelIncTagAction();
  openModal('modal-delete-income-tag');
}

// Показывает только поле, относящееся к выбранному радио-варианту
function _renderDelIncTagAction(){
  const action = document.querySelector('input[name="del-inc-tag-action"]:checked').value;
  document.getElementById('del-inc-tag-move-select').style.display = action === 'move' ? '' : 'none';
  document.getElementById('del-inc-tag-new-input').style.display = action === 'new' ? '' : 'none';
}

function confirmDeleteIncomeTag(){
  const i = _deletingIncomeTagIdx;
  const tag = (DB.incomeTags||[])[i];
  if(tag == null) return;
  const action = document.querySelector('input[name="del-inc-tag-action"]:checked').value;
  let destTag = '';
  if(action === 'move'){
    destTag = document.getElementById('del-inc-tag-move-select').value;
    if(!destTag){ toast('Выберите тег'); return; }
  } else if(action === 'new'){
    const name = document.getElementById('del-inc-tag-new-input').value.trim();
    if(!name){ toast('Введите название'); return; }
    if(DB.incomeTags.includes(name)){ toast('Уже существует'); return; }
    DB.incomeTags.push(name);
    destTag = name;
  }
  _removeIncomeTagAt(i, destTag);
  closeModal('modal-delete-income-tag');
  _deletingIncomeTagIdx = null;
  toast('Удалено: ' + tag + (destTag ? ', доходы → ' + destTag : ''));
}

// Общий хвост удаления тега (i — индекс в DB.incomeTags ДО splice):
// перевешивает затронутые доходы на destTag ('' = без тега), удаляет тег,
// ремапит цвета по индексу (как раньше), чинит слот в порядке списания —
// заменяет его на destTag, если у того ещё нет своего слота, иначе просто
// убирает слот удалённого тега (дублей быть не должно; '' всегда уже имеет
// свой слот благодаря _incomeTagWriteoffOrder, так что «оставить без тега»
// корректно падает в ветку «просто убрать слот»).
function _removeIncomeTagAt(i, destTag){
  const tag = DB.incomeTags[i];
  const now = Date.now();
  (DB.incomes||[]).forEach(inc => { if(inc.tag === tag){ inc.tag = destTag; inc.updatedAt = now; } });
  DB.incomeTags.splice(i, 1);
  touchList('incomeTags');
  const newColors = {};
  Object.entries(DB.incomeTagColors||{}).forEach(([k,v]) => {
    const ki = parseInt(k);
    if(ki < i) newColors[ki] = v;
    else if(ki > i) newColors[ki-1] = v;
  });
  DB.incomeTagColors = newColors;
  if(DB.incomeTagOrder){
    const destHasSlot = DB.incomeTagOrder.includes(destTag);
    DB.incomeTagOrder = DB.incomeTagOrder
      .map(t => t === tag ? (destHasSlot ? null : destTag) : t)
      .filter(t => t !== null);
  }
  touchList('incomeTagOrder');
  saveDB();
  renderIncomeTagsList();
  renderIncomeTagOrderList();
  renderSettings();
}
```

- [ ] **Step 3: Syntax check**

Run the Global Constraints syntax one-liner. Expected: `syntax OK`.

- [ ] **Step 4: Puppeteer check — all three delete branches**

Create `C:\Users\AANISI~1\AppData\Local\Temp\claude\C--Users-aanisimov-code-nto\48b9aaae-d58c-4b33-b935-17f446234224\scratchpad\test-delete-reassign.js`:
```javascript
const puppeteer = require('puppeteer-core');
const path = require('path');

async function freshPage(browser, db){
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3 });
  const url = 'file://' + path.resolve(__dirname, '../../../nto/index.html').replace(/\\/g, '/');
  await page.goto(url);
  await page.evaluate((dbJson) => localStorage.setItem('budgetDB_v2', dbJson), JSON.stringify(db));
  await page.reload();
  return page;
}

function baseDb(){
  return {
    categories: ['Еда'], catIds: ['c1'], catColors: {0:'#185fa5'},
    expenses: [], banks: ['Сбербанк'], creditBanks: [], limits: {},
    incomeTags: ['A','B'], incomeTagColors: {}, incomeTagOrder: ['', 'A', 'B'],
    incomes: [{id:'i1', date:'2026-08-01', source:'x', amount:100, tag:'A'}],
  };
}

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  });

  // ── radio appearance:auto (CSS gotcha regression guard) ──
  {
    const page = await freshPage(browser, baseDb());
    await page.evaluate(() => deleteIncomeTag(0));
    const appearances = await page.evaluate(() =>
      [...document.querySelectorAll('input[name="del-inc-tag-action"]')].map(r => getComputedStyle(r).appearance));
    if (appearances.some(a => a !== 'auto')) throw new Error('FAIL: radio appearance not auto — ' + JSON.stringify(appearances));
    console.log('OK: radios render (appearance:auto)');
  }

  // ── move to existing tag ──
  {
    const page = await freshPage(browser, baseDb());
    await page.evaluate(() => deleteIncomeTag(0)); // tag 'A', index 0
    await page.select('#del-inc-tag-move-select', 'B');
    await page.click('input[name="del-inc-tag-action"][value="move"]');
    await page.evaluate(() => confirmDeleteIncomeTag());
    const state = await page.evaluate(() => ({ tags: DB.incomeTags, incTag: DB.incomes[0].tag, order: DB.incomeTagOrder }));
    if (state.tags.includes('A')) throw new Error('FAIL: tag A still present: ' + JSON.stringify(state));
    if (state.incTag !== 'B') throw new Error('FAIL: income not reassigned to B: ' + JSON.stringify(state));
    if (state.order.includes('A')) throw new Error('FAIL: order still has A: ' + JSON.stringify(state));
    console.log('OK: move-to-existing-tag branch — ', JSON.stringify(state));
  }

  // ── create new tag ──
  {
    const page = await freshPage(browser, baseDb());
    await page.evaluate(() => deleteIncomeTag(0));
    await page.click('input[name="del-inc-tag-action"][value="new"]');
    await page.type('#del-inc-tag-new-input', 'Кешбек');
    await page.evaluate(() => confirmDeleteIncomeTag());
    const state = await page.evaluate(() => ({ tags: DB.incomeTags, incTag: DB.incomes[0].tag, order: DB.incomeTagOrder }));
    if (!state.tags.includes('Кешбек')) throw new Error('FAIL: new tag not created: ' + JSON.stringify(state));
    if (state.incTag !== 'Кешбек') throw new Error('FAIL: income not reassigned to new tag: ' + JSON.stringify(state));
    if (!state.order.includes('Кешбек')) throw new Error('FAIL: order missing new tag: ' + JSON.stringify(state));
    console.log('OK: create-new-tag branch — ', JSON.stringify(state));
  }

  // ── leave without tag (default) ──
  {
    const page = await freshPage(browser, baseDb());
    await page.evaluate(() => deleteIncomeTag(0));
    await page.evaluate(() => confirmDeleteIncomeTag()); // default radio = 'none'
    const state = await page.evaluate(() => ({ tags: DB.incomeTags, incTag: DB.incomes[0].tag, order: DB.incomeTagOrder }));
    if (state.incTag !== '') throw new Error('FAIL: income not left untagged: ' + JSON.stringify(state));
    if (state.order.filter(t => t === '').length !== 1) throw new Error('FAIL: "" slot duplicated or missing: ' + JSON.stringify(state));
    console.log('OK: leave-untagged branch — ', JSON.stringify(state));
  }

  // ── zero affected incomes — no modal, immediate delete ──
  {
    const db = baseDb(); db.incomes = [];
    const page = await freshPage(browser, db);
    await page.evaluate(() => deleteIncomeTag(0));
    const isModalOpen = await page.evaluate(() => document.getElementById('modal-delete-income-tag').classList.contains('open'));
    const state = await page.evaluate(() => DB.incomeTags);
    if (isModalOpen) throw new Error('FAIL: modal opened despite 0 affected incomes');
    if (state.includes('A')) throw new Error('FAIL: tag A not deleted immediately: ' + JSON.stringify(state));
    console.log('OK: zero-affected-incomes branch deletes immediately, no modal');
  }

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
```

(`openModal(id)`/`closeModal(id)` toggle a plain `.open` class on the overlay — `index.html:1634-1635` — so `classList.contains('open')` is the correct check as written.)

Run (`npm install puppeteer-core` in scratchpad first if not already done):
```bash
node test-delete-reassign.js
```
Expected: five `OK:` lines, no thrown errors.

- [ ] **Step 5: Commit**
```bash
git add index.html
git commit -m "feat(income): delete-tag modal — reassign to existing/new tag or leave untagged"
```

---

## Task 5: Docs + version bump + final smoke test

**Files:**
- Modify: `CLAUDE.md:72-74` (DB schema block)
- Modify: `CLAUDE.md:133` (What syncs list)
- Modify: `index.html` (About block version string, search `v1.`)
- Modify: `sw.js` (`const V`)

**Interfaces:** none (docs + version metadata only).

- [ ] **Step 1: Update CLAUDE.md DB schema block**

Find (currently line 72-74):
```
  incomeTags:      ['Оплата труда', ...],     // income source tag names
  incomeTagColors: {0: '#185fa5', ...},       // tag index → hex color
  listsMeta:       {categories: 1234567890},  // list name → updatedAt ms; LWW-merge for categories/banks/creditBanks/incomeTags (call touchList(name) on every list mutation)
```
Replace with:
```
  incomeTags:      ['Оплата труда', ...],     // income source tag names
  incomeTagColors: {0: '#185fa5', ...},       // tag index → hex color
  incomeTagOrder:  ['', 'Проценты', ...],     // write-off priority for «Из чего накоплено» (top→bottom = spent first); '' = «Без тега»; independent of incomeTags' own order — see _incomeTagWriteoffOrder()
  listsMeta:       {categories: 1234567890},  // list name → updatedAt ms; LWW-merge for categories/banks/creditBanks/incomeTags/incomeTagOrder (call touchList(name) on every list mutation)
```

- [ ] **Step 2: Update CLAUDE.md sync "What syncs" list**

Find (currently line 133):
```
**What syncs (both directions):** `expenses`, `incomes`, `assets`, `goals`, `templates`, `deposits`, `credits`, `categories`, `catColors`, `banks`, `creditBanks`, `limits`, `incomeTags`, `incomeTagColors`, plus `listsMeta` (LWW timestamps).
```
Replace with:
```
**What syncs (both directions):** `expenses`, `incomes`, `assets`, `goals`, `templates`, `deposits`, `credits`, `categories`, `catColors`, `banks`, `creditBanks`, `limits`, `incomeTags`, `incomeTagColors`, `incomeTagOrder`, plus `listsMeta` (LWW timestamps).
```

- [ ] **Step 3: Version bump**

In `index.html`, find the About block version string (search `v1.` — currently `v1.45.2`, per the deposit-close fix earlier this session) and bump to `v1.46.0`.

In `sw.js`, find `const V = '...'` and bump to match, e.g.:
```javascript
const V = '2026-08-11 v1.46.0';
```

- [ ] **Step 4: Full syntax check**

Run the Global Constraints syntax one-liner. Expected: `syntax OK`.

- [ ] **Step 5: Re-run all three prior test scripts against the final file**

```bash
node "C:\Users\AANISI~1\AppData\Local\Temp\claude\C--Users-aanisimov-code-nto\48b9aaae-d58c-4b33-b935-17f446234224\scratchpad\test-income-tag-order.js" "C:\Users\aanisimov\code\nto\index.html"
```
Expected: `OK: all income-tag-order tests passed`

```bash
node "C:\Users\AANISI~1\AppData\Local\Temp\claude\C--Users-aanisimov-code-nto\48b9aaae-d58c-4b33-b935-17f446234224\scratchpad\test-savings-order.js"
```
Expected: `OK: savings breakdown honors incomeTagOrder`

```bash
node "C:\Users\AANISI~1\AppData\Local\Temp\claude\C--Users-aanisimov-code-nto\48b9aaae-d58c-4b33-b935-17f446234224\scratchpad\test-drag-order.js"
```
Expected: `OK: drag reordered and persisted...`

```bash
node "C:\Users\AANISI~1\AppData\Local\Temp\claude\C--Users-aanisimov-code-nto\48b9aaae-d58c-4b33-b935-17f446234224\scratchpad\test-delete-reassign.js"
```
Expected: five `OK:` lines.

- [ ] **Step 6: Commit**
```bash
git add index.html sw.js CLAUDE.md
git commit -m "chore: v1.46.0 — docs + version bump for income tag order/delete feature"
```

- [ ] **Step 7: Push** (only after user confirms — matches this session's established deploy pattern of asking before push)
```bash
git push
```

---

## Self-Review Notes

- **Spec coverage:** Data model (Task 1), UI section + drag (Task 3), delete-with-reassignment (Task 4), `_savingsBreakdownHtml` consumer (Task 2), sync (Task 1 Step 3), docs/version (Task 5) — every spec section has a task.
- **CSS radio gotcha:** applied inline `appearance:auto` override to all 3 new radios in Task 4, with a regression-guard assertion in the puppeteer test (per `[[css-checkbox-appearance-gotcha]]` memory).
- **Type/signature consistency checked:** `_incomeTagWriteoffOrder()` (Task 1) used identically in Task 2 and Task 3; `renderIncomeTagOrderList()` (Task 3) called from Task 3's own CRUD edits and from Task 4's `_removeIncomeTagAt` — same zero-arg signature throughout.
- **`openModal`'s "is open" marker verified**: `index.html:1634-1635` confirms `.open` class toggle, matching Task 4 Step 4's zero-incomes test assertion.

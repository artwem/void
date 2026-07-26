# Раздел «Инвестиции» — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Учёт брокерских счетов/ИИС: ручные снимки стоимости + журнал пополнений/выводов, прибыль ₽/%, интеграция в «Всего активов», график, историю, sync, Excel, аудит.

**Architecture:** Новый массив `DB.investments` (soft-delete + LWW-sync, как `deposits`). Стоимость = последний снимок ≤ даты + пополнения после него. Sub-page `page-investments` по образцу `page-deposits`. Все правки — в `index.html` (единственный источник; `js/*.js` stale, не трогать). Спека: `docs/superpowers/specs/2026-07-26-investments-design.md`.

**Tech Stack:** vanilla JS inline в `index.html`, без build-шага. Проверка синтаксиса — node-однострочник из CLAUDE.md. Ручной тест в браузере (`python3 -m http.server 8080`).

## Global Constraints

- Править ТОЛЬКО `index.html` (+ `sw.js` при деплое). `js/*.js`, `pages.html`, `modals.html` — stale, не трогать.
- Все денежные значения в innerHTML — через `fmtH()`; пользовательские строки — через `esc()`.
- Каждая мутация записи стампует `updatedAt: Date.now()`; удаления — soft (`_deleted: true`).
- После каждой задачи: parse-check `node -e "const html=require('fs').readFileSync('index.html','utf8');const re=/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g;let m,ok=true;while((m=re.exec(html))){try{new Function(m[1])}catch(e){ok=false;console.log('FAIL:',e.message)}};console.log(ok?'syntax OK':'ERRORS')"` → `syntax OK`.
- Версия релиза: **v1.32.0** (About в `index.html:1051`, `const V` в `sw.js:5`) — бампается в последней задаче, не раньше.
- CSS не меняем (инлайн-стили, как в существующих карточках) → `?v=` у `app.css` не трогаем.

---

### Task 1: Данные + движок стоимости + sync

**Files:**
- Modify: `index.html:1220` (loadDB defaults), `index.html:1236` (purge list), `index.html:6738` (mergePullData), `═══ assets.js ═══` секция — движок рядом с `_depDelDay` (~`index.html:4016`)

**Interfaces:**
- Produces: `invValueAt(inv, dateStr) -> number` (0 до первого снимка), `invInvested(inv, dateStr?) -> number` (Σ contributions ≤ даты, выводы отрицательные), `_invSnapDates(inv) -> string[]` (отсортированные даты снимков). Схема записи: `{id, name, snapshots:{'YYYY-MM-DD':number}, contributions:[{id,date,amount,updatedAt?}], updatedAt, _deleted?}`.
- Consumes: `_depDelDay(d)` — generic (читает только `_deleted`/`updatedAt`), переиспользуем для инвестиций без изменений.

- [ ] **Step 1: loadDB — дефолт и purge**

В `index.html:1220` после `if(!DB.deposits) DB.deposits = [];` добавить:
```js
  if(!DB.investments) DB.investments = [];
```
В `index.html:1236` список purge расширить:
```js
  ['expenses','incomes','assets','goals','templates','deposits','investments'].forEach(k => {
```

- [ ] **Step 2: mergePullData — LWW по id**

В `index.html:6738`:
```js
  ['expenses','incomes','assets','goals','templates','deposits','investments'].forEach(key => {
```
`buildPayload` шлёт весь DB — правок не требует. `Code.gs` generic — не трогаем.

- [ ] **Step 3: движок стоимости**

В секции `═══ assets.js ═══`, после `_depDelDay` (`index.html:4020`), вставить:
```js
// ── Инвестиции: снимки стоимости + пополнения/выводы ────────────────
// Стоимость на дату = последний снимок ≤ даты + пополнения ПОСЛЕ него.
// Пополнение видно сразу без нового снимка; следующий снимок перебазирует.
function _invSnapDates(inv){ return Object.keys(inv.snapshots||{}).sort(); }

function invValueAt(inv, dateStr){
  const past = _invSnapDates(inv).filter(ds=>ds<=dateStr);
  if(!past.length) return 0;               // до первого снимка счёта нет
  const base = past[past.length-1];
  const later = (inv.contributions||[]).filter(c=>c.date>base && c.date<=dateStr)
    .reduce((s,c)=>s+c.amount,0);
  return Math.round((inv.snapshots[base]||0) + later);
}

// Вложено = Σ пополнений − выводы (amount<0) на дату
function invInvested(inv, dateStr){
  const cut = dateStr || today();
  return (inv.contributions||[]).filter(c=>c.date<=cut).reduce((s,c)=>s+c.amount,0);
}
```

- [ ] **Step 4: parse-check** → `syntax OK`

- [ ] **Step 5: Commit** `feat(invest): модель данных, движок стоимости, sync`

---

### Task 2: HTML — страница, кнопка, модалки

**Files:**
- Modify: `index.html:289-294` (кнопка на Активах), `index.html:256` (строка-расшифровка), `index.html:410` (после `page-deposits` — новая страница), `index.html:837` (после `modal-dep-contrib` — три модалки), `index.html:1489` (`showPage`)

**Interfaces:**
- Produces: DOM ids: `page-investments`, `investments-list`, `investments-total-now`, `invest-btn-count`, `total-deps-wrap`, `total-inv-wrap`, `total-inv-val`, `modal-investment` (`invest-modal-title`, `invest-name`, `invest-create-grp`, `invest-date`, `invest-invested`, `invest-value`, `inv-snaps-grp`, `inv-snaps-list`, `inv-contribs-grp`, `inv-contribs-list`, `invest-delete-btn`), `modal-inv-snap` (`inv-snap-info`, `inv-snap-date`, `inv-snap-value`), `modal-inv-contrib` (`inv-contrib-title`, `inv-contrib-info`, `inv-contrib-date`, `inv-contrib-amount`, `inv-contrib-bank`, `inv-contrib-bank-lbl`, `inv-contrib-bank-hint`, `inv-contrib-save`). Обработчики (реализуются в Task 3): `renderInvestments, openInvestModal, saveInvestment, deleteInvestment, openInvSnapshot, saveInvSnapshot, openInvContribution, saveInvContribution`.
- Consumes: `showPage`, `openModal`/`closeModal`, `formatMoneyInput`.

- [ ] **Step 1: строка-расшифровка под «Всего активов»**

`index.html:256` заменить целиком на:
```html
  <div id="total-with-deps" style="display:none;text-align:right;font-size:12px;color:var(--muted);padding:0 16px;margin:-2px 0 10px">счета <span id="total-banks-val"></span><span id="total-deps-wrap"> · вклады <span id="total-deps-val"></span></span><span id="total-inv-wrap"> · инвест <span id="total-inv-val"></span></span></div>
```

- [ ] **Step 2: кнопка «Мои инвестиции»**

После блока кнопки «Мои вклады» (`index.html:289-294`), внутри того же `<div style="padding:8px 16px 0">` добавить вторую кнопку (div станет `display:flex;flex-direction:column;gap:8px`):
```html
    <button class="btn" style="width:100%;display:flex;align-items:center;justify-content:center;gap:8px" onclick="showPage('investments')">
      <svg width="18" height="18" viewBox="0 0 22 22" fill="none"><path d="M3 18L8 12l3 3 7-8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 7h4v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Мои инвестиции<span id="invest-btn-count" style="color:var(--muted);font-weight:400"></span>
    </button>
```

- [ ] **Step 3: страница**

После `</div>` страницы `page-deposits` (`index.html:410`) вставить:
```html
<!-- PAGE: INVESTMENTS -->
<div id="page-investments" class="page">
  <div class="hdr" style="display:flex;align-items:center;gap:10px">
    <button onclick="showPage('assets',document.getElementById('nav-assets'))" aria-label="Назад к активам" style="background:none;border:none;color:var(--text);font-size:24px;line-height:1;cursor:pointer;padding:2px 6px 4px 0;font-family:inherit">‹</button>
    <div><h1>Инвестиции</h1><div class="hdr-sub">Брокер и ИИС</div></div>
  </div>
  <div class="total-bar"><span class="total-lbl">Стоимость сейчас</span><span class="total-val" id="investments-total-now">0 ₽</span></div>
  <div class="sec-hdr"><span class="sec-title">Счета</span><span class="sec-action" onclick="openInvestModal()">+ Добавить</span></div>
  <div id="investments-list" style="padding:0 16px 8px"></div>
  <div class="page-end"></div>
</div>
```

- [ ] **Step 4: модалки**

После `modal-dep-contrib` (`index.html:837`) вставить:
```html
<div class="overlay" id="modal-investment">
  <div class="sheet" style="position:relative">
    <button class="close-btn" onclick="closeModal('modal-investment')">✕</button>
    <h2 id="invest-modal-title" style="margin-bottom:16px">Новый счёт</h2>
    <div class="fgrp">
      <label class="flbl">Название</label>
      <input type="text" id="invest-name" class="finp" placeholder="Т-Инвестиции, ИИС ВТБ…">
    </div>
    <div id="invest-create-grp">
      <div class="fgrp">
        <label class="flbl">Дата</label>
        <input type="date" id="invest-date" class="finp">
      </div>
      <div class="fgrp">
        <label class="flbl">Вложено всего, ₽</label>
        <input type="text" id="invest-invested" class="finp" inputmode="decimal" placeholder="500 000" oninput="formatMoneyInput(this)">
        <div style="font-size:11px;color:var(--muted);margin-top:4px">Сколько денег ты занёс за всё время — от этого считается прибыль</div>
      </div>
      <div class="fgrp">
        <label class="flbl">Стоимость сейчас, ₽</label>
        <input type="text" id="invest-value" class="finp" inputmode="decimal" placeholder="560 000" oninput="formatMoneyInput(this)">
      </div>
    </div>
    <div class="fgrp" id="inv-snaps-grp" style="display:none">
      <label class="flbl">Снимки стоимости</label>
      <div id="inv-snaps-list" style="font-size:13px;max-height:180px;overflow-y:auto"></div>
    </div>
    <div class="fgrp" id="inv-contribs-grp" style="display:none">
      <label class="flbl">Пополнения и выводы</label>
      <div id="inv-contribs-list" style="font-size:13px;max-height:180px;overflow-y:auto"></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn danger" id="invest-delete-btn" onclick="deleteInvestment()" style="display:none">Удалить</button>
      <button class="btn primary" onclick="saveInvestment()" style="flex:1">Сохранить</button>
    </div>
  </div>
</div>

<div class="overlay" id="modal-inv-snap">
  <div class="sheet" style="position:relative">
    <button class="close-btn" onclick="closeModal('modal-inv-snap')">✕</button>
    <h2>Обновить стоимость</h2>
    <p id="inv-snap-info" style="font-size:13px;color:var(--muted);margin:4px 0 12px"></p>
    <div class="fgrp">
      <label class="flbl">Дата</label>
      <input type="date" id="inv-snap-date" class="finp">
    </div>
    <div class="fgrp">
      <label class="flbl">Стоимость счёта, ₽</label>
      <input type="text" id="inv-snap-value" class="finp" inputmode="decimal" placeholder="575 000" oninput="formatMoneyInput(this)">
    </div>
    <div class="btn-row">
      <button class="btn" onclick="closeModal('modal-inv-snap')">Отмена</button>
      <button class="btn primary" onclick="saveInvSnapshot()">Сохранить</button>
    </div>
  </div>
</div>

<div class="overlay" id="modal-inv-contrib">
  <div class="sheet" style="position:relative">
    <button class="close-btn" onclick="closeModal('modal-inv-contrib')">✕</button>
    <h2 id="inv-contrib-title">Пополнить счёт</h2>
    <p id="inv-contrib-info" style="font-size:13px;color:var(--muted);margin:4px 0 12px"></p>
    <div class="fgrp">
      <label class="flbl">Дата</label>
      <input type="date" id="inv-contrib-date" class="finp">
    </div>
    <div class="fgrp">
      <label class="flbl">Сумма, ₽</label>
      <input type="text" id="inv-contrib-amount" class="finp" inputmode="decimal" placeholder="50 000" oninput="formatMoneyInput(this)">
    </div>
    <div class="fgrp">
      <label class="flbl" id="inv-contrib-bank-lbl">Списать из банка</label>
      <select id="inv-contrib-bank" class="finp"></select>
      <div style="font-size:11px;color:var(--muted);margin-top:4px" id="inv-contrib-bank-hint">Баланс банка уменьшится записью на эту дату</div>
    </div>
    <div class="btn-row">
      <button class="btn" onclick="closeModal('modal-inv-contrib')">Отмена</button>
      <button class="btn primary" id="inv-contrib-save" onclick="saveInvContribution()">Пополнить</button>
    </div>
  </div>
</div>
```

- [ ] **Step 5: showPage**

`index.html:1489` — добавить `'investments'` в условие подсветки Активов:
```js
  else if(name==='calc'||name==='deposits'||name==='investments'){ const nb=document.getElementById('nav-assets'); if(nb) nb.classList.add('active'); }
```
И после `if(name==='deposits') renderDeposits();` (`index.html:1504`):
```js
  if(name==='investments') renderInvestments();
```

- [ ] **Step 6: parse-check** → `syntax OK` (обработчики Task 3 ещё не существуют — onclick-строки не парсятся node-чеком, это ок)

- [ ] **Step 7: Commit** `feat(invest): страница, кнопка, модалки`

---

### Task 3: Логика страницы — CRUD, снимки, пополнения/выводы

**Files:**
- Modify: `═══ assets.js ═══` — после блока deposit-функций (после `_renderDepContribsList`, ~`index.html:4330`)

**Interfaces:**
- Consumes: `invValueAt`, `invInvested`, `_invSnapDates` (Task 1); `_fillSrcBankSelect(id)` (`index.html:4245`) — но с кастомным первым пунктом, поэтому своя обёртка `_fillInvBankSelect`; `_bankAdjust(bankName, date, delta)` (`index.html:4232`); `uid, today, fmt, fmtH, esc, parseMoney, setMoneyInput, toast, toastUndo, openModal, closeModal, _fmtDateRu, saveDB, renderAssets`.
- Produces: `renderInvestments()`, `openInvestModal(id?)`, `saveInvestment()`, `deleteInvestment()`, `openInvSnapshot(id)`, `saveInvSnapshot()`, `deleteInvSnapshot(invId, date)`, `openInvContribution(id, dir)` (`dir: 1|-1`), `saveInvContribution()`, `deleteInvContribution(invId, cid)`.

- [ ] **Step 1: рендер списка счетов**

```js
// ── Инвестиции: страница ────────────────────────────────────────────
function renderInvestments(){
  const list = document.getElementById('investments-list');
  if(!list) return;
  const invs = (DB.investments||[]).filter(v=>!v._deleted).sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  const td = today();
  document.getElementById('investments-total-now').innerHTML = fmtH(invs.reduce((s,v)=>s+invValueAt(v,td),0));
  if(!invs.length){
    list.innerHTML = '<p style="color:var(--muted);font-size:13px;padding:4px 0 8px">Нет счетов — нажмите + чтобы добавить</p>';
    return;
  }
  list.innerHTML = invs.map(v=>{
    const val = invValueAt(v, td);
    const invested = invInvested(v, td);
    const profit = val - invested;
    const pct = invested > 0 ? Math.round(profit/invested*1000)/10 : null;
    const pcol = profit >= 0 ? 'var(--green)' : 'var(--red)';
    const sign = profit >= 0 ? '+' : '−';
    const snaps = _invSnapDates(v);
    const lastSnap = snaps.length ? snaps[snaps.length-1] : null;
    let snapLine = '';
    if(lastSnap){
      const age = Math.floor((new Date(td+'T12:00:00') - new Date(lastSnap+'T12:00:00'))/86400000);
      snapLine = age > 30
        ? `<div style="font-size:11px;color:#c98a1b;margin-top:2px">снимок ${_fmtDateRu(lastSnap)} · обновите стоимость</div>`
        : `<div style="font-size:11px;color:var(--muted);margin-top:2px">снимок ${_fmtDateRu(lastSnap)}</div>`;
    }
    return `<div class="chart-card" style="margin:0 0 10px;padding:14px 16px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;cursor:pointer" onclick="openInvestModal('${esc(v.id)}')">
        <div style="min-width:0">
          <div style="font-weight:600">${esc(v.name)}</div>
          ${snapLine}
        </div>
        <div style="text-align:right;flex-shrink:0;margin-left:10px">
          <div style="font-weight:600">${fmtH(val)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">вложено ${fmtH(invested)}</div>
        </div>
      </div>
      <div style="font-size:12px;color:${pcol};margin-top:6px">${sign} ${fmtH(Math.abs(profit))}${pct!==null ? ' ('+sign+Math.abs(pct)+'%)' : ''}</div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn" style="flex:1;padding:8px 0;font-size:12px" onclick="openInvSnapshot('${esc(v.id)}')">↻ Обновить</button>
        <button class="btn" style="flex:1;padding:8px 0;font-size:12px" onclick="openInvContribution('${esc(v.id)}',1)">+ Пополнить</button>
        <button class="btn" style="flex:1;padding:8px 0;font-size:12px" onclick="openInvContribution('${esc(v.id)}',-1)">− Вывести</button>
      </div>
    </div>`;
  }).join('');
}
```

- [ ] **Step 2: создание/редактирование/удаление**

```js
let _editInvId = null;

function openInvestModal(id){
  _editInvId = id || null;
  const v = id ? (DB.investments||[]).find(x=>x.id===id && !x._deleted) : null;
  document.getElementById('invest-modal-title').textContent = v ? 'Счёт' : 'Новый счёт';
  document.getElementById('invest-name').value = v ? v.name : '';
  document.getElementById('invest-create-grp').style.display = v ? 'none' : '';
  document.getElementById('invest-delete-btn').style.display = v ? '' : 'none';
  if(!v){
    document.getElementById('invest-date').value = today();
    setMoneyInput('invest-invested','');
    setMoneyInput('invest-value','');
    document.getElementById('inv-snaps-grp').style.display='none';
    document.getElementById('inv-contribs-grp').style.display='none';
  } else {
    _renderInvSnapsList(v);
    _renderInvContribsList(v);
  }
  openModal('modal-investment');
}

function saveInvestment(){
  const name = document.getElementById('invest-name').value.trim();
  if(!name){ toast('Введите название'); return; }
  if(_editInvId){
    const v = (DB.investments||[]).find(x=>x.id===_editInvId);
    if(!v) return;
    v.name = name;
    v.updatedAt = Date.now();
  } else {
    const date = document.getElementById('invest-date').value;
    const invested = parseMoney(document.getElementById('invest-invested').value);
    const value = parseMoney(document.getElementById('invest-value').value);
    if(!date){ toast('Укажите дату'); return; }
    if(date > today()){ toast('Дата в будущем'); return; }
    if(!value || value<=0){ toast('Введите стоимость'); return; }
    if(!invested || invested<=0){ toast('Введите вложенную сумму'); return; }
    if(!DB.investments) DB.investments = [];
    DB.investments.push({
      id: uid(), name,
      snapshots: {[date]: value},
      contributions: [{id: uid(), date, amount: invested, updatedAt: Date.now()}],
      updatedAt: Date.now()
    });
  }
  saveDB();
  closeModal('modal-investment');
  _editInvId = null;
  renderInvestments();
  if(typeof renderAssets==='function') renderAssets();
  toast('✓ Сохранено');
}

function deleteInvestment(){
  const v = (DB.investments||[]).find(x=>x.id===_editInvId);
  if(!v) return;
  v._deleted = true;
  v.updatedAt = Date.now();
  saveDB();
  closeModal('modal-investment');
  _editInvId = null;
  renderInvestments();
  if(typeof renderAssets==='function') renderAssets();
  toastUndo('Счёт удалён', ()=>{
    delete v._deleted;
    v.updatedAt = Date.now();
    saveDB(); renderInvestments();
    if(typeof renderAssets==='function') renderAssets();
  });
}
```

- [ ] **Step 3: списки в edit-модалке**

```js
function _renderInvSnapsList(v){
  const grp = document.getElementById('inv-snaps-grp');
  const list = document.getElementById('inv-snaps-list');
  const snaps = _invSnapDates(v);
  grp.style.display = snaps.length ? '' : 'none';
  list.innerHTML = snaps.slice().reverse().map(ds=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0">
    <span style="color:var(--muted)">${_fmtDateRu(ds)}</span>
    <span style="display:flex;align-items:center;gap:10px">${fmtH(v.snapshots[ds])}<span onclick="deleteInvSnapshot('${esc(v.id)}','${ds}')" style="cursor:pointer;color:var(--red);padding:0 4px">✕</span></span>
  </div>`).join('');
}

function deleteInvSnapshot(invId, date){
  const v = (DB.investments||[]).find(x=>x.id===invId);
  if(!v || !v.snapshots) return;
  if(_invSnapDates(v).length <= 1){ toast('Нельзя удалить последний снимок'); return; }
  delete v.snapshots[date];
  v.updatedAt = Date.now();
  saveDB();
  _renderInvSnapsList(v);
  renderInvestments();
  toast('Снимок удалён');
}

function _renderInvContribsList(v){
  const grp = document.getElementById('inv-contribs-grp');
  const list = document.getElementById('inv-contribs-list');
  const cs = (v.contributions||[]);
  grp.style.display = cs.length ? '' : 'none';
  list.innerHTML = cs.slice().reverse().map(c=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0">
    <span style="color:var(--muted)">${_fmtDateRu(c.date)}</span>
    <span style="display:flex;align-items:center;gap:10px"><span style="color:${c.amount<0?'var(--red)':'var(--text)'}">${c.amount<0?'−':'+'} ${fmtH(Math.abs(c.amount))}</span><span onclick="deleteInvContribution('${esc(v.id)}','${esc(c.id)}')" style="cursor:pointer;color:var(--red);padding:0 4px">✕</span></span>
  </div>`).join('');
}

function deleteInvContribution(invId, cid){
  const v = (DB.investments||[]).find(x=>x.id===invId);
  if(!v || !v.contributions) return;
  v.contributions = v.contributions.filter(c=>c.id!==cid);
  v.updatedAt = Date.now();
  saveDB();
  _renderInvContribsList(v);
  renderInvestments();
  toast('Запись удалена');
}
```

- [ ] **Step 4: снимок стоимости**

```js
let _invSnapId = null;

function openInvSnapshot(id){
  const v = (DB.investments||[]).find(x=>x.id===id && !x._deleted);
  if(!v) return;
  _invSnapId = id;
  document.getElementById('inv-snap-info').textContent = v.name+': впиши текущую стоимость из приложения брокера.';
  document.getElementById('inv-snap-date').value = today();
  setMoneyInput('inv-snap-value','');
  openModal('modal-inv-snap');
}

function saveInvSnapshot(){
  const v = (DB.investments||[]).find(x=>x.id===_invSnapId && !x._deleted);
  if(!v) return;
  const date = document.getElementById('inv-snap-date').value;
  const value = parseMoney(document.getElementById('inv-snap-value').value);
  if(!date){ toast('Укажите дату'); return; }
  if(date > today()){ toast('Дата в будущем'); return; }
  if(value===null || value<0){ toast('Введите стоимость'); return; }
  if(!v.snapshots) v.snapshots = {};
  v.snapshots[date] = value;
  v.updatedAt = Date.now();
  saveDB();
  closeModal('modal-inv-snap');
  _invSnapId = null;
  renderInvestments();
  if(typeof renderAssets==='function') renderAssets();
  toast('✓ Стоимость обновлена');
}
```

- [ ] **Step 5: пополнение / вывод**

```js
let _invContribId = null, _invContribDir = 1;

function _fillInvBankSelect(dir){
  const sel = document.getElementById('inv-contrib-bank');
  sel.innerHTML = '<option value="">— '+(dir>0?'не списывать':'не зачислять')+'</option>' +
    (DB.banks||[]).map(b=>`<option value="${esc(b)}">${esc(b)}</option>`).join('');
}

function openInvContribution(id, dir){
  const v = (DB.investments||[]).find(x=>x.id===id && !x._deleted);
  if(!v) return;
  _invContribId = id; _invContribDir = dir;
  document.getElementById('inv-contrib-title').textContent = dir>0 ? 'Пополнить счёт' : 'Вывести со счёта';
  document.getElementById('inv-contrib-info').textContent = v.name;
  document.getElementById('inv-contrib-bank-lbl').textContent = dir>0 ? 'Списать из банка' : 'Зачислить в банк';
  document.getElementById('inv-contrib-bank-hint').textContent = dir>0
    ? 'Баланс банка уменьшится записью на эту дату'
    : 'Баланс банка увеличится записью на эту дату';
  document.getElementById('inv-contrib-save').textContent = dir>0 ? 'Пополнить' : 'Вывести';
  document.getElementById('inv-contrib-date').value = today();
  setMoneyInput('inv-contrib-amount','');
  _fillInvBankSelect(dir);
  openModal('modal-inv-contrib');
}

function saveInvContribution(){
  const v = (DB.investments||[]).find(x=>x.id===_invContribId && !x._deleted);
  if(!v) return;
  const date = document.getElementById('inv-contrib-date').value;
  const amount = parseMoney(document.getElementById('inv-contrib-amount').value);
  if(!date){ toast('Укажите дату'); return; }
  if(date > today()){ toast('Дата в будущем'); return; }
  if(!amount || amount<=0){ toast('Введите сумму'); return; }
  const signed = _invContribDir > 0 ? amount : -amount;
  if(!v.contributions) v.contributions = [];
  v.contributions.push({id:uid(), date, amount: signed, updatedAt: Date.now()});
  v.contributions.sort((a,b)=>a.date.localeCompare(b.date));
  v.updatedAt = Date.now();
  const bank = document.getElementById('inv-contrib-bank').value;
  if(bank) _bankAdjust(bank, date, -signed);
  saveDB();
  closeModal('modal-inv-contrib');
  _invContribId = null;
  renderInvestments();
  if(typeof renderAssets==='function') renderAssets();
  toast('✓ '+(signed>0?'Пополнение ':'Вывод ')+fmt(amount)+(bank?' · '+bank:''));
}
```

- [ ] **Step 6: parse-check** → `syntax OK`; ручной тест в браузере: создать счёт (вложено 500к, стоимость 560к) → карточка «+60 000 (+12%)»; пополнить 50к → стоимость 610к, вложено 550к, прибыль та же; вывести 20к с зачислением в банк → баланс банка +20к.

- [ ] **Step 7: Commit** `feat(invest): страница инвестиций — CRUD, снимки, пополнения/выводы`

---

### Task 4: Интеграция в Активы — итог, строки, серии, график, история

**Files:**
- Modify: `renderAssets` (`index.html:3646-3663` итог/кнопка, `~3734` строки-«вклады», `~3745-3760` график), `_buildAssetSeries` (`index.html:4025-4052`), `renderAssetsHistory` (`index.html:3534+`), сборка rows истории (`index.html:3779`), тумблер (`acd-on` label)

**Interfaces:**
- Consumes: `invValueAt`, `invInvested`, `_invSnapDates`, `_depDelDay` (generic).
- Produces: `_buildAssetSeries()` возвращает `{dates, bankSeries, depSeries, invSeries}`; rows истории получают поле `inv`.

- [ ] **Step 1: итог + расшифровка + счётчик кнопки**

Блок `index.html:3648-3660` заменить на:
```js
  {
    const liveDeps = (DB.deposits||[]).filter(d=>!d._deleted);
    const liveInvs = (DB.investments||[]).filter(v=>!v._deleted);
    const tdN = today();
    const depSumNow = liveDeps.reduce((s,d)=>s+depositValueAt(d,tdN),0);
    const invSumNow = liveInvs.reduce((s,v)=>s+invValueAt(v,tdN),0);
    document.getElementById('total-val').innerHTML = fmtH(total + depSumNow + invSumNow);
    const wdEl = document.getElementById('total-with-deps');
    if(wdEl){
      if(liveDeps.length || liveInvs.length){
        document.getElementById('total-banks-val').innerHTML = fmtH(total);
        document.getElementById('total-deps-val').innerHTML = fmtH(depSumNow);
        document.getElementById('total-inv-val').innerHTML = fmtH(invSumNow);
        document.getElementById('total-deps-wrap').style.display = liveDeps.length ? '' : 'none';
        document.getElementById('total-inv-wrap').style.display = liveInvs.length ? '' : 'none';
        wdEl.style.display = 'block';
      } else wdEl.style.display = 'none';
    }
  }
```
После блока счётчика `deposits-btn-count` (`index.html:3661-3663`) добавить:
```js
  const invCnt = (DB.investments||[]).filter(v=>!v._deleted).length;
  const invBtn = document.getElementById('invest-btn-count');
  if(invBtn) invBtn.textContent = invCnt ? ' · '+invCnt : '';
```

- [ ] **Step 2: read-only строки в «Текущих счетах»**

После блока строк вкладов (`index.html:3711-3734`) добавить аналогичный:
```js
  // Инвестиции — read-only строки с бейджем; клик ведёт на страницу
  {
    const listInvs = (DB.investments||[]).filter(v=>!v._deleted).sort((a,b)=>(a.name||'').localeCompare(b.name||''));
    const tdInv = today();
    listInvs.forEach(v => {
      const val = invValueAt(v, tdInv);
      const invested = invInvested(v, tdInv);
      const profit = val - invested;
      const row = document.createElement('div');
      row.className = 'asset-row';
      row.style.cssText = 'gap:8px;cursor:pointer';
      row.addEventListener('click', ()=>showPage('investments'));
      const namePart = document.createElement('div');
      namePart.style.cssText = 'flex:1;min-width:0';
      const invBadge = ' <span style="font-size:10px;background:rgba(155,89,182,0.15);color:#9b59b6;padding:1px 5px;border-radius:4px;margin-left:4px">инвестиции</span>';
      const pcol = profit >= 0 ? 'var(--green)' : 'var(--red)';
      const subLine = `<div style="font-size:11px;color:${pcol};margin-top:2px">${profit>=0?'+':'−'} ${fmt(Math.abs(profit))}</div>`;
      namePart.innerHTML = `<div class="asset-name">${esc(v.name)}${invBadge}</div>` + subLine;
      const amtSpan = document.createElement('span');
      amtSpan.className = 'asset-amount';
      amtSpan.innerHTML = fmtH(val);
      row.appendChild(namePart);
      row.appendChild(amtSpan);
      list.appendChild(row);
    });
  }
```

- [ ] **Step 3: `_buildAssetSeries` — invSeries + даты снимков в сетке**

Заменить тело `index.html:4025-4052` на:
```js
function _buildAssetSeries(){
  const allBanks = getAllBanks();
  const byDate = {};
  [...DB.assets].filter(a=>!a._deleted).sort((a,b)=>a.date.localeCompare(b.date)).forEach(a=>{
    const key = a.bankName || allBanks[a.bank] || String(a.bank);
    if(!byDate[a.date]) byDate[a.date] = {};
    byDate[a.date][key] = a.amount;
  });
  const histDeps = (DB.deposits||[]).filter(d=>d.openDate);
  const histInvs = (DB.investments||[]).filter(v=>v.snapshots && Object.keys(v.snapshots).length);
  // Сетка дат: снимки банков + снимки инвестиций (вклады свои даты не добавляют — растут непрерывно)
  const dateSet = new Set(Object.keys(byDate));
  histInvs.forEach(v=>{
    const delDay = _depDelDay(v);
    _invSnapDates(v).forEach(ds=>{ if(!(v._deleted && delDay && ds >= delDay)) dateSet.add(ds); });
  });
  const dates = [...dateSet].sort();
  const lastVal = {};
  const bankSeries = [], depSeries = [], invSeries = [];
  dates.forEach(date=>{
    Object.entries(byDate[date]||{}).forEach(([b,amt])=>{ lastVal[b]=amt; });
    let total = 0;
    Object.entries(lastVal).forEach(([bname,amt])=>{
      total += (DB.creditBanks||[]).includes(bname) ? -amt : amt;
    });
    bankSeries.push(Math.round(total));
    depSeries.push(Math.round(histDeps.reduce((s,d)=>{
      if(d.openDate > date) return s;
      const delDay = _depDelDay(d);
      if(d._deleted && (!delDay || date >= delDay)) return s;
      return s + depositValueAt(d, date);
    },0)));
    invSeries.push(Math.round(histInvs.reduce((s,v)=>{
      const delDay = _depDelDay(v);
      if(v._deleted && (!delDay || date >= delDay)) return s;
      return s + invValueAt(v, date);
    },0)));
  });
  return {dates, bankSeries, depSeries, invSeries};
}
```

- [ ] **Step 4: график + тумблер**

В `renderAssets` (`index.html:3745`):
```js
  const {dates: allDates, bankSeries, depSeries, invSeries} = _buildAssetSeries();
```
Условие тумблера (`index.html:3748-3749`):
```js
  const liveDepsCnt = (DB.deposits||[]).filter(x=>!x._deleted).length + (DB.investments||[]).filter(x=>!x._deleted).length;
  const depsOn = localStorage.getItem('assetsChartDeps') === '1' && liveDepsCnt > 0;
```
Данные линии (`index.html:3760`):
```js
  const data = bankSeries.map((v,i)=> v + (depsOn ? depSeries[i] + invSeries[i] : 0));
```
Подпись «on»-половинки тумблера (элемент `acd-on` в разметке Активов): текст заменить с «+вклады» на «+вклады·инвест» (найти `id="acd-on"` в HTML, поправить textContent в разметке).

- [ ] **Step 5: история**

Сборка rows (`index.html:3779`):
```js
    const rows = allDates.map((date, idx) => ({date, banks: bankSeries[idx], deps: depSeries[idx], inv: invSeries[idx], total: bankSeries[idx] + depSeries[idx] + invSeries[idx]}))
```
`renderAssetsHistory` (`index.html:3543-3550`): рядом с `hasDeps` добавить `hasInv`, колонки:
```js
  const hasDeps = rows.some(r => r.deps);
  const hasInv  = rows.some(r => r.inv);
  const cols = [{t:'Дата',a:'left'}];
  if(hasDeps || hasInv) cols.push({t:'Счета',a:'right'});
  if(hasDeps) cols.push({t:'Вклады',a:'right'});
  if(hasInv)  cols.push({t:'Инвест',a:'right'});
  cols.push({t:'Всего',a:'right'},{t:'Δ',a:'right'},{t:'',a:'center'});
```
В теле строк (`index.html:3572+`) — та же схема: ячейка «Счета» при `hasDeps||hasInv`, ячейка «Вклады» при `hasDeps`, новая ячейка «Инвест» при `hasInv` (стиль как у «Вклады», значение `fmtShort(r.inv)` или как соседние — повторить существующий формат ячейки «Вклады»).

- [ ] **Step 6: parse-check** → `syntax OK`; ручной тест: счёт из Task 3 виден в «Текущих счетах» с бейджем, «Всего активов» вырос на стоимость, расшифровка «счета · инвест», график с тумблером включает инвестиции, в истории колонка «Инвест».

- [ ] **Step 7: Commit** `feat(invest): интеграция в Активы — итог, строки, график, история`

---

### Task 5: Excel, аудит, версия, деплой

**Files:**
- Modify: `exportExcel` (`index.html:5810` после листа «Вклады»), `renderDataAudit` (блок «Вклады и даты», `index.html:5405`), About (`index.html:1051`), `sw.js:5`

**Interfaces:**
- Consumes: `invValueAt`, `invInvested`, `_invSnapDates`.

- [ ] **Step 1: лист «Инвестиции»**

После блока листа «Вклады» (`index.html:5810`):
```js
  // ── Инвестиции ───────────────────────────────────────────────────────
  const xInvs = (DB.investments||[]).filter(v=>!v._deleted);
  if(xInvs.length){
    const tdI = today();
    const iHdr = ['Название','Вложено','Стоимость','Прибыль','Прибыль %','Последний снимок'];
    const iRows = xInvs.map(v=>{
      const val = invValueAt(v, tdI);
      const invested = invInvested(v, tdI);
      const snaps = _invSnapDates(v);
      return [
        v.name,
        invested,
        val,
        val - invested,
        invested > 0 ? Math.round((val-invested)/invested*1000)/10 : '',
        snaps.length ? snaps[snaps.length-1] : ''
      ];
    });
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([iHdr,...iRows]), 'Инвестиции');
  }
```

- [ ] **Step 2: аудит — устаревший снимок**

В `renderDataAudit`, в блок «Вклады и даты» (`index.html:5405`, после существующих проверок вкладов) добавить:
```js
    (DB.investments||[]).filter(v=>!v._deleted).forEach(v=>{
      const snaps = _invSnapDates(v);
      if(!snaps.length) return;
      const age = Math.floor((new Date(today()+'T12:00:00') - new Date(snaps[snaps.length-1]+'T12:00:00'))/86400000);
      if(age > 60) h += `<div class="audit-row warn">⚠ Инвестиции «${esc(v.name)}»: снимок стоимости устарел (${age} дн.)</div>`;
    });
```
Точный вид строки (`audit-row warn` vs текущая разметка) — повторить формат соседних предупреждений блока при реализации.

- [ ] **Step 3: версия**

- `index.html:1051`: `v1.31.1` → `v1.32.0`
- `sw.js:5`: `const V = '2026-07-23 v1.31.1'` → `const V = '<сегодня> v1.32.0'`

- [ ] **Step 4: полный parse-check + ручной прогон**

Чек-лист браузером: создание счёта, пополнение со списанием из банка, вывод с зачислением, снимок, удаление снимка/записи, удаление счёта + undo, «Всего активов», график/история, Excel, аудит, sync-цикл без ошибок в консоли (`syncCycle` пушит `investments`).

- [ ] **Step 5: Commit + deploy**

```bash
git add index.html sw.js docs/superpowers/plans/2026-07-26-investments.md
git commit -m "feat(invest): v1.32.0 — раздел «Инвестиции»: снимки, пополнения, прибыль"
git push
```
Проверить билд Pages: `& "C:\Program Files\GitHub CLI\gh.exe" api repos/artwem/void/pages/builds/latest --jq '{status,commit}'`.

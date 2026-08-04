# Проекция трат + Кредиты (грейс/сплит) + Чистка — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Удалить мёртвые build-файлы; добавить прогноз трат до конца месяца в «День за днём» (v1.36.0); добавить трекинг кредиток — грейс-периоды и сплиты (v1.37.0).

**Architecture:** Всё приложение — один файл `index.html` (инлайн-JS по секциям `// ═══ x.js ═══`), данные в глобальном `DB` (localStorage), синк через Apps Script. Новая сущность `DB.credits` повторяет sync-паттерн `deposits` (updatedAt, soft-delete, LWW). Проекция — новый dataset в существующем кумулятивном графике `charts.dayCompare`.

**Tech Stack:** vanilla JS, Chart.js (уже подключён), без сборки и тестов.

**Spec:** `docs/superpowers/specs/2026-08-04-projection-credits-cleanup-design.md`

## Global Constraints

- Единственный исходник — `index.html`. CSS — `css/app.css` (при правке CSS бампить `?v=` в `<link>`).
- Каждый деплой: бамп видимой версии в About-блоке `index.html` + `const V` в `sw.js`, коммит, push в `main`.
- Все денежные значения в innerHTML — через `fmtH()`; пользовательские строки — через `esc()`; в Notification — `fmt()` (как у вкладов).
- Любая мутация записи `DB.credits` штампует `updatedAt: Date.now()` и зовёт `saveDB()`.
- Парс-чек после каждой правки index.html:
  ```bash
  node -e "const html=require('fs').readFileSync('index.html','utf8');const re=/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g;let m,ok=true;while((m=re.exec(html))){try{new Function(m[1])}catch(e){ok=false;console.log('FAIL:',e.message)}};console.log(ok?'syntax OK':'ERRORS')"
  ```
- Ручная проверка в браузере: `python3 -m http.server 8080` (или уже запущенный сервер), desktop Chrome достаточно; iOS-специфику не трогаем.

---

### Task 1: Чистка мёртвого кода

**Files:**
- Delete: `js/` (11 файлов), `nav.html`, `pages.html`, `modals.html`, `build.sh`
- Modify: `README.md` (строки ~131, ~136), `CLAUDE.md` (раздел «Critical: index.html Is the Only Real Source»)

**Interfaces:** ничего не производит; `index.html`, `css/`, `sw.js`, `apps-script/` не трогать.

- [ ] **Step 1: Удалить файлы**

```bash
git rm -r js nav.html pages.html modals.html build.sh
```

- [ ] **Step 2: README.md — вычистить упоминания**

Найти в README.md строки про `js/` и `build.sh` (~131 и ~136). Удалить строку `├── js/ …` из дерева и переписать абзац ~136 так:

```markdown
⚠️ **Весь JS живёт в `index.html`** — секции помечены маркерами `// ═══ db.js ═══`, `// ═══ assets.js ═══` и т.п. Отдельных JS-файлов и шага сборки нет.
```

Проверить `grep -n "js/\|build.sh\|nav.html\|pages.html\|modals.html" README.md` — должно быть пусто (кроме маркеров секций).

- [ ] **Step 3: CLAUDE.md — переписать раздел**

Заменить раздел «## Critical: index.html Is the Only Real Source» целиком на:

```markdown
## Critical: index.html Is the Only Source

**`index.html` is the authoritative and only JS source.** All modules are inlined with section marker comments:
```
// ═══ db.js ═══      // ═══ nav.js ═══     // ═══ budget.js ═══
// ═══ day.js ═══     // ═══ income.js ═══  // ═══ assets.js ═══
// ═══ stats.js ═══   // ═══ calc.js ═══    // ═══ settings.js ═══
// ═══ sync.js ═══    // ═══ init.js ═══
```
(Historic `js/*.js` build inputs and `build.sh` were removed in Aug 2026.)

**`css/app.css` is the exception** — loaded directly via `<link rel="stylesheet" href="css/app.css?v=X.Y.Z">` (~line 25 of `index.html`), so CSS edits go to `css/app.css` even in dev mode. Every CSS change must bump the `?v=` query string, otherwise iOS PWAs keep serving stale CSS.
```

- [ ] **Step 4: Проверить sw.js на ссылки**

`grep -n "js/\|nav.html\|pages.html\|modals.html" sw.js` — если прекеш-список содержит удалённые файлы, убрать их. (Ожидается: не содержит.)

- [ ] **Step 5: Парс-чек + коммит**

Парс-чек (Global Constraints). Затем:

```bash
git add -A
git commit -m "chore: удалены мёртвые build-файлы (js/, nav/pages/modals.html, build.sh)"
git push
```

Бамп версии НЕ нужен: файлы не участвуют в работе приложения и не кешируются.

---

### Task 2: Проекция трат до конца месяца (v1.36.0)

**Files:**
- Modify: `index.html` — блок «День за днём» в секции `═══ stats.js ═══` (~3204–3391), About-блок (поиск `v1.35.0`)
- Modify: `sw.js` — `const V`

**Interfaces:**
- Consumes: `selCum`, `selTotal`, `cD`, `daysInSel`, `displayDays`, `isCurrentMonth`, `showFull`, `getLimits(y,m)`, `fmtH`, `_chartColors()` — всё уже есть в этом блоке.
- Produces: ничего внешнего.

- [ ] **Step 1: Вычислить линию прогноза**

После вычисления `avgCumLine`/`histMonthCount` (~строка 3279), перед `const avgIdx`, вставить. **Внимание:** `selTotal` в этом блоке объявляется НИЖЕ по коду — использовать `selCum[cD-1]`, не `selTotal`:

```javascript
    // Прогноз до конца месяца: линейно от сегодняшней точки при текущем темпе.
    // Только текущий месяц + режим «весь месяц» — иначе будущих дней на оси нет.
    let projLine = null, projTotal = null;
    if (isCurrentMonth && showFull && (selCum[cD - 1] || 0) > 0 && cD < daysInSel) {
      const pace = selCum[cD - 1] / cD;
      projLine = Array.from({length: displayDays}, (_, i) =>
        i < cD - 1 ? null : Math.round(pace * (i + 1)));
      projLine[cD - 1] = selCum[cD - 1]; // старт из фактической точки
      projTotal = projLine[displayDays - 1];
    }
```

- [ ] **Step 2: Добавить dataset в график**

В `charts.dayCompare = new Chart(...)` (~3325), в массив `datasets` ПОСЛЕ dataset'а текущего месяца (последний, с `fill: true`) добавить спредом:

```javascript
          ...(projLine ? [{
            label: 'Прогноз',
            data: projLine,
            borderColor: _chartColors().blue,
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            borderDash: [5, 4],
            pointRadius: 0,
            cubicInterpolationMode: 'monotone',
            spanGaps: false,
            fill: false
          }] : [])
```

- [ ] **Step 3: Строка в summary**

В summary-блоке (~3368–3390), после блока `if (avgHist && vsAvgDiff !== null) {...}` и ПЕРЕД `sumEl.innerHTML = html;` вставить:

```javascript
    if (projTotal !== null) {
      const budget = (getLimits(selY, selM) || []).reduce((s, v) => s + (v || 0), 0);
      let projHtml = `Прогноз на конец месяца: <b style="color:var(--text)">${fmtH(projTotal)}</b>`;
      if (budget > 0) {
        const over = projTotal - budget;
        const bCol = over > 0 ? '#d85a30' : '#1d9e75';
        projHtml += over > 0
          ? ` — <span style="color:${bCol};font-weight:600">+${fmtH(over)} к бюджету</span>`
          : ` — <span style="color:${bCol};font-weight:600">в рамках бюджета ${fmtH(budget)}</span>`;
      }
      html += `<div style="font-size:11px;color:#888;border-top:0.5px solid var(--border);padding-top:6px">${projHtml}</div>`;
    }
```

Примечание: `sumEl.innerHTML = html;` стоит после avgHist-блока — вставка идёт между ними, `html` ещё доступен для дописывания.

- [ ] **Step 4: Парс-чек + ручная проверка**

Парс-чек. В браузере, вкладка Аналитика → «День за днём»:
- текущий месяц + «весь месяц»: пунктирная синяя линия от сегодняшней точки до конца, в summary «Прогноз на конец месяца: X₽ — … к бюджету»;
- режим «до сегодня»: линии и строки нет;
- выбрать прошлый месяц: линии и строки нет;
- переключить «Особые»: прогноз пересчитывается вместе с линией месяца.

- [ ] **Step 5: Версии + коммит + деплой**

1. В `index.html` About-блок: `v1.35.0` → `v1.36.0`.
2. В `sw.js`: бамп `const V`.
3. Парс-чек, затем:

```bash
git add index.html sw.js
git commit -m "feat(stats): v1.36.0 — прогноз трат до конца месяца в «День за днём»"
git push
```

4. Проверить деплой:

```powershell
& "C:\Program Files\GitHub CLI\gh.exe" api repos/artwem/void/pages/builds/latest --jq '{status,commit}'
```

Ожидается `status: built` на новом коммите (повторить через минуту при `building`).

---

### Task 3: Кредиты — данные и sync

**Files:**
- Modify: `index.html` — секция `═══ db.js ═══` (loadDB ~1330–1360), секция `═══ sync.js ═══` (mergePullData ~7345), restore-блок (~6021), тестовые данные (~6354), очистка (~6475), секция `═══ assets.js ═══` (helpers)

**Interfaces:**
- Produces (используют Task 4–6):
  - `DB.credits` — массив записей `{id, kind:'grace', bank, payoffAmount, graceEnd, updatedAt, _deleted?}` и `{id, kind:'split', name, payments:[{date,amount,paid}], updatedAt, _deleted?}`
  - `_splitNextPayment(c)` → `{date, amount, paid}|null` — ближайший неоплаченный
  - `_splitRemains(c)` → number — сумма неоплаченных
  - `_graceDaysLeft(c)` → number — дней до конца грейса (отрицательное = просрочен)

- [ ] **Step 1: Дефолт + purge в loadDB**

После `if(!DB.investments) DB.investments = [];` (~1340) добавить:

```javascript
  if(!DB.credits) DB.credits = [];
```

В purge-списке (~1356) добавить `'credits'`:

```javascript
  ['expenses','incomes','assets','goals','templates','deposits','investments','credits'].forEach(k => {
```

- [ ] **Step 2: mergePullData**

В списке LWW-массивов (~7345) добавить `'credits'`:

```javascript
  ['expenses','incomes','assets','goals','templates','deposits','investments','credits'].forEach(key => {
```

`buildPayload()` менять не нужно — он шлёт `{...DB}` минус device-local поля, `credits` уедет автоматически.

- [ ] **Step 3: Restore / тест-данные / очистка**

В restore-блоке (~6021) добавить `'credits'` в список массивов, получающих дефолт `[]`. В функции очистки данных (~6475, рядом с `DB.creditBanks = []`) добавить `DB.credits = [];`. В генераторе тестовых данных (~6354) кредиты НЕ генерируем (не обязательны). Проверить `grep -n "DB.investments = \[\]" index.html` — везде, где investments сбрасывается в `[]`, добавить credits.

- [ ] **Step 4: Helpers в assets.js-секции**

Рядом с `isCredit` (~3654) добавить:

```javascript
// ─── Кредиты: грейс-периоды и сплиты ─────────────────────────────────
function _splitNextPayment(c){
  return (c.payments||[]).filter(p=>!p.paid).sort((a,b)=>a.date.localeCompare(b.date))[0] || null;
}
function _splitRemains(c){
  return (c.payments||[]).filter(p=>!p.paid).reduce((s,p)=>s+p.amount,0);
}
function _graceDaysLeft(c){
  return Math.ceil((new Date(c.graceEnd) - new Date(today()))/86400000);
}
```

- [ ] **Step 5: Парс-чек + коммит (без push)**

```bash
git add index.html
git commit -m "feat(credits): модель данных DB.credits, sync-паттерн, helpers"
```

---

### Task 4: Грейс-трекер — UI

**Files:**
- Modify: `index.html` — `_buildBankRow` в renderAssets (~3820–3849), HTML страницы Активы (~294), блок модалок (перед `<div class="overlay" id="modal-about">`), секция `═══ assets.js ═══` (новые функции)

**Interfaces:**
- Consumes: `DB.credits`, `_graceDaysLeft(c)` (Task 3), `openModal`/`closeModal`, `formatMoneyInput`/`parseMoney`, `_fmtDateRu`, `uid()`, `toast`, `esc`, `fmtH`
- Produces: `openGraceModal(id?)`, `saveGrace()`, `payoffGrace()`, `renderCredits()` (заглушка под сплиты — Task 5 её дополнит)

- [ ] **Step 1: Бейдж на строке кредитного банка**

В `_buildBankRow` (~3841), строку

```javascript
    namePart.innerHTML = `<div class="asset-name">${esc(name)}${creditBadge}</div>` + freshLine;
```

заменить на:

```javascript
    let graceLine = '';
    if(credit){
      const g = (DB.credits||[]).find(c=>!c._deleted && c.kind==='grace' && c.bank===name);
      if(g){
        const dl = _graceDaysLeft(g);
        const col = dl <= 3 ? 'var(--red)' : dl <= 7 ? '#c98a1b' : 'var(--muted)';
        graceLine = `<div style="font-size:11px;color:${col};margin-top:2px" onclick="event.stopPropagation();openGraceModal('${g.id}')">грейс до ${_fmtDateRu(g.graceEnd)} · ${fmtH(g.payoffAmount)}${dl<0?' · ПРОСРОЧЕН':''}</div>`;
      }
    }
    namePart.innerHTML = `<div class="asset-name">${esc(name)}${creditBadge}</div>` + freshLine + graceLine;
```

- [ ] **Step 2: Секция «Кредиты» на странице Активы**

В HTML после `<div class="settings-list" id="assets-list"></div>` (~294) вставить:

```html
  <div class="sec-hdr" id="credits-sec-hdr" style="margin-top:8px"><span class="sec-title">Кредиты</span><span style="display:flex;gap:14px"><span class="sec-action" onclick="openGraceModal()">+ Грейс</span><span class="sec-action" onclick="openSplitModal()">+ Сплит</span></span></div>
  <div id="credits-list" style="padding:0 16px 8px"></div>
```

`openSplitModal` появится в Task 5 — до него «+ Сплит» кинет ReferenceError при клике, это ок (задачи деплоятся вместе в v1.37.0).

- [ ] **Step 3: Модалка грейса**

Перед `<div class="overlay" id="modal-about">` (~1160) вставить:

```html
<!-- MODAL: GRACE -->
<div class="overlay" id="modal-grace">
  <div class="sheet" style="position:relative">
    <button class="close-btn" onclick="closeModal('modal-grace')">✕</button>
    <h2 style="margin-bottom:16px">Грейс-период</h2>
    <div class="fgrp"><label class="flbl">Кредитка</label><select id="grace-bank" class="finp"></select></div>
    <div class="fgrp"><label class="flbl">Погасить до</label><input type="date" id="grace-end" class="finp"></div>
    <div class="fgrp"><label class="flbl">Сумма к погашению, ₽</label><input type="text" id="grace-amount" class="finp" inputmode="decimal" placeholder="0" oninput="formatMoneyInput(this)"></div>
    <button class="btn primary" onclick="saveGrace()" style="width:100%;margin-top:8px">Сохранить</button>
    <button class="btn" id="grace-payoff-btn" onclick="payoffGrace()" style="width:100%;margin-top:8px;display:none;color:var(--green)">✓ Погашено</button>
  </div>
</div>
```

- [ ] **Step 4: Функции грейса**

В секцию `═══ assets.js ═══` рядом с helpers из Task 3 добавить:

```javascript
let _editGraceId = null;
function openGraceModal(id){
  const banks = DB.creditBanks || [];
  if(!banks.length){ toast('Нет кредитных счетов — добавьте в «Управлять»', 'err'); return; }
  _editGraceId = id || null;
  const g = id ? (DB.credits||[]).find(c=>c.id===id && !c._deleted) : null;
  const sel = document.getElementById('grace-bank');
  sel.innerHTML = banks.map(b=>`<option value="${esc(b)}"${g && g.bank===b?' selected':''}>${esc(b)}</option>`).join('');
  document.getElementById('grace-end').value = g ? g.graceEnd : '';
  const amtEl = document.getElementById('grace-amount');
  amtEl.value = g ? String(g.payoffAmount) : '';
  if(g) formatMoneyInput(amtEl);
  document.getElementById('grace-payoff-btn').style.display = g ? '' : 'none';
  openModal('modal-grace');
}
function saveGrace(){
  const bank = document.getElementById('grace-bank').value;
  const end = document.getElementById('grace-end').value;
  const amount = parseMoney(document.getElementById('grace-amount').value) || 0;
  if(!end){ toast('Укажите дату конца грейса', 'err'); return; }
  if(amount <= 0){ toast('Укажите сумму', 'err'); return; }
  // одна активная запись на банк: редактируем существующую, если есть
  let g = _editGraceId
    ? (DB.credits||[]).find(c=>c.id===_editGraceId)
    : (DB.credits||[]).find(c=>!c._deleted && c.kind==='grace' && c.bank===bank);
  if(g){
    g.bank = bank; g.payoffAmount = amount; g.graceEnd = end; g.updatedAt = Date.now();
    delete g._deleted;
  } else {
    DB.credits.push({id: uid(), kind:'grace', bank, payoffAmount: amount, graceEnd: end, updatedAt: Date.now()});
  }
  saveDB(); closeModal('modal-grace'); renderAssets(); toast('Грейс сохранён');
}
function payoffGrace(){
  const g = (DB.credits||[]).find(c=>c.id===_editGraceId);
  if(!g) return;
  g._deleted = true; g.payoffAmount = 0; g.updatedAt = Date.now();
  saveDB(); closeModal('modal-grace'); renderAssets(); toast('Грейс погашен ✓');
}
```

- [ ] **Step 5: renderCredits() — каркас + вызов**

Там же добавить (Task 5 дополнит сплитами):

```javascript
function renderCredits(){
  const wrap = document.getElementById('credits-list');
  if(!wrap) return;
  wrap.innerHTML = '';
  const splits = (DB.credits||[]).filter(c=>!c._deleted && c.kind==='split')
    .sort((a,b)=>{ const pa=_splitNextPayment(a), pb=_splitNextPayment(b); return (pa?pa.date:'9999').localeCompare(pb?pb.date:'9999'); });
  if(!splits.length){
    wrap.innerHTML = '<div style="font-size:12px;color:var(--hint);padding:4px 0">Нет активных сплитов</div>';
    return;
  }
  // строки сплитов — Task 5
}
```

В конце `renderAssets()` (перед закрывающей `}` функции, после блока графика) добавить вызов `renderCredits();`.

- [ ] **Step 6: Парс-чек + ручная проверка + коммит**

Парс-чек. В браузере (Активы):
- «+ Грейс» → модалка, сохранить → бейдж «грейс до …» на строке кредитного банка;
- цвет бейджа: серый (>7 дн), поставить дату через 5 дней → янтарный, через 2 дня → красный, вчера → красный + ПРОСРОЧЕН;
- тап по бейджу → модалка с данными, «✓ Погашено» → бейдж исчез;
- повторное сохранение на тот же банк редактирует, а не плодит записи (проверить `DB.credits` в консоли).

```bash
git add index.html
git commit -m "feat(credits): грейс-трекер — бейджи на кредитках, модалка, секция «Кредиты»"
```

---

### Task 5: Сплиты — UI

**Files:**
- Modify: `index.html` — модалки (перед `modal-about`), секция `═══ assets.js ═══` (функции + дополнение `renderCredits`)

**Interfaces:**
- Consumes: `DB.credits`, `_splitNextPayment`, `_splitRemains` (Task 3), `renderCredits()` (Task 4), `uid`, `toast`, `toastUndo`, `esc`, `fmtH`, `fmt`, `parseMoney`, `formatMoneyInput`, `_fmtDateRu`, `today()`
- Produces: `openSplitModal()`, `saveSplit()`, `openSplitView(id)`, `toggleSplitPaid(id, idx)`, `closeSplit()`; module-state `_splitGenPayments`, `_splitInterval`, `_viewSplitId`

- [ ] **Step 1: Модалка создания сплита**

Перед `<div class="overlay" id="modal-about">` вставить:

```html
<!-- MODAL: SPLIT (создание) -->
<div class="overlay" id="modal-split">
  <div class="sheet" style="position:relative;max-height:85vh;overflow-y:auto">
    <button class="close-btn" onclick="closeModal('modal-split')">✕</button>
    <h2 style="margin-bottom:16px">Новый сплит</h2>
    <div class="fgrp"><label class="flbl">Название</label><input type="text" id="split-name" class="finp" placeholder="Яндекс Сплит — куртка"></div>
    <div class="fgrp"><label class="flbl">Общая сумма, ₽</label><input type="text" id="split-total" class="finp" inputmode="decimal" placeholder="0" oninput="formatMoneyInput(this);_splitRegen()"></div>
    <div class="fgrp"><label class="flbl">Частей</label><input type="number" id="split-parts" class="finp" value="4" min="1" max="24" oninput="_splitRegen()"></div>
    <div class="fgrp"><label class="flbl">Интервал</label>
      <div style="display:flex;gap:0;font-size:12px;border:1px solid var(--border);border-radius:6px;width:fit-content;user-select:none">
        <span id="siv-week" onclick="setSplitInterval('week')" style="padding:4px 10px;cursor:pointer;border-radius:5px 0 0 5px">неделя</span><span id="siv-biweek" onclick="setSplitInterval('biweek')" style="padding:4px 10px;cursor:pointer;border-left:1px solid var(--border)">2 недели</span><span id="siv-month" onclick="setSplitInterval('month')" style="padding:4px 10px;cursor:pointer;border-left:1px solid var(--border);border-radius:0 5px 5px 0">месяц</span>
      </div>
    </div>
    <div class="fgrp"><label class="flbl">Дата покупки</label><input type="date" id="split-buy-date" class="finp" onchange="_splitRegen()"></div>
    <div class="fgrp" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="split-first-now" checked onchange="_splitRegen()" style="width:auto"><label for="split-first-now" style="font-size:13px;color:var(--text)">Первая оплата сразу</label></div>
    <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin:8px 0 6px">График платежей — можно править</div>
    <div id="split-gen-list"></div>
    <button class="btn primary" onclick="saveSplit()" style="width:100%;margin-top:8px">Сохранить</button>
  </div>
</div>

<!-- MODAL: SPLIT (просмотр/оплата) -->
<div class="overlay" id="modal-split-view">
  <div class="sheet" style="position:relative;max-height:85vh;overflow-y:auto">
    <button class="close-btn" onclick="closeModal('modal-split-view')">✕</button>
    <h2 id="split-view-title" style="margin-bottom:4px">Сплит</h2>
    <div id="split-view-sub" style="font-size:13px;color:var(--muted);margin-bottom:12px"></div>
    <div id="split-view-list"></div>
    <button class="btn" onclick="closeSplit()" style="width:100%;margin-top:12px;color:var(--red)">Закрыть сплит</button>
  </div>
</div>
```

- [ ] **Step 2: Генератор графика + функции создания**

В секцию `═══ assets.js ═══` добавить:

```javascript
// ─── Сплиты ──────────────────────────────────────────────────────────
let _splitGenPayments = [];
let _splitInterval = 'biweek';   // 'week' | 'biweek' | 'month'
let _viewSplitId = null;

function setSplitInterval(iv){
  _splitInterval = iv;
  ['week','biweek','month'].forEach(k=>{
    const el = document.getElementById('siv-'+k);
    el.style.background = k===iv ? 'rgba(128,128,128,0.18)' : '';
    el.style.color      = k===iv ? 'var(--text)' : '#888';
  });
  _splitRegen();
}

function _splitShiftDate(startStr, i){
  const d = new Date(startStr + 'T12:00:00');
  if(_splitInterval === 'month'){
    const day = d.getDate();
    const t = new Date(d.getFullYear(), d.getMonth() + i, 1);
    const dim = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
    t.setDate(Math.min(day, dim)); // 31-е в коротких месяцах прижимается
    return t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0');
  }
  d.setDate(d.getDate() + (_splitInterval === 'week' ? 7 : 14) * i);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

function _splitRegen(){
  const total = parseMoney(document.getElementById('split-total').value) || 0;
  const parts = parseInt(document.getElementById('split-parts').value) || 0;
  const buy   = document.getElementById('split-buy-date').value || today();
  const firstNow = document.getElementById('split-first-now').checked;
  if(total <= 0 || parts < 1 || parts > 24){ _splitGenPayments = []; _splitRenderGenList(); return; }
  const base = Math.floor(total / parts);
  _splitGenPayments = Array.from({length: parts}, (_, i) => ({
    date: _splitShiftDate(buy, firstNow ? i : i + 1),
    amount: i === parts - 1 ? total - base * (parts - 1) : base,  // последний забирает округление
    paid: false
  }));
  _splitRenderGenList();
}

function _splitRenderGenList(){
  const el = document.getElementById('split-gen-list');
  if(!_splitGenPayments.length){ el.innerHTML = '<div style="font-size:12px;color:var(--hint)">Заполните сумму и число частей</div>'; return; }
  el.innerHTML = _splitGenPayments.map((p, i) => `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
      <span style="font-size:12px;color:var(--muted);width:16px;flex-shrink:0">${i+1}</span>
      <input type="date" value="${p.date}" class="finp" style="flex:1;margin:0" onchange="_splitGenPayments[${i}].date=this.value">
      <input type="text" value="${fmt(p.amount).replace('₽','').trim()}" class="finp" inputmode="decimal" style="width:100px;margin:0;text-align:right" oninput="formatMoneyInput(this);_splitGenPayments[${i}].amount=parseMoney(this.value)||0;_splitGenTotal()">
    </div>`).join('') + `<div id="split-gen-total" style="font-size:12px;color:var(--muted);text-align:right;padding:2px 0"></div>`;
  _splitGenTotal();
}

function _splitGenTotal(){
  const el = document.getElementById('split-gen-total');
  if(el) el.textContent = 'Итого: ' + fmt(_splitGenPayments.reduce((s,p)=>s+p.amount,0));
}

function openSplitModal(){
  document.getElementById('split-name').value = '';
  document.getElementById('split-total').value = '';
  document.getElementById('split-parts').value = '4';
  document.getElementById('split-buy-date').value = today();
  document.getElementById('split-first-now').checked = true;
  _splitGenPayments = [];
  setSplitInterval('biweek'); // подсветка чипа + regen (даст пустой список)
  openModal('modal-split');
}

function saveSplit(){
  const name = document.getElementById('split-name').value.trim();
  if(!name){ toast('Введите название', 'err'); return; }
  if(!_splitGenPayments.length){ toast('Заполните сумму и число частей', 'err'); return; }
  if(_splitGenPayments.some(p => !p.date || !(p.amount > 0))){ toast('Проверьте график: даты и суммы', 'err'); return; }
  DB.credits.push({id: uid(), kind: 'split', name, payments: _splitGenPayments.map(p => ({...p})), updatedAt: Date.now()});
  saveDB(); closeModal('modal-split'); renderAssets(); toast('Сплит добавлен');
}
```

- [ ] **Step 3: Просмотр, оплата, закрытие**

Там же:

```javascript
function openSplitView(id){
  const c = (DB.credits||[]).find(x => x.id === id && !x._deleted);
  if(!c) return;
  _viewSplitId = id;
  _renderSplitView(c);
  openModal('modal-split-view');
}

function _renderSplitView(c){
  document.getElementById('split-view-title').textContent = c.name;
  const paidCnt = c.payments.filter(p=>p.paid).length;
  document.getElementById('split-view-sub').innerHTML =
    `оплачено ${paidCnt}/${c.payments.length} · осталось ${fmtH(_splitRemains(c))}`;
  const td = today();
  document.getElementById('split-view-list').innerHTML = c.payments.map((p, i) => {
    const overdue = !p.paid && p.date < td;
    const col = p.paid ? 'var(--muted)' : overdue ? 'var(--red)' : 'var(--text)';
    return `<div style="display:flex;gap:10px;align-items:center;padding:7px 0;border-bottom:0.5px solid var(--border)">
      <input type="checkbox" ${p.paid?'checked':''} onchange="toggleSplitPaid('${c.id}',${i})" style="width:18px;height:18px;flex-shrink:0">
      <span style="flex:1;font-size:13px;color:${col};${p.paid?'text-decoration:line-through':''}">${_fmtDateRu(p.date)}${overdue?' · просрочен':''}</span>
      <span style="font-size:13px;font-weight:600;color:${col}">${fmtH(p.amount)}</span>
    </div>`;
  }).join('');
}

function toggleSplitPaid(id, idx){
  const c = (DB.credits||[]).find(x => x.id === id);
  if(!c || !c.payments[idx]) return;
  c.payments[idx].paid = !c.payments[idx].paid;
  c.updatedAt = Date.now();
  saveDB(); _renderSplitView(c); renderCredits();
}

function closeSplit(){
  const c = (DB.credits||[]).find(x => x.id === _viewSplitId);
  if(!c) return;
  c._deleted = true; c.updatedAt = Date.now();
  saveDB(); closeModal('modal-split-view'); renderAssets();
  toastUndo('Сплит закрыт', () => { delete c._deleted; c.updatedAt = Date.now(); saveDB(); renderAssets(); });
}
```

- [ ] **Step 4: Строки сплитов в renderCredits**

В `renderCredits()` (Task 4 Step 5) заменить комментарий `// строки сплитов — Task 5` на:

```javascript
  const td = today();
  splits.forEach(c => {
    const next = _splitNextPayment(c);
    const paidCnt = c.payments.filter(p=>p.paid).length;
    const overdue = next && next.date < td;
    const row = document.createElement('div');
    row.className = 'asset-row';
    row.style.cssText = 'gap:8px;cursor:pointer';
    row.addEventListener('click', () => openSplitView(c.id));
    const sub = next
      ? `<div style="font-size:11px;color:${overdue?'var(--red)':'var(--muted)'};margin-top:2px">осталось ${paidCnt}/${c.payments.length}${overdue ? ' · просрочен ' : ' · след. '}${_fmtDateRu(next.date)} · ${fmtH(next.amount)}</div>`
      : `<div style="font-size:11px;color:var(--green);margin-top:2px">✓ всё оплачено — можно закрыть</div>`;
    row.innerHTML = `<div style="flex:1;min-width:0"><div class="asset-name">${esc(c.name)}<span style="font-size:10px;background:rgba(128,128,128,0.12);color:var(--muted);padding:1px 5px;border-radius:4px;margin-left:4px">сплит</span></div>${sub}</div><span class="asset-amount">${fmtH(_splitRemains(c))}</span>`;
    wrap.appendChild(row);
  });
```

Примечание: строка «осталось X/N» использует `paidCnt` из числителя оплаченных — подпись «осталось» относится к следующему платежу и остатку суммы; прогресс `paidCnt/total` читается как «оплачено». Оставить как в коде (компактно, смысл ясен из чисел).

- [ ] **Step 5: Парс-чек + ручная проверка + коммит**

Парс-чек. В браузере (Активы → «+ Сплит»):
- сумма 10 000, частей 4, интервал «2 недели», дата покупки сегодня, «первая сразу» → график: сегодня, +14, +28, +42, суммы 2500×4;
- снять «первая сразу» → первый платёж через 14 дней;
- частей 3, сумма 10 000 → 3333 + 3333 + 3334 (последний забирает округление);
- интервал «месяц», дата покупки 31-е число → в коротких месяцах даты прижаты к 28/30;
- поправить дату и сумму строки вручную → «Итого» пересчитан; сохранить;
- строка сплита в секции «Кредиты»: бейдж, «след. …», остаток; тап → просмотр;
- отметить платёж галкой → строка зачёркнута, остаток уменьшился; снять галку — вернулось;
- платёж с прошедшей датой без галки → красный «просрочен» в строке и списке;
- «Закрыть сплит» → исчез из списка, тост с «Отменить» возвращает;
- сплит с 1 частью — создаётся и работает.

```bash
git add index.html
git commit -m "feat(credits): сплиты — генератор графика, ручные правки, оплата, закрытие"
```

---

### Task 6: Уведомления + деплой v1.37.0

**Files:**
- Modify: `index.html` — секция `═══ settings.js ═══` (рядом с `checkDepositNotifications` ~6154), `init()` (~7267), About-блок (версия)
- Modify: `sw.js` — `const V`
- Modify: `CLAUDE.md` — схема DB + раздел про кредиты

**Interfaces:**
- Consumes: `DB.credits`, `_splitNextPayment`, `_graceDaysLeft`, `_fmtDateRu`, `fmt`, `today()`
- Produces: `checkCreditNotifications()`

- [ ] **Step 1: checkCreditNotifications**

После `checkDepositNotifications` (~6171) добавить:

```javascript
function checkCreditNotifications(){
  if(!DB.notifsEnabled || Notification.permission !== 'granted') return;
  const td = today();
  (DB.credits||[]).filter(c=>!c._deleted).forEach(c=>{
    let title = null, body = null;
    if(c.kind === 'grace'){
      const dl = _graceDaysLeft(c);
      if(dl > 3) return;
      title = 'Кредитка: ' + c.bank;
      body = dl >= 0
        ? 'Грейс кончается ' + (dl === 0 ? 'сегодня' : 'через ' + dl + ' дн. (' + _fmtDateRu(c.graceEnd) + ')') + ' — погасить ' + fmt(c.payoffAmount)
        : 'Грейс просрочен с ' + _fmtDateRu(c.graceEnd) + ' — ' + fmt(c.payoffAmount);
    } else {
      const p = _splitNextPayment(c);
      if(!p) return;
      const dl = Math.ceil((new Date(p.date) - new Date(td))/86400000);
      if(dl > 1) return;
      title = 'Сплит: ' + c.name;
      body = dl >= 0
        ? 'Платёж ' + fmt(p.amount) + (dl === 0 ? ' сегодня' : ' завтра')
        : 'Платёж ' + fmt(p.amount) + ' просрочен (' + _fmtDateRu(p.date) + ')';
    }
    const stampKey = 'notif_credit_' + c.id;
    const stamp = localStorage.getItem(stampKey);
    if(stamp && (Date.now() - parseInt(stamp)) < 3*86400000) return;
    localStorage.setItem(stampKey, String(Date.now()));
    new Notification(title, {body, icon: './apple-touch-icon.png'});
  });
}
```

- [ ] **Step 2: Вызов в init()**

После `checkDepositNotifications();` (~7267) добавить:

```javascript
  checkCreditNotifications();
```

- [ ] **Step 3: CLAUDE.md — документация**

В схему DB (раздел Data Layer) после строки `investments:` добавить:

```
  credits:         [{id, kind:'grace', bank, payoffAmount, graceEnd, _deleted?} | {id, kind:'split', name, payments:[{date,amount,paid}], _deleted?}, ...],  // грейс кредиток + BNPL-сплиты; информационные, в итоги активов не входят
```

В список «What syncs (both directions)» добавить `credits`. В раздел Assets Page добавить строку:

```
- **Кредиты (грейс + сплиты)** — `DB.credits`, информационный блок: грейс-бейдж на строке кредитного банка (тап → `openGraceModal`), секция «Кредиты» со сплитами (`renderCredits`, `openSplitView`, ручные галки оплаты). График платежей сплита генерится в модалке (`_splitRegen`, чипы неделя/2 недели/месяц, тумблер «первая сразу»), строки редактируются до сохранения. `checkCreditNotifications` — грейс ≤3 дн, платёж сплита завтра/просрочен.
```

В список Notifications-функций (Assets раздел) добавить `checkCreditNotifications`.

- [ ] **Step 4: Версии + финальная проверка + деплой**

1. About-блок `index.html`: `v1.36.0` → `v1.37.0`; `sw.js`: бамп `const V`.
2. Парс-чек.
3. Ручная сквозная проверка: грейс + сплит созданы, отображаются, синк-цикл не падает (открыть консоль, дождаться «sync» без ошибок; при настроенном syncUrl проверить пуш-пулл на второй вкладке).
4. Коммит + push:

```bash
git add index.html sw.js CLAUDE.md
git commit -m "feat(credits): v1.37.0 — грейс-трекер кредиток и сплиты: пуши, доки"
git push
```

5. Проверить деплой:

```powershell
& "C:\Program Files\GitHub CLI\gh.exe" api repos/artwem/void/pages/builds/latest --jq '{status,commit}'
```

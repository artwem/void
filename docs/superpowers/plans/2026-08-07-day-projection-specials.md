# Прогноз с учётом особых трат — «День за днём» — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Линия «Прогноз» на графике «День за днём» учитывает особые траты — по каждой категории отдельно, угадывая дату из истории или размазывая остаток по оставшимся дням, а не только линейный темп по всем тратам вместе.

**Architecture:** Три новых чистых функции (без DOM/Chart.js зависимостей) в `═══ stats.js ═══`, вызываемые из существующего блока построения `projLine` внутри `renderStats()`. `_budgetFree()` и Бюджет-таб не трогаем.

**Tech Stack:** Vanilla JS, инлайн в `index.html`. Тесты — Node-скрипты (проект без фреймворка/раннера), извлекающие функции регэкспом и гоняющие assert на фикстурах.

## Global Constraints

- `index.html` — единственный источник JS (все модули инлайн, см. CLAUDE.md).
- Каждый деплой: бампнуть видимую версию в `index.html` (About-блок, `v1.`) и `const V` в `sw.js`.
- Особые траты определяются `expense.special === true`; группировка — по `e.cat` (индекс категории), как во всей остальной агрегации в stats.js/budget.js.
- Дата трат — строка `YYYY-MM-DD`; день месяца = `Number(e.date.slice(-2))`.
- Прогноз строится только когда: `isCurrentMonth && showFull && (selCum[cD-1]||0) > 0 && cD < daysInSel` (существующий гард, не менять).
- Тумблер `dayInclSpecial` (读: вкл/выкл «особые» на графике) гейтит весь прогноз особых: выкл → `specialCumLine = null` (только базовый темп по неособым).

---

## File Structure

- Modify: `index.html`
  - Новые функции — сразу перед `function renderStats(){` (текущая строка 3223, после `renderSavingsCharts`).
  - Блок построения `projLine` внутри `renderStats()` (текущие строки 3329-3338) — заменяется на вызов новых функций.
- Test: временные Node-скрипты в scratchpad (`C:\Users\AANISI~1\AppData\Local\Temp\claude\...\scratchpad\`), не коммитятся — только для проверки логики перед вшиванием в index.html.

## Task 1: Чистые функции прогноза особых трат

**Files:**
- Modify: `index.html` (вставка перед строкой 3223, `function renderStats(){`)

**Interfaces:**
- Produces (используются в Task 2):
  - `_specialCatStats(exps: Expense[]): {[catIdx: number]: {sum: number, topDay: number, topAmt: number}}`
  - `_guessSpecialDay(days: number[]): number | null`
  - `_specialForecastByCat(curExps: Expense[], histMonthsExps: {exps: Expense[]}[]): {cat: number, unpaid: number, guessDay: number|null}[]`
  - `_specialForecastCumLine(forecast: ReturnType<_specialForecastByCat>, cD: number, daysInMonth: number, displayDays: number): number[]` — длина `displayDays`, кумулятивная добавка по дням (0-indexed).
  - `_regularCumByDay(exps: Expense[], y: number, m: number, maxDay: number, totalDays: number): (number|null)[]` — аналог локального `cumByDay` внутри `renderStats`, но фильтрует `!e.special`.
  - `Expense` здесь = объект вида `{date: 'YYYY-MM-DD', amount: number, cat: number, special?: boolean, ...}` — как в `DB.expenses`.

- [ ] **Step 1: Написать функции в index.html**

Вставить перед строкой `function renderStats(){` (сейчас строка 3223):

```javascript
// ─── ПРОГНОЗ ОСОБЫХ ТРАТ (для линии «Прогноз» на «День за днём») ────
// Группирует special-траты месяца по категории: cat idx → {sum, topDay, topAmt}.
// topDay — день месяца самой крупной special-траты этой категории (представитель
// месяца для угадывания повторяющейся даты, напр. аренда).
function _specialCatStats(exps){
  const map = {};
  exps.forEach(e => {
    if(!e.special) return;
    if(!map[e.cat]) map[e.cat] = {sum:0, topDay:0, topAmt:-1};
    map[e.cat].sum += e.amount;
    if(e.amount > map[e.cat].topAmt){
      map[e.cat].topAmt = e.amount;
      map[e.cat].topDay = Number(e.date.slice(-2));
    }
  });
  return map;
}

// Угадывает повторяющийся день месяца по истории: 1 точка — берём как есть,
// ≥2 точки при разбросе ≤3 дня — медиана, иначе не доверяем (null).
function _guessSpecialDay(days){
  if(!days.length) return null;
  if(days.length === 1) return days[0];
  const sorted = [...days].sort((a,b)=>a-b);
  if(sorted[sorted.length-1] - sorted[0] > 3) return null;
  const mid = Math.floor(sorted.length/2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid-1]+sorted[mid])/2);
}

// Резерв особых по категориям: plan = минимум суммы категории за прошлые месяцы,
// где категория встречалась; unpaid = max(0, plan − факт текущего месяца).
// histMonthsExps — траты прошлых месяцев, от ближайшего к дальнему (обычно 3).
function _specialForecastByCat(curExps, histMonthsExps){
  const curMap = _specialCatStats(curExps);
  const histByCat = {};
  histMonthsExps.forEach(({exps}) => {
    const hMap = _specialCatStats(exps);
    Object.keys(hMap).forEach(ci => {
      ci = Number(ci);
      if(!histByCat[ci]) histByCat[ci] = [];
      histByCat[ci].push(hMap[ci]);
    });
  });
  const result = [];
  Object.keys(histByCat).forEach(ciStr => {
    const ci = Number(ciStr);
    const hist = histByCat[ci];
    const plan = Math.min(...hist.map(h => h.sum));
    const spent = (curMap[ci] && curMap[ci].sum) || 0;
    const unpaid = Math.max(0, plan - spent);
    if(unpaid <= 0) return;
    const guessDay = _guessSpecialDay(hist.map(h => h.topDay));
    result.push({cat: ci, unpaid, guessDay});
  });
  return result;
}

// Строит кумулятивную добавку особых по дням месяца (0-indexed, длина displayDays).
// Угаданная дата в будущем — кладём unpaid куском на неё. Угаданная дата сегодня
// или в прошлом (просрочено) — куском на первый прогнозный день (cD+1). Угадать
// не вышло — размазываем unpaid равными долями по дням cD+1..daysInMonth.
function _specialForecastCumLine(forecast, cD, daysInMonth, displayDays){
  const extra = Array.from({length: displayDays}, () => 0);
  forecast.forEach(({unpaid, guessDay}) => {
    if(guessDay != null && guessDay >= cD + 1){
      const idx = Math.min(guessDay, displayDays) - 1;
      if(idx >= 0) extra[idx] += unpaid;
    } else if(guessDay != null){
      const idx = Math.min(cD + 1, displayDays) - 1;
      if(idx >= 0) extra[idx] += unpaid;
    } else {
      const remainDays = daysInMonth - cD;
      if(remainDays > 0){
        const per = unpaid / remainDays;
        for(let d = cD + 1; d <= daysInMonth && d <= displayDays; d++) extra[d-1] += per;
      }
    }
  });
  let acc = 0;
  return extra.map(v => { acc += v; return acc; });
}

// Кумулятивная сумма НЕ-special трат по дням месяца (аналог локального cumByDay
// внутри renderStats, но с фильтром !e.special) — база для линейного темпа прогноза.
function _regularCumByDay(exps, y, m, maxDay, totalDays){
  const mk = monthKey(y, m);
  let acc = 0;
  return Array.from({length: totalDays}, (_, i) => {
    if(i >= maxDay) return null;
    const ds = mk + '-' + String(i+1).padStart(2, '0');
    acc += exps.filter(e => !e.special && e.date === ds).reduce((s,e) => s + e.amount, 0);
    return Math.round(acc);
  });
}

```

- [ ] **Step 2: Node-тест на фикстурах — написать и прогнать**

Создать `C:\Users\aanisimov\AppData\Local\Temp\claude\C--Users-aanisimov-code-nto\004f3151-fa61-440d-8a62-1d861a37d210\scratchpad\test-special-forecast.js`:

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
// monthKey должен существовать до вызова извлечённых функций (closure резолвится
// в момент вызова, не в момент eval) — direct eval ниже пишет объявления в этот
// же scope, поэтому достаточно объявить monthKey раньше по файлу.
function monthKey(y,m){ return y+'-'+String(m+1).padStart(2,'0'); }
const src = ['_specialCatStats','_guessSpecialDay','_specialForecastByCat','_specialForecastCumLine','_regularCumByDay']
  .map(extract).join('\n');
eval(src);

// ── _guessSpecialDay ──
assert.strictEqual(_guessSpecialDay([]), null);
assert.strictEqual(_guessSpecialDay([5]), 5);
assert.strictEqual(_guessSpecialDay([5,6]), 6); // even count, upper median по формуле
assert.strictEqual(_guessSpecialDay([5,6,7]), 6);
assert.strictEqual(_guessSpecialDay([1,20]), null); // разброс >3

// ── _specialCatStats ──
const exps = [
  {date:'2026-08-05', amount:30000, cat:0, special:true},
  {date:'2026-08-05', amount:500,   cat:1, special:false}, // не особая — игнор
  {date:'2026-08-12', amount:2000,  cat:2, special:true},
];
const stats = _specialCatStats(exps);
assert.strictEqual(stats[0].sum, 30000);
assert.strictEqual(stats[0].topDay, 5);
assert.strictEqual(stats[1], undefined);
assert.strictEqual(stats[2].sum, 2000);

// ── _specialForecastByCat: угадана дата, ещё не оплачено ──
const cur = []; // аренда (cat 0) в этом месяце ещё не платили
const hist = [
  {exps:[{date:'2026-07-05', amount:30000, cat:0, special:true}]},
  {exps:[{date:'2026-06-05', amount:30000, cat:0, special:true}]},
  {exps:[{date:'2026-05-06', amount:30000, cat:0, special:true}]},
];
const fc = _specialForecastByCat(cur, hist);
assert.strictEqual(fc.length, 1);
assert.strictEqual(fc[0].cat, 0);
assert.strictEqual(fc[0].unpaid, 30000);
assert.strictEqual(fc[0].guessDay, 5);

// ── _specialForecastByCat: уже оплачено в этом месяце — unpaid=0, не попадает в результат ──
const curPaid = [{date:'2026-08-05', amount:30000, cat:0, special:true}];
const fcPaid = _specialForecastByCat(curPaid, hist);
assert.strictEqual(fcPaid.length, 0);

// ── _specialForecastCumLine: будущая дата — кусок ──
const line1 = _specialForecastCumLine([{unpaid:30000, guessDay:20}], 10, 31, 31);
assert.strictEqual(line1[18], 0);      // день 19 — ещё нет
assert.strictEqual(line1[19], 30000);  // день 20 — весь кусок
assert.strictEqual(line1[30], 30000);  // держится до конца

// ── _specialForecastCumLine: просрочено — на завтра (cD+1) ──
const line2 = _specialForecastCumLine([{unpaid:5000, guessDay:3}], 10, 31, 31);
assert.strictEqual(line2[9], 0);       // день 10 (сегодня, index 9) — 0
assert.strictEqual(line2[10], 5000);   // день 11 (index 10) — кусок

// ── _specialForecastCumLine: не угадали — размазка ──
const line3 = _specialForecastCumLine([{unpaid:2100, guessDay:null}], 10, 31, 31);
// remainDays = 31-10 = 21, per = 100/день
assert.strictEqual(line3[10], 100);    // день 11
assert.strictEqual(line3[30], 2100);   // день 31 — всё накопилось

console.log('OK: all special-forecast tests passed');
```

Запуск:
```bash
node "C:\Users\aanisimov\AppData\Local\Temp\claude\C--Users-aanisimov-code-nto\004f3151-fa61-440d-8a62-1d861a37d210\scratchpad\test-special-forecast.js" "C:\Users\aanisimov\code\nto\index.html"
```
Expected: FAIL (функции ещё не существуют в index.html) — до Step 1 выполнить нельзя проверить успех, поэтому реальный порядок: **Step 1 → Step 2**. После Step 1 — `node ...` должен вывести `OK: all special-forecast tests passed`.

- [ ] **Step 3: Прогнать общий синтаксис-чек index.html**

```bash
node -e "const html=require('fs').readFileSync('index.html','utf8');const re=/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g;let m,ok=true;while((m=re.exec(html))){try{new Function(m[1])}catch(e){ok=false;console.log('FAIL:',e.message)}};console.log(ok?'syntax OK':'ERRORS')"
```
Expected: `syntax OK`

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(stats): чистые функции прогноза особых трат по категориям"
```

---

## Task 2: Вшить прогноз особых в linию «Прогноз»

**Files:**
- Modify: `index.html:3329-3338` (текущий блок построения `projLine` внутри `renderStats()`)

**Interfaces:**
- Consumes (из Task 1): `_regularCumByDay`, `_specialForecastByCat`, `_specialForecastCumLine` — сигнатуры выше.
- Consumes (уже существует в этой области `renderStats`): `selY, selM, cD, daysInSel, displayDays, isCurrentMonth, showFull, selCum, dayInclSpecial, getMonthExpenses(y,m)`.
- Produces: `projLine` (number|null)[], `projTotal` (number|null) — как и раньше, используются в датасете Chart.js ниже по коду (строки ~3412-3423) без изменений.

- [ ] **Step 1: Заменить блок построения projLine**

Найти в `index.html` (текущие строки 3329-3338):
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

Заменить на:
```javascript
    // Прогноз до конца месяца: линейный темп по НЕособым тратам от сегодняшней
    // точки + прогноз особых по категориям (угаданная дата или размазка остатка
    // резерва по оставшимся дням). Следует тумблеру dayInclSpecial — выключен →
    // особые в прогнозе не участвуют. Только текущий месяц + режим «весь месяц».
    let projLine = null, projTotal = null;
    if (isCurrentMonth && showFull && (selCum[cD - 1] || 0) > 0 && cD < daysInSel) {
      const curMonthExps = getMonthExpenses(selY, selM);
      const regularCum = _regularCumByDay(curMonthExps, selY, selM, cD, displayDays);
      const regularPace = (regularCum[cD - 1] || 0) / cD;

      let specialCumLine = null;
      if (dayInclSpecial) {
        const histMonthsExps = [];
        for (let k = 1; k <= 3; k++) {
          let hm = selM - k, hy = selY;
          if (hm < 0) { hm += 12; hy--; }
          histMonthsExps.push({ exps: getMonthExpenses(hy, hm) });
        }
        const forecast = _specialForecastByCat(curMonthExps, histMonthsExps);
        specialCumLine = _specialForecastCumLine(forecast, cD, daysInSel, displayDays);
      }

      projLine = Array.from({length: displayDays}, (_, i) => {
        if (i < cD - 1) return null;
        const spec = specialCumLine ? specialCumLine[i] : 0;
        return Math.round(selCum[cD - 1] + regularPace * (i - (cD - 1)) + spec);
      });
      projLine[cD - 1] = selCum[cD - 1]; // старт из фактической точки
      projTotal = projLine[displayDays - 1];
    }
```

- [ ] **Step 2: Синтаксис-чек**

```bash
node -e "const html=require('fs').readFileSync('index.html','utf8');const re=/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g;let m,ok=true;while((m=re.exec(html))){try{new Function(m[1])}catch(e){ok=false;console.log('FAIL:',e.message)}};console.log(ok?'syntax OK':'ERRORS')"
```
Expected: `syntax OK`

- [ ] **Step 3: Ручная проверка в браузере**

```bash
python3 -m http.server 8080
```
Открыть `http://localhost:8080`, перейти в Аналитику → «День за днём», текущий месяц, режим «весь месяц»:
1. Тумблер «особые» выключен → линия «Прогноз» не дёргается на дни с крупными особыми тратами в прошлом (пунктир идёт ровно по темпу неособых).
2. Тумблер «особые» включён → если есть категория с повторяющейся особой тратой за 1-3 прошлых месяца и в этом месяце она ещё не оплачена — на линии «Прогноз» виден скачок примерно на угаданный день (или к концу месяца, если дата не угадалась). Навести тултип на день скачка — сумма прогноза увеличивается на величину unpaid.
3. Если особая трата этого месяца уже оплачена (факт ≥ план прошлых месяцев) — скачка на линии прогноза для этой категории нет (unpaid=0).
4. Итоговая цифра прогноза (`projTotal`, последняя точка линии) вменяемая — не отрицательная, не в разы больше факта.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(stats): линия Прогноз учитывает особые траты по категориям"
```

---

## Task 3: Версия и деплой

**Files:**
- Modify: `index.html:1217` (About-блок, `v1.37.2` → `v1.38.0`)
- Modify: `sw.js:5` (`const V = '2026-08-04 v1.37.2'` → `'2026-08-07 v1.38.0'`)

**Interfaces:** нет — финальный шаг деплоя.

- [ ] **Step 1: Бампнуть версию в index.html**

Строка 1217: `<div style="font-size:11px;color:var(--hint);margin-top:2px">v1.37.2</div>`
→ `<div style="font-size:11px;color:var(--hint);margin-top:2px">v1.38.0</div>`

- [ ] **Step 2: Бампнуть V в sw.js**

Строка 5: `const V = '2026-08-04 v1.37.2';`
→ `const V = '2026-08-07 v1.38.0';`

- [ ] **Step 3: Синтаксис-чек ещё раз**

```bash
node -e "const html=require('fs').readFileSync('index.html','utf8');const re=/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g;let m,ok=true;while((m=re.exec(html))){try{new Function(m[1])}catch(e){ok=false;console.log('FAIL:',e.message)}};console.log(ok?'syntax OK':'ERRORS')"
```
Expected: `syntax OK`

- [ ] **Step 4: Commit и push**

```bash
git add index.html sw.js
git commit -m "chore: v1.38.0 — прогноз особых трат по категориям в «День за днём»"
git push
```

- [ ] **Step 5: Проверить деплой**

```powershell
& "C:\Program Files\GitHub CLI\gh.exe" api repos/artwem/void/pages/builds/latest --jq '{status,commit}'
```
Expected: `status: "built"`, commit совпадает с только что запушенным.

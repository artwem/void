# Бюджет: расчёт «в день» с учётом особых расходов — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Строка «в день» на вкладке «Бюджет» считает переменные расходы, резервируя особые (аренда, ЖКУ, подписки) по прогнозу, чтобы цифра не прыгала в день оплаты.

**Architecture:** Подтипы `'oneoff'`/`'recurring'` схлопываются в один булев тег «Особое» — новых полей в `DB` нет, миграции нет (старые строковые значения truthy и читаются как особые). Добавляется чистая функция `_budgetFree(y,m,totalSpent,totalLimit)` в секции `═══ budget.js ═══`, её результат потребляет блок `budget-days-row` в `renderBudget()` плюс новая строка `budget-obl-row` с расшифровкой резерва.

**Tech Stack:** Vanilla JS, всё внутри `index.html`. Ни сборки, ни тестов, ни зависимостей.

## Global Constraints

- **`index.html` — единственный реальный источник.** `js/*.js` стухли, править их бессмысленно. Все правки только в `index.html`.
- Все денежные значения в `innerHTML` — через `fmtH()`, иначе приватный режим их не скроет.
- Все выборки расходов фильтруются по `!_deleted` — `getMonthExpenses()` это уже делает.
- Тег `expense.special` — булев: truthy = особое. Старые значения `'oneoff'`/`'recurring'` остаются в базе, проверяются только на truthy, миграция не пишется.
- Терминология: **особые** (тег `special`) и **переменные** (всё остальное).
- Тестов и линтера в проекте нет. Проверка синтаксиса — node-однострочник ниже, остальное вручную в браузере. Не выдумывай тестовый фреймворк и не добавляй зависимостей.
- Деплой: бамп версии в блоке About (`index.html:1051`) **и** `const V` в `sw.js:5`. CSS не трогается — `?v=` бампать не нужно.

**Проверка синтаксиса (используется в каждой задаче):**

```bash
node -e "const html=require('fs').readFileSync('index.html','utf8');const re=/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g;let m,ok=true;while((m=re.exec(html))){try{new Function(m[1])}catch(e){ok=false;console.log('FAIL:',e.message)}};console.log(ok?'syntax OK':'ERRORS')"
```

Ожидаемый вывод: `syntax OK`

---

### Task 1: Схлопнуть «разовое / регулярное» в один тег «Особое»

**Files:**
- Modify: `index.html:626-628`, `index.html:651-653` (сегменты «Тип» в модалках расхода и шаблона)
- Modify: `index.html:1146-1147` (константы бейджа)
- Modify: `index.html:1748`, `index.html:1758` (чтение/запись тега расхода)
- Modify: `index.html:2189`, `index.html:2210` (чтение/запись тега шаблона)
- Modify: `index.html:1823`, `index.html:2067`, `index.html:2127`, `index.html:2156` (отрисовка бейджа)

**Interfaces:**
- Produces: `expense.special` и `template.special` — булев `true` или `null`. Использует Task 2.

- [ ] **Step 1: Сегмент «Тип» в модалке расхода**

`index.html:625-629` — заменить:

```html
      <div class="spec-seg" id="exp-spec-seg">
        <span data-v="" onclick="setExpSpecial('')">Обычный</span>
        <span data-v="oneoff" onclick="setExpSpecial('oneoff')">Разовое</span>
        <span data-v="recurring" onclick="setExpSpecial('recurring')">Регулярное</span>
      </div>
```

на:

```html
      <div class="spec-seg" id="exp-spec-seg">
        <span data-v="" onclick="setExpSpecial('')">Обычный</span>
        <span data-v="1" onclick="setExpSpecial('1')">Особое</span>
      </div>
```

- [ ] **Step 2: Сегмент «Тип» в модалке шаблона**

`index.html:650-654` — заменить:

```html
      <div class="spec-seg" id="tmpl-spec-seg">
        <span data-v="" onclick="setTmplSpecial('')">Обычный</span>
        <span data-v="oneoff" onclick="setTmplSpecial('oneoff')">Разовое</span>
        <span data-v="recurring" onclick="setTmplSpecial('recurring')">Регулярное</span>
      </div>
```

на:

```html
      <div class="spec-seg" id="tmpl-spec-seg">
        <span data-v="" onclick="setTmplSpecial('')">Обычный</span>
        <span data-v="1" onclick="setTmplSpecial('1')">Особое</span>
      </div>
```

- [ ] **Step 3: Константы бейджа**

`index.html:1146-1147` — заменить:

```js
const SPEC_BADGE = {oneoff:'•', recurring:'↻'};
const SPEC_LABEL = {oneoff:'разовое', recurring:'регулярное'};
```

на:

```js
// Тег особого расхода булев. Старые значения 'oneoff'/'recurring' остаются
// в базе и читаются как truthy — миграция не нужна.
const SPEC_BADGE = '✦';
const SPEC_LABEL = 'особое';
```

- [ ] **Step 4: Чтение и запись тега расхода**

`index.html:1748` — заменить:

```js
  setExpSpecial(exp.special||'');
```

на:

```js
  setExpSpecial(exp.special ? '1' : '');
```

`index.html:1758` — заменить:

```js
  const special = _selectedExpSpecial || null;
```

на:

```js
  const special = _selectedExpSpecial ? true : null;
```

- [ ] **Step 5: Чтение и запись тега шаблона**

`index.html:2189` — заменить:

```js
    setTmplSpecial(t.special||'');
```

на:

```js
    setTmplSpecial(t.special ? '1' : '');
```

`index.html:2210` — заменить:

```js
  const special = _selectedTmplSpecial || null;
```

на:

```js
  const special = _selectedTmplSpecial ? true : null;
```

- [ ] **Step 6: Отрисовка бейджа — четыре места**

`index.html:1823` — заменить:

```js
        <div class="exp-list-amount">${fmtH(e.amount)}${e.special?`<span class="spec-badge">${SPEC_BADGE[e.special]||''} ${SPEC_LABEL[e.special]||''}</span>`:''}</div>
```

на:

```js
        <div class="exp-list-amount">${fmtH(e.amount)}${e.special?`<span class="spec-badge">${SPEC_BADGE} ${SPEC_LABEL}</span>`:''}</div>
```

`index.html:2067` — заменить:

```js
          <div class="entry-cat">${esc(catName)}<span class="spec-badge">${SPEC_BADGE[e.special]||''} ${SPEC_LABEL[e.special]||''}</span></div>
```

на:

```js
          <div class="entry-cat">${esc(catName)}<span class="spec-badge">${SPEC_BADGE} ${SPEC_LABEL}</span></div>
```

`index.html:2127` — заменить:

```js
        <div class="entry-cat">${esc(catName)}${e.special?`<span class="spec-badge">${SPEC_BADGE[e.special]||''} ${SPEC_LABEL[e.special]||''}</span>`:''}</div>
```

на:

```js
        <div class="entry-cat">${esc(catName)}${e.special?`<span class="spec-badge">${SPEC_BADGE} ${SPEC_LABEL}</span>`:''}</div>
```

`index.html:2156` — заменить:

```js
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0">${esc(t.name)}${t.special?' '+(SPEC_BADGE[t.special]||''):''}</span><span style="color:var(--muted);font-size:11px;flex-shrink:0"> ${fmtH(t.amount)}</span>
```

на:

```js
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0">${esc(t.name)}${t.special?' '+SPEC_BADGE:''}</span><span style="color:var(--muted);font-size:11px;flex-shrink:0"> ${fmtH(t.amount)}</span>
```

- [ ] **Step 7: Убедиться, что старые обращения не остались**

Run: `grep -n "SPEC_BADGE\[\|SPEC_LABEL\[\|'oneoff'\|'recurring'\|\"oneoff\"\|\"recurring\"" index.html`
Expected: пустой вывод. Любое совпадение — недоделанное место, исправить.

- [ ] **Step 8: Проверка синтаксиса**

Run: node-однострочник из Global Constraints
Expected: `syntax OK`

- [ ] **Step 9: Проверка в браузере**

Run: `python3 -m http.server 8080`, открыть `http://localhost:8080`

Проверить:
1. Вкладка «День» → добавить расход → сегмент «Тип» показывает две кнопки: «Обычный | Особое». Выбрать «Особое», сохранить — в списке бейдж «✦ особое».
2. Открыть этот расход на редактирование — «Особое» подсвечено.
3. Если в базе есть старая запись с типом (бейдж «✦ особое» в списке) — открыть её, убедиться что «Особое» подсвечено, сохранить, бейдж остался.
4. Настройки → шаблоны: то же самое, у шаблона с тегом рядом с названием стоит «✦».

- [ ] **Step 10: Commit**

```bash
git add index.html
git commit -m "refactor(expenses): «разовое/регулярное» схлопнуты в один тег «особое»"
```

---

### Task 2: Функция `_budgetFree()`

**Files:**
- Modify: `index.html` — вставить перед `function renderBudget()` (`index.html:1542`), сразу после строки-заголовка `// ─── RENDER: BUDGET ───`

**Interfaces:**
- Consumes: `getMonthExpenses(y,m)` (`index.html:1417`) — расходы месяца без удалённых; `expense.special` (truthy = особое) из Task 1.
- Produces: `_budgetFree(y, m, totalSpent, totalLimit)` → `{specSpent, specPlan, reserve, varSpent, varLimit, varLeft}`, все значения — числа в рублях. Использует Task 3.

- [ ] **Step 1: Вставить функцию**

`index.html:1541` — после строки `// ─── RENDER: BUDGET ─────────────────────────────────────────────────` и перед `function renderBudget(){` вставить:

```js
// Особые расходы (expense.special) вынимаются из расчёта «в день»: резерв
// берётся по прогнозу, пока факт месяца его не превысит — цифра не прыгает
// в день оплаты аренды. Прогноз — МИНИМУМ особых за 3 прошлых месяца, а не
// среднее: минимум приближает повторяющуюся часть (аренда, ЖКУ, подписки)
// и отсекает разовые всплески — холодильник попадёт лишь в один месяц из трёх.
function _budgetFree(y, m, totalSpent, totalLimit){
  let specSpent = 0;
  getMonthExpenses(y,m).forEach(e => { if(e.special) specSpent += e.amount; });
  // Пустые месяцы пропускаем — иначе новый пользователь получит нулевой прогноз
  let specPlan = null;
  for(let k = 1; k <= 3; k++){
    const d = new Date(y, m - k, 1);
    const exps = getMonthExpenses(d.getFullYear(), d.getMonth());
    if(!exps.length) continue;
    let sum = 0;
    exps.forEach(e => { if(e.special) sum += e.amount; });
    if(specPlan === null || sum < specPlan) specPlan = sum;
  }
  if(specPlan === null) specPlan = 0;
  const reserve  = Math.max(specSpent, specPlan);
  const varSpent = totalSpent - specSpent;
  const varLimit = totalLimit - reserve;
  return {specSpent, specPlan, reserve, varSpent, varLimit, varLeft: varLimit - varSpent};
}
```

- [ ] **Step 2: Проверка синтаксиса**

Run: node-однострочник из Global Constraints
Expected: `syntax OK`

- [ ] **Step 3: Проверка в консоли браузера**

Открыть `http://localhost:8080`, вкладка «Бюджет», в консоли:

```js
_budgetFree(currentMonth.y, currentMonth.m, 0, 0)
```

Ожидается объект с числами. Сверить `specSpent` с суммой особых расходов месяца:

```js
getMonthExpenses(currentMonth.y, currentMonth.m)
  .filter(e => e.special)
  .reduce((s,e) => s + e.amount, 0)
```

Обе цифры должны совпасть. Если особых в этом месяце нет — обе `0`, это валидный результат.

Проверить вырожденный случай (нет особых ни сейчас, ни в прошлом): `reserve === 0`, `varSpent === totalSpent`, `varLimit === totalLimit` — формула схлопывается в текущее поведение.

Проверить прогноз-минимум: если в одном из трёх прошлых месяцев была крупная разовая трата, `specPlan` должен быть **меньше** суммы особых того месяца — минимум её отсёк.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(budget): _budgetFree — резерв под особые расходы"
```

---

### Task 3: Строка «в день» по переменным + расшифровка резерва

**Files:**
- Modify: `index.html:74` (padding существующей строки + новый `div`)
- Modify: `index.html:1628-1657` (блок расчёта в `renderBudget()`; номера строк сдвинуты вставкой из Task 2 — искать по комментарию `// Days remaining row`)

**Interfaces:**
- Consumes: `_budgetFree(y, m, totalSpent, totalLimit)` из Task 2, `fmtH()`.
- Produces: ничего для последующих задач.

- [ ] **Step 1: Добавить контейнер второй строки**

`index.html:74` — заменить:

```html
  <div id="budget-days-row" style="display:none;padding:4px 16px 8px;font-size:12px;color:var(--muted);gap:12px;flex-wrap:wrap"></div>
```

на:

```html
  <div id="budget-days-row" style="display:none;padding:4px 16px 4px;font-size:12px;color:var(--muted);gap:12px;flex-wrap:wrap"></div>
  <div id="budget-obl-row" style="display:none;padding:0 16px 8px;font-size:11px;color:var(--hint);gap:10px;flex-wrap:wrap"></div>
```

Нижний отступ переехал с первой строки на вторую, чтобы при видимой расшифровке между ними не зияла дыра.

- [ ] **Step 2: Переписать блок расчёта**

Найти блок, начинающийся с `// Days remaining row — current month only`, и заменить его целиком:

```js
  // Days remaining row — current month only
  const daysRow = document.getElementById('budget-days-row');
  if(daysRow){
    const now = new Date();
    const isCurrentMonth = (y === now.getFullYear() && m === now.getMonth());
    if(isCurrentMonth && totalLimit > 0){
      const daysInMonth = new Date(y, m+1, 0).getDate();
      const today = now.getDate();
      const daysLeft = daysInMonth - today + 1; // include today
      const daysGone = today - 1;
      const dailyAllowance = daysLeft > 0 ? Math.round(left / daysLeft) : 0;
      const dailySpent = daysGone > 0 ? Math.round(totalSpent / daysGone) : 0;
      const ok = left >= 0 && dailyAllowance >= 0;
      const parts = [
        '<span>📅 ' + daysLeft + ' дн. до конца месяца</span>',
        '<span style="color:' + (ok ? 'var(--green)' : 'var(--red)') + ';font-weight:600">' +
          (ok ? '✓ ' : '⚠ ') + fmtH(Math.abs(dailyAllowance)) + '/день' +
        '</span>',
      ];
      if(daysGone > 0) parts.push('<span>факт ' + fmtH(dailySpent) + '/день</span>');
      if(daysGone > 0 && daysLeft > 0){
        const projected = Math.round(totalSpent + dailySpent * daysLeft);
        const projColor = projected > totalLimit && totalLimit > 0 ? 'var(--red)' : 'var(--muted)';
        parts.push('<span style="color:'+projColor+'">прогноз ' + fmtH(projected) + '</span>');
      }
      daysRow.style.display = 'flex';
      daysRow.innerHTML = parts.join('');
    } else {
      daysRow.style.display = 'none';
    }
  }
```

на:

```js
  // Days remaining row — current month only. Считается по переменным
  // расходам: особые вынуты в резерв (см. _budgetFree).
  const daysRow = document.getElementById('budget-days-row');
  const oblRow  = document.getElementById('budget-obl-row');
  if(daysRow){
    const now = new Date();
    const isCurrentMonth = (y === now.getFullYear() && m === now.getMonth());
    if(isCurrentMonth && totalLimit > 0){
      const daysInMonth = new Date(y, m+1, 0).getDate();
      const today = now.getDate();
      const daysLeft = daysInMonth - today + 1; // include today
      const daysGone = today - 1;
      const f = _budgetFree(y, m, totalSpent, totalLimit);
      const dailyAllowance = (daysLeft > 0 && f.varLimit > 0) ? Math.round(f.varLeft / daysLeft) : 0;
      const dailySpent = daysGone > 0 ? Math.round(f.varSpent / daysGone) : 0;
      const ok = f.varLimit > 0 && f.varLeft >= 0;
      const parts = [
        '<span>📅 ' + daysLeft + ' дн. до конца месяца</span>',
        '<span style="color:' + (ok ? 'var(--green)' : 'var(--red)') + ';font-weight:600">' +
          (ok ? '✓ ' : '⚠ ') + fmtH(Math.abs(dailyAllowance)) + '/день' +
        '</span>',
      ];
      if(daysGone > 0) parts.push('<span>факт ' + fmtH(dailySpent) + '/день</span>');
      if(daysGone > 0 && daysLeft > 0){
        // К прогнозу добавляем ещё не оплаченную часть резерва
        const unpaid = Math.max(0, f.specPlan - f.specSpent);
        const projected = Math.round(totalSpent + unpaid + dailySpent * daysLeft);
        const projColor = projected > totalLimit && totalLimit > 0 ? 'var(--red)' : 'var(--muted)';
        parts.push('<span style="color:'+projColor+'">прогноз ' + fmtH(projected) + '</span>');
      }
      daysRow.style.display = 'flex';
      daysRow.innerHTML = parts.join('');
      if(oblRow){
        if(f.reserve > 0){
          oblRow.style.display = 'flex';
          oblRow.innerHTML = '<span>особые ' + fmtH(f.reserve) + '</span>' +
            '<span>' + (f.specSpent >= f.specPlan ? 'факт' : 'резерв') + '</span>';
        } else oblRow.style.display = 'none';
      }
    } else {
      daysRow.style.display = 'none';
      if(oblRow) oblRow.style.display = 'none';
    }
  }
```

- [ ] **Step 3: Проверка синтаксиса**

Run: node-однострочник из Global Constraints
Expected: `syntax OK`

- [ ] **Step 4: Проверка в браузере**

Открыть `http://localhost:8080`, вкладка «Бюджет», текущий месяц. Проверить по пунктам:

1. Строка «в день» показывает цифру **меньше** прежней, если в месяце есть особые расходы или они были в прошлых месяцах.
2. Под ней вторая строка мельче: `особые 40 000₽ · резерв` (или `факт`, если особые месяца уже перекрыли прогноз).
3. Переключиться на прошлый месяц — обе строки скрываются (как и раньше).
4. Включить приватный режим — сумма во второй строке скрыта шиммер-пилюлей. Если видна, потерян `fmtH()`.
5. Добавить расход с типом «Особое» на текущую дату — после сохранения «в день» не меняется скачком (резерв уже держал эту сумму), пока факт не перекрыл прогноз; при перекрытии подпись меняется с «резерв» на «факт».
6. Если особых нет вообще — вторая строка не рисуется, «в день» совпадает с прежним поведением.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(budget): «в день» считается по переменным расходам"
```

---

### Task 4: Деплой v1.30.0

**Files:**
- Modify: `index.html:1051` (версия в блоке About)
- Modify: `sw.js:5` (`const V`)

- [ ] **Step 1: Бамп версии в About**

`index.html:1051` — заменить `v1.29.1` на `v1.30.0`:

```html
        <div style="font-size:11px;color:var(--hint);margin-top:2px">v1.30.0</div>
```

- [ ] **Step 2: Бамп кэша service worker**

`sw.js:5` — заменить:

```js
const V = '2026-07-21 v1.29.1';
```

на:

```js
const V = '2026-07-21 v1.30.0';
```

- [ ] **Step 3: Проверка синтаксиса**

Run: node-однострочник из Global Constraints
Expected: `syntax OK`

- [ ] **Step 4: Commit и push**

```bash
git add index.html sw.js
git commit -m "feat(budget): v1.30.0 — «в день» по переменным расходам"
git push origin main
```

- [ ] **Step 5: Проверка деплоя**

```powershell
& "C:\Program Files\GitHub CLI\gh.exe" api repos/artwem/void/pages/builds/latest --jq '{status,commit}'
```

Ожидается `status: built` и `commit`, совпадающий с только что запушенным. Если висит в `building`/`queued` дольше пары минут — форсировать сборку:

```powershell
& "C:\Program Files\GitHub CLI\gh.exe" api -X POST repos/artwem/void/pages/builds
```

Открыть `https://artwem.github.io/void/`, убедиться что в About значится v1.30.0.

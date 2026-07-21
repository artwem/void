# Бюджет: расчёт «в день» с учётом обязательных расходов — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Строка «в день» на вкладке «Бюджет» считает переменные расходы, резервируя обязательные (аренда, ЖКУ, подписки) по прогнозу, чтобы цифра не прыгала в день оплаты.

**Architecture:** Новых полей в `DB` нет — используется существующий `expense.special ∈ {null,'oneoff','recurring'}`. Добавляется чистая функция `_budgetFree(y,m,totalSpent,totalLimit)` в секции `═══ budget.js ═══`, её результат потребляет блок `budget-days-row` в `renderBudget()` плюс новая строка `budget-obl-row` с расшифровкой резерва.

**Tech Stack:** Vanilla JS, всё внутри `index.html`. Ни сборки, ни тестов, ни зависимостей.

## Global Constraints

- **`index.html` — единственный реальный источник.** `js/*.js` стухли, править их бессмысленно. Все правки только в `index.html`.
- Все денежные значения в `innerHTML` — через `fmtH()`, иначе приватный режим их не скроет.
- Все выборки расходов фильтруются по `!_deleted` — `getMonthExpenses()` это уже делает.
- Терминология: **обязательные** (тег `special`, подтипы ↻ регулярное / • разовое) и **переменные** (всё остальное). Собирательное «Особые» из UI уходит.
- Тестов и линтера нет. Проверка синтаксиса — node-однострочник из `CLAUDE.md`, остальное вручную в браузере.
- Деплой: бамп версии в блоке About (`index.html:1051`) **и** `const V` в `sw.js:5`. CSS не трогается — `?v=` бампать не нужно.

**Проверка синтаксиса (используется в каждой задаче):**

```bash
node -e "const html=require('fs').readFileSync('index.html','utf8');const re=/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g;let m,ok=true;while((m=re.exec(html))){try{new Function(m[1])}catch(e){ok=false;console.log('FAIL:',e.message)}};console.log(ok?'syntax OK':'ERRORS')"
```

Ожидаемый вывод: `syntax OK`

---

### Task 1: Терминология «Особые» → «Обязательные»

Чисто текстовая задача, отдельно от логики — чтобы правки расчёта потом читались чистым диффом.

**Files:**
- Modify: `index.html:187-189` (переключатель графика «День за днём»)
- Modify: `index.html:2052`, `index.html:2057` (секция в «Аналитике»)
- Modify: `index.html:2868` (комментарий-заголовок секции)

Бейджи `SPEC_BADGE`/`SPEC_LABEL` (`index.html:1146-1147`) **не трогаем** — «↻ регулярное» / «• разовое» и так короткие и точные, меняется только собирательное слово. Сегменты «Тип» в модалках расхода и шаблона (`index.html:626-628`, `651-653`) тоже остаются: «Обычный / Разовое / Регулярное» читаются верно.

- [ ] **Step 1: Переключатель графика**

`index.html:187-188` — заменить:

```html
        <div id="day-special-mode" data-special="1" style="display:flex;font-size:11px;border:1px solid var(--border);border-radius:4px;user-select:none" title="Особые расходы">
          <span id="dsm-on" onclick="setDayInclSpecial(true)" style="padding:2px 6px;cursor:pointer;border-radius:3px 0 0 3px">Особые</span>
```

на:

```html
        <div id="day-special-mode" data-special="1" style="display:flex;font-size:11px;border:1px solid var(--border);border-radius:4px;user-select:none" title="Обязательные расходы">
          <span id="dsm-on" onclick="setDayInclSpecial(true)" style="padding:2px 6px;cursor:pointer;border-radius:3px 0 0 3px">Обязат.</span>
```

Сокращение «Обязат.» — слово целиком раздувает и без того плотный ряд переключателей над графиком.

- [ ] **Step 2: Секция в «Аналитике»**

`index.html:2052` — заменить комментарий:

```js
  // Особые расходы — отдельная приглушённая секция, не в сумме дня
```

на:

```js
  // Обязательные расходы — отдельная приглушённая секция, не в сумме дня
```

`index.html:2057` — заменить:

```js
    hdr.innerHTML = `<span>Особые</span><span>${fmtH(specTotal)}</span>`;
```

на:

```js
    hdr.innerHTML = `<span>Обязательные</span><span>${fmtH(specTotal)}</span>`;
```

- [ ] **Step 3: Комментарий секции**

`index.html:2868` — заменить:

```js
// Особые расходы влияют только на график «День за днём» (там — переключатель).
```

на:

```js
// Обязательные расходы влияют на график «День за днём» (там — переключатель)
// и на расчёт «в день» во вкладке «Бюджет» (см. _budgetFree).
```

- [ ] **Step 4: Проверка синтаксиса**

Run: node-однострочник из Global Constraints
Expected: `syntax OK`

- [ ] **Step 5: Проверка глазами**

Run: `python3 -m http.server 8080`, открыть `http://localhost:8080`

Проверить: Аналитика → над графиком «День за днём» переключатель читается «Обязат. | Без»; ниже по странице секция расходов называется «Обязательные». Слово «Особые» в интерфейсе не встречается.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "refactor(budget): «особые» расходы переименованы в «обязательные»"
```

---

### Task 2: Функция `_budgetFree()`

**Files:**
- Modify: `index.html` — вставить перед `function renderBudget()` (`index.html:1542`), сразу после строки-заголовка `// ─── RENDER: BUDGET ───`

**Interfaces:**
- Consumes: `getMonthExpenses(y,m)` (`index.html:1417`) — расходы месяца без удалённых.
- Produces: `_budgetFree(y, m, totalSpent, totalLimit)` → `{recSpent, oneSpent, recPlan, reserve, varSpent, varLimit, varLeft}`, все значения — числа в рублях. Использует Task 3.

- [ ] **Step 1: Вставить функцию**

`index.html:1541` — после строки `// ─── RENDER: BUDGET ─────────────────────────────────────────────────` и перед `function renderBudget(){` вставить:

```js
// Обязательные расходы (expense.special) вынимаются из расчёта «в день»:
// резерв под регулярку берётся по среднему за 3 прошлых месяца, пока факт
// месяца его не превысит — цифра не прыгает в день оплаты аренды.
// Разовые не прогнозируются, только факт: холодильник покупают один раз.
function _budgetFree(y, m, totalSpent, totalLimit){
  let recSpent = 0, oneSpent = 0;
  getMonthExpenses(y,m).forEach(e => {
    if(e.special === 'recurring') recSpent += e.amount;
    else if(e.special === 'oneoff') oneSpent += e.amount;
  });
  // Среднее регулярных за 3 прошлых месяца. Пустые месяцы пропускаем —
  // иначе новый пользователь получит заниженный резерв.
  let recSum = 0, recMonths = 0;
  for(let k = 1; k <= 3; k++){
    const d = new Date(y, m - k, 1);
    const exps = getMonthExpenses(d.getFullYear(), d.getMonth());
    if(!exps.length) continue;
    recMonths++;
    exps.forEach(e => { if(e.special === 'recurring') recSum += e.amount; });
  }
  const recPlan  = recMonths ? Math.round(recSum / recMonths) : 0;
  const reserve  = Math.max(recSpent, recPlan) + oneSpent;
  const varSpent = totalSpent - recSpent - oneSpent;
  const varLimit = totalLimit - reserve;
  return {recSpent, oneSpent, recPlan, reserve, varSpent, varLimit, varLeft: varLimit - varSpent};
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

Ожидается объект с числами. Осмысленная проверка — сверить `recSpent` с суммой расходов месяца, помеченных «Регулярное»:

```js
getMonthExpenses(currentMonth.y, currentMonth.m)
  .filter(e => e.special === 'recurring')
  .reduce((s,e) => s + e.amount, 0)
```

Обе цифры должны совпасть. Если обязательных в этом месяце нет — обе `0`, это валидный результат.

Проверить вырожденный случай (нет обязательных ни сейчас, ни в прошлом): тогда `reserve === 0`, `varSpent === totalSpent`, `varLimit === totalLimit` — формула схлопывается в текущее поведение.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(budget): _budgetFree — резерв под обязательные расходы"
```

---

### Task 3: Строка «в день» по переменным + расшифровка резерва

**Files:**
- Modify: `index.html:74` (padding существующей строки + новый `div`)
- Modify: `index.html:1628-1657` (блок расчёта в `renderBudget()`)

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

`index.html:1628-1657` — заменить целиком:

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
  // расходам: обязательные вынуты в резерв (см. _budgetFree).
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
        // К прогнозу добавляем ещё не оплаченную часть регулярного резерва
        const unpaid = Math.max(0, f.recPlan - f.recSpent);
        const projected = Math.round(totalSpent + unpaid + dailySpent * daysLeft);
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

- [ ] **Step 3: Проверка синтаксиса**

Run: node-однострочник из Global Constraints
Expected: `syntax OK`

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(budget): «в день» считается по переменным расходам"
```

- [ ] **Step 5: Добавить расшифровку резерва**

В том же блоке, сразу после `daysRow.innerHTML = parts.join('');` вставить:

```js
      if(oblRow){
        if(f.reserve > 0){
          const recVal   = Math.max(f.recSpent, f.recPlan);
          const recLabel = f.recSpent >= f.recPlan ? 'факт' : 'резерв';
          const obl = ['<span>обязательные ' + fmtH(f.reserve) + '</span>'];
          if(recVal > 0)     obl.push('<span>↻ ' + fmtH(recVal) + ' ' + recLabel + '</span>');
          if(f.oneSpent > 0) obl.push('<span>• ' + fmtH(f.oneSpent) + ' факт</span>');
          oblRow.style.display = 'flex';
          oblRow.innerHTML = obl.join('');
        } else oblRow.style.display = 'none';
      }
```

И в ветке `else` (месяц не текущий или лимитов нет) после `daysRow.style.display = 'none';` вставить:

```js
      if(oblRow) oblRow.style.display = 'none';
```

- [ ] **Step 6: Проверка синтаксиса**

Run: node-однострочник из Global Constraints
Expected: `syntax OK`

- [ ] **Step 7: Проверка в браузере**

Открыть `http://localhost:8080`, вкладка «Бюджет», текущий месяц. Проверить по пунктам:

1. Строка «в день» показывает цифру **меньше** прежней, если в месяце есть обязательные расходы или регулярка была в прошлых месяцах.
2. Под ней вторая строка мельче: `обязательные N₽ · ↻ M₽ резерв` (или `факт`, если регулярка месяца уже перекрыла средний прогноз).
3. Переключиться на прошлый месяц — обе строки скрываются (как и раньше).
4. Включить приватный режим — все суммы во второй строке скрыты шиммер-пилюлей. Если хоть одна видна, где-то потерян `fmtH()`.
5. Добавить расход с типом «Регулярное» на текущую дату — после сохранения `↻` растёт, «в день» не меняется скачком (резерв уже держал эту сумму), подпись при перекрытии прогноза меняется с «резерв» на «факт».
6. Если обязательных нет вообще — вторая строка не рисуется, «в день» совпадает с прежним поведением.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "feat(budget): строка расшифровки резерва обязательных"
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

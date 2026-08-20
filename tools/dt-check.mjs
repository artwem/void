// Проверки геометрии десктопной раскладки. Запуск: node tools/dt-check.mjs
import { withPage, rect, cssOf, isVisible } from './harness.mjs';

const results = [];
let current = null;

export function suite(width, title, fn) { SUITES.push({ width, title, fn }); }
export function check(name, fn) { current.checks.push({ name, fn }); }

const SUITES = [];

export function eq(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what}: ожидалось ${expected}, получено ${actual}`);
}
export function near(actual, expected, what, tol = 1) {
  if (Math.abs(actual - expected) > tol) throw new Error(`${what}: ожидалось ~${expected}, получено ${actual}`);
}

// ─── ПРОВЕРКИ ───────────────────────────────────────────────────────
suite(390, 'мобильная база', () => {
  check('body ограничен 430 px', async p => {
    const r = await rect(p, 'body');
    near(r.width, 390, 'ширина body');
    eq(await cssOf(p, 'body', 'maxWidth'), '430px', 'max-width body');
  });
  check('навбар внизу, фиксированный', async p => {
    eq(await cssOf(p, 'nav.nav', 'position'), 'fixed', 'position навбара');
    const r = await rect(p, 'nav.nav');
    near(r.y + r.height, 900, 'низ навбара', 2); // высота вьюпорта в харнессе
  });
  check('контекстной колонки нет', async p => {
    eq(await isVisible(p, '#dt-ctx'), false, 'видимость #dt-ctx');
  });
  check('индикатор активной вкладки анимируется мобильной пилюлей', async p => {
    await p.evaluate(() => window.showPage('income', document.getElementById('nav-income')));
    const anim = await p.evaluate(() =>
      getComputedStyle(document.getElementById('nav-income'), '::before').animationName);
    eq(anim, 'nav-bar-in', 'animation-name у ::before активной вкладки');
  });
});

suite(390, 'типографика', () => {
  check('body набран Golos Text', async p => {
    const ff = await cssOf(p, 'body', 'fontFamily');
    if (!/Golos Text/.test(ff)) throw new Error(`fontFamily = ${ff}`);
  });
  check('оба вендоренных woff2 реально загрузились', async p => {
    const faces = await p.evaluate(async () => {
      // document.fonts.check() бесполезен: возвращает true даже для
      // несуществующего семейства, потому что учитывает фолбэк. Смотрим сам
      // FontFaceSet — в нём лежат только лица, объявленные через @font-face,
      // а status становится 'loaded' лишь после успешной загрузки файла.
      await Promise.allSettled([
        document.fonts.load('400 16px "Golos Text"'),
        document.fonts.load('400 16px "JetBrains Mono"'),
      ]);
      return [...document.fonts].map(f => ({ family: f.family, status: f.status }));
    });
    for (const fam of ['Golos Text', 'JetBrains Mono']) {
      const f = faces.find(x => x.family === fam);
      if (!f) throw new Error(`@font-face для «${fam}» не объявлен. FontFaceSet: ${JSON.stringify(faces)}`);
      if (f.status !== 'loaded') throw new Error(`«${fam}»: status=${f.status}, ожидался loaded`);
    }
  });
  check('денежные значения табличные и моноширинные', async p => {
    await p.evaluate(() => window.showPage('budget', document.getElementById('nav-budget')));
    const got = await p.evaluate(() => {
      const el = document.querySelector('#sum-spent');
      const st = getComputedStyle(el);
      return { fv: st.fontVariantNumeric, ff: st.fontFamily };
    });
    if (!/tabular-nums/.test(got.fv)) throw new Error(`font-variant-numeric = ${got.fv}`);
    if (!/JetBrains Mono/.test(got.ff)) throw new Error(`fontFamily = ${got.ff}`);
  });
});

suite(1280, 'оболочка 1280', () => {
  check('сайдбар слева, 208 px, липкий', async p => {
    eq(await cssOf(p, 'nav.nav', 'position'), 'sticky', 'position навбара');
    const r = await rect(p, 'nav.nav');
    near(r.x, 0, 'левый край навбара');
    near(r.width, 208, 'ширина навбара');
    near(r.height, 900, 'высота навбара');
  });
  check('подписи вкладок видны', async p => {
    eq(await isVisible(p, '#nav-day .nav-lbl'), true, 'видимость подписи');
  });
  check('страница начинается после сайдбара и контекста', async p => {
    const r = await rect(p, '#page-day');
    near(r.x, 504, 'левый край страницы'); // 208 + 296
  });
  check('FAB спрятан', async p => {
    eq(await isVisible(p, '#fab'), false, 'видимость FAB');
  });
  check('индикатор активной вкладки не анимируется мобильной пилюлей', async p => {
    await p.evaluate(() => window.showPage('income', document.getElementById('nav-income')));
    const anim = await p.evaluate(() =>
      getComputedStyle(document.getElementById('nav-income'), '::before').animationName);
    eq(anim, 'none', 'animation-name у ::before активной вкладки');
  });
});

suite(1000, 'оболочка 1000', () => {
  check('сайдбар схлопнут в рельс 64 px', async p => {
    near((await rect(p, 'nav.nav')).width, 64, 'ширина рельса');
    eq(await isVisible(p, '#nav-day .nav-lbl'), false, 'видимость подписи');
  });
});

suite(1280, 'контекстная колонка', () => {
  check('колонка на месте, 296 px, липкая', async p => {
    eq(await isVisible(p, '#dt-ctx'), true, 'видимость #dt-ctx');
    const r = await rect(p, '#dt-ctx');
    near(r.x, 208, 'левый край колонки');
    near(r.width, 296, 'ширина колонки');
    eq(await cssOf(p, '#dt-ctx', 'position'), 'sticky', 'position колонки');
  });
  check('в колонке та же сумма, что на вкладке «Бюджет»', async p => {
    await p.evaluate(() => window.showPage('budget', document.getElementById('nav-budget')));
    const [ctx, page] = await p.evaluate(() => [
      document.querySelector('#dtc-spent').textContent.replace(/\s/g, ''),
      document.querySelector('#sum-spent').textContent.replace(/\s/g, ''),
    ]);
    eq(ctx, page, 'сумма в колонке против суммы на вкладке');
    if (/^0/.test(ctx)) throw new Error('сумма нулевая — фикстура не засеялась');
  });
  check('в колонке тот же остаток, что на вкладке «Бюджет»', async p => {
    await p.evaluate(() => window.showPage('budget', document.getElementById('nav-budget')));
    const [ctx, page] = await p.evaluate(() => [
      document.querySelector('#dtc-left').textContent.replace(/\s/g, ''),
      document.querySelector('#sum-left').textContent.replace(/\s/g, ''),
    ]);
    eq(ctx, page, 'остаток в колонке против остатка на вкладке');
  });
  check('в колонке шесть категорий', async p => {
    const n = await p.evaluate(() => document.querySelectorAll('#dtc-cats .dtc-cat').length);
    eq(n, 6, 'число строк категорий');
  });
  check('помесячная шапка бюджета скрыта', async p => {
    await p.evaluate(() => window.showPage('budget', document.getElementById('nav-budget')));
    eq(await isVisible(p, '#page-budget .month-nav'), false, 'видимость month-nav');
  });
});

suite(1280, 'единый месяц', () => {
  check('переключение месяца в колонке тянет доходы и день', async p => {
    const before = await p.evaluate(() => currentDay);
    await p.evaluate(() => window.dtcMonth(-1));
    const got = await p.evaluate(() => ({
      m: currentMonth.m, y: currentMonth.y,
      inc: currentIncomeMonth, day: currentDay,
    }));
    const mk = `${got.y}-${String(got.m + 1).padStart(2, '0')}`;
    if (!got.day.startsWith(mk)) throw new Error(`currentDay = ${got.day}, ожидался месяц ${mk}`);
    if (!(got.inc && got.inc.y === got.y && got.inc.m === got.m))
      throw new Error(`currentIncomeMonth = ${JSON.stringify(got.inc)}, ожидался ${mk}`);
    if (before === got.day) throw new Error('currentDay не изменился');
  });
  check('колонка показывает тот же месяц', async p => {
    // Сравниваем с той же конвенцией форматирования, что использует само
    // приложение (MONTHS_RU[m]+' '+y — так же на вкладках «Бюджет» и «Доходы»),
    // а не с toLocaleDateString: у него другой регистр и суффикс «г.»,
    // так что строки никогда не совпали бы независимо от значения месяца.
    const [label, state] = await p.evaluate(() => [
      document.getElementById('dtc-month').textContent,
      MONTHS_RU[currentMonth.m] + ' ' + currentMonth.y,
    ]);
    eq(label, state, 'подпись месяца');
  });
});

suite(390, 'месяц на мобиле независим', () => {
  check('changeMonth не трогает день и доходы', async p => {
    const before = await p.evaluate(() => ({ day: currentDay, inc: JSON.stringify(currentIncomeMonth) }));
    await p.evaluate(() => window.changeMonth(-1));
    const after = await p.evaluate(() => ({ day: currentDay, inc: JSON.stringify(currentIncomeMonth) }));
    eq(after.day, before.day, 'currentDay после changeMonth');
    eq(after.inc, before.inc, 'currentIncomeMonth после changeMonth');
  });
});

suite(1600, 'инспектор 1600', () => {
  check('панель записи встаёт четвёртой колонкой', async p => {
    await p.evaluate(() => window.openAddExpense());
    const ins = await rect(p, '#modal-expense .sheet');
    near(ins.width, 380, 'ширина инспектора');
    near(ins.x, 1220, 'левый край инспектора', 2); // 1600 − 380
    near(ins.height, 900, 'высота инспектора');
    eq(await p.evaluate(() => document.body.classList.contains('insp-open')), true, 'класс insp-open');
  });
  check('рабочая область не перекрыта', async p => {
    const page = await rect(p, '#page-day');
    const ins = await rect(p, '#modal-expense .sheet');
    if (page.x + page.width > ins.x + 1)
      throw new Error(`страница заходит под инспектор: ${page.x + page.width} > ${ins.x}`);
  });
  check('Escape закрывает', async p => {
    await p.keyboard.press('Escape');
    eq(await isVisible(p, '#modal-expense'), false, 'видимость модалки');
    eq(await p.evaluate(() => document.body.classList.contains('insp-open')), false, 'класс insp-open');
  });
  check('менеджер открывается диалогом по центру, а не панелью', async p => {
    await p.evaluate(() => window.openCatManager());
    const r = await rect(p, '#modal-cats .sheet');
    if (r.width > 560) throw new Error(`ширина диалога ${r.width}`);
    const cx = r.x + r.width / 2;
    near(cx, 800, 'центр диалога', 4);
    // Ширина ≤560 и горизонтальный центр ≈800 выполняются и на мобильной
    // шторке (align-items:flex-end;justify-content:center + max-width:430px)
    // без единого десктопного правила — они не отличают диалог от шторки.
    // Единственная реальная разница — по вертикали: шторка прижата к низу,
    // диалог центрирован по высоте вьюпорта (900).
    const cy = r.y + r.height / 2;
    near(cy, 450, 'вертикальный центр диалога', 8); // высота вьюпорта харнесса — 900
    if (r.y < 20) throw new Error(`диалог прижат к верху: y=${r.y}`);
    eq(await p.evaluate(() => document.body.classList.contains('insp-open')), false, 'insp-open для диалога');
    await p.keyboard.press('Escape');
  });
});

suite(390, 'модалки на мобиле — шторки', () => {
  check('шторка снизу во всю ширину', async p => {
    await p.evaluate(() => window.openAddExpense());
    const r = await rect(p, '#modal-expense .sheet');
    near(r.width, 390, 'ширина шторки');
    if (r.y + r.height < 800) throw new Error(`шторка не прижата книзу: низ ${r.y + r.height}`);
    await p.evaluate(() => window.closeModal('modal-expense'));
  });
});

// ─── РАННЕР ─────────────────────────────────────────────────────────
const byWidth = new Map();
for (const s of SUITES) {
  current = { checks: [] };
  s.fn();
  byWidth.set(s, current.checks);
}

let failed = 0;
await withPage([...new Set(SUITES.map(s => s.width))], async (page, { width }) => {
  for (const s of SUITES.filter(s => s.width === width)) {
    for (const c of byWidth.get(s)) {
      try {
        await c.fn(page);
        results.push(['ok', width, s.title, c.name, '']);
      } catch (e) {
        failed++;
        results.push(['FAIL', width, s.title, c.name, e.message]);
      }
    }
  }
});

for (const [st, w, t, n, msg] of results) {
  const mark = st === 'ok' ? '  ok  ' : ' FAIL ';
  console.log(`${mark} ${String(w).padStart(4)}  ${t} · ${n}${msg ? '\n        ' + msg : ''}`);
}
console.log(`\n${results.length - failed} из ${results.length} прошло`);
process.exit(failed ? 1 : 0);

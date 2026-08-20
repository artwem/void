// Проверки геометрии десктопной раскладки. Запуск: node tools/dt-check.mjs
import { withPage, rect, cssOf, isVisible, scrollDown, resetScroll } from './harness.mjs';

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
    // «Аналитика» — единственная вкладка, которая на фикстуре заведомо выше
    // вьюпорта (≈1700 px). Без запаса прокрутки проверять липкость не на чем.
    await p.evaluate(() => window.showPage('stats', document.getElementById('nav-stats')));
    eq(await cssOf(p, 'nav.nav', 'position'), 'sticky', 'position навбара');
    const r = await rect(p, 'nav.nav');
    near(r.x, 0, 'левый край навбара');
    near(r.width, 208, 'ширина навбара');
    near(r.height, 900, 'высота навбара');
    // computed position === 'sticky' проверяет лишь то, что в CSS написано
    // слово: при body{height:100%} ряд грида равен вьюпорту, содержащий блок
    // совпадает с самим элементом, свободного хода нет и «липкий» сайдбар
    // уезжает вместе со страницей. Проверяем поведение, а не декларацию.
    const sy = await scrollDown(p, 600);
    near((await rect(p, 'nav.nav')).y, 0, `верх навбара после прокрутки на ${sy}`, 1);
    await resetScroll(p);
  });
  check('подписи вкладок видны', async p => {
    eq(await isVisible(p, '#nav-day .nav-lbl'), true, 'видимость подписи');
  });
  check('страница начинается сразу после сайдбара', async p => {
    // Вкладку задаём явно: у неактивной .page display:none и нулевая геометрия,
    // так что проверка молча зазеленела бы от чужого showPage в соседнем чеке.
    await p.evaluate(() => window.showPage('day', document.getElementById('nav-day')));
    const r = await rect(p, '#page-day');
    near(r.x, 208, 'левый край страницы');
  });
  check('FAB виден — колонки с «+ Расход» больше нет', async p => {
    // Плавающую кнопку прятали, пока добавление жило в контекстной колонке.
    // Колонка снята, и на «Бюджете» FAB — единственный способ внести трату.
    await p.evaluate(() => window.showPage('budget', document.getElementById('nav-budget')));
    eq(await isVisible(p, '#fab'), true, 'видимость FAB на «Бюджете»');
  });
  check('помесячные шапки вернулись на десктоп', async p => {
    await p.evaluate(() => window.showPage('budget', document.getElementById('nav-budget')));
    eq(await isVisible(p, '#page-budget .month-nav'), true, 'шапка «Бюджета»');
    await p.evaluate(() => window.showPage('income', document.getElementById('nav-income')));
    eq(await isVisible(p, '#page-income .month-nav'), true, 'шапка «Доходов»');
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
  check('затемнение инспектора начинается после рельса', async p => {
    await p.evaluate(() => window.openAddExpense());
    const ov = await rect(p, '#modal-expense');
    near(ov.x, 64, 'левый край подложки');
    near(ov.width, 1000 - 64, 'ширина подложки');
    await p.evaluate(() => window.closeModal('modal-expense'));
  });
});

// Колонка была единственным навигатором месяца, поэтому тянула за собой день
// и доходы. Колонки нет — проводки быть не должно нигде, ни на телефоне, ни на ПК.
suite(1280, 'месяц вкладок независим и на десктопе', () => {
  check('changeMonth не трогает день и доходы', async p => {
    const before = await p.evaluate(() => ({ day: currentDay, inc: JSON.stringify(currentIncomeMonth) }));
    await p.evaluate(() => window.changeMonth(-1));
    const after = await p.evaluate(() => ({ day: currentDay, inc: JSON.stringify(currentIncomeMonth) }));
    eq(after.day, before.day, 'currentDay после changeMonth');
    eq(after.inc, before.inc, 'currentIncomeMonth после changeMonth');
    await p.evaluate(() => window.changeMonth(1));
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

suite(1280, 'инспектор 1280', () => {
  check('затемнение не накрывает сайдбар', async p => {
    await p.evaluate(() => window.openAddExpense());
    const ov = await rect(p, '#modal-expense');
    near(ov.x, 208, 'левый край подложки');
    near(ov.width, 1280 - 208, 'ширина подложки');
    const nav = await rect(p, 'nav.nav');
    if (ov.x < nav.x + nav.width - 0.5) throw new Error('подложка заходит на сайдбар');
    await p.evaluate(() => window.closeModal('modal-expense'));
  });
});

suite(1600, 'инспектор 1600', () => {
  check('панель записи встаёт третьей колонкой', async p => {
    // «Аналитика»: вкладка выше вьюпорта, иначе прокручивать нечего и
    // липкость панели не проверить (см. проверку сайдбара).
    await p.evaluate(() => window.showPage('stats', document.getElementById('nav-stats')));
    await p.evaluate(() => window.openAddExpense());
    const ins = await rect(p, '#modal-expense .sheet');
    near(ins.width, 380, 'ширина инспектора');
    near(ins.x, 1220, 'левый край инспектора', 2); // 1600 − 380
    near(ins.height, 900, 'высота инспектора');
    eq(await p.evaluate(() => document.body.classList.contains('insp-open')), true, 'класс insp-open');
    // Геометрия при нулевом скролле ничего не говорит о липкости панели:
    // инлайновый position:relative на .sheet глушил sticky, и панель уезжала
    // вместе со страницей — при scrollY=0 это невидимо.
    // 400, а не 600: у sticky-панели ход ограничен высотой её содержащего
    // блока (оверлей-колонка ≈1500 px минус 900 px самой панели), на 600 она
    // уже упирается в нижнюю границу диапазона и честно отходит на пару
    // пикселей. Без починки панель уехала бы на все −400.
    const sy = await scrollDown(p, 400);
    const ins2 = await rect(p, '#modal-expense .sheet');
    near(ins2.y, 0, `верх инспектора после прокрутки на ${sy}`, 1);
    near(ins2.x, 1220, 'левый край инспектора после прокрутки', 2);
    await resetScroll(p);
  });
  check('рабочая область не перекрыта', async p => {
    // Именно активная вкладка: у скрытой .page display:none и нулевая
    // геометрия, сравнение прошло бы вхолостую.
    const page = await rect(p, '#page-stats');
    if (!page || page.width === 0) throw new Error('активная вкладка не «Аналитика»');
    const ins = await rect(p, '#modal-expense .sheet');
    if (page.x + page.width > ins.x + 1)
      throw new Error(`страница заходит под инспектор: ${page.x + page.width} > ${ins.x}`);
  });
  check('Escape закрывает', async p => {
    await p.keyboard.press('Escape');
    eq(await isVisible(p, '#modal-expense'), false, 'видимость модалки');
    eq(await p.evaluate(() => document.body.classList.contains('insp-open')), false, 'класс insp-open');
  });
  check('клик по подложке снимает insp-open и третью колонку', async p => {
    await p.evaluate(() => window.openAddExpense());
    eq(await p.evaluate(() => document.body.classList.contains('insp-open')), true, 'insp-open после открытия');
    // Кликаем событием, а не координатами: при insp-open панель занимает всю
    // третью колонку, и свободной подложки под курсором может не быть.
    // target === сам оверлей — ровно то, на что реагирует обработчик подложки.
    await p.evaluate(() => document.getElementById('modal-expense')
      .dispatchEvent(new MouseEvent('click', { bubbles: true })));
    eq(await isVisible(p, '#modal-expense'), false, 'видимость модалки');
    eq(await p.evaluate(() => document.body.classList.contains('insp-open')), false, 'класс insp-open');
    const cols = (await cssOf(p, 'body', 'gridTemplateColumns')).trim().split(/\s+/);
    eq(cols.length, 2, `число колонок грида (${cols.join(' ')})`);
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
// Гигиена состояния: каждая сюита получает СВОЮ страницу. Раньше сюиты одной
// ширины делили одну и мутировали общее — активную вкладку, currentMonth,
// DB.expenses, теперь ещё и позицию прокрутки. Порядок объявления случайно
// совпадал с рабочим, и перестановка сюит молча покрасила бы проверки.
// Своя страница дешевле дисциплины «не забудь прибраться»: фикстура
// пересеивается через evaluateOnNewDocument, localStorage/sessionStorage,
// scrollY и активная вкладка стартуют с нуля. Внутри одной сюиты порядок
// по-прежнему значим — там чеки обязаны задавать нужную вкладку сами.
await withPage(SUITES.map(s => s.width), async (page, { width, index }) => {
  const s = SUITES[index];
  for (const c of byWidth.get(s)) {
    try {
      await c.fn(page);
      results.push(['ok', width, s.title, c.name, '']);
    } catch (e) {
      failed++;
      results.push(['FAIL', width, s.title, c.name, e.message]);
    }
  }
});

for (const [st, w, t, n, msg] of results) {
  const mark = st === 'ok' ? '  ok  ' : ' FAIL ';
  console.log(`${mark} ${String(w).padStart(4)}  ${t} · ${n}${msg ? '\n        ' + msg : ''}`);
}
console.log(`\n${results.length - failed} из ${results.length} прошло`);
process.exit(failed ? 1 : 0);

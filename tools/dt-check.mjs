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

// Высоты холстов переехали из инлайновых style в классы, чтобы десктопный CSS
// мог их переопределить. Инлайн бил CSS по специфичности — из-за этого график
// на широкой карточке оставался приплюснутым. Сторожим, что на мобиле значения
// остались ровно прежними: переезд обязан быть визуально безоперационным.
suite(390, 'высоты графиков на мобиле не изменились', () => {
  check('каждый холст сохранил свою прежнюю высоту', async p => {
    await p.evaluate(() => window.showPage('stats', document.getElementById('nav-stats')));
    const got = await p.evaluate(() => {
      const h = id => {
        const el = document.getElementById(id);
        return el ? getComputedStyle(el.parentElement).height : 'НЕТ';
      };
      return { day: h('chartDayCompare'), grouped: h('chartGrouped'), tags: h('chartIncomeTags') };
    });
    eq(got.day, '190px', 'высота «День за днём»');
    eq(got.grouped, '200px', 'высота «Расходы по группам»');
    eq(got.tags, '200px', 'высота «Доходы по тегам»');
    const assets = await p.evaluate(() => {
      window.showPage('assets', document.getElementById('nav-assets'));
      const h = id => getComputedStyle(document.getElementById(id).parentElement).height;
      return { grow: h('chartAssets'), ive: h('chartIncomeVsExp'), rate: h('chartSavingsRate') };
    });
    eq(assets.grow, '180px', 'высота «Рост накоплений»');
    eq(assets.ive, '180px', 'высота «Доходы vs Расходы»');
    eq(assets.rate, '160px', 'высота «Норма накопления»');
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

// Правило вида #page-stats{display:grid} перебивает .page{display:none} по
// специфичности идентификатора, и неактивные страницы остаются на экране,
// просвечивая друг сквозь друга. Геометрические проверки этого не видят —
// они меряют отдельные элементы, а не то, что показано лишнее.
suite(1600, 'на экране только активная страница', () => {
  check('переключение вкладок не оставляет предыдущую видимой', async p => {
    for (const tab of ['stats', 'assets', 'day', 'budget']) {
      await p.evaluate(t => window.showPage(t, document.getElementById('nav-' + t)), tab);
      const shown = await p.evaluate(() => [...document.querySelectorAll('.page')]
        .filter(el => getComputedStyle(el).display !== 'none')
        .map(el => el.id));
      eq(shown.join(','), 'page-' + tab, `видимые страницы после перехода на «${tab}»`);
    }
  });
});

suite(1600, 'раскладка «Аналитики»', () => {
  check('карточки в две колонки, сводка и «День за днём» во всю ширину', async p => {
    await p.evaluate(() => window.showPage('stats', document.getElementById('nav-stats')));
    const cols = (await cssOf(p, '#page-stats', 'gridTemplateColumns')).trim().split(/\s+/);
    eq(cols.length, 2, `число колонок сетки (${cols.join(' ')})`);
    const full = await rect(p, '#cw-daycompare');
    const half = await rect(p, '#cw-pie');
    const other = await rect(p, '#cw-grouped');
    if (!(full.width > half.width * 1.8))
      throw new Error(`«День за днём» не во всю ширину: ${full.width} против ${half.width}`);
    // Две половинчатые карточки обязаны стоять рядом, а не одна под другой
    near(half.y, other.y, 'верх соседних карточек', 2);
    if (other.x <= half.x) throw new Error('карточки не разложились по колонкам');
  });
  check('холст на широкой карточке выше мобильного', async p => {
    const h = await p.evaluate(() =>
      getComputedStyle(document.getElementById('chartGrouped').parentElement).height);
    eq(h, '300px', 'высота холста на десктопе');
  });
});

// Годовой отчёт получил собственный вход в сайдбаре (v1.55.0). Дублирующие
// входы — кнопка в карточке «Аналитики» и «‹» в шапке отчёта — на десктопе
// прячутся классом .dt-hide, на мобиле остаются единственным способом попасть
// в отчёт, поэтому обе стороны границы проверяются явно.
suite(1600, 'годовой отчёт: вход и раскладка', () => {
  check('в сайдбаре своя кнопка, дубли скрыты', async p => {
    await p.evaluate(() => window.showPage('stats', document.getElementById('nav-stats')));
    eq(await isVisible(p, '#nav-report'), true, 'кнопка «Отчёт» в сайдбаре');
    eq(await isVisible(p, '#cw-summary .dt-hide'), false, 'кнопка «Отчёт» в карточке Аналитики');
    await p.evaluate(() => document.getElementById('nav-report').click());
    const shown = await p.evaluate(() => [...document.querySelectorAll('.page')]
      .filter(el => getComputedStyle(el).display !== 'none').map(el => el.id));
    eq(shown.join(','), 'page-report', 'видимые страницы');
    eq(await p.evaluate(() => document.getElementById('nav-report').classList.contains('active')), true,
       'подсветка кнопки отчёта');
    eq(await isVisible(p, '#page-report .dt-hide'), false, 'кнопка «назад» в шапке отчёта');
  });
  check('цифры слева, разрезы справа, сводка во всю ширину', async p => {
    const a = await rect(p, '#rep-col-a');
    const b = await rect(p, '#rep-col-b');
    if (!a || !b || !a.height || !b.height) throw new Error('колонки отчёта пусты');
    near(a.y, b.y, 'верх колонок отчёта', 2);
    if (b.x <= a.x) throw new Error('колонки не разложились: x правой ' + b.x + ', левой ' + a.x);
    near(a.width, b.width, 'ширины колонок', 2);
    const sum = await rect(p, '#rep-summary');
    if (!(sum.width > a.width * 1.8)) throw new Error('сводка не во всю ширину: ' + sum.width);
    const cols = (await cssOf(p, '#rep-summary', 'gridTemplateColumns')).trim().split(/\s+/);
    eq(cols.length, 4, 'колонок в сводке отчёта (' + cols.join(' ') + ')');
  });
});

suite(390, 'годовой отчёт на мобиле не изменился', () => {
  check('вход из карточки, сайдбарной кнопки нет, один столбец', async p => {
    await p.evaluate(() => window.showPage('stats', document.getElementById('nav-stats')));
    eq(await isVisible(p, '#nav-report'), false, 'кнопка «Отчёт» в навбаре');
    eq(await isVisible(p, '#cw-summary .dt-hide'), true, 'кнопка «Отчёт» в карточке Аналитики');
    await p.evaluate(() => document.querySelector('#cw-summary .dt-hide').click());
    eq(await isVisible(p, '#page-report .dt-hide'), true, 'кнопка «назад» в шапке отчёта');
    eq(await p.evaluate(() => document.getElementById('nav-stats').classList.contains('active')), true,
       'подсветка «Аналитики» при открытом отчёте');
    eq(await cssOf(p, '#report-body', 'gridTemplateColumns'), 'none', 'сетка тела отчёта');
    const cols = (await cssOf(p, '#rep-summary', 'gridTemplateColumns')).trim().split(/\s+/);
    eq(cols.length, 2, 'колонок в сводке отчёта (' + cols.join(' ') + ')');
    const a = await rect(p, '#rep-col-a');
    const b = await rect(p, '#rep-col-b');
    if (b.y <= a.y) throw new Error('колонки встали рядом на мобиле');
  });
});

// «День за днём»: на широком экране ось подписывает каждый день, тултип
// ловится наведением в любую точку (mode:'index'), а не попаданием в
// невидимую точку линии — при pointRadius 0 дефолтный nearest+intersect молчит.
suite(1600, '«День за днём» на десктопе', () => {
  check('ось подписывает каждый день', async p => {
    await p.evaluate(() => window.showPage('stats', document.getElementById('nav-stats')));
    const got = await p.evaluate(() => ({
      ticks: charts.dayCompare.scales.x.ticks.length,
      labels: charts.dayCompare.data.labels.length,
      autoSkip: charts.dayCompare.options.scales.x.ticks.autoSkip,
    }));
    eq(got.autoSkip, false, 'autoSkip оси дней');
    eq(got.ticks, got.labels, 'подписей на оси против числа дней');
  });
  check('наведение показывает суммы всех линий за день', async p => {
    const box = await rect(p, '#chartDayCompare');
    await p.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
    await new Promise(r => setTimeout(r, 120));
    const tt = await p.evaluate(() => {
      const t = charts.dayCompare.tooltip;
      return { n: t.getActiveElements().length, title: (t.title || []).join(''), body: (t.body || []).map(b => b.lines.join('')) };
    });
    if (tt.n < 2) throw new Error('тултип поднял ' + tt.n + ' линий — режим index не работает');
    if (!/[0-9]/.test(tt.title)) throw new Error('в заголовке тултипа нет дня: «' + tt.title + '»');
    if (!tt.body.some(l => /₽/.test(l))) throw new Error('в тултипе нет сумм: ' + JSON.stringify(tt.body));
  });
});

suite(390, 'ось «День за днём» на мобиле не изменилась', () => {
  check('подписи прорежены autoSkip', async p => {
    await p.evaluate(() => window.showPage('stats', document.getElementById('nav-stats')));
    const got = await p.evaluate(() => ({
      ticks: charts.dayCompare.scales.x.ticks.length,
      labels: charts.dayCompare.data.labels.length,
      autoSkip: charts.dayCompare.options.scales.x.ticks.autoSkip,
    }));
    eq(got.autoSkip, true, 'autoSkip оси дней');
    if (got.labels > 10 && got.ticks > 10)
      throw new Error('подписей ' + got.ticks + ' при ' + got.labels + ' днях — ось не прорежена');
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

// «Всего активов» в другой валюте (v1.56.0): одна строка под итогом, курс ЦБ,
// кэш в localStorage. Сеть в харнессе недетерминирована, поэтому fetch
// глушится, а курс подкладывается в кэш — проверяем поведение, не API.
const FX_CACHE = JSON.stringify({ date: '2026-08-21', fetchedAt: 1, rates: { USD: 83.355, EUR: 96.7335, CNY: 12.4057 } });
suite(390, 'активы в другой валюте', () => {
  check('с кэшированным курсом строка видна и считает по курсу', async p => {
    await p.evaluate(fx => {
      localStorage.setItem('fxRates', fx);
      localStorage.removeItem('assetsFxCur');
      window.fetch = () => Promise.reject(new Error('offline'));
      window.showPage('assets', document.getElementById('nav-assets'));
    }, FX_CACHE);
    eq(await isVisible(p, '#total-fx'), true, 'видимость строки валюты');
    const t = await p.evaluate(() => document.getElementById('total-fx').textContent);
    // фикстура: 420000 + 310000 = 730000 ₽ / 83.355 = 8757.7 → 8 758 $
    if (!/8[\s\u00a0]758/.test(t) || !/\$/.test(t)) throw new Error('текст строки: «' + t + '»');
    if (!/83,36/.test(t) || !/21\.08/.test(t)) throw new Error('нет курса/даты в строке: «' + t + '»');
  });
  check('тап переключает валюту по кругу и прячет', async p => {
    const tap = () => p.evaluate(() => document.getElementById('total-fx').click());
    const txt = () => p.evaluate(() => document.getElementById('total-fx').textContent);
    await tap(); if (!/€/.test(await txt())) throw new Error('после 1 тапа не евро: «' + await txt() + '»');
    await tap(); if (!/¥/.test(await txt())) throw new Error('после 2 тапов не юань: «' + await txt() + '»');
    await tap(); eq(await isVisible(p, '#total-fx'), false, 'после 3 тапов строка скрыта');
    // Скрытая строка недоступна для тапа — возвращаемся через сеттер
    await p.evaluate(() => window.setAssetsFxCur('USD'));
    if (!/\$/.test(await txt())) throw new Error('после возврата не доллар: «' + await txt() + '»');
    eq(await p.evaluate(() => localStorage.getItem('assetsFxCur')), 'USD', 'выбор сохранён device-locally');
  });
  check('без кэша и без сети строки нет', async p => {
    await p.evaluate(() => {
      localStorage.removeItem('fxRates');
      window.fetch = () => Promise.reject(new Error('offline'));
      window.renderAssets();
    });
    // renderAssets ждёт fetch асинхронно — даём обещанию отвергнуться
    await new Promise(r => setTimeout(r, 100));
    eq(await isVisible(p, '#total-fx'), false, 'видимость строки без курса');
  });
});

// Поиск по тратам переехал с «Дня» в «Аналитику» (v1.56.0): вкладка «День» —
// про один день, поиск — по всей истории с ограничением периода. Вместе с ним
// переехали чипы категорий: на «Дне» они были тем же поиском, только по категории.
suite(390, 'поиск по тратам живёт в «Аналитике»', () => {
  check('на «Дне» поля поиска и чипов категорий больше нет', async p => {
    await p.evaluate(() => window.showPage('day', document.getElementById('nav-day')));
    eq(await p.evaluate(() => !!document.getElementById('expense-search')), false, 'поле #expense-search на «Дне»');
    eq(await p.evaluate(() => !!document.querySelector('#page-day #expense-cat-filter')), false, 'чипы #expense-cat-filter на «Дне»');
  });
  check('запрос находит записи и считает сумму', async p => {
    await p.evaluate(() => window.showPage('stats', document.getElementById('nav-stats')));
    eq(await isVisible(p, '#exp-search'), true, 'поле поиска в «Аналитике»');
    await p.evaluate(() => { const i = document.getElementById('exp-search'); i.value = 'ашан'; i.dispatchEvent(new Event('input')); });
    const t = await p.evaluate(() => document.getElementById('exp-search-result').textContent);
    // Счётчик — из своего span: в textContent карточки он склеивается с суммой («Найдено: 1» + «5 000₽»)
    const cnt = await p.evaluate(() => document.querySelector('#exp-search-result span').textContent);
    if (!/Найдено:\s*1$/.test(cnt)) throw new Error('счётчик: «' + cnt + '»');
    if (!/5[\s\u00a0]000/.test(t)) throw new Error('сумма: «' + t.slice(0, 120) + '»');
  });
  check('период ограничивает выдачу, разбивка по месяцам есть', async p => {
    // Подсыпаем трату четырёхмесячной давности с тем же комментарием
    await p.evaluate(() => {
      const d = new Date(); d.setMonth(d.getMonth() - 4);
      const ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-10';
      DB.expenses.push({ id: 'eOld', date: ds, cat: 1, catId: 'cat0002', amount: 777, comment: 'Ашан старый', updatedAt: 1 });
    });
    const res = () => p.evaluate(() => document.querySelector('#exp-search-result span').textContent);
    await p.evaluate(() => window.setExpSearchPeriod(3));
    if (!/Найдено:\s*1\b/.test(await res())) throw new Error('период 3 мес не отсёк старую запись: «' + (await res()).slice(0, 120) + '»');
    await p.evaluate(() => window.setExpSearchPeriod('all'));
    const t = await res();
    if (!/Найдено:\s*2\b/.test(t)) throw new Error('период «всё» не вернул обе: «' + t.slice(0, 120) + '»');
    // Разбивка по месяцам: две разные суммы на двух разных месяцах
    const months = await p.evaluate(() => [...document.querySelectorAll('#exp-search-months span')].map(x => x.textContent));
    if (months.length < 2) throw new Error('разбивки по месяцам нет: ' + JSON.stringify(months));
    eq(await p.evaluate(() => sessionStorage.getItem('expSearchPeriod')), 'all', 'период сохранён в sessionStorage');
  });
  check('тап по дате выдачи уводит на «День» в тот день', async p => {
    await p.evaluate(() => document.querySelector('#exp-search-result [data-date]').click());
    eq(await p.evaluate(() => currentPage), 'day', 'активная вкладка');
    const got = await p.evaluate(() => ({ cur: currentDay, active: document.getElementById('nav-day').classList.contains('active') }));
    if (!/-10$/.test(got.cur) && !/-\d\d$/.test(got.cur)) throw new Error('currentDay=' + got.cur);
    eq(got.active, true, 'подсветка вкладки «День»');
  });
});

suite(1600, 'карточка поиска на десктопе во всю ширину', () => {
  check('#cw-search растянута на обе колонки', async p => {
    await p.evaluate(() => window.showPage('stats', document.getElementById('nav-stats')));
    const full = await rect(p, '#cw-search');
    const half = await rect(p, '#cw-pie');
    if (!(full.width > half.width * 1.8)) throw new Error('поиск не во всю ширину: ' + full.width + ' против ' + half.width);
  });
});

// Знак V.O.I.D. (v1.57.0): один SVG на все места вместо трёх разных
// логотипов, currentColor вместо захардкоженного чёрного (на тёмных темах
// прежний знак сливался с фоном), и своё место — сайдбар на десктопе,
// иконка запуска на телефоне.
suite(1280, 'знак в сайдбаре', () => {
  check('виден над вкладками и подписан на широком сайдбаре', async p => {
    eq(await isVisible(p, '.nav-brand'), true, 'видимость знака');
    eq(await isVisible(p, '.nav-brand .nav-lbl'), true, 'подпись V.O.I.D.');
    const brand = await rect(p, '.nav-brand');
    const first = await rect(p, '#nav-day');
    if (brand.y + brand.height > first.y + 1)
      throw new Error('знак не над вкладками: низ ' + (brand.y + brand.height) + ', верх «Дня» ' + first.y);
  });
  check('цвет берётся из темы, а не захардкожен', async p => {
    const fill = t => p.evaluate(th => {
      window.setTheme(th);
      return getComputedStyle(document.querySelector('.nav-brand svg circle')).fill;
    }, t);
    const light = await fill('light'), dark = await fill('dark');
    if (light === dark) throw new Error('знак не меняет цвет со сменой темы: ' + light);
    // В тёмной теме знак обязан быть светлым, иначе сольётся с фоном
    const [r, g, b] = dark.match(/\d+/g).map(Number);
    if ((r + g + b) / 3 < 128) throw new Error('в тёмной теме знак тёмный: ' + dark);
    await p.evaluate(() => window.setTheme('auto'));
  });
});

suite(390, 'на телефоне знака в интерфейсе нет', () => {
  check('ни в навбаре, ни в шапке «Бюджета»', async p => {
    eq(await isVisible(p, '.nav-brand'), false, 'знак в мобильном навбаре');
    await p.evaluate(() => window.showPage('budget', document.getElementById('nav-budget')));
    eq(await p.evaluate(() => !!document.querySelector('#page-budget svg')), false, 'знак в шапке «Бюджета»');
  });
});

suite(390, 'иконки приложения', () => {
  check('фавикон объявлен и это SVG', async p => {
    const icon = await p.evaluate(() => {
      const l = document.querySelector('link[rel="icon"]');
      return l ? { href: l.getAttribute('href'), type: l.getAttribute('type') } : null;
    });
    if (!icon) throw new Error('link[rel=icon] отсутствует — вкладка браузера без иконки');
    eq(icon.type, 'image/svg+xml', 'тип фавикона');
    if (!/^data:image\/svg\+xml,/.test(icon.href)) throw new Error('фавикон не data-URI: ' + icon.href.slice(0, 40));
    const svg = decodeURIComponent(icon.href.replace('data:image/svg+xml,', ''));
    // v1.57.0 задавал цвета через <style>, а CSS перебивает presentation-атрибут
    // fill="none" — дуги залились сегментами, и во вкладке была клякса вместо
    // кольца. Цвета обязаны стоять атрибутами на самих фигурах.
    if (/<style/.test(svg)) throw new Error('в фавиконе снова <style> — он перебьёт fill="none" у дуг');
    if (!/fill='none'|fill="none"/.test(svg)) throw new Error('дуги фавикона без fill=none — зальются сегментами');
    // Плашка: одинаково читается в светлой и тёмной вкладке, не зависит от
    // того, поддерживает ли браузер @media внутри фавикона.
    if (!/<rect/.test(svg)) throw new Error('фавикон без плашки-подложки');
  });
  check('манифест отдаёт тот же знак, а не старое «₽»', async p => {
    const icons = await p.evaluate(async () => {
      const r = await fetch(document.querySelector('link[rel=manifest]').href);
      return (await r.json()).icons.map(i => i.src);
    });
    eq(icons.length, 3, 'число иконок манифеста');
    for (const src of icons) {
      if (/text|%E2%82%BD|₽/.test(src)) throw new Error('в манифесте осталась старая иконка с ₽');
      if (!src.includes('circle')) throw new Error('иконка манифеста без знака: ' + src.slice(0, 60));
    }
  });
});

// Массовая подстановка средних в редакторе лимитов однажды стёрла настроенный
// август целиком: «подставить все» заполняло 17 полей без вопроса, «Сохранить»
// записывало их без пути назад, а средние выглядят правдоподобно — заметны
// только выбросы. Сторожим оба барьера: вопрос перед подстановкой и отмену
// после сохранения.
suite(390, 'лимиты: подтверждение и отмена', () => {
  const openEditor = p => p.evaluate(() => {
    window.showPage('budget', document.getElementById('nav-budget'));
    window.openLimitEditor();
    return [...document.querySelectorAll('.limit-edit-input')].map(i => i.value);
  });

  check('«подставить все» спрашивает, и отказ ничего не меняет', async p => {
    const before = await openEditor(p);
    const got = await p.evaluate(() => {
      let asked = 0;
      const orig = window.confirm;
      window.confirm = () => { asked++; return false; };
      window.applyAllLimitAvgs();
      window.confirm = orig;
      return { asked, vals: [...document.querySelectorAll('.limit-edit-input')].map(i => i.value) };
    });
    eq(got.asked, 1, 'число вопросов перед массовой подстановкой');
    eq(got.vals.join('|'), before.join('|'), 'значения полей после отказа');
  });

  check('согласие подставляет средние и помечает изменённые поля', async p => {
    await openEditor(p);
    const got = await p.evaluate(() => {
      // Поле «Еда вне дома» заранее равно своему ⌀ — подстановка его не меняет,
      // значит и метки на нём быть не должно: пометка означает «строка уехала».
      document.getElementById('lim_2').value = '8000';
      const orig = window.confirm;
      window.confirm = () => true;
      window.applyAllLimitAvgs();
      window.confirm = orig;
      const inp = [...document.querySelectorAll('.limit-edit-input')];
      return {
        rent: inp[0].value,
        noHistory: inp[5].value,
        marked: inp.filter(i => i.style.background).length,
        same: inp[2].style.background || '',
      };
    });
    // Аренда: единственный прошлый месяц с данными даёт ⌀ = 30 000
    eq(got.rent, '30000', 'подставленное среднее по аренде');
    eq(got.noHistory, '0', 'категория без трат получает ⌀ = 0');
    eq(got.marked, 6, 'сколько полей подсвечено как изменённые');
    eq(got.same, '', 'совпавшее со средним поле не помечено');
  });

  check('после «Сохранить» отмена возвращает прежние лимиты', async p => {
    await openEditor(p);
    const got = await p.evaluate(async () => {
      const key = document.getElementById('limit-month-sel').value;
      const before = JSON.stringify(DB.limits[key]);
      const orig = window.confirm;
      window.confirm = () => true;
      window.applyAllLimitAvgs();
      window.confirm = orig;
      window.saveLimits();
      const after = JSON.stringify(DB.limits[key]);
      const btn = document.querySelector('#toast .toast-undo');
      if (btn) btn.click();
      return { before, after, undone: JSON.stringify(DB.limits[key]), hadBtn: !!btn };
    });
    if (!got.hadBtn) throw new Error('после сохранения лимитов нет кнопки «Отменить»');
    if (got.before === got.after) throw new Error('подстановка не изменила лимиты — проверка вакуумна');
    eq(got.undone, got.before, 'лимиты после отмены');
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

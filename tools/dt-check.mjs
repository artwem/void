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
  check('двойной тап не зумит: touch-action стоит на элементах, а не только на body', async p => {
    // touch-action не наследуется. Пока правило висело только на html,body,
    // Safari гасил double-tap-to-zoom по голому фону, но зумил по любой
    // карточке, кнопке или строке — то есть по всему, куда реально тычут.
    const got = await p.evaluate(() => {
      const sel = ['.s-card', 'nav.nav button', '.day-total', '#cat-list'];
      return sel.map(s => {
        const el = document.querySelector(s);
        return s + '=' + (el ? getComputedStyle(el).touchAction : 'НЕТ');
      });
    });
    const bad = got.filter(x => !x.endsWith('=manipulation'));
    if (bad.length) throw new Error('без touch-action: ' + bad.join(', '));
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
// Валюта итога переключалась тапом по самой строке: USD → EUR → CNY → скрыть,
// и «скрыть» было тупиком — вернуться можно было только из консоли. Заменено
// сегмент-переключателем ₽ $ € ¥ (v1.58.0): выключенное состояние видимо и
// обратимо, а сам переключатель существует, даже когда пересчёта нет.
suite(390, 'активы в другой валюте', () => {
  const openAssets = (p, fx) => p.evaluate((f, cur) => {
    if (f) localStorage.setItem('fxRates', f); else localStorage.removeItem('fxRates');
    if (cur === null) localStorage.removeItem('assetsFxCur'); else localStorage.setItem('assetsFxCur', cur);
    window.fetch = () => Promise.reject(new Error('offline'));
    window.showPage('assets', document.getElementById('nav-assets'));
  }, fx, null);
  const txt = p => p.evaluate(() => document.getElementById('total-fx-txt').textContent);
  const active = p => p.evaluate(() => ['RUB', 'USD', 'EUR', 'CNY']
    .filter(c => document.getElementById('fxc-' + c).style.fontWeight === '600').join(','));
  const tap = (p, c) => p.evaluate(cur => document.getElementById('fxc-' + cur).click(), c);

  check('с кэшированным курсом строка видна и считает по курсу', async p => {
    await openAssets(p, FX_CACHE);
    eq(await isVisible(p, '#total-fx'), true, 'видимость блока валюты');
    const t = await txt(p);
    // фикстура: 420000 + 310000 = 730000 ₽ / 83.355 = 8757.7 → 8 758 $
    if (!/8[\s ]758/.test(t) || !/\$/.test(t)) throw new Error('текст строки: «' + t + '»');
    if (!/83,36/.test(t) || !/21\.08/.test(t)) throw new Error('нет курса/даты в строке: «' + t + '»');
  });

  check('переключатель — четыре ячейки, выбранная подсвечена', async p => {
    await openAssets(p, FX_CACHE);
    const cells = await p.evaluate(() => [...document.querySelectorAll('#total-fx-seg > span')]
      .map(s => s.textContent.trim()));
    eq(cells.join(''), '₽$€¥', 'состав переключателя');
    eq(await active(p), 'USD', 'подсвеченная валюта по умолчанию');
  });

  check('выбор ₽ гасит пересчёт, но переключатель остаётся на экране', async p => {
    await openAssets(p, FX_CACHE);
    await tap(p, 'RUB');
    eq(await txt(p), '', 'текст пересчёта после выбора ₽');
    eq(await active(p), 'RUB', 'подсветка после выбора ₽');
    eq(await isVisible(p, '#total-fx-seg'), true, 'переключатель виден в рублёвом режиме');
    // Тупик прошлой версии: из скрытого состояния не было пути назад
    await tap(p, 'USD');
    if (!/\$/.test(await txt(p))) throw new Error('возврат к доллару не сработал: «' + await txt(p) + '»');
  });

  check('выбор валюты меняет и сумму, и подсветку, и переживает перерисовку', async p => {
    await openAssets(p, FX_CACHE);
    await tap(p, 'EUR');
    // 730000 / 96.7335 = 7546.8 → 7 547 €
    if (!/7[\s ]547/.test(await txt(p)) || !/€/.test(await txt(p)))
      throw new Error('после выбора евро: «' + await txt(p) + '»');
    eq(await active(p), 'EUR', 'подсветка после выбора евро');
    eq(await p.evaluate(() => localStorage.getItem('assetsFxCur')), 'EUR', 'выбор сохранён device-locally');
    await p.evaluate(() => window.renderAssets());
    eq(await active(p), 'EUR', 'подсветка после перерисовки вкладки');
  });

  check('без курса переключатель на месте, вместо суммы — «курс недоступен»', async p => {
    await openAssets(p, null);
    await new Promise(r => setTimeout(r, 100)); // даём отвергнуться обещанию fetch
    eq(await isVisible(p, '#total-fx-seg'), true, 'переключатель без курса');
    if (!/недоступен/.test(await txt(p))) throw new Error('текст без курса: «' + await txt(p) + '»');
    // Рублёвый режим ничего не пересчитывает — жаловаться не на что
    await tap(p, 'RUB');
    eq(await txt(p), '', 'текст в рублёвом режиме без курса');
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
    // Знак = залитый диск плюс две дуги, единственный <circle> в разметке.
    // Раньше здесь стояло «любой svg на вкладке», но с v1.58.1 в интерфейсе
    // появились значки-иконки (карандаш «Лимиты»), и прокси стал ловить их.
    eq(await p.evaluate(() => !!document.querySelector('#page-budget svg circle')), false, 'знак в шапке «Бюджета»');
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

// ✕ ✓ ✎ ⚠ ↻ в Golos Text отсутствуют: как текст они уезжали в системный
// шрифт — чужое начертание рядом со своим, а ⚠ на iOS ещё и цветная эмодзи
// вместо значка по теме. Заменены на спрайт <symbol> + <use>: цвет берётся
// из currentColor, размер — из font-size, от гарнитуры больше не зависят.
suite(390, 'значки интерфейса — иконки, а не символы шрифта', () => {
  const GLYPHS = '✕✓✎⚠↻';

  check('спрайт объявлен и содержит все пять знаков', async p => {
    const ids = await p.evaluate(() =>
      [...document.querySelectorAll('#ico-sprite symbol')].map(s => s.id).sort().join(','));
    eq(ids, 'i-check,i-close,i-edit,i-refresh,i-warn', 'символы спрайта');
    // Спрайт обязан стоять раньше первой ссылки, иначе Safari рисует пустоту
    const ok = await p.evaluate(() => {
      const sp = document.getElementById('ico-sprite');
      const first = document.querySelector('use');
      return !!sp && !!first && (sp.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    });
    eq(ok, true, 'спрайт стоит до первого <use>');
  });

  check('крестик каждой модалки — иконка, шрифтового знака не осталось', async p => {
    const got = await p.evaluate(() => {
      const btns = [...document.querySelectorAll('.close-btn')];
      return {
        n: btns.length,
        withIcon: btns.filter(b => b.querySelector('use[href="#i-close"]')).length,
        withGlyph: btns.filter(b => b.textContent.includes('✕')).length,
      };
    });
    if (got.n < 20) throw new Error('модалок с крестиком всего ' + got.n + ' — проверка не о том');
    eq(got.withIcon, got.n, 'кнопок с иконкой из ' + got.n);
    eq(got.withGlyph, 0, 'кнопок, где остался символ ✕');
  });

  check('иконка красится темой, а не своим цветом', async p => {
    const got = await p.evaluate(() => {
      const b = document.querySelector('.close-btn');
      const svg = b.querySelector('svg.ico');
      return { stroke: getComputedStyle(svg).stroke, color: getComputedStyle(b).color,
               fill: getComputedStyle(svg).fill };
    });
    eq(got.stroke, got.color, 'обводка иконки против цвета кнопки');
    eq(got.fill, 'none', 'заливка иконки');
  });

  check('карандаш правки и значок аудита тоже иконки', async p => {
    const got = await p.evaluate(() => {
      window.showPage('day', document.getElementById('nav-day'));
      // Сегодня трат может не быть — открываем день с записью через тот же
      // путь, что и календарь: currentDay объявлен через let и в window не живёт.
      window.onDayCalChange(DB.expenses.find(e => !e._deleted).date);
      const pencil = document.querySelector('#entry-list .entry-del');
      window.showPage('assets', document.getElementById('nav-assets'));
      const badge = document.getElementById('assets-audit-badge');
      return {
        pencil: pencil ? !!pencil.querySelector('use[href="#i-edit"]') : 'кнопки правки нет',
        pencilGlyph: pencil ? pencil.textContent.includes('✎') : false,
        badge: !!badge.querySelector('use[href="#i-warn"]'),
        badgeGlyph: badge.textContent.includes('⚠'),
      };
    });
    eq(got.pencil, true, 'карандаш в списке трат — иконка');
    eq(got.pencilGlyph, false, 'символ ✎ остался в кнопке правки');
    eq(got.badge, true, 'значок аудита — иконка');
    eq(got.badgeGlyph, false, 'символ ⚠ остался в значке аудита');
  });

  check('подстановки значков раскрыты, а не выведены текстом', async p => {
    // ICO.* подставляется и в шаблонные литералы (${ICO.check}), и в склейку
    // строк ('+ICO.check+'). Перепутать легко: ${…} внутри одинарных кавычек
    // молча печатается как есть, и ошибку видно только глазами на нужной ветке.
    const dirty = [];
    for (const pg of ['day', 'budget', 'income', 'stats', 'assets', 'settings']) {
      const bad = await p.evaluate(n => {
        window.showPage(n, document.getElementById('nav-' + n));
        // Только контейнер вкладки: в body.innerHTML попадает и весь инлайновый
        // <script>, где эти строки лежат в исходном виде — проверка бы всегда врала.
        const h = document.getElementById('page-' + n).innerHTML;
        // Только сырая подстановка: «undefined» в разметке встречается
        // законно в чужих местах и к значкам отношения не имеет.
        return h.includes('${ICO.') || h.includes('[object') ? n : null;
      }, pg);
      if (bad) dirty.push(bad);
    }
    if (dirty.length) throw new Error('сырая подстановка на вкладках: ' + dirty.join(', '));
  });

  check('в кнопках интерфейса не осталось шрифтовых значков', async p => {
    const left = await p.evaluate(g => {
      const out = [];
      document.querySelectorAll('button, .sec-action').forEach(el => {
        const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('');
        for (const ch of g) if (own.includes(ch)) out.push(ch + ' @ ' + (el.className || el.id || el.tagName));
      });
      return out;
    }, GLYPHS);
    if (left.length) throw new Error('осталось ' + left.length + ': ' + left.slice(0, 4).join('; '));
  });
});

// Дневной конверт: «Остаток на сегодня» на вкладке «День» и первая строка шапки
// «Бюджета». Абсолютную сумму не проверяем — она зависит от даты прогона и от
// резерва особых; стережём поведение конверта, ради которого он и делался:
// знаменатель дня («из N ₽») в течение дня стоит на месте, а остаток тает ровно
// на сумму траты. Порядок чеков значим — они накапливают траты в DB.
suite(390, 'остаток на сегодня', () => {
  const read = p => p.evaluate(() => {
    const box = document.getElementById('day-envelope');
    const nums = t => (t.replace(/[   ](?=\d)/g, '').match(/-?\d+/g) || []).map(Number);
    const sub = nums(box.querySelector('.day-env-sub').textContent);
    return {
      lbl: box.querySelector('.day-env-lbl').textContent,
      val: nums(box.querySelector('.day-env-val').textContent)[0],
      cls: box.querySelector('.day-env-val').className,
      cap: sub[0], spent: sub[1],
    };
  });
  const addToday = (p, e) => p.evaluate(ex => {
    DB.expenses.push(Object.assign({ date: today(), catId: 'cat0002', cat: 1, comment: '', updatedAt: 1 }, ex));
    renderDay();
  }, e);

  check('на сегодняшней дате блок виден, остаток = потолок дня минус траты дня', async p => {
    // Базовая фикстура сидит в перерасходе (лимит 76 249 против 88 200 трат),
    // а конверт надо проверять и в зелёной ветке — поднимаем лимиты на этой
    // странице. Своя страница у каждой сюиты, чужие проверки это не задевает.
    await p.evaluate(() => {
      const now = new Date();
      DB.limits[monthKey(now.getFullYear(), now.getMonth())] = DB.categories.map(() => 30000);
      saveDB();
      window.showPage('day', document.getElementById('nav-day'));
    });
    eq(await isVisible(p, '#day-envelope'), true, 'видимость блока');
    const g = await read(p);
    eq(g.lbl, 'Остаток на сегодня', 'подпись');
    eq(g.val, g.cap - g.spent, 'остаток = «из N» − «потрачено»');
  });

  check('трата уменьшает остаток ровно на себя, потолок дня не прыгает', async p => {
    const before = await read(p);
    await addToday(p, { id: 'eEnv1', amount: 1000 });
    const after = await read(p);
    eq(after.cap, before.cap, 'потолок дня после траты');
    eq(after.spent, before.spent + 1000, '«потрачено» после траты');
    eq(after.val, before.val - 1000, 'остаток после траты');
  });

  check('особая трата не съедает день целиком, а размазывается по остатку месяца', async p => {
    // Аренда, оплаченная сегодня, не должна обнулять дневной конверт — она живёт
    // в резерве особых (_budgetFree). Но если особых потрачено больше, чем было
    // зарезервировано, свободных денег в месяце реально меньше: превышение
    // делится на оставшиеся дни. Здесь резерв уже выбран, поэтому 9 000 ₽ снимают
    // с сегодняшнего остатка ровно 9000/дней_до_конца, а не все 9 000.
    const before = await read(p);
    const daysLeft = await p.evaluate(() => {
      const n = new Date();
      return new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate() - n.getDate() + 1;
    });
    await addToday(p, { id: 'eEnv2', amount: 9000, catId: 'cat0001', cat: 0, special: true });
    const after = await read(p);
    eq(after.spent, before.spent, '«потрачено сегодня» не считает особые');
    near(before.val - after.val, Math.round(9000 / daysLeft), 'просадка остатка от особой траты', 1);
  });

  check('перерасход подписан словом и покрашен красным', async p => {
    const before = await read(p);
    await addToday(p, { id: 'eEnv3', amount: before.val + 340 });
    const g = await read(p);
    eq(g.lbl, 'Перерасход', 'подпись при перерасходе');
    eq(g.cls.includes('over'), true, 'класс .over: ' + g.cls);
    eq(g.val, 340, 'величина перерасхода');
  });

  check('в шапке «Бюджета» ровно та же цифра', async p => {
    const day = await read(p);
    const bud = await p.evaluate(() => {
      window.showPage('budget', document.getElementById('nav-budget'));
      const row = document.getElementById('budget-days-row');
      const head = row.firstElementChild.textContent;
      return { head, num: Number((head.replace(/[   ](?=\d)/g, '').match(/-?\d+/) || [0])[0]) };
    });
    eq(bud.head.includes('Перерасход сегодня'), true, 'подпись в шапке: «' + bud.head + '»');
    eq(bud.num, day.val, 'сумма в шапке «Бюджета» и на «Дне»');
  });

  check('на не-сегодняшней дате блока нет', async p => {
    await p.evaluate(() => {
      window.showPage('day', document.getElementById('nav-day'));
      window.changeDay(-1);
    });
    eq(await isVisible(p, '#day-envelope'), false, 'блок на вчерашней дате');
  });
});

// Ручная бронь особых: прогноз резервирует под ещё не оплаченные особые сумму
// по истории категории, и этот резерв съедает дневной конверт. Редактор в строке
// «особые» позволяет сказать «этого в этом месяце не будет». Фикстура даёт такую
// бронь сама: в прошлом месяце особая «Аренда» на 30 000, в этом — на 36 407,
// плюс двухточечная история нужна _specialForecastByCat, поэтому подсыпаем
// позапрошлый месяц прямо здесь.
suite(390, 'ручная бронь особых', () => {
  const setup = p => p.evaluate(() => {
    const n = new Date();
    const mk = (y, m) => y + '-' + String(m + 1).padStart(2, '0');
    // Две точки истории по «Хотелкам» (cat 4) — иначе категория не попадёт
    // в прогноз: одна точка закономерностью не считается.
    // Две забронированные категории: одну гасит чек с галочкой, второй правит
    // сумму следующий чек. С одной строкой второй проверке нечего было бы найти.
    for (const k of [1, 2]) {
      const d = new Date(n.getFullYear(), n.getMonth() - k, 12);
      const key = mk(d.getFullYear(), d.getMonth()) + '-12';
      DB.expenses.push({ id: 'sp' + k, date: key,
        cat: 4, catId: 'cat0005', amount: 12000, comment: '', special: true, updatedAt: 1 });
      DB.expenses.push({ id: 'sq' + k, date: key,
        cat: 2, catId: 'cat0003', amount: 6000, comment: '', special: true, updatedAt: 1 });
    }
    DB.limits[mk(n.getFullYear(), n.getMonth())] = DB.categories.map(() => 30000);
    saveDB();
    sessionStorage.setItem('oblOpen', '1');
    window.showPage('budget', document.getElementById('nav-budget'));
  });
  const state = p => p.evaluate(() => {
    const n = new Date(), y = n.getFullYear(), m = n.getMonth();
    const limits = getLimits(y, m);
    let tl = 0, ts = 0;
    DB.categories.forEach((_, i) => { tl += limits[i] || 0; });
    getMonthExpenses(y, m).forEach(e => { ts += e.amount; });
    const fc = _monthForecast(y, m);
    const f = _budgetFree(y, m, ts, tl, fc);
    const dl = new Date(y, m + 1, 0).getDate() - n.getDate() + 1;
    const env = _dayEnvelopeFrom(y, m, f, dl);
    return { reserve: Math.round(f.reserve), remain: Math.round(fc ? fc.specRemain : 0),
      total: fc && fc.total, left: env && env.left,
      rows: [...document.querySelectorAll('#spec-editor-rows input[type=text]')].length };
  });

  check('тап по строке особых открывает редактор со списком брони', async p => {
    await setup(p);
    const g = await state(p);
    if (!(g.remain > 0)) throw new Error('прогноз ничего не забронировал: remain=' + g.remain);
    // Кликаем именно по строке: отдельной ссылки «править» быть не должно —
    // рядом «Лимиты ✎», и две ссылки правки спорили бы друг с другом.
    const words = await p.evaluate(() => document.getElementById('budget-obl-row').textContent);
    if (/править|скрыть/.test(words)) throw new Error('в строке остался глагол правки: «' + words + '»');
    const rows = await p.evaluate(() => {
      document.querySelector('#budget-obl-row div').click();
      return document.querySelectorAll('#spec-editor-rows input[type=text]').length;
    });
    if (!(rows > 0)) throw new Error('строк в редакторе: ' + rows);
    eq(await isVisible(p, '#modal-spec'), true, 'модалка открыта');
  });

  check('«Отмена» не пишет правку в базу, «Сохранить» — пишет', async p => {
    const before = await state(p);
    const draft = () => p.evaluate(() => {
      const inp = document.querySelector('#spec-editor-rows input[type=text]');
      inp.value = '1 000';
      inp.dispatchEvent(new Event('change'));
    });
    await draft();
    await p.evaluate(() => window.closeModal('modal-spec'));
    const cancelled = await state(p);
    eq(cancelled.remain, before.remain, 'бронь после «Отмены»');
    await p.evaluate(() => window.openSpecEditor());
    await draft();
    await p.evaluate(() => window.saveSpecPlan());
    const saved = await state(p);
    if (!(saved.remain < before.remain)) throw new Error('бронь не уменьшилась: ' + before.remain + ' → ' + saved.remain);
    if (!(saved.left > before.left)) throw new Error('дневной остаток не вырос: ' + before.left + ' → ' + saved.left);
    const stored = await p.evaluate(() => {
      const n = new Date();
      return Object.values(DB.specPlan[monthKey(n.getFullYear(), n.getMonth())] || {});
    });
    if (!stored.includes(1000)) throw new Error('в DB.specPlan нет 1000: ' + JSON.stringify(stored));
  });

  check('кнопка строки гасит бронь и возвращает её обратно', async p => {
    await p.evaluate(() => window.openSpecEditor());
    const g = await p.evaluate(() => {
      const btn = document.querySelector('#spec-editor-rows button');
      const was = document.querySelector('#spec-editor-rows input[type=text]').value;
      btn.click();
      const off = { label: document.querySelector('#spec-editor-rows button').textContent,
        val: document.querySelector('#spec-editor-rows input[type=text]').value };
      document.querySelector('#spec-editor-rows button').click();
      return { was, off, back: document.querySelector('#spec-editor-rows input[type=text]').value };
    });
    eq(g.off.val, '0', 'сумма после «не будет»');
    eq(g.off.label, 'вернуть', 'подпись кнопки в погашенном состоянии');
    eq(g.back, g.was, 'сумма вернулась к расчётной');
  });

  check('«Всё оплачено» обнуляет черновик, «Вернуть прогноз» восстанавливает авто', async p => {
    await p.evaluate(() => { window.specDraftAllPaid(); window.saveSpecPlan(); });
    const paid = await state(p);
    eq(paid.remain, 0, 'остаток брони после «Всё оплачено»');
    await p.evaluate(() => { window.openSpecEditor(); window.specDraftReset(); window.saveSpecPlan(); });
    const back = await state(p);
    if (!(back.remain > 0)) throw new Error('прогноз не вернулся: remain=' + back.remain);
    // Совпавшее с авто значение не должно оставаться оверрайдом — иначе прогноз
    // замёрзнет на сегодняшней цифре и перестанет реагировать на новые траты.
    const clean = await p.evaluate(() => {
      const n = new Date();
      return !(DB.specPlan || {})[monthKey(n.getFullYear(), n.getMonth())];
    });
    eq(clean, true, 'оверрайды месяца стёрты');
  });

  check('бронь не уезжает в payload как device-local и переживает merge', async p => {
    const g = await p.evaluate(() => {
      const n = new Date(), mk = monthKey(n.getFullYear(), n.getMonth());
      // Локальная правка после «синка»: baseline пуст, значит удалённое значение
      // для этого месяца применяться не должно — иначе своя бронь гибнет.
      DB._lastSyncedSpecPlan = {};
      DB.specPlan = { [mk]: { cat0005: 0 } };
      const p = buildPayload();
      mergePullData({ specPlan: { [mk]: { cat0005: 7777 } } });
      return { inPayload: !!p.specPlan, baselineStripped: p._lastSyncedSpecPlan === undefined,
        kept: DB.specPlan[mk].cat0005 };
    });
    eq(g.inPayload, true, 'specPlan уходит в payload');
    eq(g.baselineStripped, true, '_lastSyncedSpecPlan вырезан из payload');
    eq(g.kept, 0, 'локальная правка пережила merge');
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

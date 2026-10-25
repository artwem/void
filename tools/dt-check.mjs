// Проверки геометрии десктопной раскладки. Запуск: node tools/dt-check.mjs
import { withPage, rect, cssOf, isVisible, scrollDown, resetScroll } from './harness.mjs';

const results = [];
let current = null;

// opts.demo — сюита идёт на полном демо-наборе (buildDemoDB), а не на
// минимальной FIXTURE: вклады, инвестиции, кредиты и шаблоны проверять
// больше не на чем.
export function suite(width, title, fn, opts = {}) { SUITES.push({ width, title, fn, demo: !!opts.demo }); }
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
    const half = await rect(p, '#cw-weekday');
    const other = await rect(p, '#cw-cushion');
    if (!(full.width > half.width * 1.8))
      throw new Error(`«День за днём» не во всю ширину: ${full.width} против ${half.width}`);
    // Две половинчатые карточки обязаны стоять рядом, а не одна под другой
    near(half.y, other.y, 'верх соседних карточек', 2);
    if (other.x <= half.x) throw new Error('карточки не разложились по колонкам');
  });
  check('холст на широкой карточке выше мобильного', async p => {
    // v1.86.0: высота от ширины (2.4:1, потолок 360), а не фиксированные 300 px
    const g = await p.evaluate(() => {
      const r = document.getElementById('chartGrouped').parentElement.getBoundingClientRect();
      return { w: r.width, h: r.height };
    });
    eq(g.h > 200 && g.h <= 360, true, `высота холста на десктопе: ${Math.round(g.h)} при ширине ${Math.round(g.w)}`);
    eq(g.h === 360 || Math.abs(g.w / g.h - 2.4) < 0.15, true, 'пропорция 2.4:1');
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

suite(390, 'бейдж проверки данных не лезет под чип синхронизации', () => {
  check('бейдж стоит за заголовком и не пересекается с #sync-widget', async p => {
    await p.evaluate(() => {
      window.showPage('assets', document.getElementById('nav-assets'));
      document.getElementById('assets-audit-badge').style.display = 'inline-flex';
      document.getElementById('assets-audit-badge-n').textContent = '3';
      document.getElementById('sync-widget').style.display = 'flex';
    });
    const r = await p.evaluate(() => {
      const a = document.getElementById('assets-audit-badge').getBoundingClientRect();
      const s = document.getElementById('sync-widget').getBoundingClientRect();
      const h = document.querySelector('#page-assets > .hdr h1').getBoundingClientRect();
      document.getElementById('assets-audit-badge').style.display = 'none';
      document.getElementById('sync-widget').style.display = 'none';
      return { overlap: a.right > s.left && a.left < s.right && a.bottom > s.top && a.top < s.bottom,
               afterTitle: a.left >= h.right && a.left - h.right < 20, a: [a.left, a.right], s: [s.left, s.right] };
    });
    eq(r.overlap, false, 'бейдж ' + r.a.join('–') + ' и чип ' + r.s.join('–') + ' не пересекаются');
    eq(r.afterTitle, true, 'бейдж сразу за заголовком');
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
    const cells = await p.evaluate(() => [...document.querySelectorAll('#total-fx-seg > button')]
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
    eq(await p.evaluate(() => localStorage.getItem('expSearchPeriod')), 'all', 'период сохранён device-locally');
  });
  check('тап по дате выдачи уводит на «День» в тот день', async p => {
    await p.evaluate(() => document.querySelector('#exp-search-result [data-date]').click());
    eq(await p.evaluate(() => currentPage), 'day', 'активная вкладка');
    const got = await p.evaluate(() => ({ cur: currentDay, active: document.getElementById('nav-day').classList.contains('active') }));
    if (!/-10$/.test(got.cur) && !/-\d\d$/.test(got.cur)) throw new Error('currentDay=' + got.cur);
    eq(got.active, true, 'подсветка вкладки «День»');
  });
});

// Доли в процентах (v1.74.0): один формат «#.#%» на все разбивки — до этого
// отчёт и сводка «Аналитики» округляли до целого, и близкие категории
// (6.4% и 5.6%) печатались одинаковыми «6%».
const PCT_RE = /^\d+\.\d%$/;
// Сюита идёт на демо-наборе: в FIXTURE нет групп (все категории разного
// цвета), и карточка «Расходы по группам» в отчёте просто не рисуется.
suite(1280, 'доли печатаются с одним знаком после запятой', () => {
  check('сводка «Аналитики»: карточки и «% от дохода»', async p => {
    await p.evaluate(() => window.showPage('stats', document.getElementById('nav-stats')));
    const got = await p.evaluate(() => {
      const el = document.getElementById('stats-summary');
      return [...el.querySelectorAll('div,span')].map(x => x.childElementCount ? '' : x.textContent.trim())
        .filter(t => /%$/.test(t));
    });
    if (!got.length) throw new Error('процентов в сводке не найдено');
    const bad = got.filter(t => !PCT_RE.test(t));
    if (bad.length) throw new Error('не в формате #.#%: ' + bad.join(', '));
  });
  check('годовой отчёт: категории, группы, теги доходов', async p => {
    await p.evaluate(() => window.showPage('report', document.getElementById('nav-report')));
    const got = await p.evaluate(() => {
      const cards = [...document.querySelectorAll('#report-body .chart-card')]
        .filter(c => /Расходы по (категориям|группам)|Доходы по тегам/.test(c.querySelector('.chart-title')?.textContent || ''));
      return cards.map(c => ({
        title: c.querySelector('.chart-title').textContent,
        // .rep-yoy — дельта к прошлому году (v1.83.0), не доля: у неё свой формат «+12%»
        pcts: [...c.querySelectorAll('span:not(.rep-yoy)')].map(x => x.textContent.trim()).filter(t => /%$/.test(t)),
      }));
    });
    eq(got.length, 3, 'карточек с разбивками в отчёте');
    got.forEach(c => {
      if (!c.pcts.length) throw new Error('«' + c.title + '»: процентов нет');
      const bad = c.pcts.filter(t => !PCT_RE.test(t));
      if (bad.length) throw new Error('«' + c.title + '» не в формате #.#%: ' + bad.join(', '));
    });
  });
  check('колонка процента вмещает «100.0%» без обрезки', async p => {
    const over = await p.evaluate(() => {
      const out = [];
      document.querySelectorAll('#report-body .chart-card span').forEach(x => {
        if (!/^\d+\.\d%$/.test(x.textContent.trim())) return;
        const probe = x.cloneNode(true); probe.textContent = '100.0%';
        x.after(probe);
        if (probe.scrollWidth > probe.clientWidth) out.push(probe.scrollWidth + '>' + probe.clientWidth);
        probe.remove();
      });
      return out;
    });
    if (over.length) throw new Error('«100.0%» не влезает в колонку: ' + over.join(', '));
  });
}, { demo: true });

// Сводка «Аналитики» колонками (v1.84.3): на мобильном три списка делят одну сетку,
// на десктопе стоят тремя колонками, и первые строки начинаются на одном уровне.
const ssGeom = () => {
  const r = el => el.getBoundingClientRect();
  const cols = [...document.querySelectorAll('#stats-summary .ss-col')];
  return {
    cols: cols.length,
    // только видимые: строки за «ещё N» (v1.86.0) свёрнуты и меряются нулём
    sumRight: [...new Set([...document.querySelectorAll('#stats-summary .ss-sum')].filter(x => x.offsetParent).map(x => Math.round(r(x).right)))],
    nameLeft: [...new Set([...document.querySelectorAll('#stats-summary .ss-name')].filter(x => x.offsetParent).map(x => Math.round(r(x).left)))],
    firstRowTop: [...new Set(cols.map(c => Math.round(r(c.querySelector('.ss-name')).top)))],
    trunc: [...document.querySelectorAll('#stats-summary .ss-name')].filter(x => x.scrollWidth > x.clientWidth).map(x => x.textContent),
  };
};
suite(390, 'сводка «Аналитики» колонками', () => {
  check('все три списка делят одни колонки: суммы и названия на одной вертикали', async p => {
    await p.evaluate(() => window.showPage('stats', document.getElementById('nav-stats')));
    const g = await p.evaluate(ssGeom);
    eq(g.cols, 3, 'списков в сводке');
    eq(g.sumRight.length, 1, 'разных правых краёв сумм ' + g.sumRight.join(','));
    eq(g.nameLeft.length, 1, 'разных левых краёв названий ' + g.nameLeft.join(','));
  });
}, { demo: true });
[1000, 1440].forEach(w => suite(w, 'сводка «Аналитики» колонками', () => {
  check('три колонки, первые строки на одном уровне, названия не обрезаны', async p => {
    await p.evaluate(() => window.showPage('stats', document.getElementById('nav-stats')));
    const g = await p.evaluate(ssGeom);
    eq(g.cols, 3, 'колонок');
    eq(g.firstRowTop.length, 1, 'разных верхов первой строки ' + g.firstRowTop.join(','));
    eq(g.nameLeft.length, 3, 'левых краёв названий (по одному на колонку)');
    if (g.trunc.length) throw new Error('обрезаны: ' + g.trunc.join(', '));
  });
}, { demo: true }));

// Чипы категорий поиска (v1.73.1): на телефоне лента со свайпом, на десктопе
// свайпа нет — чипы, уехавшие за правый край, были просто недостижимы.
const CHIP_GEOM = `(() => {
  const w = document.getElementById('expense-cat-filter');
  const ys = [...w.children].map(c => Math.round(c.getBoundingClientRect().top));
  const box = w.getBoundingClientRect();
  const last = w.lastElementChild.getBoundingClientRect();
  return { rows: new Set(ys).size, chips: w.children.length, cats: DB.categories.length,
           overflow: Math.round(w.scrollWidth - w.clientWidth),
           rightOut: Math.round(last.right - box.right) };
})()`;

suite(390, 'чипы категорий поиска — лента на мобиле', () => {
  check('все чипы в одну строку, лента скроллится вбок', async p => {
    await p.evaluate(() => window.showPage('stats', document.getElementById('nav-stats')));
    const g = await p.evaluate(CHIP_GEOM);
    eq(g.chips, g.cats, 'число чипов');
    eq(g.rows, 1, 'строк чипов на мобиле');
    if (g.overflow <= 0) throw new Error('лента не скроллится: overflow=' + g.overflow);
  });
});

suite(1280, 'чипы категорий поиска — переносятся на десктопе', () => {
  // Категорий в фикстуре семь, и в широкую карточку они влезают одной строкой —
  // перенос виден только когда их заведомо больше, чем помещается.
  check('чипы в несколько строк и целиком внутри карточки', async p => {
    const g = await p.evaluate(`(() => {
      window._chipBackup = { cats: DB.categories.slice(), ids: DB.catIds.slice() };
      for (let i = 0; i < 20; i++) { DB.categories.push('Категория ' + i); DB.catIds.push('chipTest' + i); }
      window.showPage('stats', document.getElementById('nav-stats'));
      return ${CHIP_GEOM};
    })()`);
    await p.evaluate(() => {
      DB.categories = window._chipBackup.cats; DB.catIds = window._chipBackup.ids;
      delete window._chipBackup; renderExpenseSearch();
    });
    eq(g.chips, g.cats, 'число чипов');
    if (g.rows < 2) throw new Error('чипы не перенеслись: строк ' + g.rows);
    if (g.overflow > 0) throw new Error('на десктопе осталась боковая прокрутка: ' + g.overflow);
    if (g.rightOut > 0) throw new Error('последний чип вылез за правый край на ' + g.rightOut + ' px');
  });
});

suite(1600, 'карточка поиска на десктопе в полуширине', () => {
  // До v1.86.0 поиск шёл на обе колонки, и «Доходы по тегам» оставались одни
  // на полуширине внизу; теперь пары: поиск|структура, группы|теги.
  check('#cw-search стоит рядом со «Структурой»', async p => {
    await p.evaluate(() => window.showPage('stats', document.getElementById('nav-stats')));
    const search = await rect(p, '#cw-search');
    const pie = await rect(p, '#cw-pie');
    const grouped = await rect(p, '#cw-grouped');
    const tags = await rect(p, '#income-tags-chart-wrap');
    if (!(search.width < pie.width * 1.2)) throw new Error('поиск шире соседней карточки: ' + search.width + ' против ' + pie.width);
    near(search.y, pie.y, 'поиск и структура в одном ряду', 2);
    near(grouped.y, tags.y, 'группы и теги в одном ряду', 2);
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
    const got = await p.evaluate(async () => {
      let asked = 0;
      const orig = window.confirmDialog;
      window.confirmDialog = async () => { asked++; return false; };
      await window.applyAllLimitAvgs();
      window.confirmDialog = orig;
      return { asked, vals: [...document.querySelectorAll('.limit-edit-input')].map(i => i.value) };
    });
    eq(got.asked, 1, 'число вопросов перед массовой подстановкой');
    eq(got.vals.join('|'), before.join('|'), 'значения полей после отказа');
  });

  check('согласие подставляет средние и помечает изменённые поля', async p => {
    await openEditor(p);
    const got = await p.evaluate(async () => {
      // Поле «Еда вне дома» заранее равно своему ⌀ — подстановка его не меняет,
      // значит и метки на нём быть не должно: пометка означает «строка уехала».
      document.getElementById('lim_2').value = '8000';
      const orig = window.confirmDialog;
      window.confirmDialog = async () => true;
      await window.applyAllLimitAvgs();
      window.confirmDialog = orig;
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
      const orig = window.confirmDialog;
      window.confirmDialog = async () => true;
      await window.applyAllLimitAvgs();
      window.confirmDialog = orig;
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
      // Карандаш из строк «Дня» снят в v1.86.0 (правка — тапом по строке);
      // иконку правки проверяем на списке доходов.
      window.showPage('income', document.getElementById('nav-income'));
      const pencil = document.querySelector('#income-list button');
      window.showPage('assets', document.getElementById('nav-assets'));
      const badge = document.getElementById('assets-audit-badge');
      return {
        pencil: pencil ? !!pencil.querySelector('use[href="#i-edit"]') : 'кнопки правки нет',
        pencilGlyph: pencil ? pencil.textContent.includes('✎') : false,
        badge: !!badge.querySelector('use[href="#i-warn"]'),
        badgeGlyph: badge.textContent.includes('⚠'),
      };
    });
    eq(got.pencil, true, 'карандаш в списке доходов — иконка');
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
    // С v1.86.0 «потрачено» в конверте не печатается — та же цифра стоит в
    // соседней ячейке героя: #day-total, а при обязательных/разовых повседневные
    // уходят в подпись #day-total-sub.
    const tsub = document.getElementById('day-total-sub');
    const spent = tsub.style.display !== 'none' ? nums(tsub.textContent)[0] : nums(document.getElementById('day-total').textContent)[0];
    return {
      lbl: box.querySelector('.day-env-lbl').textContent,
      val: nums(box.querySelector('.day-env-val').textContent)[0],
      cls: box.querySelector('.day-env-val').className,
      cap: sub[0], spent,
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
    // Две точки истории по «Маме» (cat 5) и «Подпискам» (cat 6) — иначе категория
    // не попадёт в прогноз: одна точка закономерностью не считается.
    // Две забронированные категории: одну гасит чек с галочкой, второй правит
    // сумму следующий чек. С одной строкой второй проверке нечего было бы найти.
    // С v1.79.0 обязательность — у категории, и ВСЕ её траты месяца идут в
    // «оплачено»: поэтому категории без трат в текущем месяце фикстуры.
    for (const k of [1, 2]) {
      const d = new Date(n.getFullYear(), n.getMonth() - k, 12);
      const key = mk(d.getFullYear(), d.getMonth()) + '-12';
      DB.expenses.push({ id: 'sp' + k, date: key,
        cat: 5, catId: 'cat0006', amount: 12000, comment: '', updatedAt: 1 });
      DB.expenses.push({ id: 'sq' + k, date: key,
        cat: 6, catId: 'cat0007', amount: 6000, comment: '', updatedAt: 1 });
    }
    DB.limits[mk(n.getFullYear(), n.getMonth())] = DB.categories.map(() => 30000);
    DB.catOblig = { cat0001: true, cat0006: true, cat0007: true };
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
      DB.specPlan = { [mk]: { cat0006: 0 } };
      const p = buildPayload();
      mergePullData({ specPlan: { [mk]: { cat0006: 7777 } } });
      return { inPayload: !!p.specPlan, baselineStripped: p._lastSyncedSpecPlan === undefined,
        kept: DB.specPlan[mk].cat0006 };
    });
    eq(g.inPayload, true, 'specPlan уходит в payload');
    eq(g.baselineStripped, true, '_lastSyncedSpecPlan вырезан из payload');
    eq(g.kept, 0, 'локальная правка пережила merge');
  });
});

// Обязательные и разовые (v1.79.0): одна галочка «особое» разделена на свойство
// категории (обязательная — бронируется по истории) и отметку траты (разовая —
// вне темпа, но вперёд не бронируется). Сторожим миграцию старых особых, то,
// что разовая не создаёт брони, и экран разметки.
suite(390, 'обязательные и разовые', () => {
  check('миграция: особые в ≥3 месяцах → обязательная категория, остальные — разовые, траты не штампуются', async p => {
    const g = await p.evaluate(() => {
      const saved = { exp: DB.expenses, obl: DB.catOblig };
      const ms = ['2026-03', '2026-04', '2026-05'];
      DB.expenses = [
        ...ms.map((m, i) => ({ id: 'mA' + i, date: m + '-01', cat: 0, catId: 'cat0001', amount: 33000, special: true, updatedAt: 1 })),
        ...ms.slice(0, 2).map((m, i) => ({ id: 'mB' + i, date: m + '-10', cat: 4, catId: 'cat0005', amount: 20000, special: true, updatedAt: 1 })),
      ];
      delete DB.catOblig;
      _ensureCatIds();
      const r = {
        obl: Object.keys(DB.catOblig).sort().join(','),
        rentOneoff: DB.expenses.filter(e => e.catId === 'cat0001').some(e => _isOneoff(e)),
        stamped: DB.expenses.some(e => e.updatedAt !== 1),
        meta: (DB.listsMeta || {}).catOblig || 0,
        wishOneoff: DB.expenses.filter(e => e.catId === 'cat0005').every(e => _isOneoff(e)),
      };
      DB.expenses = saved.exp; DB.catOblig = saved.obl;
      return r;
    });
    eq(g.obl, 'cat0001', 'обязательные после миграции');
    eq(g.rentOneoff, false, 'траты обязательной категории не читаются разовыми');
    eq(g.stamped, false, 'миграция не штампует updatedAt — не затрёт разметку других устройств');
    eq(g.meta, 0, 'авторазметка без LWW-метки');
    eq(g.wishOneoff, true, 'двухмесячные «Хотелки» остались разовыми');
  });

  check('миграция ждёт данных: без трат catOblig не создаётся', async p => {
    const g = await p.evaluate(() => {
      const saved = { exp: DB.expenses, obl: DB.catOblig };
      DB.expenses = []; delete DB.catOblig;
      _ensureCatIds();
      const r = DB.catOblig === undefined;
      DB.expenses = saved.exp; DB.catOblig = saved.obl;
      return r;
    });
    eq(g, true, 'catOblig не создан на пустых данных');
  });

  check('разовая в истории не бронируется, обязательная — бронируется', async p => {
    const g = await p.evaluate(() => {
      const hist = [1, 2].map(k => ({ exps: [
        { cat: 0, amount: 30000, date: '2026-0' + k + '-02' },                  // Аренда — обязательная
        { cat: 4, amount: 15000, date: '2026-0' + k + '-12', special: true },   // Хотелки — разовая
      ] }));
      return _specialForecastByCat([], hist).map(f => f.cat).join(',');
    });
    eq(g, '0', 'в брони только обязательная категория');
  });

  check('разовая сегодня не входит в «потрачено сегодня»', async p => {
    const g = await p.evaluate(() => {
      const n = new Date(), y = n.getFullYear(), m = n.getMonth();
      DB.limits[monthKey(y, m)] = DB.categories.map(() => 30000);
      const env = () => {
        let ts = 0; getMonthExpenses(y, m).forEach(e => { ts += e.amount; });
        const f = _budgetFree(y, m, ts, DB.categories.length * 30000, _monthForecast(y, m));
        return { spent: _dayEnvelopeFrom(y, m, f, 5).spentToday, one: f.oneoffSpent };
      };
      const before = env();
      DB.expenses.push({ id: 'oneT', date: today(), cat: 4, catId: 'cat0005', amount: 9000, special: true, updatedAt: 1 });
      const after = env();
      DB.expenses = DB.expenses.filter(e => e.id !== 'oneT');
      return { before, after };
    });
    eq(g.after.spent, g.before.spent, '«потрачено сегодня» без разовой');
    eq(g.after.one - g.before.one, 9000, 'разовая учтена в oneoffSpent');
  });

  check('итог дня: без отдельных трат одна цифра, с разовой — «всего» и «повседневные»', async p => {
    // v1.86.0: обе цифры в одной ячейке героя — крупно «всего», подписью повседневные
    const g = await p.evaluate(() => {
      const num = el => Number(el.textContent.replace(/\D/g, ''));
      const nums = el => [num(el), num(document.getElementById('day-total-sub'))];
      currentDay = today();
      // Чужие траты дня прячем на время проверки и возвращаем: 1-го числа под
      // фильтр попадала фикстурная e01 (dd(1)), и следующая проверка её не находила.
      const saved = DB.expenses;
      DB.expenses = DB.expenses.filter(e => e.date !== today());
      DB.expenses.push({ id: 'dA', date: today(), cat: 1, catId: 'cat0002', amount: 1200, comment: '', updatedAt: 1 });
      renderDay();
      const el = document.getElementById('day-total');
      const one = { pair: document.getElementById('day-total-sub').style.display !== 'none', lbl: document.getElementById('day-total-lbl').textContent };
      DB.expenses.push({ id: 'dB', date: today(), cat: 4, catId: 'cat0005', amount: 9000, comment: '', special: true, updatedAt: 1 });
      renderDay();
      const two = { nums: nums(el), lbl: document.getElementById('day-total-lbl').textContent };
      DB.expenses = saved;
      renderDay();
      return { one, two };
    });
    eq(g.one.pair, false, 'без отдельных трат подписи «повседневные» нет');
    eq(g.one.lbl, 'Расходы за день', 'подпись одной цифры');
    eq(g.two.nums.join('|'), '10200|1200', 'всего | повседневные');
    eq(g.two.lbl, 'Всего за день', 'подпись при двух цифрах');
  });

  check('модалка траты: в обязательной категории свой выбор, крупная сумма даёт подсказку', async p => {
    const g = await p.evaluate(() => {
      openAddExpense();
      const sel = document.getElementById('exp-cat'), amt = document.getElementById('exp-amount');
      const seg = document.getElementById('exp-spec-seg'), note = document.getElementById('exp-kind-note');
      const first = () => seg.querySelector('button').textContent;
      sel.value = '0'; _expKindUi();
      const oblig = { seg: seg.style.display, note: note.style.display, first: first() };
      sel.value = '2'; amt.value = '7 000'; _expKindUi();
      const big = { seg: seg.style.display, note: note.style.display, first: first() };
      amt.value = '500'; _expKindUi();
      const small = note.style.display;
      closeModal('modal-expense');
      return { oblig, big, small };
    });
    eq(g.oblig.seg, 'flex', 'в обязательной категории выбор доступен');
    eq(g.oblig.first, 'Обязательная', 'первый чип назван по виду категории');
    eq(g.oblig.note, 'block', 'пояснение про резерв');
    eq(g.big.seg + '|' + g.big.note, 'flex|block', 'крупная трата: сегмент и подсказка');
    eq(g.big.first, 'Обычная', 'в обычной категории первый чип прежний');
    eq(g.small, 'none', 'мелкая трата без подсказки');
  });

  check('экран разметки: крупная без отметки видна, тап отмечает разовой; категорию можно сделать обязательной', async p => {
    const g = await p.evaluate(() => {
      DB.expenses.push({ id: 'bigU', date: today(), cat: 3, catId: 'cat0004', amount: 12000, comment: 'Куртка', updatedAt: 1 });
      saveDB();
      openKindsManager();
      const btn = document.querySelector('#kinds-history .km-mark[data-exp="bigU"]');
      const label = btn && btn.textContent;
      btn && btn.click();
      const marked = _isOneoff(DB.expenses.find(e => e.id === 'bigU'));
      const after = document.querySelector('#kinds-history .km-mark[data-exp="bigU"]');
      const meta0 = (DB.listsMeta || {}).catOblig || 0;
      document.querySelectorAll('#kinds-cats .kind-chip')[6].click();   // «Подписки»
      const chip = document.querySelectorAll('#kinds-cats .kind-chip')[6];
      const r = { label, marked, markedOn: !!after && after.classList.contains('on'),
        obl: !!DB.catOblig.cat0007, touched: (DB.listsMeta.catOblig || 0) > meta0,
        catOn: chip.classList.contains('on') && chip.getAttribute('aria-pressed') === 'true',
        strip: !!document.querySelector('#kinds-history .km-strip .ks-one') };
      closeModal('modal-kinds');
      return r;
    });
    eq(g.label, 'отметить', 'крупная без отметки предложена');
    eq(g.marked, true, 'тап отметил разовой');
    eq(g.markedOn, true, 'после отметки кнопка в состоянии «разовая»');
    eq(g.strip, true, 'разовая появилась штриховкой в полоске месяца');
    eq(g.obl, true, 'категория стала обязательной');
    eq(g.touched, true, 'listsMeta.catOblig обновлён для синка');
    eq(g.catOn, true, 'чип категории включён и помечен aria-pressed');
  });

  // Разовая внутри ОБЯЗАТЕЛЬНОЙ категории (v1.80.0): подписка на два года вперёд
  // в «Связи» — категория обязательная, а платёж не повторится. Раньше он ехал
  // в историю резерва и полгода бронировал деньги под то, чего не будет.
  check('разовая в обязательной категории: вне брони, но вне темпа', async p => {
    const g = await p.evaluate(() => {
      const hist = [1, 2].map(k => ({ exps: [
        { cat: 0, amount: 30000, date: '2026-0' + k + '-02' },                 // Аренда — обязательная
        { cat: 0, amount: 60000, date: '2026-0' + k + '-20', oneoff: true },   // оплата вперёд
      ] }));
      const fc = _specialForecastByCat([], hist);
      const pre = { cat: 0, catId: 'cat0001', amount: 60000, date: today(), oneoff: true };
      return { cats: fc.map(f => f.cat).join(','), plan: Math.round(fc[0].unpaid),
        spec: _isSpec(pre), obl: _isOblig(pre), one: _isOneoff(pre), badge: _kindBadge(pre) };
    });
    eq(g.cats, '0', 'обязательная категория осталась в брони');
    eq(g.plan, 30000, 'разовая оплата вперёд не задрала резерв');
    eq(g.one, true, 'читается разовой');
    eq(g.obl, false, 'в бронь по истории не идёт');
    eq(g.spec, true, 'но остаётся вне темпа «в день»');
    eq(g.badge.includes('разовая'), true, 'бейдж разовой перебивает «обяз.»');
  });

  check('старый special в обязательной категории разовым не стал', async p => {
    const g = await p.evaluate(() => {
      const e = DB.expenses.find(x => x.id === 'e01');   // фикстура: special:true в обязательной «Аренде»
      return { one: _isOneoff(e), obl: _isOblig(e), badge: _kindBadge(e) };
    });
    eq(g.one, false, 'legacy-special в обязательной категории не разовая');
    eq(g.obl, true, 'осталась обязательной');
    eq(g.badge.includes('обяз.'), true, 'бейдж «обяз.»');
  });

  check('сохранение: разовость в обязательной категории пишется в e.oneoff', async p => {
    const g = await p.evaluate(() => {
      openAddExpense();
      document.getElementById('exp-cat').value = '0';           // Аренда — обязательная
      document.getElementById('exp-amount').value = '60 000';
      document.getElementById('exp-date').value = today();
      setExpSpecial('1');
      saveExpense();
      const e = DB.expenses.filter(x => x.cat === 0 && x.amount === 60000).pop();
      const r = { has: !!e, field: !!(e && e.oneoff), legacy: !!(e && e.special), one: !!e && _isOneoff(e) };
      DB.expenses = DB.expenses.filter(x => x !== e);
      saveDB();
      return r;
    });
    eq(g.has, true, 'трата сохранена');
    eq(g.field, true, 'разовость в новом поле oneoff');
    eq(g.legacy, false, 'legacy-поле special не пишется');
    eq(g.one, true, 'читается разовой');
  });

  check('экран разметки: разовая обязательной категории — строка в «Разовых», тап снимает отметку', async p => {
    const g = await p.evaluate(() => {
      DB.expenses.push({ id: 'oblOne', date: today(), cat: 0, catId: 'cat0001', amount: 60000, comment: 'Год вперёд', oneoff: true, updatedAt: 1 });
      saveDB();
      openKindsManager();
      const btn = document.querySelector('#kinds-history .km-mark[data-exp="oblOne"]');
      const r = { row: !!btn, label: btn && btn.textContent, on: !!btn && btn.classList.contains('on') };
      btn && btn.click();
      const e = DB.expenses.find(x => x.id === 'oblOne');
      r.off = !_isOneoff(e);
      closeModal('modal-kinds');
      DB.expenses = DB.expenses.filter(x => x.id !== 'oblOne');
      saveDB();
      return r;
    });
    eq(g.row, true, 'строка есть в «Разовых»');
    eq(g.on, true, 'кнопка в состоянии «разовая»');
    eq(g.off, true, 'тап вернул трату в обязательные');
  });

  check('обязательность категории не стирает разовые отметки внутри неё', async p => {
    const g = await p.evaluate(() => {
      const saved = { obl: { ...(DB.catOblig || {}) }, meta: (DB.listsMeta || {}).catOblig };
      DB.expenses.push({ id: 'togOne', date: today(), cat: 3, catId: 'cat0004', amount: 12000, comment: '', oneoff: true, updatedAt: 1 });
      toggleCatOblig(3);                                  // делаем категорию обязательной
      const e = DB.expenses.find(x => x.id === 'togOne');
      const r = { one: _isOneoff(e), stamped: e.updatedAt !== 1 };
      DB.expenses = DB.expenses.filter(x => x.id !== 'togOne');
      DB.catOblig = saved.obl;
      if(saved.meta == null) delete DB.listsMeta.catOblig; else DB.listsMeta.catOblig = saved.meta;
      saveDB();
      closeModal('modal-kinds');
      return r;
    });
    eq(g.one, true, 'отметка пережила включение обязательности');
    eq(g.stamped, false, 'трата не перештампована');
  });

  check('синк: разметка и порог — LWW по своим меткам, не по списку категорий', async p => {
    const g = await p.evaluate(() => {
      const saved = { obl: DB.catOblig, meta: { ...(DB.listsMeta || {}) }, thr: DB.oneoffThreshold };
      const remote = (obl, meta, thr) => {
        const d = JSON.parse(JSON.stringify(buildPayload()));
        d.catOblig = obl; d.oneoffThreshold = thr;
        d.listsMeta = { ...(d.listsMeta || {}), ...meta };
        return d;
      };
      const out = {};
      // 1. Обе стороны без метки (авторазметка) и разные — сходимся к версии с Drive,
      //    хотя список категорий на удалённой стороне НЕ новее
      DB.catOblig = { cat0001: true }; delete DB.listsMeta.catOblig;
      mergePullData(remote({ cat0006: true }, {}, 6000));
      out.tie = Object.keys(DB.catOblig).join(',');
      // 2. Явная правка на удалённом устройстве новее — берём
      DB.listsMeta.catOblig = 1000;
      mergePullData(remote({ cat0002: true }, { catOblig: 2000 }, 6000));
      out.newer = Object.keys(DB.catOblig).join(',');
      // 3. Локальная правка новее — удалённая старая не перетирает
      DB.listsMeta.catOblig = Date.now();
      mergePullData(remote({ cat0004: true }, { catOblig: 3000 }, 6000));
      out.localWins = Object.keys(DB.catOblig).join(',');
      // 4. Порог с другого устройства
      DB.listsMeta.oneoffThreshold = 10;
      mergePullData(remote(DB.catOblig, { oneoffThreshold: 20 }, 9000));
      out.thr = _oneoffThreshold();
      out.inPayload = buildPayload().oneoffThreshold === 9000 && !!buildPayload().catOblig;
      DB.catOblig = saved.obl; DB.listsMeta = saved.meta; DB.oneoffThreshold = saved.thr;
      return out;
    });
    eq(g.tie, 'cat0006', 'без меток — версия с Drive');
    eq(g.newer, 'cat0002', 'более свежая удалённая правка');
    eq(g.localWins, 'cat0002', 'свежая локальная правка не перетёрта');
    eq(g.thr, 9000, 'порог пришёл с другого устройства');
    eq(g.inPayload, true, 'порог и разметка уходят в payload');
  });
});

// Лимиты и цвета категорий хранятся по catId (v1.64.0). До этого limits были
// позиционным массивом, а catColors — словарём по индексу, тогда как сам список
// categories мержится LWW целиком: после правки категорий на двух устройствах
// позиция N значила одну категорию в списке и другую в лимитах, и деньги
// молча приписывались чужой строке. Сторожим и миграцию, и сам сценарий.
suite(390, 'лимиты и цвета по catId', () => {
  // Свежая база под каждый чек: чеки одной сюиты делят страницу.
  const seed = (p, extra = {}) => p.evaluate(ex => {
    DB.categories = ['A', 'B', 'C'];
    DB.catIds     = ['i1', 'i2', 'i3'];
    DB.catColors  = { i1: '#111111', i2: '#222222', i3: '#333333' };
    DB.expenses = []; DB.templates = [];
    DB.limits = {}; DB._lastSyncedLimits = {};
    Object.assign(DB, ex);
    return true;
  }, extra);

  check('старый формат конвертируется в ключи catId без потери сумм', async p => {
    await p.evaluate(() => {
      DB.categories = ['A', 'B', 'C'];
      DB.catIds     = ['i1', 'i2', 'i3'];
      DB.limits     = { '2026-01': [100, 200, 300] };                 // позиционный массив
      DB.catColors  = { 0: '#111111', 1: '#222222', 2: '#333333' };   // ключ-индекс
      DB._lastSyncedLimits = { '2026-01': [100, 200, 300] };
      _ensureCatIds();
    });
    const got = await p.evaluate(() => ({
      lim:  DB.limits['2026-01'],
      base: DB._lastSyncedLimits['2026-01'],
      col:  DB.catColors,
      read: getLimits(2026, 0),
      c1:   getCatColor(1),
    }));
    eq(Array.isArray(got.lim), false, 'лимиты остались массивом');
    eq(JSON.stringify(got.lim), JSON.stringify({ i1: 100, i2: 200, i3: 300 }), 'лимиты по catId');
    eq(JSON.stringify(got.base), JSON.stringify({ i1: 100, i2: 200, i3: 300 }), 'baseline мигрирован вместе с лимитами');
    eq(JSON.stringify(got.col), JSON.stringify({ i1: '#111111', i2: '#222222', i3: '#333333' }), 'цвета по catId');
    eq(JSON.stringify(got.read), JSON.stringify([100, 200, 300]), 'getLimits отдаёт прежний позиционный массив');
    eq(got.c1, '#222222', 'цвет второй категории');
  });

  check('удаление категории не сдвигает лимиты и цвета соседей', async p => {
    await seed(p, { limits: { '2026-01': { i1: 100, i2: 200, i3: 300 } } });
    await p.evaluate(async () => {
      window.confirmDialog = async () => true;   // removeCategory спрашивает подтверждение
      await removeCategory(1);                   // выбрасываем B из середины
    });
    const got = await p.evaluate(() => ({
      cats: DB.categories, read: getLimits(2026, 0),
      colors: DB.categories.map((_, i) => getCatColor(i)),
      leftover: Object.keys(DB.limits['2026-01']),
    }));
    eq(JSON.stringify(got.cats), JSON.stringify(['A', 'C']), 'список категорий');
    eq(JSON.stringify(got.read), JSON.stringify([100, 300]), 'лимиты поехали за своими категориями');
    eq(JSON.stringify(got.colors), JSON.stringify(['#111111', '#333333']), 'цвета поехали за своими категориями');
    eq(JSON.stringify(got.leftover), JSON.stringify(['i1', 'i3']), 'ключ удалённой категории убран');
  });

  check('добавление категории не делает все месяцы «локально изменёнными»', async p => {
    // Раньше addCategory дописывал элемент в КАЖДЫЙ месяц, поэтому 3-way merge
    // считал локально изменёнными все месяцы разом и молча выбрасывал чужие
    // правки лимитов за прошлые месяцы.
    await p.evaluate(() => {
      const n = new Date();
      const cur  = n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0');
      const prev = (n.getMonth() ? n.getFullYear() : n.getFullYear() - 1) + '-' +
                   String(n.getMonth() ? n.getMonth() : 12).padStart(2, '0');
      DB.categories = ['A', 'B', 'C'];
      DB.catIds     = ['i1', 'i2', 'i3'];
      DB.catColors  = { i1: '#111111', i2: '#222222', i3: '#333333' };
      DB.expenses = []; DB.templates = [];
      DB.limits = { [cur]: { i1: 100, i2: 200, i3: 300 }, [prev]: { i1: 10, i2: 20, i3: 30 } };
      DB._lastSyncedLimits = JSON.parse(JSON.stringify(DB.limits));
      window._tPrev = prev; window._tCur = cur;
      document.getElementById('new-cat-name').value = 'Такси';
      addCategory();
      mergePullData({ limits: { [prev]: { i1: 11, i2: 22, i3: 33 } } });
    });
    const got = await p.evaluate(() => {
      const [py, pm] = window._tPrev.split('-').map(Number);
      return { prev: getLimits(py, pm - 1), curKeys: Object.keys(DB.limits[window._tCur]).length };
    });
    eq(JSON.stringify(got.prev.slice(0, 3)), JSON.stringify([11, 22, 33]), 'чужие лимиты нетронутого месяца приняты');
    eq(got.prev[3], 0, 'новой категории в прошлом месяце лимита нет');
    eq(got.curKeys, 4, 'в текущем месяце у новой категории лимит появился');
  });

  check('две категории, добавленные на разных устройствах, не путают лимиты', async p => {
    // Тот самый разъезд: список категорий побеждает удалённый целиком, а лимиты
    // раньше оставались локальным массивом — позиция 4 значила «Такси» в одном
    // и «Спорт» в другом, и лимит такси показывался у спорта.
    await seed(p, { limits: { '2026-01': { i1: 100, i2: 200, i3: 300, i4: 3000 } },
                    _lastSyncedLimits: { '2026-01': { i1: 100, i2: 200, i3: 300 } } });
    await p.evaluate(() => {
      DB.categories = ['A', 'B', 'C', 'Такси'];
      DB.catIds     = ['i1', 'i2', 'i3', 'i4'];
      DB.listsMeta  = { categories: 1000 };
      mergePullData({
        categories: ['A', 'B', 'C', 'Спорт'],
        catIds:     ['i1', 'i2', 'i3', 'r5'],
        catColors:  { i1: '#111111', i2: '#222222', i3: '#333333', r5: '#555555' },
        listsMeta:  { categories: 2000 },              // удалённый список свежее — он и побеждает
        limits:     { '2026-01': { i1: 100, i2: 200, i3: 300, r5: 777 } },
      });
    });
    const got = await p.evaluate(() => ({ cats: DB.categories, read: getLimits(2026, 0) }));
    eq(got.cats[3], 'Спорт', 'победил удалённый список категорий');
    if (got.read[3] === 3000) throw new Error('лимит «Такси» приписан категории «Спорт» — позиции разъехались');
    eq(JSON.stringify(got.read.slice(0, 3)), JSON.stringify([100, 200, 300]), 'лимиты прежних категорий на месте');
  });

  check('порядок ключей не выдаёт нетронутый месяц за изменённый', async p => {
    // Ключи limits/specPlan — catId, и с разных устройств они приходят в разном
    // порядке. JSON.stringify зависит от порядка вставки, поэтому сравнение
    // «локально менялось?» врало бы на ровном месте.
    await seed(p, { limits: { '2026-01': { i3: 300, i1: 100, i2: 200 } },
                    _lastSyncedLimits: { '2026-01': { i1: 100, i2: 200, i3: 300 } } });
    await p.evaluate(() => mergePullData({ limits: { '2026-01': { i1: 111, i2: 222, i3: 333 } } }));
    const got = await p.evaluate(() => getLimits(2026, 0));
    eq(JSON.stringify(got), JSON.stringify([111, 222, 333]), 'месяц признан нетронутым, удалённые лимиты приняты');
  });

  check('новое устройство не затирает лимиты текущего месяца дефолтами', async p => {
    // Первый запуск раньше писал DEFAULT_LIMITS в текущий месяц под свежими
    // случайными catId. Baseline пустой → месяц «локально изменён» → удалённые
    // лимиты отвергнуты, а дефолты с чужими id уходили на Drive. Все устройства
    // принимали их и видели в текущем месяце нули.
    const got = await p.evaluate(() => {
      const n = new Date();
      const cur = n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0');
      const saved = localStorage.getItem('budgetDB_v2');
      localStorage.removeItem('budgetDB_v2');
      Object.keys(DB).forEach(k => delete DB[k]);
      DB.limits = {}; DB.expenses = [];
      loadDB();                                            // первый запуск: пусто
      if(saved) localStorage.setItem('budgetDB_v2', saved);
      mergePullData({
        categories: ['A', 'B', 'C'], catIds: ['i1', 'i2', 'i3'],
        listsMeta:  { categories: 1000 },
        limits:     { [cur]: { i1: 100, i2: 200, i3: 300 } },
      });
      return { read: getLimits(n.getFullYear(), n.getMonth()), push: buildPayload().limits[cur] };
    });
    eq(JSON.stringify(got.read), JSON.stringify([100, 200, 300]), 'лимиты текущего месяца пришли с Drive');
    eq(JSON.stringify(got.push), JSON.stringify({ i1: 100, i2: 200, i3: 300 }), 'на Drive уйдут те же лимиты');
  });
});

// В установленной PWA на iOS <a download> игнорируется — копия уходит через
// системное «Поделиться» с файлом. iOS тут не воспроизвести, поэтому проверяем
// развилку: standalone + Web Share → share(), иначе — загрузка blob-ссылкой.
suite(390, 'резервная копия', () => {
  check('в PWA копия уходит в «Поделиться» файлом .json', async p => {
    const got = await p.evaluate(async () => {
      const saved = { st: Object.getOwnPropertyDescriptor(navigator, 'standalone'),
                      share: navigator.share, can: navigator.canShare };
      Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
      let shared = null;
      navigator.canShare = () => true;
      navigator.share = async d => { shared = d; };
      const r = await _saveFile('{"a":1}', 'budget_backup_x.json', 'application/json');
      const f = shared && shared.files[0];
      const out = { r, name: f && f.name, text: f && await f.text() };
      delete navigator.standalone; if(saved.st) Object.defineProperty(navigator, 'standalone', saved.st);
      navigator.share = saved.share; navigator.canShare = saved.can;
      return out;
    });
    eq(got.r, 'shared', 'результат');
    eq(got.name, 'budget_backup_x.json', 'имя файла');
    eq(got.text, '{"a":1}', 'содержимое');
  });

  check('в браузере копия скачивается blob-ссылкой с именем файла', async p => {
    const got = await p.evaluate(async () => {
      let clicked = null;
      const orig = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function(){ clicked = { href: this.href, dl: this.download }; };
      const r = await _saveFile('{}', 'budget_backup_y.json', 'application/json');
      HTMLAnchorElement.prototype.click = orig;
      return { r, ...clicked };
    });
    eq(got.r, 'downloaded', 'результат');
    eq(got.dl, 'budget_backup_y.json', 'имя файла');
    eq(got.href.startsWith('blob:'), true, 'blob-ссылка, не data:');
  });
});

suite(390, 'экспорт Excel', () => {
  check('в PWA xlsx уходит в «Поделиться» и читается обратно', async p => {
    const got = await p.evaluate(async () => {
      const saved = { st: Object.getOwnPropertyDescriptor(navigator, 'standalone'),
                      share: navigator.share, can: navigator.canShare };
      Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
      let shared = null;
      navigator.canShare = () => true;
      navigator.share = async d => { shared = d; };
      await exportExcel(); // сама подгружает vendor/xlsx.style.min.js
      for(let i = 0; i < 50 && !shared; i++) await new Promise(r => setTimeout(r, 20));
      const f = shared && shared.files[0];
      const wb = f && XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: 'array' });
      delete navigator.standalone; if(saved.st) Object.defineProperty(navigator, 'standalone', saved.st);
      navigator.share = saved.share; navigator.canShare = saved.can;
      return { name: f && f.name, sheets: wb ? wb.SheetNames.length : 0 };
    });
    eq(/^budget_\d{4}-\d{2}-\d{2}\.xlsx$/.test(got.name || ''), true, 'имя файла ' + got.name);
    eq(got.sheets > 0, true, 'в книге есть листы');
  });
}, { demo: true });

// Средние за месяц и период графиков. Две отдельные истории, но обе про одно:
// цифра под графиком обязана отвечать ровно за тот набор данных, который на
// графике нарисован — за выбранный период и за невыключенные ряды легенды.
suite(390, 'средние и период графиков', () => {
  const bDigits = (p, sel) => p.evaluate(s => {
    const b = document.querySelector(s + ' b');
    return b ? (b.textContent.match(/\d/g) || []).join('') : null;
  }, sel);
  // Под стэк-графиками две цифры: сумма за период и среднее за завершённые месяцы.
  const digitsOf = (p, sel) => p.evaluate(s => {
    const el = document.querySelector(s);
    return el ? (el.textContent.match(/\d/g) || []).join('') : null;
  }, sel);
  const avgDigits = (p, sel) => digitsOf(p, sel + ' .sa-avg');
  const sumDigits = (p, sel) => digitsOf(p, sel + ' .sa-sum');
  const chartSum = (p, name) => p.evaluate(n =>
    String(Math.round(_stackVisTotals(charts[n]).reduce((s, v) => s + v, 0))), name);

  check('на «Накоплениях» свой период, по умолчанию полгода', async p => {
    await p.evaluate(() => window.showPage('assets', document.getElementById('nav-assets')));
    eq(await p.evaluate(() => savingsPeriodMode), '6', 'режим периода по умолчанию');
    // Ряда чипов два (у обоих графиков), правят они один период — подсветка общая.
    const on = await p.evaluate(() => ['svp-6','svp2-6','svp-12','svp2-12']
      .map(id => document.getElementById(id).style.fontWeight));
    eq(on.join(','), '600,600,,', 'подсвечены оба ряда чипов и только активный период');
  });

  check('среднее считается по завершённым месяцам, текущий не в счёт', async p => {
    // Фикстура: прошлый месяц — 50 000 ₽ расходов и ни рубля дохода,
    // текущий — 88 207 ₽ и 207 550 ₽. «Всё» = два месяца, завершён один.
    await p.evaluate(() => setSavingsPeriod('all'));
    eq(await p.evaluate(() => charts.incVsExp.data.labels.length), 2, 'месяцев на графике');
    const txt = await p.evaluate(() => document.getElementById('inc-exp-avg').textContent);
    const bs = await p.evaluate(() => [...document.querySelectorAll('#inc-exp-avg b')]
      .map(b => (b.textContent.match(/\d/g) || []).join('')));
    eq(bs.join('|'), '0|50000', 'средние доход и расход: ' + txt);
  });

  check('«всё» берёт весь доступный период, а не фиксированное число', async p => {
    eq(await p.evaluate(() => _dataMonthsSpan()), 2, 'месяцев в данных фикстуры');
    await p.evaluate(() => { DB.expenses.push({id:'old1', date:'2025-01-10', cat:0, catId:'cat0001', amount:100, updatedAt:1}); saveDB(); });
    eq(await p.evaluate(() => _dataMonthsSpan()) > 12, true, 'старая трата растянула период');
    await p.evaluate(() => { DB.expenses = DB.expenses.filter(e => e.id !== 'old1'); saveDB(); });
  });

  check('доход за месяц до первой траты: не «0 расходов и 100%», а «не вносились»', async p => {
    // Реальный случай: доходы за февраль внесли задним числом, траты — нет.
    const r = await p.evaluate(() => {
      const d = new Date();
      const y = d.getMonth() < 2 ? d.getFullYear() - 1 : d.getFullYear();
      const ds = y + '-' + String((d.getMonth() + 10) % 12 + 1).padStart(2, '0') + '-15';
      DB.incomes.push({ id: 'feb1', date: ds, source: 'X', amount: 100000, tag: '', updatedAt: 1 }); saveDB();
      setSavingsPeriod('all');
      const out = {
        n: charts.incVsExp.data.labels.length,
        exp0: charts.incVsExp.data.datasets[1].data[0],
        rate0: charts.savingsRate.data.datasets[0].data[0],
        bs: [...document.querySelectorAll('#inc-exp-avg b')].map(b => (b.textContent.match(/\d/g) || []).join('')).join('|'),
      };
      window.showPage('stats', document.getElementById('nav-stats'));
      setStatsPeriod('all');
      out.grouped = charts.grouped.data.labels.length;
      out.note = (document.querySelector('#stats-summary .ss-note') || {}).textContent || '';
      uiSet('reportYear', String(y));
      const sel = document.getElementById('report-year'); sel.innerHTML = '';
      window.showPage('report');
      out.dashRows = [...document.querySelectorAll('#report-body tr')].filter(tr => tr.textContent.includes('—')).length;
      out.repNote = (document.querySelector('#rep-summary > .rep-note') || {}).textContent || '';
      out.inCard = [...document.querySelectorAll('#rep-summary .s-card')].some(c => /учит|учёт/.test(c.textContent));
      DB.incomes = DB.incomes.filter(x => x.id !== 'feb1'); saveDB();
      sel.innerHTML = ''; uiSet('reportYear', ''); window.showPage('stats', document.getElementById('nav-stats'));
      return out;
    });
    eq(r.n, 3, 'на «Доходы vs Расходы» месяц с доходом остался');
    eq(r.exp0, 50000, 'на месте расхода — штриховка высотой в средний расход');
    eq(r.rate0, null, 'нормы у такого месяца нет');
    eq(r.bs, '50000|50000', '⌀ доход по двум месяцам, ⌀ расход — только с начала учёта');
    eq(r.grouped, 2, '«Расходы по группам» в режиме «всё» начинаются с первой траты');
    eq(/Расходы учитываются с \S+ \d{4}/.test(r.note), true, 'в сводке общей строкой подписано, откуда считается «Накоплено»: ' + r.note);
    eq(r.dashRows >= 1, true, 'в таблице отчёта у месяца прочерки');
    eq(/Расходы учитываются с \S+ \d{4}/.test(r.repNote), true, 'в отчёте та же общая строка под карточками: ' + r.repNote);
    eq(r.inCard, false, 'внутри карточек сводки отчёта подписи нет');
  });

  check('период «Накоплений» не трогает период «Аналитики»', async p => {
    await p.evaluate(() => { setSavingsPeriod(6); setStatsPeriod(24); });
    eq(await p.evaluate(() => localStorage.getItem('savingsPeriod')), '6', 'период накоплений device-local');
    eq(await p.evaluate(() => charts.incVsExp.data.labels.length), 6, 'график накоплений остался на 6 мес');
    await p.evaluate(() => window.showPage('stats', document.getElementById('nav-stats')));
    eq(await p.evaluate(() => charts.grouped.data.labels.length), 24, 'аналитика на 24 мес');
  });

  check('легенда стэк-графиков — HTML-чипы с пальцевой тап-зоной', async p => {
    await p.evaluate(() => setStatsPeriod(6));
    // Встроенную легенду Chart.js рисует внутри канваса: хитбокс высотой в строку
    // шрифта (~11px). Она должна быть выключена у обоих стэк-графиков.
    eq(await p.evaluate(() => [charts.grouped, charts.incomeTags]
      .map(c => c.options.plugins.legend.display).join(',')), 'false,false', 'встроенная легенда выключена');
    const box = await p.evaluate(() => ['grouped-legend','income-tags-legend'].map(id => {
      const chips = [...document.querySelectorAll('#' + id + ' .sl-chip')];
      const rs = chips.map(c => c.getBoundingClientRect());
      return { id, n: chips.length, minH: Math.min(...rs.map(r => r.height)), minW: Math.min(...rs.map(r => r.width)) };
    }));
    eq(box.map(b => b.n).join(','), '5,2', 'чипов столько же, сколько рядов');
    box.forEach(b => {
      eq(b.minH >= 36, true, b.id + ': высота тап-зоны ' + b.minH);
      eq(b.minW >= 44, true, b.id + ': ширина тап-зоны ' + b.minW);
    });
  });

  check('выключение ряда в легенде пересчитывает среднее и подписи над столбцами', async p => {
    await p.evaluate(() => setStatsPeriod(6));
    // Из шести месяцев завершены пять, но траты вносятся только с прошлого (50 000 ₽):
    // четыре месяца до первой траты — «не вносились», а не нули (v1.77.0).
    eq(await avgDigits(p, '#grouped-avg'), '50000', 'среднее по всем группам');
    // Сумма — по ВСЕМ столбцам графика, включая текущий неполный месяц (в отличие
    // от среднего), поэтому она строго больше суммы завершённых месяцев.
    eq(await sumDigits(p, '#grouped-avg'), await chartSum(p, 'grouped'), 'сумма = все столбцы графика');
    eq(+(await sumDigits(p, '#grouped-avg')) > 50000, true, 'текущий месяц входит в сумму');
    const hidden = await p.evaluate(() => {
      const c = charts.grouped;
      const i = c.data.datasets.findIndex(d => d.label.startsWith('Аренда'));
      document.querySelectorAll('#grouped-legend .sl-chip')[i].click();
      return { i, prev: _stackVisTotals(c)[c.data.labels.length - 2], n: c.data.datasets.length };
    });
    eq(hidden.prev, 20000, 'подпись над столбцом прошлого месяца без «Аренды»');
    eq(await avgDigits(p, '#grouped-avg'), '20000', 'среднее пересчиталось под выбор');
    eq(await sumDigits(p, '#grouped-avg'), await chartSum(p, 'grouped'), 'сумма пересчиталась под выбор');
    const txt = await p.evaluate(() => document.getElementById('grouped-avg').textContent);
    eq(/выбрано 4 из 5/.test(txt), true, 'подписано, сколько рядов осталось: ' + txt);
  });

  check('«Кат. / Гр.» на стэк-графике расходов и ⌀ у каждого ряда', async p => {
    // В фикстуре у всех категорий свой цвет — групп нет, тогл не нужен.
    await p.evaluate(() => { setStatsPeriod(6); });
    eq(await p.evaluate(() => getComputedStyle(document.getElementById('grouped-view-toggle')).display), 'none', 'без групп тогла нет');
    const r = await p.evaluate(() => {
      const sum = () => _stackVisTotals(charts.grouped).reduce((s, v) => s + v, 0);
      const keep = DB.catColors.cat0002;
      DB.catColors.cat0002 = DB.catColors.cat0001;          // «Аренда» + «Продукты» — одна группа
      setGroupedViewMode('groups');
      const out = { toggle: getComputedStyle(document.getElementById('grouped-view-toggle')).display,
                    gN: charts.grouped.data.datasets.length, gSum: sum(),
                    gTitle: document.getElementById('grouped-title').textContent };
      setGroupedViewMode('cats');
      const c = charts.grouped;
      out.cN = c.data.datasets.length; out.cSum = sum();
      out.cTitle = document.getElementById('grouped-title').textContent;
      out.stored = localStorage.getItem('groupedViewMode');
      const i = c.data.datasets.findIndex(d => d.label === 'Аренда');
      out.colors = [c.data.datasets[i].backgroundColor, c.data.datasets[i + 1].backgroundColor];
      out.chipAvg = (document.querySelectorAll('#grouped-legend .sl-chip')[i].querySelector('.sl-avg').textContent.match(/\d/g) || []).join('');
      out.chips = document.querySelectorAll('#grouped-legend .sl-avg').length;
      DB.catColors.cat0002 = keep;
      setGroupedViewMode('groups');
      return out;
    });
    eq(r.toggle, 'flex', 'с группой из двух категорий тогл появился');
    eq(r.gN, 4, 'по группам: две категории слились в один ряд');
    eq(r.cN, 5, 'по категориям: ряд на категорию');
    eq(r.cSum, r.gSum, 'сумма графика от режима не зависит');
    eq(r.gTitle + '|' + r.cTitle, 'Расходы по группам|Расходы по категориям', 'заголовок следует за режимом');
    eq(r.stored, 'cats', 'режим запоминается');
    eq(r.colors[0] !== r.colors[1], true, 'категории одной группы различимы: ' + r.colors.join(' / '));
    eq(r.chipAvg, '30000', '⌀ «Аренды» в чипе легенды');
    eq(r.chips, 5, '⌀ стоит у каждого ряда');
  });

  check('среднее по тегам дохода живёт по тем же правилам', async p => {
    await p.evaluate(() => {
      const d = new Date(); let m = d.getMonth() - 1, y = d.getFullYear();
      if (m < 0) { m += 12; y--; }
      const mk = y + '-' + String(m + 1).padStart(2, '0');
      DB.incomes.push({id:'pi1', date: mk + '-05', source:'Зарплата', amount:60000, tag:'Оплата труда', updatedAt:1});
      DB.incomes.push({id:'pi2', date: mk + '-06', source:'Вклад', amount:20000, tag:'Проценты', updatedAt:1});
      saveDB(); renderStats();
    });
    eq(await avgDigits(p, '#income-tags-avg'), '16000', 'среднее по всем тегам (80 000 за 5 завершённых мес.)');
    eq(await sumDigits(p, '#income-tags-avg'), await chartSum(p, 'incomeTags'), 'сумма по всем тегам = все столбцы');
    await p.evaluate(() => {
      const c = charts.incomeTags;
      const i = c.data.datasets.findIndex(d => d.label === 'Проценты');
      document.querySelectorAll('#income-tags-legend .sl-chip')[i].click();
    });
    eq(await avgDigits(p, '#income-tags-avg'), '12000', 'среднее без «Процентов»');
    eq(await sumDigits(p, '#income-tags-avg'), await chartSum(p, 'incomeTags'), 'сумма без «Процентов»');
  });
});

suite(390, 'свой период на чипах «…»', () => {
  // Тап по «…» → поле; how: 'enter' | 'esc' | 'blur'
  const typeChip = (p, id, val, how = 'enter') => p.evaluate((id, val, how) => {
    // Чип — кнопка, поле встаёт НА ЕГО МЕСТО (input внутри button невалиден),
    // ищем его по data-chip; по завершении чип обязан вернуться в DOM
    const chip = document.getElementById(id);
    chip.click();
    const find = () => document.querySelector('input[data-chip="' + id + '"]');
    const inp = find();
    if (!inp) return 'нет поля';
    inp.value = val;
    if (how === 'blur') inp.dispatchEvent(new FocusEvent('blur'));
    else inp.dispatchEvent(new KeyboardEvent('keydown', { key: how === 'esc' ? 'Escape' : 'Enter' }));
    if (find()) return 'поле не закрылось';
    return document.getElementById(id) ? 'ok' : 'чип не вернулся';
  }, id, val, how);
  const on = (p, id) => p.evaluate(i => document.getElementById(i).style.background !== '', id);
  const txt = (p, id) => p.evaluate(i => document.getElementById(i).textContent, id);

  check('Аналитика: 9 месяцев с «…» — графики на 9 столбцов, чип «9 мес»', async p => {
    await p.evaluate(() => window.showPage('stats', document.getElementById('nav-stats')));
    eq(await txt(p, 'sp-c'), '…', 'по умолчанию «…»');
    eq(await typeChip(p, 'sp-c', '9'), 'ok', 'ввод');
    const s = await p.evaluate(() => ({ mode: statsPeriodMode, per: statsPeriod, stored: uiGet('statsPeriod'),
      bars: charts.incomeTags ? charts.incomeTags.data.labels.length : -1 }));
    eq(s.mode + '|' + s.per + '|' + s.stored, '9|9|9', 'режим, месяцы, сохранено');
    eq(s.bars, 9, 'столбцов на «Доходах по тегам»');
    eq(await txt(p, 'sp-c'), '9 мес', 'подпись чипа');
    eq(await on(p, 'sp-c'), true, 'свой чип подсвечен');
    eq(await on(p, 'sp-6'), false, '«6 мес» погашен');
  });

  check('пустое поле и Escape — отмена, больше 240 — до 240, готовое число — готовый чип', async p => {
    await p.evaluate(() => { window.showPage('stats', document.getElementById('nav-stats')); setStatsPeriod(9); });
    await typeChip(p, 'sp-c', '', 'blur');
    eq(await p.evaluate(() => statsPeriodMode), '9', 'пустое поле ничего не меняет');
    await typeChip(p, 'sp-c', '5', 'esc');
    eq(await p.evaluate(() => statsPeriodMode), '9', 'Escape ничего не меняет');
    eq(await txt(p, 'sp-c'), '9 мес', 'подпись вернулась');
    await typeChip(p, 'sp-c', '999');
    eq(await p.evaluate(() => statsPeriodMode), '240', 'обрезано до 240');
    await typeChip(p, 'sp-c', '12');
    eq(await p.evaluate(() => statsPeriodMode), '12', '12 с клавиатуры');
    eq(await on(p, 'sp-12'), true, 'подсвечен готовый «12 мес»');
    eq(await txt(p, 'sp-c') + (await on(p, 'sp-c')), '…false', 'свой чип снова «…» и погашен');
  });

  check('поиск, глубина средней, накопления, доходность, лимиты', async p => {
    await p.evaluate(() => window.showPage('stats', document.getElementById('nav-stats')));
    await typeChip(p, 'esp-c', '9');
    eq(await p.evaluate(() => _expSearchPeriod()), 9, 'поиск по тратам: 9');
    eq(await txt(p, 'esp-c'), '9', 'подпись в поиске');
    await typeChip(p, 'dam-c', '40');
    eq(await p.evaluate(() => uiGet('dayAvgMonths')), '36', 'глубина средней обрезана до 36');
    eq(await txt(p, 'dam-c'), '36', 'подпись глубины');
    await typeChip(p, 'svp-c', '9');
    eq(await p.evaluate(() => savingsPeriodMode), '9', 'накопления: 9');
    eq(await txt(p, 'svp2-c'), '9 мес', 'второй ряд накоплений подписан тоже');
    await typeChip(p, 'dyp-c', '9');
    eq(await p.evaluate(() => uiGet('depYieldPeriod')), '9', 'доходность вкладов: 9');
    eq(await txt(p, 'dyp-c'), '9 мес', 'подпись доходности');
    await p.evaluate(() => {
      const k = monthKey(currentMonth.y, currentMonth.m);
      const sel = document.getElementById('limit-month-sel');
      sel.innerHTML = `<option value="${k}">${k}</option>`; sel.value = k;
    });
    await typeChip(p, 'lam-c', '7');
    eq(await p.evaluate(() => sessionStorage.getItem('limitAvgMonths')), '7', 'лимиты: 7');
    eq(await txt(p, 'lam-c'), '7', 'подпись в редакторе лимитов');
  });

  check('при старте свой период проходит проверку, мусор — к умолчанию', async p => {
    const r = await p.evaluate(() => {
      const out = [_periodMode('9', '6'), _periodMode('500', '6'), _periodMode('abc', '6'), _periodMode('all', '6')];
      uiSet('expSearchPeriod', '0'); out.push(_expSearchPeriod());
      uiSet('expSearchPeriod', '18'); out.push(_expSearchPeriod());
      return out.join('|');
    });
    eq(r, '9|240|6|all|6|18', '_periodMode и _expSearchPeriod');
  });
});

suite(390, 'доходность вкладов и архив закрытых', () => {
  // 100 000 ровно на 365 дней, фактические проценты 10 000 → 10% годовых.
  const CLOSED = { id: 'y1', name: 'Тест', amount: 100000, rate: 10, openDate: '2025-01-01', endDate: '2026-01-01',
    capitalization: 'end', closedAt: '2026-01-01', closedInterest: 10000, _deleted: true, updatedAt: 1 };

  check('_depYield: начислено по деньго-дням, получено по дате закрытия', async p => {
    const r = await p.evaluate(c => {
      DB.deposits = [c];
      const all = _depYield('0000-01-01', '9999-12-31');
      const half = _depYield('2025-01-01', '2025-07-02');     // 182 дня из 365
      const after = _depYield('2026-01-01', '2027-01-01');
      return { all: [all.accrued, all.received, all.rate], half: [half.accrued, half.received, half.rate],
               after: [after.accrued, after.received, after.rate, after.rows.length] };
    }, CLOSED);
    eq(r.all.join('|'), '10000|10000|10', 'всё время');
    eq(await p.evaluate(() => _depYield('0000-01-01', '9999-12-31').avgBody), 100000, '«в среднем на вкладах» за всё = тело');
    eq(await p.evaluate(() => _depYield('2025-01-01', '2026-01-01').avgBody), 100000, 'за год жизни вклада — тоже тело');
    // Вклад открыт в июле: окно 2025 года всё равно с 01.01 — до v1.79.7 обрезалось по открытию
    const w = await p.evaluate(c => { DB.deposits = [{ ...c, openDate: '2025-07-02' }];
      const y = _depYield('2025-01-01', '2026-01-01');
      return [y.pFrom, y.pTo, y.pDays, y.avgBody, Math.round(y.avgBody * y.rate / 100 * y.pDays / 365) - y.accrued]; }, CLOSED);
    eq(w.slice(0, 4).join('|'), '2025-01-01|2026-01-01|365|50137', 'окно года с 01.01, хоть вклад открыт в июле');
    eq(Math.abs(w[4]) <= 1, true, 'средняя × ставка × дни/365 = начислено, расхождение ' + w[4]);
    await p.evaluate(c => { DB.deposits = [c]; }, CLOSED);
    eq(r.half.join('|'), '4986|0|10', 'полгода: 10 000 × 182/365, получено 0');
    eq(r.after.map(String).join('|'), '0|10000|null|1', 'год закрытия после срока: только получено');
  });

  check('взвешенная средняя, а не среднее ставок', async p => {
    const rate = await p.evaluate(c => {
      // 1 000 000 на полгода под ~20% и 100 000 на год под 10%
      DB.deposits = [c, { ...c, id: 'y2', amount: 1000000, openDate: '2025-01-01', endDate: '2025-07-02',
        closedAt: '2025-07-02', closedInterest: 99726 }];
      return Math.round(_depYield('0000-01-01', '9999-12-31').rate * 10) / 10;
    }, CLOSED);
    // 109 726 ÷ ((100 000×365 + 1 000 000×182) / 365) — а среднее ставок дало бы 15%
    eq(rate, 18.3, 'средняя доходность');
  });

  check('строки: закрытые сверху с «факт», открытые ниже с полным доходом за срок', async p => {
    const r = await p.evaluate(c => {
      DB.deposits = [{ ...c, id: 'o1', name: 'Открытый', openDate: '2025-06-01', endDate: '2099-01-01', closedAt: undefined, closedInterest: undefined, _deleted: false }, c];
      const y = _depYield('0000-01-01', '9999-12-31');
      const html = _depYieldHtml(y);
      const els = [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('.dy-row')];
      return { order: y.rows.map(x => x.d.id).join(','), rows: els.map(el => el.textContent.replace(/\s+/g, ' ')),
               bars: els.map(el => !!el.querySelector('.dy-bar')).join(','), cells: els.map(el => el.children.length).join(',') };
    }, CLOSED);
    eq(r.order, 'y1,o1', 'закрытый первым');
    const ord = await p.evaluate(c => {
      const o = (id, openDate, endDate) => ({ ...c, id, openDate, endDate, closedAt: undefined, closedInterest: undefined, _deleted: false });
      DB.deposits = [o('late', '2025-02-01', '2099-06-01'), o('soon', '2025-09-01', '2099-01-01'), { ...c, id: 'old', closedAt: '2025-06-01', endDate: '2026-01-01' }, c];
      return _depYield('0000-01-01', '9999-12-31').rows.map(x => x.d.id).join(',');
    }, CLOSED);
    eq(ord, 'old,y1,soon,late', 'по дате закрытия: closedAt у закрытых, endDate у открытых — не по открытию');
    eq(r.cells, '4,4', 'строки — таблица из четырёх колонок: вклад, ставка, за период, за срок');
    eq(/закрыт 01\.01\.26 .*10\.0%/.test(r.rows[0]), true, 'закрытый: ' + r.rows[0]);
    eq(/до 01\.01\.99 .*[\d.]+%/.test(r.rows[1]) && !/~/.test(r.rows[1]), true, 'открытый: ' + r.rows[1]);
    eq(r.bars, 'false,true', 'полоска «сколько набежало» только у открытого');
  });

  check('вкладка «Выплачено»: закрытые в периоде и открытые в «Ожидается»', async p => {
    const r = await p.evaluate(c => {
      DB.deposits = [c, { ...c, id: 'o2', name: 'Открытый', openDate: '2025-06-01', endDate: '2099-01-01', closedAt: undefined, closedInterest: undefined, _deleted: false }];
      window.showPage('deposits');
      setDepYieldPeriod('all');
      const accRate = !!document.querySelector('#dep-yield-body .dy-rate');
      setDepYieldTab('rec');
      const body = document.getElementById('dep-yield-body');
      const out = { accRate, saved: uiGet('depYieldTab'), rec: (body.querySelector('.dy-rec').textContent.match(/\d/g) || []).join(''),
        closed: body.querySelectorAll('.dy-row').length, open: body.querySelectorAll('.dy-open').length,
        noRate: !body.querySelector('.dy-rate'), recOn: document.getElementById('dyt-rec').style.fontWeight };
      setDepYieldTab('acc');
      return out;
    }, CLOSED);
    eq(r.accRate, true, 'по умолчанию «Начислено» со средней доходностью');
    eq(r.saved, 'rec', 'выбор вкладки сохранён');
    eq(r.rec, '10000', 'выплачено = проценты закрытого');
    eq(r.closed + '|' + r.open, '1|1', 'одна строка закрытого, одна в «Ожидается»');
    eq(r.noRate, true, 'на «Выплачено» начисленных цифр нет');
    eq(r.recOn, '600', 'чип вкладки подсвечен');
  });

  check('отчёт за текущий год: начислено + ещё до 31.12 = доход за год', async p => {
    const r = await p.evaluate(() => {
      const Y = +today().slice(0, 4);
      DB.deposits = [{ id: 'cy', name: 'Год', amount: 100000, rate: 10, openDate: Y + '-01-01', endDate: (Y + 1) + '-01-01', capitalization: 'end', updatedAt: 1 }];
      const y = _depYield(Y + '-01-01', (Y + 1) + '-01-01');
      const I = depositValueAt(DB.deposits[0], (Y + 1) + '-01-01') - 100000;
      const html = _depYieldHtml(y, 'report', { per: 'за год', restLbl: 'ещё до 31.12' });
      return { sum: y.accrued + y.expected, I, rest: y.expected, full: html.includes('dy-full'), rec: html.includes('dy-rec') };
    });
    eq(r.rest > 0, true, 'ещё набежит: ' + r.rest);
    eq(Math.abs(r.sum - r.I) <= 1, true, 'итого ' + r.sum + ' ≈ доход за год ' + r.I);
    eq(r.full && r.rec, true, 'в отчёте строки «Итого за год» и «Выплачено за год»');
  });

  check('архив закрытых свёрнут по умолчанию, раскрывается и запоминается', async p => {
    const r = await p.evaluate(c => {
      DB.deposits = [c]; window.showPage('deposits');
      const list = document.getElementById('deposits-closed-list');
      const before = getComputedStyle(list).display;
      const title = document.getElementById('deposits-closed-title').textContent;
      toggleClosedDeps();
      return { before, title, after: getComputedStyle(list).display, saved: uiGet('showClosedDeps', '0') };
    }, CLOSED);
    eq(r.before, 'none', 'свёрнут');
    eq(r.title, 'Закрытые вклады (1)', 'заголовок со счётчиком');
    eq(r.after !== 'none', true, 'раскрылся');
    eq(r.saved, '1', 'выбор сохранён');
  });

  check('вклад, закрытый задним числом, уходит из ряда активов в дату закрытия', async p => {
    const s = await p.evaluate(c => { DB.deposits = [c]; return _buildAssetSeries(['2025-06-01', '2026-02-01']).depSeries; }, CLOSED);
    eq(s.join('|'), '100000|0', 'до закрытия есть, после — нет');
  });

  check('чистка 90 дней не трогает закрытые, миграция узнаёт закрытый по доходу', async p => {
    const r = await p.evaluate(c => {
      DB.deposits = [c,
        { id: 'y3', name: 'Удалён', amount: 5000, rate: 5, openDate: '2025-01-01', endDate: '2025-06-01', capitalization: 'end', _deleted: true, updatedAt: 1 },
        { id: 'y4', name: 'Старый', amount: 5000, rate: 5, openDate: '2025-01-01', endDate: '2025-06-01', capitalization: 'end', _deleted: true, updatedAt: 1 },
        { id: 'y5', name: 'Стёрт', amount: 5000, rate: 5, openDate: '2025-01-01', endDate: '2025-06-01', capitalization: 'end', _deleted: true, closedAt: null, updatedAt: 1 }];
      DB.incomes.push({ id: 'yi', date: '2025-06-01', source: 'Проценты по вкладу Старый', amount: 120, tag: '', updatedAt: 1 });
      DB.incomes.push({ id: 'yj', date: '2025-06-01', source: 'Проценты по вкладу Стёрт', amount: 120, tag: '', updatedAt: 1 });
      saveDB(); loadDB();
      const old = DB.deposits.find(d => d.id === 'y4');
      return { ids: DB.deposits.map(d => d.id).sort().join(','), old: old ? old.closedAt + '/' + old.closedInterest : '' };
    }, CLOSED);
    eq(r.ids, 'y1,y4', 'остались закрытый и мигрированный');
    eq(r.old, '2025-06-01/120', 'миграция: closedAt и проценты из дохода');
  });

  check('закрытие: дата окончания по умолчанию, без записи в доходы по галке', async p => {
    const r = await p.evaluate(() => {
      DB.deposits = [{ id: 'y6', name: 'Ретро', amount: 100000, rate: 12, openDate: '2025-01-01', endDate: '2025-07-01', capitalization: 'end', updatedAt: 1 }];
      const before = DB.incomes.length;
      openCloseDeposit('y6');
      const date = document.getElementById('close-dep-date').value;
      const interest = parseMoney(document.getElementById('close-dep-interest').value);
      document.getElementById('close-dep-to-income').checked = false;
      confirmCloseDeposit();
      const d = DB.deposits[0];
      return { date, interest, closed: d.closedAt + '/' + d.closedInterest + '/' + d._deleted, added: DB.incomes.length - before };
    });
    eq(r.date, '2025-07-01', 'дата закрытия = endDate');
    eq(r.interest, 5951, 'расчётные проценты 100 000 × 12% × 181/365');
    eq(r.closed, '2025-07-01/5951/true', 'вклад закрыт');
    eq(r.added, 0, 'доход не записан');
  });

  check('досрочное закрытие: кнопка на открытом вкладе, проценты сгорели', async p => {
    const r = await p.evaluate(() => {
      DB.deposits = [{ id: 'y7', name: 'Досрочный', amount: 100000, rate: 12, openDate: '2025-01-01', endDate: '2099-01-01', capitalization: 'monthly', updatedAt: 1 }];
      const before = DB.incomes.length;
      window.showPage('deposits');
      // кнопка живёт в модалке правки вклада, не на карточке (v1.75.2)
      openDepositModal('y7');
      const btn = document.getElementById('deposit-close-btn');
      if(!btn || btn.style.display === 'none') return { btn: false };
      btn.click();
      const date = document.getElementById('close-dep-date').value;
      const prefill = parseMoney(document.getElementById('close-dep-interest').value);
      _closeDepZero();
      _closeDepRecalc(); // смена даты не должна затереть ручной 0
      const tagHidden = document.getElementById('close-dep-tag-grp').style.display === 'none';
      confirmCloseDeposit();
      const d = DB.deposits[0];
      return { btn: true, date, prefill, tagHidden, closed: d.closedAt === today() && d.closedInterest === 0 && d._deleted === true,
               added: DB.incomes.length - before, inOpen: document.getElementById('deposits-list').textContent.includes('Досрочный') };
    });
    eq(r.btn, true, 'кнопка «Закрыть досрочно» есть');
    eq(r.date, await p.evaluate(() => today()), 'дата закрытия — сегодня');
    eq(r.prefill > 0, true, 'начисленные проценты предзаполнены: ' + r.prefill);
    eq(r.tagHidden, true, 'при 0 выбор тега скрыт');
    eq(r.closed, true, 'закрыт сегодня с нулевыми процентами');
    eq(r.added, 0, 'доход не записан');
    eq(r.inOpen, false, 'из открытых ушёл');
  });
});

suite(390, 'демо-набор покрывает всё приложение', () => {
  // Эти экраны до v1.69.0 не проверял никто: в FIXTURE deposits/investments/
  // credits/templates были пустыми массивами, и рендерить было нечего.
  check('вклады: три живых, у каждого тело, срок и доход', async p => {
    await p.evaluate(() => window.showPage('deposits'));
    const n = await p.evaluate(() => document.querySelectorAll('#deposits-list > div').length);
    eq(n >= 3, true, 'карточек вкладов на странице: ' + n);
    const total = await p.evaluate(() => (document.getElementById('deposits-total-now').textContent.match(/\d/g) || []).join(''));
    eq(Number(total) > 0, true, '«На вкладах сейчас» посчитано: ' + total);
    const txt = await p.evaluate(() => document.getElementById('deposits-list').textContent);
    eq(/капитализац/i.test(txt), true, 'месячная капитализация подписана');
    eq(/пополнени/i.test(txt), true, 'пополнения показаны');
  });

  check('удалённый вклад в список не попадает', async p => {
    const shown = await p.evaluate(() => document.getElementById('deposits-list').textContent.includes('Старый вклад'));
    eq(shown, false, 'вклад с _deleted не отрисован');
    eq(await p.evaluate(() => DB.deposits.some(d => d._deleted)), true, 'при этом тумбстоун в данных есть');
  });

  check('закрытый вклад — в архиве, доходность на странице вкладов и в отчёте', async p => {
    await p.evaluate(() => window.showPage('deposits'));
    const st = await p.evaluate(() => ({
      open: document.getElementById('deposits-list').textContent.includes('ВТБ · полгода'),
      closed: document.getElementById('deposits-closed-list').textContent.includes('ВТБ · полгода'),
      grp: getComputedStyle(document.getElementById('deposits-closed-grp')).display,
      yieldShown: getComputedStyle(document.getElementById('deposits-yield-wrap')).display,
    }));
    eq(st.open, false, 'закрытый не в списке открытых');
    eq(st.closed, true, 'закрытый в «Закрытых вкладах»');
    eq(st.grp !== 'none', true, 'секция закрытых видна');
    eq(st.yieldShown !== 'none', true, 'карточка «Доходность» видна');
    await p.evaluate(() => setDepYieldPeriod('all'));
    const txt = await p.evaluate(() => document.querySelector('#dep-yield-body .dy-rate').textContent);
    eq(/^\d+\.\d%/.test(txt), true, 'средняя доходность печатается: ' + txt);
    await p.evaluate(() => { uiSet('reportYear', 'all'); window.showPage('report'); });
    const rows = await p.evaluate(() => document.querySelectorAll('#rep-dep-yield .dy-row').length);
    eq(rows >= 4, true, 'в отчёте «всё время» строки вкладов: ' + rows);
    // вернуть отчёт на последний год — страница у сюиты общая, «Всё время» ломало бы проверки дальше
    await p.evaluate(() => { const s = document.getElementById('report-year'); s.value = s.options[0].value; uiSet('reportYear', s.value); renderReport(); });
  });

  check('инвестиции: снимки и вывод средств', async p => {
    await p.evaluate(() => window.showPage('investments'));
    const n = await p.evaluate(() => document.getElementById('investments-list').children.length);
    eq(n >= 1, true, 'карточек инвестиций: ' + n);
    const withdrawn = await p.evaluate(() => (DB.investments[0].contributions || []).some(c => c.amount < 0));
    eq(withdrawn, true, 'в наборе есть вывод средств (amount < 0)');
    const total = await p.evaluate(() => (document.getElementById('investments-total-now').textContent.match(/\d/g) || []).join(''));
    eq(Number(total) > 0, true, '«Стоимость сейчас» посчитана: ' + total);
  });

  check('кредиты: грейс и сплит с отметками оплаты', async p => {
    await p.evaluate(() => window.showPage('assets', document.getElementById('nav-assets')));
    const txt = await p.evaluate(() => document.getElementById('credits-list').textContent);
    eq(/грейс/i.test(txt), true, 'грейс-кредитка в списке: ' + txt.slice(0, 80));
    eq(/сплит/i.test(txt), true, 'сплит в списке');
    eq(/оплачено 2\/4/.test(txt), true, 'видно, сколько платежей закрыто: ' + txt.slice(0, 120));
    // Суммы долгов красные — как минусы кредиток в списке счетов, а не синие «как актив»
    const col = await p.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--red)';
      document.body.appendChild(probe);
      const red = getComputedStyle(probe).color;
      probe.remove();
      const amts = [...document.querySelectorAll('#credits-list .asset-amount')].map(e => getComputedStyle(e).color);
      return { red, amts };
    });
    eq(col.amts.length >= 2 && col.amts.every(c => c === col.red), true, 'суммы кредитов красные: ' + JSON.stringify(col));
  });

  check('«Всего активов» = банки + вклады + инвестиции', async p => {
    const parts = await p.evaluate(() => {
      const num = id => Number((document.getElementById(id).textContent.match(/\d/g) || []).join(''));
      return { total: num('total-val'), banks: num('total-banks-val'), deps: num('total-deps-val'), inv: num('total-inv-val') };
    });
    eq(parts.banks > 0 && parts.deps > 0 && parts.inv > 0, true, 'все три части ненулевые: ' + JSON.stringify(parts));
    near(parts.total, parts.banks + parts.deps + parts.inv, 'итог сходится с разбивкой', 2);
  });

  check('история активов: колонки и глубина', async p => {
    const head = await p.evaluate(() => [...document.querySelectorAll('#assets-history-table th')].map(th => th.textContent.trim()).join('|'));
    eq(/Счета/.test(head) && /Вклады/.test(head) && /Всего/.test(head), true, 'колонки истории: ' + head);
    const rows = await p.evaluate(() => document.querySelectorAll('#assets-history-table tbody tr, #assets-history-table tr').length);
    eq(rows > 5, true, 'строк в истории: ' + rows);
  });

  check('шаблоны быстрых трат нарисованы чипами', async p => {
    await p.evaluate(() => window.showPage('day', document.getElementById('nav-day')));
    const n = await p.evaluate(() => document.querySelectorAll('#template-chips > *').length);
    eq(n, 5, 'чипов шаблонов');
  });

  check('история — 14 месяцев, все периоды графиков наполнены', async p => {
    eq(await p.evaluate(() => _dataMonthsSpan()), 14, 'месяцев в данных');
    await p.evaluate(() => { window.showPage('stats', document.getElementById('nav-stats')); setStatsPeriod(12); });
    const empty = await p.evaluate(() => charts.grouped.data.labels
      .filter((_, i) => _stackVisTotals(charts.grouped)[i] === 0).length);
    eq(empty, 0, 'пустых столбцов на 12 месяцах: ' + empty);
  });

  check('тумбстоуны есть в данных и не попадают в суммы', async p => {
    const t = await p.evaluate(() => ({
      exp: DB.expenses.filter(e => e._deleted).length,
      inc: DB.incomes.filter(i => i._deleted).length,
      ast: DB.assets.filter(a => a._deleted).length,
      leak: getMonthExpenses(new Date().getFullYear(), new Date().getMonth()).some(e => e._deleted),
    }));
    eq(t.exp > 0 && t.inc > 0 && t.ast > 0, true, 'тумбстоуны всех видов: ' + JSON.stringify(t));
    eq(t.leak, false, 'удалённые не попадают в расходы месяца');
  });

  check('бронь особых заполнена и видна в шапке «Бюджета»', async p => {
    await p.evaluate(() => window.showPage('budget', document.getElementById('nav-budget')));
    const txt = await p.evaluate(() => document.getElementById('budget-days-row').parentElement.textContent);
    eq(/обязательные/i.test(txt), true, 'ячейка обязательных на месте');
    eq(await p.evaluate(() => Object.keys(DB.specPlan[monthKey(new Date().getFullYear(), new Date().getMonth())] || {}).length), 2, 'категорий в брони');
  });

  check('дни недели и подушка живут на «Аналитике»', async p => {
    await p.evaluate(() => window.showPage('stats', document.getElementById('nav-stats')));
    const got = await p.evaluate(() => ({
      wd: !!charts.weekday, cu: !!charts.cushion,
      now: document.getElementById('cushion-now').textContent,
    }));
    eq(got.wd, true, 'график дней недели');
    eq(got.cu, true, 'график подушки');
    eq(/мес/.test(got.now), true, 'текущая подушка в месяцах');
  });

  check('подушка и дни недели есть в годовом отчёте', async p => {
    await p.evaluate(() => window.showPage('report'));
    const txt = await p.evaluate(() => document.getElementById('report-body').textContent);
    eq(/Финансовая подушка/.test(txt), true, 'блок подушки в отчёте');
    eq(/Дешевле всего/.test(txt), true, 'вывод про дни недели в отчёте');
  });

  check('тап по столбику отчёта показывает цифру тостом', async p => {
    await p.evaluate(() => window.showPage('report'));
    const cushion = await p.evaluate(() => {
      document.querySelector('.rb-bar').click();
      return document.getElementById('toast').textContent;
    });
    eq(/: [\d.]+ мес/.test(cushion), true, 'тост подушки с месяцами: ' + cushion);
    const wd = await p.evaluate(() => {
      document.querySelector('.rb-wd').click();
      return document.getElementById('toast').textContent;
    });
    eq(/⌀ [\d\s ]+₽/.test(wd), true, 'тост дня недели с суммой: ' + wd);
  });

  check('годовой отчёт наполнен и на прошлый год тоже', async p => {
    await p.evaluate(() => window.showPage('report'));
    const rows = await p.evaluate(() => document.querySelectorAll('#rep-col-a table tr').length);
    eq(rows > 3, true, 'строк в помесячной таблице: ' + rows);
    const years = await p.evaluate(() => document.querySelectorAll('#report-year option').length);
    eq(years >= 2, true, 'лет на выбор: ' + years);
  });

  check('«всё» в Аналитике и «Всё время» в отчёте дают одни дни недели', async p => {
    const nums = s => (s.match(/⌀\s*[\d\s ]+₽/g) || []).map(x => x.replace(/\D/g, ''));
    const a = await p.evaluate(() => {
      window.showPage('stats', document.getElementById('nav-stats'));
      setStatsPeriod('all');
      return document.getElementById('weekday-summary').textContent;
    });
    const b = await p.evaluate(() => {
      window.showPage('report');
      const sel = document.getElementById('report-year');
      sel.value = 'all'; renderReport();
      return [...document.querySelectorAll('#rep-col-b .chart-card')]
        .map(c => c.textContent).find(t => /Дешевле всего/.test(t)) || '';
    });
    await p.evaluate(() => { // вернуть состояние соседним чекам
      document.getElementById('report-year').value = String(new Date().getFullYear());
      renderReport();
      setStatsPeriod(6);
    });
    eq(nums(a).length, 2, 'в сводке Аналитики две суммы');
    eq(nums(a).join('|'), nums(b).join('|'), 'средние совпали с отчётом');
  });
}, { demo: true });

// Дни недели и финансовая подушка: общий движок (_weekdayAvgs/_cushionAt)
// для карточек «Аналитики» и блоков годового отчёта.
suite(390, 'дни недели и подушка', () => {
  check('карточки на «Аналитике» отрисованы на фикстуре', async p => {
    await p.evaluate(() => window.showPage('stats', document.getElementById('nav-stats')));
    const got = await p.evaluate(() => ({
      wd: !!charts.weekday,
      sum: document.getElementById('weekday-summary').textContent,
      now: document.getElementById('cushion-now').textContent,
    }));
    eq(got.wd, true, 'график дней недели создан');
    eq(/Дешевле всего/.test(got.sum), true, 'строка-вывод про дешёвый день');
    eq(got.now.length > 0, true, 'плашка подушки не пустая');
  });

  check('_weekdayAvgs: среднее по дню недели, особые и удалённые вне', async p => {
    const got = await p.evaluate(() => {
      const saved = DB.expenses;
      DB.expenses = [
        {id:'w1', date:'2026-06-01', cat:1, catId:DB.catIds[1], amount:1000},               // Пн
        {id:'w2', date:'2026-06-08', cat:1, catId:DB.catIds[1], amount:3000},               // Пн
        {id:'w3', date:'2026-06-02', cat:1, catId:DB.catIds[1], amount:500, special:true},  // Вт — особая, вне
        {id:'w4', date:'2026-06-03', cat:1, catId:DB.catIds[1], amount:700, _deleted:true}, // Ср — удалена, вне
      ];
      const wd = _weekdayAvgs('2026-06-01', '2026-06-14'); // две полные недели Пн–Вс
      DB.expenses = saved;
      return {mon: wd.avgs[0], tue: wd.avgs[1], wed: wd.avgs[2], cnt: wd.counts[0]};
    });
    eq(got.cnt, 2, 'понедельников в периоде');
    eq(got.mon, 2000, '⌀ понедельника');
    eq(got.tue, 0, 'особая не вошла во вторник');
    eq(got.wed, 0, 'удалённая не вошла в среду');
  });

  check('_cushionAt: активы ÷ ⌀ расход завершённых месяцев', async p => {
    const got = await p.evaluate(() => {
      const series = {dates:['2026-06-20','2026-08-20'], bankSeries:[80000,100000], depSeries:[15000,15000], invSeries:[5000,5000]};
      const expBy = {'2026-06': 30000, '2026-07': 20000, '2026-08': 10000};
      const atEnd  = _cushionAt(series, expBy, '2026-08-31'); // авг завершён: окно июн–авг
      const midSep = _cushionAt(series, expBy, '2026-09-15'); // сен не завершён: то же окно
      const firstM = _cushionAt(series, expBy, '2026-06-30'); // один завершённый месяц — уже точка
      const early  = _cushionAt(series, expBy, '2026-06-15'); // ни одного завершённого месяца
      return {m1: atEnd && atEnd.months, m2: midSep && midSep.months, m0: firstM && firstM.months, early};
    });
    eq(got.m1, 6, 'подушка на конец августа'); // 120000 ÷ 20000
    eq(got.m2, 6, 'середина сентября считает по тем же завершённым месяцам');
    near(got.m0, 100000/30000, 'первый месяц истории виден', 0.01); // порог — 1 месяц
    eq(got.early, null, 'ни одного завершённого месяца — null');
  });

  check('пустые дни до первой траты не размывают средние дней недели', async p => {
    const got = await p.evaluate(() => {
      const saved = DB.expenses;
      DB.expenses = [
        {id:'w1', date:'2026-06-01', cat:1, catId:DB.catIds[1], amount:1000}, // Пн
        {id:'w2', date:'2026-06-08', cat:1, catId:DB.catIds[1], amount:3000}, // Пн
      ];
      // Аналитика зовёт с первого числа раннего месяца, отчёт — с даты первой
      // траты; движок обязан привести оба к одному началу
      const a = _weekdayAvgs('2026-04-01', '2026-06-14');
      const b = _weekdayAvgs('2026-06-01', '2026-06-14');
      DB.expenses = saved;
      return {aMon: a.avgs[0], bMon: b.avgs[0], aCnt: a.counts[0], bCnt: b.counts[0]};
    });
    eq(got.aCnt, got.bCnt, 'число понедельников совпало');
    eq(got.aMon, 2000, '⌀ понедельника без разбавления пустым апрелем-маем');
    eq(got.aMon, got.bMon, 'средние совпали');
  });
});

// Секрет Apps Script скрыт звёздочками, а дата снимка принимает будущее:
// вечером 31-го вносят состояние на 1-е, и «🏷 грейс» обязан сохранить снимок
// за выбранную дату. С max=today() пикер молча ел будущую дату, и снимок
// уезжал на сегодня.
suite(390, 'секрет синка и дата снимка', () => {
  check('поле секрета — password, глаз переключает видимость', async p => {
    await p.evaluate(() => openSyncSettings());
    eq(await p.evaluate(() => document.getElementById('sync-token-input').type), 'password', 'тип поля при открытии');
    await p.evaluate(() => toggleSyncTokenVis(document.getElementById('sync-token-eye')));
    eq(await p.evaluate(() => document.getElementById('sync-token-input').type), 'text', 'после глаза секрет видно');
    await p.evaluate(() => { closeModal('modal-sync'); openSyncSettings(); });
    eq(await p.evaluate(() => document.getElementById('sync-token-input').type), 'password', 'повторное открытие снова прячет');
    await p.evaluate(() => closeModal('modal-sync'));
  });

  check('снимок сохраняется за будущую дату, «грейс» берёт введённую сумму', async p => {
    const got = await p.evaluate(() => {
      // старый баланс кредитки — именно его грейс подставлял вместо введённого,
      // пока «остаток банка» отсекался по today() и не видел будущий снимок
      DB.assets.push({ id: 'tst-alfa', date: '2026-01-01', bankName: 'Альфа-Банк', bank: 2, amount: 12000, updatedAt: 1 });
      const t = new Date(Date.now() + 86400000);
      const tomorrow = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
      openEditAssetDate(tomorrow, true);
      const noMax = !document.getElementById('asset-edit-date').getAttribute('max');
      const idx = getAllBanks().indexOf('Альфа-Банк');
      const inp = document.getElementById('asset-edit-inp-' + idx);
      inp.value = '5 000';
      _tagCreditSnapshot('Альфа-Банк', 'grace');
      const rec = DB.assets.find(a => !a._deleted && a.bankName === 'Альфа-Банк' && a.date === tomorrow);
      const graceOpen = document.getElementById('modal-grace').classList.contains('open');
      const graceAmt = parseMoney(document.getElementById('grace-amount').value);
      closeModal('modal-grace');
      return { noMax, amount: rec ? rec.amount : null, graceOpen, graceAmt };
    });
    eq(got.noMax, true, 'у даты снимка нет max');
    eq(got.amount, 5000, 'снимок кредитки лёг на завтрашнюю дату');
    eq(got.graceOpen, true, 'модалка грейса открылась после сохранения');
    eq(got.graceAmt, 5000, 'в сумме грейса введённый баланс, а не старый');
  });
});

suite(390, 'чипы «банки / вклады / инвестиции» на графике накоплений', () => {
  const open = (p, stored) => p.evaluate(v => {
    localStorage.removeItem('assetsChartDeps');
    if (v === null) localStorage.removeItem('assetsChartParts'); else localStorage.setItem('assetsChartParts', v);
    window.showPage('assets', document.getElementById('nav-assets'));
  }, stored);
  const active = p => p.evaluate(() => ['banks', 'deps', 'inv']
    .filter(k => document.getElementById('acp-' + k).style.fontWeight === '600').join(','));
  const last = p => p.evaluate(() => { const d = charts.assets.data.datasets[0].data; return d[d.length - 1]; });
  const tap = (p, k) => p.evaluate(key => document.getElementById('acp-' + key).click(), k);
  const sums = p => p.evaluate(() => {
    const s = _buildAssetSeries(); const i = s.dates.length - 1;
    return { banks: s.bankSeries[i], deps: s.depSeries[i], inv: s.invSeries[i] };
  });

  check('по умолчанию три чипа видны и все включены', async p => {
    await open(p, null);
    eq(await isVisible(p, '#assets-chart-parts-toggle'), true, 'переключатель виден');
    const cells = await p.evaluate(() => [...document.querySelectorAll('#assets-chart-parts-toggle > button')]
      .filter(s => s.style.display !== 'none').map(s => s.textContent.trim()));
    eq(cells.join('|'), 'банки|вклады|инвестиции', 'состав чипов');
    eq(await active(p), 'banks,deps,inv', 'все включены');
    const s = await sums(p);
    near(await last(p), s.banks + s.deps + s.inv, 'последняя точка = банки + вклады + инвестиции', 2);
  });

  check('чипы выключаются независимо, линия пересчитывается', async p => {
    await open(p, null);
    const s = await sums(p);
    await tap(p, 'deps');
    eq(await active(p), 'banks,inv', 'после выключения вкладов');
    near(await last(p), s.banks + s.inv, 'без вкладов', 2);
    await tap(p, 'banks');
    eq(await active(p), 'inv', 'только инвестиции');
    near(await last(p), s.inv, 'одни инвестиции', 2);
    eq(await p.evaluate(() => localStorage.getItem('assetsChartParts')), 'inv', 'выбор сохранён на устройстве');
  });

  check('последний включённый чип выключить нельзя', async p => {
    await open(p, 'deps');
    eq(await active(p), 'deps', 'стартовое состояние');
    await tap(p, 'deps');
    eq(await active(p), 'deps', 'чип остался включённым');
    const s = await sums(p);
    near(await last(p), s.deps, 'линия по-прежнему одни вклады', 2);
  });

  check('старый тумблер «только банки» переезжает в чипы', async p => {
    await p.evaluate(() => { localStorage.removeItem('assetsChartParts'); localStorage.setItem('assetsChartDeps', '0');
      window.showPage('assets', document.getElementById('nav-assets')); });
    eq(await active(p), 'banks', 'явный выбор «банки» сохранён');
    await p.evaluate(() => { localStorage.setItem('assetsChartDeps', '1');
      window.showPage('assets', document.getElementById('nav-assets')); });
    eq(await active(p), 'banks,deps,inv', '«+вклады·инвест» → всё включено');
    await p.evaluate(() => { localStorage.removeItem('assetsChartDeps'); localStorage.removeItem('assetsChartParts'); });
  });
}, { demo: true });

// «Списать из банка» у инвестсчёта не пишет одинокую запись банка (v1.80.6):
// она плодила лишнюю дату в истории. Перевод живёт в пополнении (c.bank) и
// вычитается из остатка банка, пока банк не получит запись на эту дату или позже.
suite(390, 'перевод в инвестсчёт ждёт снимка банка', () => {
  const run = (p, mode) => p.evaluate(m => {
    const savedA = JSON.stringify(DB.assets), savedI = JSON.stringify(DB.investments || []);
    const t = today();
    // банк с самой крупной записью до сегодняшнего дня — он точно виден в списке
    const bank = DB.banks.map(b => ({ b, v: _lastKnownAmount(b, '9999') || 0,
      old: DB.assets.some(a => !a._deleted && a.bankName === b && a.date < t) }))
      .filter(x => x.old).sort((x, y) => y.v - x.v)[0].b;
    DB.assets = DB.assets.filter(a => !(a.bankName === bank && a.date >= t));
    if (m === 'direct') _bankAdjust(bank, t, 0);
    const prev = _lastKnownAmount(bank, t);
    const nAssets = DB.assets.length;
    const totalBefore = _buildAssetSeries([t]).bankSeries[0];
    const nDates = _buildAssetSeries().dates.length;
    openInvestModal();
    document.getElementById('invest-name').value = 'ПИФ тест';
    document.getElementById('invest-invested').value = '30000';
    document.getElementById('invest-value').value = '30000';
    const sel = document.getElementById('invest-src-bank');
    const opts = [...sel.options].map(o => o.value);
    sel.value = m === 'none' ? '' : bank;
    saveInvestment();
    const inv = DB.investments.find(x => x.name === 'ПИФ тест' && !x._deleted);
    const res = { opts, banks: DB.banks.slice(), prev, added: DB.assets.length - nAssets,
      invested: inv ? invInvested(inv, t) : null, cBank: inv ? (inv.contributions[0].bank || '') : null,
      bank, drop: totalBefore - _buildAssetSeries([t]).bankSeries[0],
      known: _lastKnownAmount(bank, t), newDates: _buildAssetSeries().dates.length - nDates,
      hint: [...document.querySelectorAll('#assets-list .pend-line')].map(e => e.textContent).join('|') };
    // следующий снимок: подставленный остаток уже за вычетом перевода
    DB.assets = DB.assets.filter(a => !(a.bankName === bank && a.date >= t));
    openEditAssetDate(t, true);
    const inp = document.getElementById('asset-edit-inp-' + getAllBanks().indexOf(bank));
    res.prefill = Number(inp.value.replace(/[^\d-]/g, ''));
    res.tag = (inp.parentElement.querySelector('.carried-tag') || {}).textContent || '';
    closeModal('modal-asset-edit');
    // вернуть базу как была — сюиты делят одну страницу
    DB.assets = JSON.parse(savedA); DB.investments = JSON.parse(savedI);
    saveDB(); renderAssets();
    return res;
  }, mode);

  check('в селекте «не списывать» и все дебетовые банки', async p => {
    const r = await run(p, 'none');
    eq(r.opts.join('|'), [''].concat(r.banks).join('|'), 'состав селекта');
    eq(r.added, 0, 'записей активов не появилось');
    eq(r.cBank, '', 'банк в пополнении не записан');
    eq(r.drop, 0, 'ряд банков не изменился');
    eq(r.prefill, r.prev, 'в снимок подставлен прежний остаток');
  });

  check('снимка на дату нет — запись банка не создаётся, перевод ждёт', async p => {
    const r = await run(p, 'deferred');
    eq(r.added, 0, 'записей активов не появилось');
    eq(r.known, r.prev, 'последняя запись банка не тронута');
    eq(r.cBank, r.bank, 'банк записан в пополнении');
    eq(r.newDates, 0, 'снимок инвестсчёта не добавил строку в историю');
    eq(r.drop, 30000, 'ряд банков уменьшен — сумма не задвоена с инвестициями');
    eq(r.hint.includes('войдёт в следующий снимок'), true, 'строка банка подписана');
    eq(r.prefill, r.prev - 30000, 'в снимок подставлен остаток за вычетом перевода');
    eq(r.tag.includes('с переводом'), true, 'подставленное подписано');
  });

  check('снимок на дату есть — правится он, второй раз не вычитается', async p => {
    const r = await run(p, 'direct');
    eq(r.added, 0, 'новых записей нет');
    eq(r.known, r.prev - 30000, 'запись банка уменьшена');
    eq(r.drop, 30000, 'ряд банков уменьшен ровно один раз');
    eq(r.hint, '', 'ожидающих переводов нет');
  });
}, { demo: true });

suite(390, 'без вкладов и инвестиций чипов графика нет', () => {
  check('переключатель скрыт, линия = банки', async p => {
    await p.evaluate(() => { localStorage.removeItem('assetsChartParts'); window.showPage('assets', document.getElementById('nav-assets')); });
    eq(await isVisible(p, '#assets-chart-parts-toggle'), false, 'переключатель скрыт');
    const ok = await p.evaluate(() => { const s = _buildAssetSeries(); const d = charts.assets.data.datasets[0].data;
      return d.every((v, i) => v === s.bankSeries[i]); });
    eq(ok, true, 'линия совпадает с рядом банков');
  });
});

// Чипы «Аналитики» и «Накоплений» — настройка устройства, а не сессии: в PWA
// сессия кончается вместе со свёрнутым приложением, и до v1.73.0 выбор
// сбрасывался при каждом холодном старте. Харнесс чистит localStorage на
// каждой новой странице, поэтому проверяем сам факт записи в него.
suite(390, 'чипы графиков переживают перезапуск', () => {
  check('«Аналитика» пишет выбор в localStorage, а не в sessionStorage', async p => {
    await p.evaluate(() => window.showPage('stats', document.getElementById('nav-stats')));
    await p.evaluate(() => {
      setStatsPeriod('all'); setDayAvgMonths(12); setDayInclSpecial(false);
      setDayCompareMode('full'); setPieViewMode('groups'); setExpSearchPeriod(3);
    });
    const got = await p.evaluate(() => ['statsPeriod','dayAvgMonths','dayInclSpecial',
      'dayCompareMode','pieViewMode','expSearchPeriod'].map(k => k + '=' + localStorage.getItem(k)).join(','));
    eq(got, 'statsPeriod=all,dayAvgMonths=12,dayInclSpecial=0,dayCompareMode=full,pieViewMode=groups,expSearchPeriod=3', 'все ключи device-local');
    const leaked = await p.evaluate(() => ['statsPeriod','dayAvgMonths','dayInclSpecial','pieViewMode','expSearchPeriod']
      .filter(k => sessionStorage.getItem(k) !== null));
    eq(leaked.length, 0, 'в sessionStorage не осталось ничего: ' + leaked.join(','));
  });

  check('состояние модулей поднимается из localStorage при старте', async p => {
    // Значения читаются на инициализации модулей, поэтому проверяем чтение
    // через те же хелперы, что и модульные переменные.
    eq(await p.evaluate(() => uiGet('statsPeriod', '6')), 'all', 'период аналитики прочитан');
    eq(await p.evaluate(() => uiGet('dayCompareMode', 'today')), 'full', 'режим «Месяц/Сегодня» прочитан');
    eq(await p.evaluate(() => uiGet('нетТакогоКлюча', 'умолчание')), 'умолчание', 'дефолт для отсутствующего ключа');
    await p.evaluate(() => { setStatsPeriod(6); setDayInclSpecial(true); setDayCompareMode('today'); setPieViewMode('cats'); });
  });

  check('«Показать нулевые счета» запоминается', async p => {
    // В фикстуре все счета с деньгами — заводим пустой, чтобы строка появилась
    await p.evaluate(() => { DB.banks.push('Пустой счёт'); saveDB();
      window.showPage('assets', document.getElementById('nav-assets')); });
    eq(await p.evaluate(() => _showZeroBanks), false, 'по умолчанию скрыты');
    const tgl = await p.evaluate(() => {
      const row = [...document.querySelectorAll('#assets-list div')].find(d => /нулевые/i.test(d.textContent||''));
      if (!row) return null; row.click(); return true;
    });
    if (tgl === null) throw new Error('строки «Показать нулевые счета» нет в списке');
    eq(await p.evaluate(() => localStorage.getItem('showZeroBanks')), '1', 'выбор записан device-locally');
    eq(await p.evaluate(() => uiGet('showZeroBanks', '0')), '1', 'читается тем же хелпером, что и при старте');
    await p.evaluate(() => { DB.banks = DB.banks.filter(b => b !== 'Пустой счёт'); saveDB(); });
  });
});


// Подписи делений оси Y (fmtAxis). fmtShort печатает миллионы всегда с одним
// знаком, а тысячи — без знаков вовсе, поэтому на узком диапазоне соседние
// деления читались одинаково: «Рост накоплений» между 1.05М и 1.15М давал два
// «1.1М» подряд, а «Расход по дням недели» — «1к 2к 2к 3к 3к».
suite(390, 'подписи оси Y не повторяются', () => {
  const axis = (p, vals) => p.evaluate(v => v.map(x => fmtAxis(x, v.map(y => ({ value: y })))).join(' '), vals);

  check('узкий диапазон миллионов получает второй знак', async p => {
    eq(await axis(p, [1000000, 1050000, 1100000, 1150000]), '1.00М 1.05М 1.10М 1.15М', 'шаг 50к');
    eq(await axis(p, [650000, 750000, 850000, 950000, 1050000, 1150000]),
      '0.65М 0.75М 0.85М 0.95М 1.05М 1.15М', 'ось из реального бэкапа');
  });

  check('привычный вид сохраняется, пока подписи различаются', async p => {
    eq(await axis(p, [0, 200000, 400000, 600000, 800000, 1000000, 1200000]),
      '0 200к 400к 600к 800к 1М 1.2М', 'широкий диапазон — как fmtShort');
    eq(await axis(p, [0, 50000, 100000, 150000]), '0 50к 100к 150к', 'сотни тысяч');
  });

  check('ниже 10к печатаются рубли, а не «0.5к»', async p => {
    eq(await axis(p, [0, 500, 1000, 1500, 2000, 2500, 3000]), '0 500 1000 1500 2000 2500 3000', 'дни недели');
  });
});

// Тот же fmtAxis, но на живых графиках демо-набора: «Расход по дням недели»
// упирается в тысячи с шагом 500 — на fmtShort у него дублировались подписи.
suite(390, 'на графиках демо все деления оси различаются', () => {
  check('ни у одного видимого графика нет двух одинаковых подписей', async p => {
    await p.evaluate(() => window.showPage('stats', document.getElementById('nav-stats')));
    const dup = await p.evaluate(() => {
      const bad = [];
      for (const [k, ch] of Object.entries(charts)) {
        if (!ch || !ch.scales || !ch.scales.y || !ch.canvas || !ch.canvas.offsetParent) continue;
        const l = ch.scales.y.ticks.map(t => t.label);
        if (new Set(l).size !== l.length) bad.push(k + ': ' + l.join(' '));
      }
      return bad.join(' | ');
    });
    eq(dup, '', 'дублей нет');
    const wd = await p.evaluate(() => charts.weekday.scales.y.ticks.map(t => t.label).join(' '));
    eq(wd.includes('к'), false, 'дни недели подписаны рублями: ' + wd);
  });
}, { demo: true });

// Аудит v1.82.0: сироты catId, полная очистка, снимки на месте, синк с таймаутом
// и хэшем, локальные настройки без пуша, своё подтверждение, чипы-кнопки,
// отложенная перезагрузка SW. Проверка очистки — последней: после неё база пуста.
suite(390, 'аудит v1.82.0', () => {
  check('сирота catId рисуется в первой категории, но catId не переписывается', async p => {
    const got = await p.evaluate(() => {
      DB.expenses.push({ id: 'orph1', date: today(), cat: 3, catId: 'ghost-cat', amount: 100, comment: '', updatedAt: Date.now() });
      _ensureCatIds();
      const e = DB.expenses.find(x => x.id === 'orph1');
      const before = { cat: e.cat, catId: e.catId, orphans: _orphanExpenseCount() };
      // «правильный» список приехал — запись сама встаёт на место
      DB.categories.push('Призрак'); DB.catIds.push('ghost-cat');
      _ensureCatIds();
      const after = { cat: e.cat, orphans: _orphanExpenseCount() };
      DB.categories.pop(); DB.catIds.pop();
      DB.expenses = DB.expenses.filter(x => x.id !== 'orph1'); _ensureCatIds();
      return { before, after };
    });
    eq(got.before.cat, 0, 'сирота показывается в первой категории');
    eq(got.before.catId, 'ghost-cat', 'catId сироты сохранён');
    eq(got.before.orphans, 1, 'счётчик сирот');
    eq(got.after.cat, 7, 'после появления категории запись встала на своё место');
    eq(got.after.orphans, 0, 'сирот не осталось');
  });

  check('снимок счетов правится на месте, без тумбстоунов на каждое сохранение', async p => {
    const got = await p.evaluate(() => {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
      const date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-15';
      const ids = () => DB.assets.filter(a => a.date === date && !a._deleted).map(a => a.id).sort().join(',');
      const tomb = () => DB.assets.filter(a => a.date === date && a._deleted).length;
      const i0 = getAllBanks().indexOf('Сбербанк'), i1 = getAllBanks().indexOf('Т-Банк');
      openEditAssetDate(date, false);
      document.getElementById('asset-edit-inp-' + i0).value = '100 000';
      document.getElementById('asset-edit-inp-' + i1).value = '200 000';
      saveAssetEdit();
      const first = ids(), t1 = tomb();
      openEditAssetDate(date, false);
      document.getElementById('asset-edit-inp-' + i0).value = '150 000';
      saveAssetEdit();
      const second = ids(), t2 = tomb();
      const sber = DB.assets.find(a => a.date === date && !a._deleted && a.bankName === 'Сбербанк');
      // Т-Банк опустел — вот тут тумбстоун законен
      openEditAssetDate(date, false);
      document.getElementById('asset-edit-inp-' + i1).value = '';
      saveAssetEdit();
      return { n1: first.split(',').length, same: second === first, t1, t2, amount: sber.amount, t3: tomb(), live3: ids().split(',').length };
    });
    eq(got.n1, 2, 'после первого сохранения две записи');
    eq(got.same, true, 'после правки id записей те же');
    eq(got.t1 + got.t2, 0, 'тумбстоунов не появилось');
    eq(got.amount, 150000, 'сумма обновлена на месте');
    eq(got.t3, 1, 'опустевший банк — один тумбстоун');
    eq(got.live3, 1, 'живой осталась одна запись');
  });

  check('синк: зависший запрос обрывается по таймауту и не блокирует следующий цикл', async p => {
    const got = await p.evaluate(async () => {
      const origFetch = window.fetch, origUrl = DB.syncUrl, origT = SYNC_TIMEOUT_MS;
      DB.syncUrl = 'https://example.invalid/exec'; SYNC_TIMEOUT_MS = 60;
      window.fetch = (u, o) => new Promise((_, rej) =>
        o.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
      const t0 = Date.now();
      const r1 = await syncCycle();
      const dt = Date.now() - t0;
      window.fetch = async () => ({ ok: true, text: async () => '{"empty":true}' });
      const r2 = await syncCycle();
      window.fetch = origFetch; DB.syncUrl = origUrl; SYNC_TIMEOUT_MS = origT; _syncFailCount = 0; setSyncStatus('none');
      return { e1: r1.error || '', dt, ok2: !!r2.ok };
    });
    eq(/Нет ответа/.test(got.e1), true, 'ошибка таймаута: ' + got.e1);
    eq(got.dt < 2000, true, 'цикл завершился быстро, а не висел: ' + got.dt + ' мс');
    eq(got.ok2, true, 'следующий цикл прошёл');
  });

  check('синк: повторный pull несёт хэш, {unchanged} ничего не мержит', async p => {
    const got = await p.evaluate(async () => {
      const origFetch = window.fetch, origUrl = DB.syncUrl;
      DB.syncUrl = 'https://example.invalid/exec'; _lastPullHash = '';
      const bodies = [];
      const remoteText = JSON.stringify({ categories: DB.categories, catIds: DB.catIds, listsMeta: {} });
      window.fetch = async (u, o) => {
        const b = JSON.parse(o.body); bodies.push(b);
        if (b.action === 'pull') return { ok: true, text: async () => (b.hash ? '{"unchanged":true}' : remoteText) };
        return { ok: true, text: async () => '{"ok":true}' };
      };
      DB._dirty = false;
      const r1 = await syncCycle();
      const h1 = _lastPullHash;
      DB._dirty = false;
      const r2 = await syncCycle();
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(remoteText));
      const expect = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
      window.fetch = origFetch; DB.syncUrl = origUrl; _lastPullHash = ''; setSyncStatus('none');
      const pulls = bodies.filter(b => b.action === 'pull');
      return { ok: !!(r1.ok && r2.ok), h1, expect, hash1: pulls[0].hash, hash2: pulls[1].hash, merged2: r2.merged };
    });
    eq(got.ok, true, 'оба цикла прошли');
    eq(got.hash1, undefined, 'первый pull без хэша');
    eq(got.h1, got.expect, 'хэш — SHA-256 полученного текста');
    eq(got.hash2, got.expect, 'второй pull несёт этот хэш');
    eq(got.merged2, false, '{unchanged} ничего не мержит');
  });

  check('тема и уведомления сохраняются без пометки _dirty', async p => {
    const got = await p.evaluate(() => {
      DB._dirty = false;
      const prev = DB.theme;
      setTheme('dark'); const a = DB._dirty;
      saveNotifThreshold('80'); const b = DB._dirty;
      setTheme(prev || 'auto');
      DB._dirty = false;
      return { a, b, stored: JSON.parse(localStorage.getItem('budgetDB_v2')).notifThreshold };
    });
    eq(got.a, false, 'смена темы не требует пуша');
    eq(got.b, false, 'порог уведомлений не требует пуша');
    eq(got.stored, 80, 'но на диск записано');
  });

  check('confirmDialog: «OK» — true, закрытие — false', async p => {
    const got = await p.evaluate(async () => {
      const p1 = confirmDialog('Вопрос?', { ok: 'Да', danger: true });
      const open = document.getElementById('modal-confirm').classList.contains('open');
      const txt = document.getElementById('confirm-text').textContent;
      const okCls = document.getElementById('confirm-ok').className;
      _confirmAnswer(true);
      const r1 = await p1;
      const p2 = confirmDialog('Ещё?');
      closeModal('modal-confirm');
      const r2 = await p2;
      return { open, txt, okCls, r1, r2, closed: !document.getElementById('modal-confirm').classList.contains('open') };
    });
    eq(got.open, true, 'модалка открылась');
    eq(got.txt, 'Вопрос?', 'текст вопроса');
    eq(/danger/.test(got.okCls), true, 'опасная кнопка красная');
    eq(got.r1, true, 'OK → true');
    eq(got.r2, false, 'закрытие → false');
    eq(got.closed, true, 'модалка закрыта');
  });

  check('чипы периодов — кнопки с aria-pressed, span-чипов в .seg нет', async p => {
    const got = await p.evaluate(() => {
      window.showPage('stats', document.getElementById('nav-stats'));
      setStatsPeriod(12);
      const q = id => document.getElementById(id);
      const out = {
        tag: q('sp-6').tagName, cls: q('sp-6').parentElement.className,
        on12: q('sp-12').getAttribute('aria-pressed'), off6: q('sp-6').getAttribute('aria-pressed'),
        kinds: [...document.querySelectorAll('#kinds-period > *')].map(e => e.tagName).join(','),
        spans: document.querySelectorAll('.seg > span, .spec-seg > span').length,
      };
      setStatsPeriod(6);
      return out;
    });
    eq(got.tag, 'BUTTON', 'чип — кнопка');
    eq(got.cls, 'seg', 'контейнер — .seg');
    eq(got.on12 + '/' + got.off6, 'true/false', 'aria-pressed следует за выбором');
    eq(got.kinds, 'BUTTON,BUTTON,BUTTON', 'чипы «История» тоже кнопки');
    eq(got.spans, 0, 'span-чипов не осталось');
  });

  check('обновление SW не перезагружает страницу при открытой модалке', async p => {
    const got = await p.evaluate(() => {
      _swReloadPending = false;
      openModal('modal-about');
      const safe = _safeToReload();
      _onSwUpdated();                // reload не случился — мы всё ещё тут
      const pending = _swReloadPending;
      closeModal('modal-about');
      const toastEl = document.getElementById('toast');
      const btn = toastEl.querySelector('.toast-undo');
      const out = { safe, pending, btn: btn ? btn.textContent : '', shown: toastEl.classList.contains('show') };
      _swReloadPending = false; toastEl.classList.remove('show', 'action');
      return out;
    });
    eq(got.safe, false, 'при открытой модалке перезагружать нельзя');
    eq(got.pending, true, 'перезагрузка отложена');
    eq(got.shown && got.btn === 'Перезагрузить', true, 'после закрытия модалки — тост с кнопкой');
  });

  check('renderCurrentPage знает страницу инвестиций', async p => {
    const got = await p.evaluate(() => {
      window.showPage('investments');
      DB.investments.push({ id: 'vi1', name: 'Тест', snapshots: { [today()]: 777 }, contributions: [], updatedAt: 1 });
      renderCurrentPage();
      const t = document.getElementById('investments-total-now').textContent;
      DB.investments = DB.investments.filter(v => v.id !== 'vi1');
      return t;
    });
    eq(got.replace(/\s/g, ''), '777₽', 'итог страницы перерисован');
  });

  check('месяц до первых лимитов — нули, а не DEFAULT_LIMITS; копейки округляются', async p => {
    const got = await p.evaluate(() => {
      const keys = Object.keys(DB.limits).sort();
      const [y, m] = keys[0].split('-').map(Number);
      const d = new Date(y, m - 1 - 1, 1);
      return { sum: getLimits(d.getFullYear(), d.getMonth()).reduce((s, v) => s + v, 0), kop: parseMoney('12,345'), calc: fmtCalc(1234) };
    });
    eq(got.sum, 0, 'сумма лимитов за месяц до начала учёта');
    eq(got.kop, 12.35, 'parseMoney округляет до копеек');
    eq(got.calc, (1234).toLocaleString('ru-RU') + '₽', 'калькулятор печатает как остальное приложение');
  });

  check('«Очистить все данные» чистит вклады, шаблоны, инвестиции, бронь, разметку и listsMeta', async p => {
    const got = await p.evaluate(() => {
      DB.templates.push({ id: 't1', name: 'x', cat: 0, catId: DB.catIds[0], amount: 1, updatedAt: 1 });
      DB.deposits.push({ id: 'd1', name: 'x', amount: 1, rate: 1, openDate: '2026-01-01', endDate: '2027-01-01', capitalization: 'end', updatedAt: 1 });
      DB.investments.push({ id: 'v1', name: 'x', snapshots: { '2026-01-01': 1 }, contributions: [], updatedAt: 1 });
      DB.specPlan = { '2026-01': { [DB.catIds[0]]: 5 } };
      DB.oneoffThreshold = 123; touchList('categories'); touchList('oneoffThreshold');
      doClearData();
      return {
        empty: ['expenses','incomes','assets','templates','deposits','investments','credits'].every(k => DB[k].length === 0),
        spec: Object.keys(DB.specPlan).length, oblig: DB.catOblig, thr: DB.oneoffThreshold,
        meta: Object.keys(DB.listsMeta).length, cats: DB.categories.length, ids: DB.catIds.length,
      };
    });
    eq(got.empty, true, 'все массивы записей пусты');
    eq(got.spec, 0, 'бронь особых пуста');
    eq(got.oblig, undefined, 'разметка обязательных снята — миграция пройдёт заново');
    eq(got.thr, undefined, 'порог подсказки сброшен');
    eq(got.meta, 0, 'listsMeta пуст — список с Drive сможет победить дефолтный');
    eq(got.cats + '/' + got.ids, '12/12', 'категории по умолчанию с розданными catIds');
  });
});

// v1.83.0: версия скрипта, копии на Drive, журнал слияний, deep-link, повтор
// траты, XIRR инвестиций, «vs прошлый год» в отчёте, размер базы в «О приложении».
suite(390, 'идеи v1.83.0', () => {
  check('XIRR: год при +10% даёт ≈10% годовых, короткая история — null', async p => {
    const got = await p.evaluate(() => {
      const d = new Date(); const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
      const t = `${y}-${m}-${dd}`, ago = `${y - 1}-${m}-${dd}`;
      const r1 = _xirr([{ date: ago, amount: -100000 }, { date: t, amount: 110000 }]);
      const short = _xirr([{ date: t, amount: -100000 }, { date: t, amount: 110000 }]);
      const oneSign = _xirr([{ date: ago, amount: -1 }, { date: t, amount: -1 }]);
      const inv = { id: 'xi', name: 'x', snapshots: { [t]: 120000 }, contributions: [{ id: 'c', date: ago, amount: 100000 }] };
      return { r1, short, oneSign, port: _invXirr([inv], t), none: _invXirr([{ id: 'z', snapshots: {}, contributions: [] }], t), fmt: _fmtRate(12.34) + '/' + _fmtRate(-3) };
    });
    near(got.r1, 10, 'ставка за год при +10%', 0.2);
    eq(got.short, null, 'история короче 30 дней — не считаем');
    eq(got.oneSign, null, 'потоки одного знака — null');
    near(got.port, 20, 'ставка счёта: вложено 100к год назад, стоит 120к', 0.2);
    eq(got.none, null, 'счёт без потоков — null');
    eq(got.fmt, '+12.3%/−3%', 'формат ставки');
  });

  check('повтор траты: тот же день/категория/сумма за две минуты — тост с «Отменить»', async p => {
    const got = await p.evaluate(() => {
      const now = Date.now();
      const mk = (id, amt, dt) => ({ id, date: today(), cat: 1, catId: 'cat0002', amount: amt, comment: '', updatedAt: now - (dt || 0) });
      const a = mk('dupA', 777), b = mk('dupB', 777), c = mk('dupC', 778), d = mk('dupD', 777, 10 * 60000);
      DB.expenses.push(a, b, c, d);
      const r1 = _offerDup(b);
      const txt = document.getElementById('toast').textContent;
      document.querySelector('#toast .toast-undo').click();
      const deleted = !!DB.expenses.find(x => x.id === 'dupB')._deleted;
      const aAlive = !DB.expenses.find(x => x.id === 'dupA')._deleted;
      const r2 = _offerDup(c);           // другая сумма
      const r3 = _offerDup(d);           // та же сумма, но 10 минут назад: пара dupA тоже 10 минут от неё — нет
      DB.expenses = DB.expenses.filter(x => !/^dup/.test(x.id));
      return { r1, txt, deleted, aAlive, r2, r3 };
    });
    eq(got.r1, true, 'повтор замечен');
    if (!/повтор/.test(got.txt)) throw new Error('текст тоста: ' + got.txt);
    eq(got.deleted, true, '«Отменить» удалил вторую запись');
    eq(got.aAlive, true, 'первая запись жива');
    eq(got.r2, false, 'другая сумма — не повтор');
    eq(got.r3, false, 'старше окна — не повтор');
  });

  check('быстрый ввод дважды — тост о повторе вместо «добавлено»', async p => {
    const got = await p.evaluate(() => {
      showPage('day', document.getElementById('nav-day'));
      document.getElementById('qa-amount').value = '333';
      document.getElementById('qa-cat').value = '2';
      quickAddSave(document.body);
      const first = document.getElementById('toast').textContent;
      document.getElementById('qa-amount').value = '333';
      document.getElementById('qa-cat').value = '2';
      quickAddSave(document.body);
      const second = document.getElementById('toast').textContent;
      const n = DB.expenses.filter(e => !e._deleted && e.amount === 333).length;
      return { first, second, n };
    });
    if (/повтор/.test(got.first)) throw new Error('первый ввод не повтор: ' + got.first);
    if (!/повтор/.test(got.second)) throw new Error('второй ввод должен предупредить: ' + got.second);
    eq(got.n, 2, 'обе записи сохранены — тост только предлагает отменить');
  });

  check('deep-link ?add=&cat=&comment= открывает заполненную модалку и чистит URL', async p => {
    const base = p.url().split('?')[0];
    await p.goto(base + '?add=350&cat=' + encodeURIComponent('Еда вне дома') + '&comment=' + encodeURIComponent('кофе'), { waitUntil: 'networkidle0' });
    const got = await p.evaluate(() => ({
      open: document.getElementById('modal-expense').classList.contains('open'),
      amount: document.getElementById('exp-amount').value.replace(/\s/g, ''),
      cat: document.getElementById('exp-cat').value,
      comment: document.getElementById('exp-comment').value,
      search: location.search,
      saved: DB.expenses.filter(e => e.amount === 350).length,
    }));
    eq(got.open, true, 'модалка траты открыта');
    eq(got.amount, '350', 'сумма подставлена');
    eq(got.cat, '2', 'категория по имени');
    eq(got.comment, 'кофе', 'комментарий');
    eq(got.search, '', 'query-строка убрана');
    eq(got.saved, 0, 'без подтверждения ничего не сохранено');
    await p.goto(base + '?tab=assets', { waitUntil: 'networkidle0' });
    const tab = await p.evaluate(() => ({ active: document.getElementById('nav-assets').classList.contains('active'), modal: !!document.querySelector('.overlay.open'), search: location.search }));
    eq(tab.active, true, '?tab=assets открывает «Накопления»');
    eq(tab.modal, false, 'без add модалки нет');
    eq(tab.search, '', 'query убран и тут');
    const cat = await p.evaluate(() => ({ byId: _deepLinkCat('cat0004'), byIdx: _deepLinkCat('3'), none: _deepLinkCat('нет такой'), lower: _deepLinkCat('ОДЕЖДА') }));
    eq(cat.byId + '/' + cat.byIdx + '/' + cat.none + '/' + cat.lower, '3/3/null/3', 'разбор категории: catId / индекс / неизвестная / регистр');
  });

  check('«О приложении» показывает размер базы и число записей', async p => {
    const got = await p.evaluate(() => {
      openAbout();
      const t = document.getElementById('about-db-size').textContent;
      closeModal('modal-about');
      const s = _dbSizeInfo();
      return { t, s };
    });
    if (!/Данные на устройстве: \d+ КБ/.test(got.t)) throw new Error('размер: ' + got.t);
    // тумбстоуны фикстуры (updatedAt: 1) вычищает 90-дневная чистка loadDB — их тут не ждём
    if (!/10 трат · 2 доходов · 2 снимков счетов/.test(got.t)) throw new Error('счётчики: ' + got.t);
    if (!(got.s.dbBytes > 1000 && got.s.allBytes >= got.s.dbBytes)) throw new Error('байты: ' + JSON.stringify(got.s));
  });

  check('журнал слияний считает новые, изменённые и удалённые с Drive', async p => {
    const got = await p.evaluate(() => {
      const far = Date.now() + 1000;
      mergePullData({ expenses: [
        { id: 'remNew', date: today(), cat: 1, catId: 'cat0002', amount: 10, comment: '', updatedAt: far },
        { id: 'e02', date: today(), cat: 1, catId: 'cat0002', amount: 4211, comment: 'правка', updatedAt: far },
        { id: 'e03', date: today(), cat: 1, catId: 'cat0002', amount: 0, comment: '', _deleted: true, updatedAt: far },
        { id: 'e04', date: today(), cat: 2, catId: 'cat0003', amount: 1, comment: '', updatedAt: 0 }, // старее — проигрывает
      ] });
      const st = { ..._lastMergeStats };
      const log = _mergeLogGet();
      DB.syncUrl = 'http://sync.test/x'; renderSettings();
      const row = document.getElementById('sync-merge-last').textContent;
      const vis = getComputedStyle(document.getElementById('sync-backups-row')).display;
      mergePullData({ expenses: [] }); // пустое слияние журнал не трогает
      const n2 = _mergeLogGet().length;
      DB.syncUrl = ''; renderSettings();
      return { st, n: log.length, ev: log[0], row, vis, n2 };
    });
    eq(got.st.added + '/' + got.st.changed + '/' + got.st.deleted, '1/1/1', 'статистика слияния');
    eq(got.n, 1, 'одно событие в журнале');
    eq(got.ev.added, 1, 'событие: новых');
    if (!/1 нов\. · 1 изм\. · 1 удал\./.test(got.row)) throw new Error('строка в Настройках: ' + got.row);
    eq(got.vis, 'flex', 'строка «Копии на Drive» видна при заданном URL');
    eq(got.n2, 1, 'пустое слияние в журнал не пишется');
  });

  check('версия скрипта: из ответов синка, строка «обновите» при отставании', async p => {
    const got = await p.evaluate(async () => {
      const res = {};
      DB.syncUrl = 'http://sync.test/x'; renderSettings();
      const row = () => document.getElementById('sync-script-version').textContent;
      _noteScriptVersion('10.4'); res.old = row();
      _noteScriptVersion('10.5'); res.cur = row();
      res.less = [_verLess('10.4', '10.5'), _verLess('10.5', '10.5'), _verLess('10.10', '10.9'), _verLess('<10.5', '10.5')].join(',');
      const realFetch = window.fetch;
      window.fetch = async (u, o) => ({ ok: true, text: async () => JSON.stringify({ ok: true }) });
      await syncRequest('ping'); res.legacy = _remoteScriptVersion + '|' + row();
      window.fetch = async (u, o) => ({ ok: true, text: async () => JSON.stringify({ ok: true, version: '10.5' }) });
      await syncRequest('push', {}); res.signed = _remoteScriptVersion;
      // полный pull — файл данных без подписи: версию не трогает
      window.fetch = async () => ({ ok: true, text: async () => JSON.stringify({ expenses: [] }) });
      await syncRequest('pull'); res.afterPull = _remoteScriptVersion;
      window.fetch = realFetch;
      res.stored = uiGet('scriptVersion', '');
      DB.syncUrl = ''; renderSettings();
      return res;
    });
    if (!/v10\.4 · нужен v10\.5, обновите/.test(got.old)) throw new Error('старый скрипт: ' + got.old);
    if (!/v10\.5 ✓/.test(got.cur)) throw new Error('актуальный скрипт: ' + got.cur);
    eq(got.less, 'true,false,false,true', 'сравнение версий');
    if (!/^<10\.5\|старый/.test(got.legacy)) throw new Error('ответ без version → старый: ' + got.legacy);
    eq(got.signed, '10.5', 'версия из подписанного ответа');
    eq(got.afterPull, '10.5', 'файл данных версию не сбивает');
    eq(got.stored, '10.5', 'версия сохранена между запусками');
  });

  check('копии на Drive: список, восстановление, force-push', async p => {
    const got = await p.evaluate(async () => {
      DB.syncUrl = 'http://sync.test/x';
      const calls = [];
      const backup = { categories: ['Только одна'], catIds: ['solo'], catColors: {}, expenses: [{ id: 'bk1', date: today(), cat: 0, catId: 'solo', amount: 42, comment: '', updatedAt: 1 }], incomes: [], assets: [], banks: [], creditBanks: [], limits: {} };
      const realFetch = window.fetch;
      window.fetch = async (u, o) => {
        const b = JSON.parse(o.body); calls.push(b);
        const answer = b.action === 'listBackups' ? { ok: true, version: '10.5', backups: [
            { id: 'f1', name: 'nto_data.bak.2026-10-14.json', date: '2026-10-14', size: 204800 },
            { id: 'f0', name: 'nto_data.bak.json', date: '2026-10-01', size: 1024, legacy: true } ] }
          : b.action === 'readBackup' ? backup
          : { ok: true, version: '10.5' };
        return { ok: true, text: async () => JSON.stringify(answer) };
      };
      window.confirmDialog = async () => true;
      await openDriveBackups();
      const rows = document.querySelectorAll('#backups-list button').length;
      const listTxt = document.getElementById('backups-list').textContent;
      await restoreDriveBackup('f1', '2026-10-14');
      window.fetch = realFetch;
      return { rows, listTxt, actions: calls.map(c => c.action).join(','), force: calls[calls.length - 1].force, cats: DB.categories.join(), n: DB.expenses.length,
        stamped: DB.expenses[0].updatedAt > 1, open: document.getElementById('modal-backups').classList.contains('open'), dirty: DB._dirty, url: DB.syncUrl };
    });
    eq(got.rows, 2, 'две копии в списке');
    if (!/200 КБ/.test(got.listTxt) || !/старая копия/.test(got.listTxt)) throw new Error('подписи списка: ' + got.listTxt);
    eq(got.actions, 'listBackups,readBackup,push', 'порядок запросов: список → копия → push без pull');
    eq(got.force, true, 'push с force — файл на Drive уменьшился осознанно');
    eq(got.cats, 'Только одна', 'данные заменены копией');
    eq(got.n, 1, 'траты из копии');
    eq(got.stamped, true, 'записи перештампованы — другие устройства их примут');
    eq(got.open, false, 'модалка закрыта');
    eq(got.dirty, false, 'после push база чистая');
    eq(got.url, 'http://sync.test/x', 'syncUrl пережил восстановление');
  });

  check('старый скрипт на запрос копий — внятная подсказка, а не «Unknown action»', async p => {
    const got = await p.evaluate(async () => {
      DB.syncUrl = 'http://sync.test/x';
      const realFetch = window.fetch;
      window.fetch = async () => ({ ok: true, text: async () => JSON.stringify({ error: 'Unknown action: listBackups' }) });
      await openDriveBackups();
      window.fetch = realFetch;
      closeModal('modal-backups');
      return document.getElementById('backups-list').textContent;
    });
    if (!/разверните Apps Script v10\.5/.test(got)) throw new Error('подсказка: ' + got);
  });

  check('в отчёте без прошлого года колонки «vs» нет', async p => {
    const got = await p.evaluate(() => {
      showPage('report', document.getElementById('nav-stats'));
      renderReport();
      return { yoy: document.querySelectorAll('.rep-yoy').length, hdr: /vs \d{4}/.test(document.getElementById('report-body').textContent) };
    });
    eq(got.yoy, 0, 'дельт нет — данных за прошлый год в фикстуре нет');
    eq(got.hdr, false, 'заголовок без «vs»');
  });
});

// Копейки (v1.84.0). parseMoney и раньше принимал «12,50», но fmt округлял до
// рубля (трата 12,50 читалась как 13₽), а setMoneyInput — при подстановке в поле,
// так что правка траты после «Сохранить» теряла копейки. Теперь копейки печатаются
// только когда они есть, круглые суммы — как раньше.
suite(390, 'копейки', () => {
  check('fmt печатает копейки только когда они есть', async p => {
    const got = await p.evaluate(() => ({
      kop: fmt(12.5), whole: fmt(1234), tail: fmt(0.1 + 0.2), big: fmt(12345.678), zero: fmt(-0.001),
      neg: fmt(-7.25), negExp: (-7.25).toLocaleString('ru-RU', { minimumFractionDigits: 2 }) + '₽',
      bigExp: (12345.68).toLocaleString('ru-RU', { minimumFractionDigits: 2 }) + '₽',
      h: fmtH(3.3), short: fmtShort(12.5),
    }));
    eq(got.kop, '12,50₽', 'с копейками');
    eq(got.whole, (1234).toLocaleString('ru-RU') + '₽', 'круглая — как раньше');
    eq(got.tail, '0,30₽', 'хвост сложения float погашен');
    eq(got.big, got.bigExp, 'округление до сотых');
    eq(got.zero, '0₽', 'без «-0»');
    eq(got.neg, got.negExp, 'отрицательная с копейками');
    if (got.h.replace(/<[^>]+>/g, '') !== '3,30₽') throw new Error('fmtH: ' + got.h); // ₽ — свой span (v1.86.0)
    eq(got.short, '13', 'fmtShort (оси, чипы) остаётся целым');
  });

  check('правка траты сохраняет копейки, поле режет третий знак', async p => {
    const got = await p.evaluate(() => {
      showPage('day', document.getElementById('nav-day'));
      DB.expenses.push({ id: 'kop1', date: today(), cat: 1, catId: DB.catIds[1], amount: 12.5, comment: 'коп', updatedAt: Date.now() });
      editExpense('kop1');
      const field = document.getElementById('exp-amount').value;
      saveExpense();
      const after = DB.expenses.find(x => x.id === 'kop1').amount;
      const shown = document.getElementById('page-day').textContent;
      const inp = document.getElementById('exp-amount');
      inp.value = '1234,567'; formatMoneyInput(inp);
      const cut = inp.value;
      setMoneyInput('exp-amount', 99.9);
      const nine = inp.value;
      setMoneyInput('exp-amount', 500);
      const whole = inp.value;
      closeModal('modal-expense');
      DB.expenses = DB.expenses.filter(x => x.id !== 'kop1');
      return { field, after, shown: /12,50₽/.test(shown), cut, nine, whole };
    });
    eq(got.field, '12,5', 'поле показывает копейки');
    eq(got.after, 12.5, 'после «Сохранить» копейки на месте');
    eq(got.shown, true, 'в списке дня трата с копейками');
    eq(got.cut.replace(/\s/g, ''), '1234,56', 'третий знак отрезан при наборе');
    eq(got.nine, '99,9', 'подстановка 99.9');
    eq(got.whole, '500', 'круглая подставляется без хвоста');
  });

  check('снимок счёта, сплит, бронь и порог не округляются до рубля', async p => {
    const got = await p.evaluate(() => {
      const t = today();
      DB.assets.push({ id: 'kopA', date: t, bank: 0, bankName: DB.banks[0], amount: 1000.55, updatedAt: Date.now() });
      openEditAssetDate(t, false);
      const field = document.getElementById('asset-edit-inp-0').value;
      closeModal('modal-asset-edit');
      DB.assets = DB.assets.filter(x => x.id !== 'kopA');

      document.getElementById('split-total').value = '1000,01';
      document.getElementById('split-parts').value = '3';
      document.getElementById('split-buy-date').value = t;
      _splitRegen();
      const parts = _splitGenPayments.map(x => x.amount).join('|');
      const sum = Math.round(_splitGenPayments.reduce((s, x) => s + x.amount, 0) * 100) / 100;
      _splitGenPayments = [];

      _specPlanWrite('cat0002', 150.75, '2030-01');
      const spec = DB.specPlan['2030-01']['cat0002'];
      delete DB.specPlan['2030-01'];

      const prevThr = DB.oneoffThreshold;
      setOneoffThreshold('5000,5');
      const thr = _oneoffThreshold();
      DB.oneoffThreshold = prevThr;
      return { field, parts, sum, spec, thr };
    });
    eq(got.field.replace(/\s/g, ''), '1000,55', 'поле снимка счёта с копейками');
    eq(got.parts, '333.33|333.33|333.35', 'части сплита до копейки, остаток — в последнем');
    eq(got.sum, 1000.01, 'сумма частей сходится с итогом');
    eq(got.spec, 150.75, 'бронь особых хранит копейки');
    eq(got.thr, 5000.5, 'порог «разовая?» хранит копейки');
  });
});

// Шапка «Доходов» (v1.84.1): три отдельные карточки, как в «Бюджете». Раньше
// одна карточка с тремя колонками внутри — цифры сливались в строку без границ.
suite(390, 'шапка «Доходов» — три карточки, как в «Бюджете»', () => {
  check('карточки доходов совпадают по раскладке с бюджетными', async p => {
    const got = await p.evaluate(() => {
      const cards = sel => [...document.querySelectorAll(sel + ' .summary-grid > .s-card')].map(c => { const r = c.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width)]; });
      showPage('budget', document.getElementById('nav-budget'));
      const b = cards('#page-budget');
      showPage('income', document.getElementById('nav-income'));
      const i = cards('#page-income');
      const lbls = [...document.querySelectorAll('#page-income .summary-grid .s-lbl')].map(x => x.textContent).join('|');
      return { b: JSON.stringify(b), i: JSON.stringify(i), n: i.length, lbls };
    });
    eq(got.n, 3, 'три карточки');
    eq(got.i, got.b, 'те же левые края и ширины, что у карточек «Бюджета»');
    eq(got.lbls, 'Доход|Расходы|Баланс', 'подписи');
  });

  // v1.84.2: с копейками сумма шире трети экрана — колонки minmax(0,1fr) и
  // _fitVals ужимают шрифт, карточка не уезжает за правый край
  check('длинные суммы с копейками не выталкивают карточку за экран', async p => {
    const got = await p.evaluate(() => {
      DB.incomes.push({ id: 'fitI', date: today(), source: 'тест', amount: 1223628.37, updatedAt: Date.now() });
      showPage('income', document.getElementById('nav-income'));
      const vw = document.documentElement.clientWidth;
      const cards = [...document.querySelectorAll('#page-income .summary-grid > .s-card')];
      const vals = [...document.querySelectorAll('#page-income .summary-grid .s-val')];
      const r = { vw, right: Math.max(...cards.map(c => Math.round(c.getBoundingClientRect().right))),
        widths: cards.map(c => Math.round(c.getBoundingClientRect().width)).join('|'),
        fits: vals.every(v => v.scrollWidth <= v.clientWidth + 1),
        shrunk: parseFloat(getComputedStyle(vals[0]).fontSize), text: vals[0].textContent };
      DB.incomes = DB.incomes.filter(x => x.id !== 'fitI');
      showPage('income', document.getElementById('nav-income'));
      r.restored = parseFloat(getComputedStyle(vals[0]).fontSize);
      return r;
    });
    eq(got.right <= got.vw - 16, true, 'правая карточка в пределах отступа 16 px: ' + got.right + ' из ' + got.vw);
    eq(new Set(got.widths.split('|')).size, 1, 'карточки одной ширины: ' + got.widths);
    eq(got.fits, true, 'суммы влезают в карточки: ' + got.text);
    eq(got.shrunk < 16, true, 'шрифт длинной суммы ужат: ' + got.shrunk);
    eq(got.restored, 16, 'после короткой суммы шрифт штатный');
  });
});

suite(390, 'идеи v1.83.0 — демо', () => {
  check('годовой отчёт: дельты к прошлому году у категорий, групп и тегов', async p => {
    const got = await p.evaluate(() => {
      showPage('report', document.getElementById('nav-stats'));
      const sel = document.getElementById('report-year');
      const yr = String(new Date().getFullYear());
      sel.value = yr; renderReport();
      const cells = [...document.querySelectorAll('.rep-yoy')];
      const body = document.getElementById('report-body').textContent;
      const res = { n: cells.length, texts: cells.map(c => c.textContent), hdr: new RegExp('vs ' + (yr - 1)).test(body), sameSpan: new RegExp('vs ' + (yr - 1) + ' · [а-я]{3}').test(body) };
      sel.value = 'all'; renderReport();
      res.nAll = document.querySelectorAll('.rep-yoy').length;
      sel.value = yr; renderReport();
      return res;
    });
    if (got.n < 3) throw new Error('дельт слишком мало: ' + got.n);
    const bad = got.texts.filter(t => !/^([+−]\d+%|±0%|новое)$/.test(t));
    if (bad.length) throw new Error('формат дельты: ' + bad.join(' '));
    eq(got.hdr, true, 'заголовок «vs <прошлый год>»');
    eq(got.sameSpan, true, 'подпись окна сравнения «vs <год> · <мес>–<мес>»');
    eq(got.nAll, 0, 'за «всё время» сравнивать не с чем');
  });

  check('инвестиции: ставка годовых у счёта и по портфелю', async p => {
    const got = await p.evaluate(() => {
      showPage('assets', document.getElementById('nav-assets'));
      renderInvestments();
      const port = document.getElementById('investments-rate');
      return { portShown: port && port.style.display !== 'none', portTxt: port ? port.textContent : '', cards: document.querySelectorAll('#investments-list .inv-rate').length, invs: DB.investments.filter(v => !v._deleted).length };
    });
    eq(got.portShown, true, 'ставка портфеля показана');
    if (!/[+−]\d+(\.\d)?% годовых по портфелю/.test(got.portTxt)) throw new Error('текст портфеля: ' + got.portTxt);
    if (got.cards < 1) throw new Error('у счетов нет ставки, счетов: ' + got.invs);
  });
}, { demo: true });

// Дизайн-правки v1.85.0: пробел в суммах, короткий hex в темах, палитра,
// шапка «Бюджета», плоские списки, строчные заголовки, цвет статей,
// свёрнутая инструкция синка.
suite(390, 'дизайн v1.85.0', () => {
  check('разделитель тысяч в моно-сумме уже половины цифры', async p => {
    const got = await p.evaluate(() => {
      showPage('budget', document.getElementById('nav-budget'));
      const host = document.getElementById('sum-spent');
      const mk = t => { const s = document.createElement('span'); s.className = 's-val'; s.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap'; s.textContent = t; host.parentElement.appendChild(s); const w = s.getBoundingClientRect().width; s.remove(); return w; };
      const digit = mk('11') - mk('1');
      const sep = mk('1 1') - mk('11');
      return { digit, sep, ws: getComputedStyle(host).wordSpacing };
    });
    eq(got.sep < got.digit * 0.5, true, `NBSP ${got.sep.toFixed(1)}px при цифре ${got.digit.toFixed(1)}px (word-spacing ${got.ws})`);
  });

  check('короткий hex в CSS-переменной не ломает цвета графиков', async p => {
    const got = await p.evaluate(() => {
      const root = document.documentElement;
      root.style.setProperty('--muted', '#888');
      const short = _chartColors().mutedBar;
      root.style.removeProperty('--muted');
      root.classList.add('dark');
      const dark = { muted: getComputedStyle(root).getPropertyValue('--muted').trim(), bar: _chartColors().mutedBar };
      root.classList.remove('dark');
      return { short, dark };
    });
    eq(got.short, 'rgba(136,136,136,0.35)', 'парсер разворачивает #888');
    eq(got.dark.muted.length, 7, 'в тёмной теме --muted шестизначный: ' + got.dark.muted);
    eq(/NaN/.test(got.dark.bar), false, 'mutedBar тёмной темы: ' + got.dark.bar);
  });

  check('палитра категорий: 11 шестизначных уникальных цветов', async p => {
    const got = await p.evaluate(() => ({
      n: CAT_COLORS.length, uniq: new Set(CAT_COLORS).size,
      hex: CAT_COLORS.every(c => /^#[0-9a-f]{6}$/.test(c)),
      tagsIn: INCOME_TAG_COLORS.every(c => CAT_COLORS.includes(c)),
      defIn: Object.values(DEFAULT_COLORS).every(c => CAT_COLORS.includes(c)),
    }));
    eq(got.n, 11, 'цветов'); eq(got.uniq, 11, 'уникальных'); eq(got.hex, true, 'формат');
    eq(got.tagsIn, true, 'цвета тегов — из той же палитры');
    eq(got.defIn, true, 'цвета по умолчанию — из той же палитры');
  });

  check('шапка «Бюджета»: две главные цифры над карточками', async p => {
    const got = await p.evaluate(() => {
      showPage('budget', document.getElementById('nav-budget'));
      const row = document.getElementById('budget-days-row');
      const cells = [...row.querySelectorAll('.bh-cell')];
      const grid = document.querySelector('#page-budget .summary-grid');
      return {
        cls: row.className, n: cells.length,
        l1: cells[0]?.querySelector('.bh-lbl')?.textContent, l2: cells[1]?.querySelector('.bh-lbl')?.textContent,
        v1: parseFloat(getComputedStyle(cells[0].querySelector('.bh-val')).fontSize),
        above: row.getBoundingClientRect().bottom <= grid.getBoundingClientRect().top + 1,
      };
    });
    eq(got.cls.includes('bh'), true, 'класс .bh');
    eq(got.n >= 2, true, 'ячеек: ' + got.n); // третья — обязательные (v1.86.0), когда они есть
    eq(/^(Остаток|Перерасход) на сегодня|^Перерасход сегодня/.test(got.l1), true, 'первая подпись: ' + got.l1);
    eq(/^Прогноз на месяц|^Факт в день/.test(got.l2), true, 'вторая подпись: ' + got.l2);
    eq(got.v1 >= 18, true, 'цифра крупная: ' + got.v1);
    eq(got.above, true, 'блок стоит над тремя карточками');
  });

  check('списки — плоские строки внутри одной карточки', async p => {
    const got = await p.evaluate(() => {
      showPage('day', document.getElementById('nav-day'));
      const list = document.getElementById('entry-list');
      // В фикстуре на один день — не больше одной траты: подсыпаем две на сегодня
      const tmp = [{ id: 'dsgA', cat: 1, amount: 100, comment: 'a' }, { id: 'dsgB', cat: 2, amount: 200, comment: 'b' }]
        .map(e => ({ ...e, date: today(), catId: DB.catIds[e.cat], updatedAt: Date.now() }));
      DB.expenses.push(...tmp); renderDay();
      const rows = [...list.querySelectorAll('.entry-row')];
      const d = { rows: rows.length, listBorder: getComputedStyle(list).borderTopStyle,
        rowRadius: rows.map(r => getComputedStyle(r).borderTopLeftRadius), rowBorder: rows.slice(1).every(r => getComputedStyle(r).borderTopWidth !== '0px') };
      DB.expenses = DB.expenses.filter(e => !tmp.some(t => t.id === e.id)); renderDay();
      showPage('settings', document.getElementById('nav-settings'));
      const sl = document.querySelector('#page-settings .settings-list');
      d.setBorder = getComputedStyle(sl).borderTopStyle;
      d.setRadius = getComputedStyle(sl.querySelector('.setting-row')).borderTopLeftRadius;
      showPage('assets', document.getElementById('nav-assets'));
      const ar = document.querySelector('#assets-list > .asset-row');
      d.assetRadius = ar ? getComputedStyle(ar).borderTopLeftRadius : '0px';
      return d;
    });
    eq(got.rows > 1, true, 'на «Дне» есть строки: ' + got.rows);
    eq(got.listBorder, 'solid', 'рамка у контейнера списка');
    eq(got.rowRadius.every(r => r === '0px'), true, 'строки без радиуса: ' + [...new Set(got.rowRadius)].join(','));
    eq(got.rowBorder, true, 'между строками разделитель');
    eq(got.setBorder, 'solid', 'рамка у блока настроек');
    eq(got.setRadius, '0px', 'строка настроек без радиуса');
    eq(got.assetRadius, '0px', 'строка счёта без радиуса');
  });

  check('пустой день — без рамки', async p => {
    const got = await p.evaluate(() => {
      showPage('day', document.getElementById('nav-day'));
      const list = document.getElementById('entry-list');
      for (let i = 0; i < 40 && !list.classList.contains('empty'); i++) changeDay(1);
      return { empty: list.classList.contains('empty'), border: getComputedStyle(list).borderTopStyle };
    });
    eq(got.empty, true, 'нашёлся пустой день');
    eq(got.border, 'none', 'рамки нет');
  });

  check('заголовки секций строчные, цветом текста', async p => {
    const got = await p.evaluate(() => {
      showPage('stats', document.getElementById('nav-stats'));
      const text = getComputedStyle(document.body).color;
      const pick = sel => [...document.querySelectorAll(sel)].filter(e => e.offsetParent).slice(0, 3)
        .map(e => ({ tt: getComputedStyle(e).textTransform, col: getComputedStyle(e).color === text }));
      return { sec: pick('.sec-title'), ch: pick('.chart-title'), inl: [...document.querySelectorAll('#page-stats [style*="uppercase"]')].length };
    });
    eq(got.ch.length > 0 && got.ch.every(x => x.tt === 'none' && x.col), true, 'заголовки карточек: ' + JSON.stringify(got.ch));
    eq(got.inl, 0, 'инлайновых uppercase на «Аналитике»');
  });

  // v1.86.2: доход — синим (как ряд «Доходы» на графике), расход — чернилами,
  // зелёный/красный — только у знака («Баланс», «Накоплено»)
  check('доход синим, расход чернилами, цвет знака только у состояния', async p => {
    const got = await p.evaluate(() => {
      showPage('income', document.getElementById('nav-income'));
      const text = getComputedStyle(document.body).color;
      const probe = document.createElement('i'); probe.style.color = 'var(--blue)'; document.body.appendChild(probe);
      const blue = getComputedStyle(probe).color; probe.remove();
      const inc = document.getElementById('income-total'), exp = document.getElementById('income-expenses'), bal = document.getElementById('income-balance');
      showPage('stats', document.getElementById('nav-stats'));
      const sum = document.getElementById('stats-summary');
      const cells = [...sum.querySelectorAll('div[style*="font-weight:700"]')].slice(0, 2).map(c => getComputedStyle(c).color);
      showPage('report', document.getElementById('nav-report') || document.getElementById('nav-stats'));
      const rep = [...document.querySelectorAll('#rep-summary .rep-val')].slice(0, 2).map(c => getComputedStyle(c).color);
      return { blue, incCls: inc.className, incCol: getComputedStyle(inc).color, expCol: getComputedStyle(exp).color, balCls: bal.className,
        statsExp: cells[0], statsInc: cells[1], repInc: rep[0], repExp: rep[1], text };
    });
    eq(/\bok\b/.test(got.incCls), false, 'у «Доход» нет постоянного зелёного: ' + got.incCls);
    eq(got.incCol, got.blue, '«Доход» на вкладке синим');
    eq(got.expCol, got.text, '«Расходы» на вкладке чернилами');
    eq(/\b(ok|over)\b/.test(got.balCls), true, '«Баланс» остаётся состоянием: ' + got.balCls);
    eq(got.statsInc === got.blue && got.statsExp === got.text, true, 'сводка «Аналитики»: доход синий, расход чернилами');
    eq(got.repInc === got.blue && got.repExp === got.text, true, 'отчёт: доход синий, расход чернилами');
  });

  check('инструкция по Apps Script свёрнута после настройки URL', async p => {
    const got = await p.evaluate(() => {
      showPage('settings', document.getElementById('nav-settings'));
      const help = document.getElementById('sync-help'), tg = document.getElementById('sync-help-toggle');
      const vis = el => !!(el.offsetWidth || el.offsetHeight);
      const saved = DB.syncUrl;
      DB.syncUrl = ''; renderSettings(); help.classList.remove('open');
      const before = { help: vis(help), tg: vis(tg) };
      DB.syncUrl = 'https://script.google.com/macros/s/test/exec'; renderSettings();
      const after = { help: vis(help), tg: vis(tg), ready: document.body.classList.contains('sync-ready') };
      tg.click();
      const opened = vis(help);
      DB.syncUrl = ''; renderSettings(); help.classList.remove('open');
      const reset = { help: vis(help), tg: vis(tg) };
      DB.syncUrl = saved; renderSettings();
      return { before, after, opened, reset };
    });
    eq(got.before.help && !got.before.tg, true, 'без URL: инструкция видна, переключателя нет');
    eq(got.after.ready && !got.after.help && got.after.tg, true, 'с URL: инструкция спрятана, строка-переключатель видна');
    eq(got.opened, true, 'тап по строке раскрывает инструкцию');
    eq(got.reset.help && !got.reset.tg, true, 'после сброса URL всё как было');
  });
});

// Дизайн-правки v1.86.0: герой «Дня», FAB только на «Бюджете», счета раньше
// графиков, обязательные в герое, вклады карточкой, знак ₽ отдельным span,
// даты без ISO, оси без единиц, сводка по три строки, настройки без эмодзи,
// очистка отдельно, тап по строке = правка.
suite(390, 'дизайн v1.86.0', () => {
  check('шапка «Дня» — герой из двух ячеек, сумма дня печатается один раз', async p => {
    const got = await p.evaluate(() => {
      showPage('day', document.getElementById('nav-day'));
      currentDay = today(); renderDay();
      const hero = document.getElementById('day-hero');
      const env = document.getElementById('day-envelope');
      const t = s => (s.match(/\d[\d  ]*₽/g) || []).map(x => x.replace(/\D/g, ''));
      return {
        cls: hero.className, cells: hero.querySelectorAll('.bh-cell').length,
        envInHero: env.parentElement === hero,
        lbl: document.getElementById('day-total-lbl').textContent,
        total: t(document.getElementById('day-total').textContent)[0],
        envNums: t(env.textContent),
        hasSpent: /потрачено/.test(env.textContent),
      };
    });
    eq(/\bbh\b/.test(got.cls), true, 'класс .bh');
    eq(got.cells, 2, 'ячеек');
    eq(got.envInHero, true, 'конверт — ячейка героя');
    eq(got.lbl, 'Расходы за день', 'подпись суммы дня');
    eq(got.hasSpent, false, 'в конверте нет «потрачено»');
    eq(got.envNums.includes(got.total), false, 'сумма дня в конверте не повторяется');
  });

  check('FAB только на «Бюджете»; в «Дне» подсказка пустого дня — про строку ввода', async p => {
    const got = await p.evaluate(() => {
      const vis = () => document.getElementById('fab').style.display;
      showPage('day', document.getElementById('nav-day')); const day = vis();
      showPage('budget', document.getElementById('nav-budget')); const bud = vis();
      showPage('day', document.getElementById('nav-day'));
      const list = document.getElementById('entry-list');
      for (let i = 0; i < 40 && !list.classList.contains('empty'); i++) changeDay(1);
      const txt = list.textContent;
      currentDay = today(); renderDay();
      const pe = getComputedStyle(document.querySelector('#page-budget .page-end')).height;
      return { day, bud, txt, pe: parseFloat(pe), ph: document.getElementById('qa-amount').placeholder };
    });
    eq(got.day, 'none', 'FAB на «Дне»');
    eq(got.bud, 'flex', 'FAB на «Бюджете»');
    eq(/Нажмите \+/.test(got.txt), false, 'пустой день не зовёт нажать +: ' + got.txt.trim());
    eq(got.pe >= 150, true, 'запас под FAB внизу «Бюджета»: ' + got.pe);
    eq(got.ph, 'Сумма', 'плейсхолдер быстрого ввода');
  });

  check('«Активы» на телефоне: графики раньше счетов (v1.86.2, откат порядка v1.86.0)', async p => {
    const got = await p.evaluate(() => {
      showPage('assets', document.getElementById('nav-assets'));
      const l = document.getElementById('assets-lists').getBoundingClientRect();
      const c = document.getElementById('assets-charts').getBoundingClientRect();
      return { listsTop: l.top, chartsTop: c.top, order: !!(document.getElementById('assets-lists').compareDocumentPosition(document.getElementById('assets-charts')) & Node.DOCUMENT_POSITION_FOLLOWING) };
    });
    eq(got.order, false, 'в DOM графики идут первыми');
    eq(got.chartsTop < got.listsTop, true, `графики (${Math.round(got.chartsTop)}) выше счетов (${Math.round(got.listsTop)})`);
  });

  check('обязательные — ячейка героя «Бюджета», тап открывает бронь', async p => {
    const got = await p.evaluate(() => {
      showPage('budget', document.getElementById('nav-budget'));
      const obl = document.getElementById('budget-obl-row');
      if (!obl) return { none: true };
      const inHero = obl.parentElement === document.getElementById('budget-days-row');
      const lbl = obl.querySelector('.bh-lbl')?.textContent;
      obl.querySelector('.bh-val').click();
      const open = !!document.getElementById('modal-spec').offsetParent || getComputedStyle(document.getElementById('modal-spec')).display !== 'none';
      closeModal('modal-spec');
      // v1.86.1: подпись «оплачено · ждём · разовые» своей строкой и целиком,
      // шеврон сразу за суммой, цифры героя по центру ячейки
      const sub = obl.querySelector('.bh-sub'), val = obl.querySelector('.bh-val');
      const sr = sub.getBoundingClientRect(), vr = val.getBoundingClientRect();
      const chev = obl.querySelector('.bh-chev');
      const cell = document.querySelector('#budget-days-row .bh-cell');
      return { inHero, lbl, open, cls: obl.className,
        subBelowVal: sr.top >= vr.bottom - 1, subFits: sub.scrollWidth <= sub.clientWidth + 1,
        subOverflow: getComputedStyle(sub).textOverflow, chevInVal: chev?.parentElement === val,
        align: getComputedStyle(cell).textAlign, card: getComputedStyle(document.querySelector('.summary-grid .s-card')).textAlign };
    });
    if (got.none) throw new Error('строки обязательных нет (фикстура должна её давать)');
    eq(got.inHero, true, 'ячейка внутри #budget-days-row');
    eq(/bh-cell/.test(got.cls) && /bh-obl/.test(got.cls), true, 'классы: ' + got.cls);
    eq(got.lbl, 'Обязательные', 'подпись');
    eq(got.open, true, 'тап по сумме открывает модалку брони');
    eq(got.subBelowVal, true, 'подпись под суммой, а не в одной строке с ней');
    eq(got.subFits && got.subOverflow !== 'ellipsis', true, 'подпись не обрезана троеточием');
    eq(got.chevInVal, true, 'шеврон стоит сразу за суммой');
    eq(got.align === 'center' && got.card === 'center', true, 'герой и карточки сводки по центру');
  });

  check('знак рубля — отдельный span, текст суммы не меняется', async p => {
    const got = await p.evaluate(() => {
      const h = fmtH(1234.5);
      const el = document.createElement('div'); el.innerHTML = h; document.body.appendChild(el);
      const cur = el.querySelector('.cur');
      const r = { text: el.textContent, expected: fmt(1234.5), hasCur: !!cur, curText: cur && cur.textContent,
        smaller: cur && parseFloat(getComputedStyle(cur).fontSize) < parseFloat(getComputedStyle(el).fontSize),
        prvWraps: el.firstElementChild.className === 'prv' };
      el.remove(); return r;
    });
    eq(got.text, got.expected, 'textContent как у fmt');
    eq(got.hasCur && got.curText === '₽', true, '.cur со знаком');
    eq(got.smaller, true, '₽ мельче цифр');
    eq(got.prvWraps, true, 'внешняя обёртка по-прежнему .prv');
  });

  check('даты без ISO: «17 окт» в текущем году, с годом — в другом', async p => {
    const got = await p.evaluate(() => {
      const y = new Date().getFullYear();
      return {
        cur: fmtDate(y + '-10-05'), prev: fmtDate((y - 1) + '-02-09'), wd: fmtDate(y + '-10-05', { weekday: true }),
        full: fmtDate(y + '-10-05', { year: true }), hdr: (showPage('day', document.getElementById('nav-day')), currentDay = today(), renderDay(), document.getElementById('day-label').textContent),
        inc: (showPage('income', document.getElementById('nav-income')), document.getElementById('income-list').textContent),
        hist: (showPage('assets', document.getElementById('nav-assets')), [...document.querySelectorAll('#assets-history-table td:first-child')].map(td => td.textContent)),
      };
    });
    eq(got.cur, '5 окт', 'текущий год без года');
    eq(got.prev, '9 фев ' + (new Date().getFullYear() - 1), 'прошлый год с годом');
    eq(/^[А-Я][а-я], 5 окт$/.test(got.wd), true, 'с днём недели: ' + got.wd);
    eq(got.full, '5 окт ' + new Date().getFullYear(), 'year: true');
    eq(/^[А-Я][а-я], \d{1,2} [а-я]{3} \d{4}$/.test(got.hdr), true, 'шапка дня строчным месяцем: ' + got.hdr);
    eq(/\d{4}-\d{2}-\d{2}/.test(got.inc), false, 'ISO в списке доходов');
    eq(got.hist.every(t => !/\d{4}-\d{2}/.test(t)), true, 'ISO в истории активов: ' + got.hist.join(','));
  });

  check('оси графиков без единицы на каждом делении', async p => {
    const got = await p.evaluate(() => {
      showPage('stats', document.getElementById('nav-stats'));
      const lab = k => charts[k] && charts[k].scales && charts[k].scales.y ? charts[k].scales.y.ticks.map(t => String(t.label)).join(' ') : '';
      return { cushion: lab('cushion'), grouped: lab('grouped'), weekday: lab('weekday') };
    });
    eq(/мес/.test(got.cushion), false, 'подушка: ' + got.cushion);
    eq(/₽/.test(got.grouped + got.weekday), false, 'деньги: ' + got.grouped + ' | ' + got.weekday);
  });

  check('сводка «Аналитики» на телефоне: по три строки и «ещё N», состояние помнится', async p => {
    const got = await p.evaluate(() => {
      showPage('stats', document.getElementById('nav-stats'));
      const col = [...document.querySelectorAll('#stats-summary .ss-col')].find(c => c.querySelector('.ss-toggle'));
      if (!col) return { none: true, rows: [...document.querySelectorAll('#stats-summary .ss-list')].map(l => l.querySelectorAll('.ss-row').length) };
      const vis = r => [...r.children].some(ch => ch.offsetParent);
      const rows = [...col.querySelectorAll('.ss-row')];
      const before = rows.filter(vis).length;
      const tg = col.querySelector('.ss-toggle'); const label = tg.textContent;
      tg.click();
      const after = [...col.querySelectorAll('.ss-row')].filter(vis).length;
      renderStats();
      const col2 = [...document.querySelectorAll('#stats-summary .ss-col')].find(c => c.querySelector('.ss-toggle'));
      const kept = [...col2.querySelectorAll('.ss-row')].filter(vis).length;
      col2.querySelector('.ss-toggle').click();
      return { total: rows.length, before, after, kept, label };
    });
    if (got.none) throw new Error('ни в одном списке сводки нет «ещё»: строк ' + got.rows.join(','));
    eq(got.before, 3, 'видно строк до раскрытия');
    eq(/^ещё \d+$/.test(got.label), true, 'подпись: ' + got.label);
    eq(got.after, got.total, 'после «ещё» видны все');
    eq(got.kept, got.total, 'после перерисовки раскрытие сохранилось');
  });

  check('настройки: без эмодзи в строках, очистка — отдельной карточкой внизу', async p => {
    const got = await p.evaluate(() => {
      showPage('settings', document.getElementById('nav-settings'));
      const labels = [...document.querySelectorAll('#page-settings .setting-label')].map(l => l.textContent.trim());
      const emoji = labels.filter(t => /^[^\wА-Яа-яЁё]/.test(t) && !/^[A-Za-zА-Яа-яЁё]/.test(t));
      const dz = document.getElementById('danger-zone');
      const lists = [...document.querySelectorAll('#page-settings .settings-list')];
      return { emoji, dzLast: lists[lists.length - 1] === dz, dzRows: dz ? dz.querySelectorAll('.setting-row').length : 0 };
    });
    eq(got.emoji.length, 0, 'строки с эмодзи: ' + got.emoji.join(' | '));
    eq(got.dzLast && got.dzRows === 1, true, 'очистка — последний блок из одной строки');
  });

  check('вклады — карточка со строками, действия текстом; тап по строке «Дня» открывает правку', async p => {
    const got = await p.evaluate(() => {
      showPage('deposits');
      const list = document.getElementById('deposits-list');
      const rows = [...list.querySelectorAll('.dep-row')];
      const r = { depCls: list.className, border: getComputedStyle(list).borderTopStyle, rows: rows.length,
        pills: list.querySelectorAll('.btn').length, links: list.querySelectorAll('.dep-actions button').length };
      showPage('day', document.getElementById('nav-day'));
      onDayCalChange(DB.expenses.find(e => !e._deleted).date);
      r.pencils = document.querySelectorAll('#entry-list use[href="#i-edit"]').length;
      const row = [...document.querySelectorAll('#entry-list .entry-row')].find(x => x.onclick);
      row.click();
      r.modal = getComputedStyle(document.getElementById('modal-expense')).display !== 'none';
      r.title = document.getElementById('expense-modal-title').textContent;
      closeModal('modal-expense');
      return r;
    });
    eq(/dep-list/.test(got.depCls), true, 'класс контейнера: ' + got.depCls);
    eq(got.rows === 0 || got.border === 'solid', true, 'рамка у карточки вкладов');
    eq(got.pencils, 0, 'карандашей в списке дня');
    eq(got.modal && got.title === 'Редактировать', true, 'тап по строке открыл правку: ' + got.title);
  });
});

suite(1600, 'дизайн v1.86.0 — десктоп', () => {
  check('высота холста от ширины, сводка раскрыта без переключателей, поиск в полуширине', async p => {
    const got = await p.evaluate(() => {
      showPage('stats', document.getElementById('nav-stats'));
      const box = document.querySelector('#cw-daycompare .chart-box').getBoundingClientRect();
      const wk = document.querySelector('#cw-weekday .chart-box').getBoundingClientRect();
      const search = document.getElementById('cw-search').getBoundingClientRect();
      const page = document.getElementById('page-stats').getBoundingClientRect();
      const toggles = [...document.querySelectorAll('#stats-summary .ss-toggle')].filter(t => t.offsetParent).length;
      const hidden = [...document.querySelectorAll('#stats-summary .ss-row.ss-more > *')].filter(e => !e.offsetParent).length;
      return { boxH: box.height, boxW: box.width, wkH: wk.height, wkW: wk.width, searchW: search.width, pageW: page.width, toggles, hidden };
    });
    eq(got.boxH >= 300 && got.boxH <= 360, true, `«День за днём» ${Math.round(got.boxW)}×${Math.round(got.boxH)}`);
    eq(Math.abs(got.wkW / got.wkH - 2.4) < 0.15 || got.wkH === 360, true, `дни недели ${Math.round(got.wkW)}×${Math.round(got.wkH)}`);
    eq(got.searchW < got.pageW * 0.6, true, `поиск ${Math.round(got.searchW)} из ${Math.round(got.pageW)}`);
    eq(got.toggles, 0, 'переключателей «ещё» на десктопе');
    eq(got.hidden, 0, 'скрытых строк сводки на десктопе');
  });
});

suite(360, 'калькулятор v1.86.3', () => {
  // Задать поля калькулятора и пересчитать; вернуть печатаемые цифры
  const calc = (p, o) => p.evaluate(o => {
    showPage('calc');
    setCalcMode('period');
    setMoneyInput('calc-start', o.start); setMoneyInput('calc-monthly', o.monthly || 0);
    document.getElementById('calc-rate').value = o.rate;
    document.getElementById('calc-infl').value = 0;
    document.getElementById('calc-cap').value = o.cap || 'monthly';
    document.getElementById('calc-duration').value = o.n;
    setCalcUnit(o.unit, document.querySelector(`#calc-unit-btns [data-val=${o.unit}]`));
    const t = id => document.getElementById(id).textContent.replace(/\s/g, '');
    return { eff: t('calc-eff-rate'), profit: t('calc-profit'), yearly: t('calc-yearly') };
  }, o);

  check('чипы срока помещаются в карточку на 360 px', async p => {
    const got = await p.evaluate(() => {
      showPage('calc');
      const c = document.getElementById('calc-duration-card').getBoundingClientRect();
      const b = document.getElementById('calc-unit-btns').getBoundingClientRect();
      return { cR: c.right, bR: b.right, bL: b.left, cL: c.left, order: [...document.querySelectorAll('#calc-unit-btns .cu-btn')].map(x => x.dataset.val).join() };
    });
    eq(got.bR <= got.cR - 8 && got.bL >= got.cL, true, `чипы ${Math.round(got.bL)}–${Math.round(got.bR)}, карточка ${Math.round(got.cL)}–${Math.round(got.cR)}`);
    eq(got.order, 'days,months,years', 'порядок дни → мес → лет');
  });

  check('14% на 14 дней — эффективная 14%, доход в год по фактическим дням', async p => {
    const got = await calc(p, { start: 100000, rate: 14, n: 14, unit: 'days' });
    eq(got.eff, '14.00%', 'короткий срок не наращивается переоткрытием');
    // 100 000 × 14% × 14/365,25 = 536,62 → в год ровно 14 000
    eq(got.yearly, '14000₽', 'доход в год = доход за срок × 365,25/14');
  });

  check('6 мес — простой пересчёт доходности за срок; год — сложная ставка', async p => {
    const half = await calc(p, { start: 100000, rate: 14, n: 6, unit: 'months' });
    eq(half.eff, (((1 + 0.14 / 12) ** 6 - 1) * 2 * 100).toFixed(2) + '%', '6 мес: (1+r/12)^6 − 1, ×2');
    const year = await calc(p, { start: 100000, rate: 14, n: 1, unit: 'years' });
    eq(year.eff, (((1 + 0.14 / 12) ** 12 - 1) * 100).toFixed(2) + '%', '1 год: (1+r/12)^12 − 1');
    const two = await calc(p, { start: 100000, rate: 14, n: 2, unit: 'years' });
    eq(two.eff, year.eff, '2 года без пополнений — та же годовая, не сумма за срок пополам');
  });

  check('калькулятор открывается из «Активов» и со страницы вкладов, «‹» ведёт обратно', async p => {
    const got = await p.evaluate(() => {
      const back = () => { document.getElementById('calc-back').click(); return currentPage; };
      showPage('deposits');
      const depLink = [...document.querySelectorAll('#page-deposits .sec-action')].find(e => e.textContent === 'Калькулятор');
      depLink.click();
      const r1 = currentPage, b1 = back();
      showPage('assets', document.getElementById('nav-assets'));
      const asBtn = [...document.querySelectorAll('#page-assets .btn')].find(e => e.textContent.trim() === 'Калькулятор');
      const inv = [...document.querySelectorAll('#page-assets .btn')].find(e => e.textContent.includes('Мои инвестиции'));
      asBtn.click();
      const r2 = currentPage, b2 = back();
      return { r1, b1, r2, b2, sameGroup: asBtn.parentElement === inv.parentElement };
    });
    eq(got.r1 + '→' + got.b1, 'calc→deposits', 'со вкладов и обратно');
    eq(got.r2 + '→' + got.b2, 'calc→assets', 'из «Активов» и обратно');
    eq(got.sameGroup, true, 'кнопка стоит рядом с вкладами и инвестициями');
  });

  check('переход со вклада ставит срок в днях, даже если до этого стояли годы', async p => {
    const got = await p.evaluate(() => {
      showPage('calc');
      setCalcUnit('years', document.querySelector('#calc-unit-btns [data-val=years]'));
      const end = new Date(); end.setDate(end.getDate() + 45);
      const ds = end.toISOString().slice(0, 10);
      DB.deposits = [{ id: 'dc1', name: 'x', amount: 50000, rate: 14, openDate: today(), endDate: ds, capitalization: 'monthly' }];
      _depToCalc('dc1');
      const r = { unit: document.getElementById('calc-unit').value, n: document.getElementById('calc-duration').value,
        active: document.querySelector('#calc-unit-btns .cu-btn.active').dataset.val };
      DB.deposits = [];
      return r;
    });
    eq(got.unit + '/' + got.active, 'days/days', 'единица и подсветка');
    eq(Math.abs(+got.n - 45) <= 1, true, `срок ${got.n} дн`);
  });
});

suite(1600, 'дизайн v1.85.0 — десктоп', () => {
  check('вкладки ввода — колонка до 760 px, аналитика во всю ширину', async p => {
    const got = await p.evaluate(() => {
      const w = id => { showPage(id, document.getElementById('nav-' + id)); return Math.round(document.getElementById('page-' + id).getBoundingClientRect().width); };
      const r = { day: w('day'), budget: w('budget'), income: w('income'), settings: w('settings'), stats: w('stats'), assets: w('assets') };
      showPage('budget', document.getElementById('nav-budget'));
      const fab = document.getElementById('fab').getBoundingClientRect();
      const page = document.getElementById('page-budget').getBoundingClientRect();
      r.fabRight = Math.round(fab.right); r.pageRight = Math.round(page.right);
      return r;
    });
    for (const k of ['day', 'budget', 'income', 'settings']) eq(got[k] <= 760, true, `#page-${k}: ${got[k]}px`);
    eq(got.stats > 1000 && got.assets > 1000, true, `аналитика ${got.stats}, активы ${got.assets}`);
    eq(got.fabRight <= got.pageRight && got.fabRight >= got.pageRight - 80, true, `FAB у края колонки: ${got.fabRight} при крае ${got.pageRight}`);
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
// Два прохода: набор данных задаётся при старте браузера, поэтому сюиты на
// FIXTURE и на демо-наборе не могут ехать в одном.
async function runPass(list, opts) {
  if (!list.length) return;
  await withPage(list.map(s => s.width), async (page, { width, index }) => {
    const s = list[index];
    for (const c of byWidth.get(s)) {
      try {
        await c.fn(page);
        results.push(['ok', width, s.title, c.name, '']);
      } catch (e) {
        failed++;
        results.push(['FAIL', width, s.title, c.name, e.message]);
      }
    }
  }, opts);
}
await runPass(SUITES.filter(s => !s.demo), {});
await runPass(SUITES.filter(s => s.demo), { demo: true });

for (const [st, w, t, n, msg] of results) {
  const mark = st === 'ok' ? '  ok  ' : ' FAIL ';
  console.log(`${mark} ${String(w).padStart(4)}  ${t} · ${n}${msg ? '\n        ' + msg : ''}`);
}
console.log(`\n${results.length - failed} из ${results.length} прошло`);
process.exit(failed ? 1 : 0);

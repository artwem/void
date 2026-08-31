// Скриншоты всех вкладок на всех ширинах. Запуск: node tools/shots.mjs
// Снимается полный демо-набор (buildDemoDB в index.html), а не минимальная
// FIXTURE: на ней вклады, инвестиции, кредиты и шаблоны были пустыми, и
// половина интерфейса на скриншотах просто не существовала.
import { mkdir } from 'node:fs/promises';
import { withPage } from './harness.mjs';

const WIDTHS = [390, 1000, 1280, 1440, 1600];
// Шесть вкладок навбара плюс четыре подстраницы, у которых своей кнопки нет:
// без них вклады, инвестиции, годовой отчёт и калькулятор не попадали в съёмку.
const PAGES = ['day', 'budget', 'income', 'stats', 'assets', 'settings',
               'deposits', 'investments', 'report', 'calc'];
const OUT = new URL('shots/', import.meta.url);

await mkdir(OUT, { recursive: true });
await withPage(WIDTHS, async (page, { width }) => {
  await page.addStyleTag({ content:
    // fullPage-скриншот перелейаутит страницу и перезапускает CSS-анимации,
    // из-за чего кадр ловит fadeIn в полёте и выходит выцветшим.
    '*,*::before,*::after{animation:none!important;transition:none!important}' });
  for (const name of PAGES) {
    await page.evaluate(n => window.showPage(n, document.getElementById('nav-' + n) || undefined), name);
    await new Promise(r => setTimeout(r, 350)); // дать Chart.js дорисоваться
    await page.screenshot({
      path: new URL(`${String(width).padStart(4, '0')}-${name}.png`, OUT).pathname.slice(1),
      fullPage: true,
    });
  }
  console.log('снято', width);
}, { demo: true });

// Все оверлеи в трёх амплуа — основная визуальная проверка задачи 7
const MODALS = await (async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  return [...html.matchAll(/<div class="overlay"[^>]*id="([^"]+)"/g)].map(m => m[1]);
})();

await withPage([390, 1280, 1600], async (page, { width }) => {
  for (const id of MODALS) {
    await page.evaluate(i => window.openModal(i), id);
    await new Promise(r => setTimeout(r, 120));
    await page.screenshot({
      path: new URL(`m-${String(width).padStart(4, '0')}-${id}.png`, OUT).pathname.slice(1),
    });
    await page.evaluate(i => window.closeModal(i), id);
  }
  console.log('модалки сняты', width);
}, { demo: true });
console.log('готово:', OUT.pathname);

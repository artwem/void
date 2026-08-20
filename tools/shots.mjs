// Скриншоты всех вкладок на всех ширинах. Запуск: node tools/shots.mjs
import { mkdir } from 'node:fs/promises';
import { withPage } from './harness.mjs';

const WIDTHS = [390, 1000, 1280, 1440, 1600];
const PAGES = ['day', 'budget', 'income', 'stats', 'assets', 'settings'];
const OUT = new URL('shots/', import.meta.url);

await mkdir(OUT, { recursive: true });
await withPage(WIDTHS, async (page, { width }) => {
  await page.addStyleTag({ content:
    // fullPage-скриншот перелейаутит страницу и перезапускает CSS-анимации,
    // из-за чего кадр ловит fadeIn в полёте и выходит выцветшим.
    '*,*::before,*::after{animation:none!important;transition:none!important}' });
  for (const name of PAGES) {
    await page.evaluate(n => window.showPage(n, document.getElementById('nav-' + n)), name);
    await new Promise(r => setTimeout(r, 350)); // дать Chart.js дорисоваться
    await page.screenshot({
      path: new URL(`${String(width).padStart(4, '0')}-${name}.png`, OUT).pathname.slice(1),
      fullPage: true,
    });
  }
  console.log('снято', width);
});
console.log('готово:', OUT.pathname);

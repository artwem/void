// Общая обвязка: статический сервер, браузер, фикстура, геометрические хелперы.
// Каталог dev-only, в PRECACHE и index.html не подключается.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME = process.env.CHROME_PATH
  || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.gs': 'text/plain; charset=utf-8',
};

function serve() {
  return new Promise(resolve => {
    const srv = createServer(async (req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const file = join(ROOT, normalize(p).replace(/^([/\\])+/, ''));
      try {
        const buf = await readFile(file);
        res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
        res.end(buf);
      } catch {
        res.writeHead(404).end('not found');
      }
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

// Фикстура текущего месяца: шесть категорий, часть с перерасходом,
// два банка и один кредитный. Реальный backup.json не используется —
// он в .gitignore, харнесс должен работать на чистом клоне.
const now = new Date();
const Y = now.getFullYear(), M = now.getMonth();
const MK = `${Y}-${String(M + 1).padStart(2, '0')}`;
const dd = n => `${MK}-${String(n).padStart(2, '0')}`;

export const FIXTURE = {
  categories: ['Аренда', 'Продукты + хозтовары + уход', 'Еда вне дома', 'Одежда', 'Хотелки', 'Мама'],
  catIds: ['cat0001', 'cat0002', 'cat0003', 'cat0004', 'cat0005', 'cat0006'],
  catColors: { 0: '#185fa5', 1: '#2d7a4f', 2: '#b07d1a', 3: '#c0392b', 4: '#7b4fa5', 5: '#1a7a7a' },
  expenses: [
    { id: 'e01', date: dd(1), cat: 0, catId: 'cat0001', amount: 36407, comment: '', special: true, updatedAt: 1 },
    { id: 'e02', date: dd(3), cat: 1, catId: 'cat0002', amount: 4210, comment: 'Пятёрочка', updatedAt: 1 },
    { id: 'e03', date: dd(5), cat: 1, catId: 'cat0002', amount: 3616, comment: 'Магнит', updatedAt: 1 },
    { id: 'e04', date: dd(6), cat: 2, catId: 'cat0003', amount: 11203, comment: '', updatedAt: 1 },
    { id: 'e05', date: dd(7), cat: 3, catId: 'cat0004', amount: 9456, comment: '', updatedAt: 1 },
    { id: 'e06', date: dd(8), cat: 4, catId: 'cat0005', amount: 18315, comment: '', updatedAt: 1 },
    { id: 'e07', date: dd(9), cat: 5, catId: 'cat0006', amount: 8200, comment: '', updatedAt: 1 },
    { id: 'e08', date: dd(10), cat: 1, catId: 'cat0002', amount: 5000, comment: 'Ашан', updatedAt: 1 },
  ],
  incomes: [
    { id: 'i01', date: dd(5), source: 'Зарплата', amount: 180000, tag: 'Оплата труда', updatedAt: 1 },
    { id: 'i02', date: dd(12), source: 'Вклад', amount: 27550, tag: 'Проценты', updatedAt: 1 },
  ],
  assets: [
    { id: 'a01', date: dd(1), bankName: 'Сбербанк', bank: 0, amount: 420000, updatedAt: 1 },
    { id: 'a02', date: dd(1), bankName: 'Т-Банк', bank: 1, amount: 310000, updatedAt: 1 },
  ],
  banks: ['Сбербанк', 'Т-Банк'],
  creditBanks: ['Альфа-Банк'],
  limits: { [MK]: [36298, 14094, 7988, 2669, 5000, 9000] },
  goals: [], templates: [], deposits: [], investments: [], credits: [],
  incomeTags: ['Оплата труда', 'Проценты'],
  incomeTagColors: { 0: '#185fa5', 1: '#2d7a4f' },
  incomeTagOrder: ['', 'Проценты'],
  listsMeta: {}, notifsEnabled: false, notifThreshold: 90,
};

/**
 * Поднимает сервер и браузер, отдаёт страницу в колбэк, всё закрывает.
 * fn(page, { width }) вызывается для каждой ширины из widths.
 */
export async function withPage(widths, fn) {
  const { srv, port } = await serve();
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--hide-scrollbars', '--font-render-hinting=none'],
  });
  try {
    for (const width of widths) {
      const page = await browser.newPage();
      await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
      await page.evaluateOnNewDocument(fx => {
        localStorage.setItem('budgetDB_v2', JSON.stringify(fx));
        // SW перезагружает страницу по controllerchange — в тестах это помеха.
        // Скрываем API целиком: регистрация в index.html за проверкой `in navigator`.
        Object.defineProperty(navigator, 'serviceWorker', { get: () => undefined });
      }, FIXTURE);
      await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle0' });
      await page.evaluate(() => document.fonts.ready);
      await fn(page, { width });
      await page.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
}

export const rect = (page, sel) => page.evaluate(s => {
  const el = document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}, sel);

export const cssOf = (page, sel, prop) => page.evaluate((s, p) => {
  const el = document.querySelector(s);
  return el ? getComputedStyle(el)[p] : null;
}, sel, prop);

export const isVisible = (page, sel) => page.evaluate(s => {
  const el = document.querySelector(s);
  if (!el) return false;
  const st = getComputedStyle(el);
  return st.display !== 'none' && st.visibility !== 'hidden' && el.getBoundingClientRect().width > 0;
}, sel);

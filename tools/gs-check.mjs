// Проверки Apps Script без развёртывания и сети: node tools/gs-check.mjs
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import vm from 'node:vm';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

export function loadGs(options = {}) {
  const files = {};
  const properties = {
    TELEGRAM_BOT_TOKEN: 'test-token',
    TELEGRAM_ALLOWED_USER_ID: '42',
    TELEGRAM_WEBHOOK_SECRET: 'test-secret',
    ...(options.properties || {}),
  };
  const cache = {};
  const calls = { drive: [], urlFetch: [] };
  let nextFileId = 1;

  function addFile(name, content) {
    const id = 'file-' + nextFileId++;
    const file = {
      id, name, content: String(content), trashed: false, updated: new Date(0),
      getId() { return id; },
      getName() { return name; },
      isTrashed() { return this.trashed; },
      setTrashed(value) { this.trashed = !!value; },
      getSize() { return this.content.length; },
      setContent(value) { this.content = String(value); this.updated = new Date(0); },
      getLastUpdated() { return this.updated; },
      getBlob() { return { getDataAsString: () => this.content }; },
    };
    files[id] = file;
    return file;
  }
  if (options.db !== null) addFile('nto_data.json', JSON.stringify(options.db || { templates: [], expenses: [] }));

  function iterator(list) {
    let i = 0;
    return { hasNext: () => i < list.length, next: () => list[i++] };
  }
  const scriptProperties = {
    getProperty: key => Object.prototype.hasOwnProperty.call(properties, key) ? properties[key] : null,
    setProperty(key, value) { properties[key] = String(value); },
    deleteProperty(key) { delete properties[key]; },
  };
  const sandbox = {
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(content) {
        return {
          content, mimeType: null,
          getData() { return this.content; },
          getMimeType() { return this.mimeType; },
          setMimeType(value) { this.mimeType = value; return this; },
        };
      },
    },
    DriveApp: {
      getFileById(id) {
        calls.drive.push({ method: 'getFileById', args: [id] });
        if (!files[id]) throw new Error('Файл не найден');
        return files[id];
      },
      getFilesByName(name) {
        calls.drive.push({ method: 'getFilesByName', args: [name] });
        return iterator(Object.values(files).filter(f => f.name === name));
      },
      createFile(name, content) {
        calls.drive.push({ method: 'createFile', args: [name, content] });
        return addFile(name, content);
      },
      searchFiles(query) {
        calls.drive.push({ method: 'searchFiles', args: [query] });
        const match = query.match(/title contains '([^']+)'/);
        const filesFound = Object.values(files).filter(f => !match || f.name.includes(match[1]));
        return iterator(filesFound);
      },
    },
    PropertiesService: { getScriptProperties: () => scriptProperties },
    CacheService: {
      getScriptCache: () => ({
        get: key => Object.prototype.hasOwnProperty.call(cache, key) ? cache[key] : null,
        put(key, value) { cache[key] = String(value); },
        remove(key) { delete cache[key]; },
      }),
    },
    LockService: {
      getScriptLock: () => ({ waitLock() {}, releaseLock() {} }),
    },
    UrlFetchApp: {
      fetch(url, fetchOptions = {}) {
        calls.urlFetch.push({ url, options: fetchOptions });
        return { getContentText: () => JSON.stringify({ ok: true, result: {} }) };
      },
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest(_algorithm, value) {
        return [...createHash('sha256').update(String(value), 'utf8').digest()];
      },
      formatDate(date, timeZone, format) {
        if (format !== 'yyyy-MM-dd') throw new Error('Неизвестный формат даты: ' + format);
        return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
      },
    },
    Session: { getScriptTimeZone: () => 'Europe/Moscow' },
    MimeType: { PLAIN_TEXT: 'text/plain' },
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(ROOT, 'apps-script/Code.gs'), 'utf8'), context, { filename: 'Code.gs' });
  const state = {
    files, properties, cache,
    get db() {
      const file = Object.values(files).find(f => f.name === 'nto_data.json' && !f.trashed);
      return file ? JSON.parse(file.content) : null;
    },
  };
  return { context, state, calls };
}

function eq(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what}: ожидалось ${expected}, получено ${actual}`);
}

const checks = [];
function check(name, fn) { checks.push({ name, fn }); }

const db = { templates: [
  { id: 't1', name: 'Кофе', amount: 350, cat: 1, catId: 'c1' },
  { id: 't2', name: 'Такси', amount: 12.5, cat: 2, catId: 'c2' },
  { id: 't3', name: 'Удалён', amount: 999, _deleted: true },
], expenses: [] };

function message(text, overrides = {}) {
  return {
    message_id: 1,
    from: { id: 42, first_name: 'Тест' },
    chat: { id: 42, type: 'private' },
    text,
    ...overrides,
  };
}

function post(context, body, telegram = 'test-secret') {
  return context.doPost({
    postData: { contents: JSON.stringify(body) },
    parameter: { telegram },
  });
}

function sentPayload(calls, index = 0) {
  eq(calls.urlFetch[index].url, 'https://api.telegram.org/bottest-token/sendMessage', 'URL Bot API');
  return JSON.parse(calls.urlFetch[index].options.payload);
}

check('подписи шаблонов и активная клавиатура', () => {
  const { context } = loadGs({ db });
  eq(context._telegramTemplateLabel(db.templates[0]), 'Кофе — 350 ₽', 'целая сумма');
  eq(context._telegramTemplateLabel(db.templates[1]), 'Такси — 12,50 ₽', 'копейки');
  eq(context._telegramKeyboard(db, 0).keyboard.flat().map(b => b.text).join('|'),
    'Кофе — 350 ₽|Такси — 12,50 ₽', 'активные шаблоны');
});

check('одиннадцать шаблонов разбиваются на две страницы', () => {
  const many = { templates: Array.from({ length: 11 }, (_, i) => ({ id: 't' + i, name: 'Шаблон ' + (i + 1), amount: i + 1 })) };
  const { context } = loadGs({ db: many });
  const first = context._telegramKeyboard(many, 0);
  const second = context._telegramKeyboard(many, 1);
  eq(first.keyboard.length, 6, 'пять строк шаблонов и навигация');
  eq(first.keyboard[5][0].text, 'Ещё 2/2', 'кнопка следующей страницы');
  eq(second.keyboard[0][0].text, 'Шаблон 11 — 11 ₽', 'одиннадцатый шаблон');
  eq(second.keyboard[1][0].text, 'Назад 1/2', 'кнопка предыдущей страницы');
});

check('/start отправляет постоянную клавиатуру', () => {
  const { context, calls } = loadGs({ db });
  context._telegramHandleMessage(message('/start'));
  eq(calls.urlFetch.length, 1, 'один вызов Telegram');
  const payload = sentPayload(calls);
  eq(payload.chat_id, 42, 'chat_id');
  eq(payload.reply_markup.resize_keyboard, true, 'resize_keyboard');
  eq(payload.reply_markup.is_persistent, true, 'is_persistent');
  eq(payload.reply_markup.one_time_keyboard, false, 'one_time_keyboard');
});

check('Ещё и Назад меняют только страницу клавиатуры', () => {
  const many = { templates: Array.from({ length: 11 }, (_, i) => ({ id: 't' + i, name: 'Шаблон ' + (i + 1), amount: i + 1 })), expenses: [] };
  const { context, state, calls } = loadGs({ db: many });
  context._telegramHandleMessage(message('Ещё 2/2'));
  let payload = sentPayload(calls);
  eq(payload.reply_markup.keyboard[0][0].text, 'Шаблон 11 — 11 ₽', 'вторая страница');
  eq(payload.reply_markup.keyboard[1][0].text, 'Назад 1/2', 'возврат на первую страницу');
  context._telegramHandleMessage(message('Назад 1/2'));
  payload = sentPayload(calls, 1);
  eq(payload.reply_markup.keyboard[5][0].text, 'Ещё 2/2', 'первая страница');
  eq(state.db.expenses.length, 0, 'расходы не созданы');
});

check('кнопка шаблона пока не записывает расход', () => {
  const { context, state, calls } = loadGs({ db });
  context._telegramHandleMessage(message('Кофе — 350 ₽'));
  eq(sentPayload(calls).text, 'Скоро будет доступно', 'заглушка записи');
  eq(state.db.expenses.length, 0, 'расходы не созданы');
});

check('неизвестный текст возвращает подсказку и клавиатуру', () => {
  const { context, state, calls } = loadGs({ db });
  context._telegramHandleMessage(message('что-то другое'));
  const payload = sentPayload(calls);
  eq(payload.text, 'Выберите шаблон кнопкой ниже.', 'подсказка');
  eq(payload.reply_markup.keyboard.flat().map(b => b.text).join('|'), 'Кофе — 350 ₽|Такси — 12,50 ₽', 'шаблоны');
  eq(state.db.expenses.length, 0, 'расходы не созданы');
});

check('доступ разрешён только пользователю 42 в личном чате', () => {
  const { context } = loadGs({ db });
  eq(context._telegramAllowed({ id: 42 }, { id: 42, type: 'private' }), true, 'разрешённый пользователь');
  eq(context._telegramAllowed({ id: 43 }, { id: 43, type: 'private' }), false, 'чужой пользователь');
  eq(context._telegramAllowed({ id: 42 }, { id: -100, type: 'group' }), false, 'группа');
});

check('неверный webhook secret отклоняется до Drive и Telegram', () => {
  const { context, calls } = loadGs({ db });
  const result = post(context, { message: message('/start') }, 'wrong-secret');
  eq(JSON.parse(result.getData()).ok, true, 'нейтральный ответ webhook');
  eq(calls.drive.length, 0, 'Drive не вызывался');
  eq(calls.urlFetch.length, 0, 'Telegram не вызывался');
  eq(result.getData().includes('Кофе'), false, 'шаблоны не раскрыты');
});

check('callback с неверным webhook secret тоже отклоняется до Drive', () => {
  const { context, calls } = loadGs({ db });
  const result = post(context, { callback_query: { id: 'cb1', from: { id: 42 }, message: { chat: { id: 42, type: 'private' } } } }, 'wrong-secret');
  eq(JSON.parse(result.getData()).ok, true, 'нейтральный ответ webhook');
  eq(calls.drive.length, 0, 'Drive не вызывался');
  eq(calls.urlFetch.length, 0, 'Telegram не вызывался');
});

check('чужой пользователь не получает шаблоны и не трогает Drive', () => {
  const { context, calls } = loadGs({ db });
  const result = post(context, { message: message('/start', { from: { id: 43 }, chat: { id: 43, type: 'private' } }) });
  eq(JSON.parse(result.getData()).ok, true, 'нейтральный ответ webhook');
  eq(calls.drive.length, 0, 'Drive не вызывался');
  eq(calls.urlFetch.length, 0, 'Telegram не вызывался');
  eq(result.getData().includes('Кофе'), false, 'шаблоны не раскрыты');
});

check('групповой чат не получает шаблоны и не трогает Drive', () => {
  const { context, calls } = loadGs({ db });
  const result = post(context, { message: message('/start', { chat: { id: -100, type: 'group' } }) });
  eq(JSON.parse(result.getData()).ok, true, 'нейтральный ответ webhook');
  eq(calls.drive.length, 0, 'Drive не вызывался');
  eq(calls.urlFetch.length, 0, 'Telegram не вызывался');
  eq(result.getData().includes('Кофе'), false, 'шаблоны не раскрыты');
});

check('допущенный webhook /start читает DB и отправляет шаблоны', () => {
  const { context, calls } = loadGs({ db });
  const result = post(context, { message: message('/start') });
  eq(JSON.parse(result.getData()).ok, true, 'ответ webhook');
  eq(calls.drive.length > 0, true, 'Drive прочитан');
  eq(sentPayload(calls).reply_markup.keyboard.flat().map(b => b.text).join('|'), 'Кофе — 350 ₽|Такси — 12,50 ₽', 'шаблоны');
});

check('прежний action ping продолжает работать', () => {
  const { context } = loadGs({ db });
  const result = context.doPost({ postData: { contents: JSON.stringify({ action: 'ping' }) }, parameter: {} });
  eq(JSON.parse(result.getData()).ok, true, 'ping');
  eq(result.getMimeType(), 'application/json', 'MIME ответа');
});

let failed = 0;
for (const { name, fn } of checks) {
  try {
    fn();
    console.log('  ok   ' + name);
  } catch (error) {
    failed++;
    console.log(' FAIL  ' + name + '\n       ' + error.message);
  }
}
console.log(`\n${checks.length - failed} из ${checks.length} прошло`);
process.exit(failed ? 1 : 0);

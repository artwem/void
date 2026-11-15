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
  const cacheExpires = {};
  const calls = { drive: [], urlFetch: [], cache: [] };
  let nextFileId = 1;
  let nextUuid = 1;
  const currentTime = () => options.now === undefined
    ? Date.now()
    : new Date(typeof options.now === 'function' ? options.now() : options.now).getTime();
  class GsDate extends Date {
    constructor(...args) {
      if (args.length) super(...args);
      else super(currentTime());
    }
    static now() { return currentTime(); }
  }

  function addFile(name, content) {
    const id = 'file-' + nextFileId++;
    const file = {
      id, name, content: String(content), trashed: false, updated: new Date(0),
      getId() { return id; },
      getName() { return name; },
      isTrashed() { return this.trashed; },
      setTrashed(value) { this.trashed = !!value; },
      getSize() { return this.content.length; },
      setContent(value) {
        calls.drive.push({ method: 'setContent', args: [id, value] });
        const fail = typeof options.failWrite === 'function' ? options.failWrite() : options.failWrite;
        if (fail) throw new Error('Тестовый сбой записи Drive');
        this.content = String(value);
        this.updated = new Date(currentTime());
      },
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
    getProperties: () => ({ ...properties }),
    setProperty(key, value) {
      const fail = typeof options.failPropertySet === 'function' ? options.failPropertySet(key) : options.failPropertySet;
      if (fail) throw new Error('Тестовый сбой записи Properties');
      properties[key] = String(value);
    },
    deleteProperty(key) { delete properties[key]; },
  };
  const sandbox = {
    Date: GsDate,
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
        get(key) {
          if (cacheExpires[key] && cacheExpires[key] <= currentTime()) {
            delete cache[key];
            delete cacheExpires[key];
          }
          return Object.prototype.hasOwnProperty.call(cache, key) ? cache[key] : null;
        },
        put(key, value, expirationInSeconds) {
          calls.cache.push({ method: 'put', key, value: String(value), expirationInSeconds });
          const fail = typeof options.failCachePut === 'function' ? options.failCachePut(key) : options.failCachePut;
          if (fail) throw new Error('Тестовый сбой записи Cache');
          cache[key] = String(value);
          cacheExpires[key] = currentTime() + expirationInSeconds * 1000;
        },
        remove(key) { delete cache[key]; delete cacheExpires[key]; },
      }),
    },
    LockService: {
      getScriptLock: () => ({
        waitLock() { if (options.onLockWait) options.onLockWait(); },
        releaseLock() {},
      }),
    },
    UrlFetchApp: {
      fetch(url, fetchOptions = {}) {
        calls.urlFetch.push({ url, options: fetchOptions });
        const method = url.slice(url.lastIndexOf('/') + 1);
        const payload = JSON.parse(fetchOptions.payload || '{}');
        const fail = typeof options.failTelegram === 'function'
          ? options.failTelegram(method, payload)
          : options.failTelegram;
        const custom = typeof options.telegramResponse === 'function'
          ? options.telegramResponse(method, payload)
          : options.telegramResponses && options.telegramResponses[method];
        return { getContentText: () => JSON.stringify(fail
          ? { ok: false, error_code: 500, description: 'Тестовый сбой Telegram ' + method }
          : { ok: true, result: custom === undefined ? {} : custom }) };
      },
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      getUuid() { return 'uuid-' + nextUuid++; },
      computeDigest(_algorithm, value) {
        return [...createHash('sha256').update(String(value), 'utf8').digest()];
      },
      formatDate(date, timeZone, format) {
        if (format !== 'yyyy-MM-dd') throw new Error('Неизвестный формат даты: ' + format);
        return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
      },
    },
    Session: { getScriptTimeZone: () => 'Europe/Moscow' },
    ScriptApp: {
      getService: () => ({ getUrl: () => options.scriptUrl || 'https://script.google.com/macros/s/test-exec/exec' }),
      getProjectTriggers: () => (options.triggers || []).slice(),
      newTrigger: name => ({
        timeBased: () => ({
          everyMinutes: minutes => ({
            create: () => {
              const trigger = { handlerFunction: name, minutes, getHandlerFunction: () => name };
              (options.triggers || (options.triggers = [])).push(trigger);
              return trigger;
            },
          }),
        }),
      }),
    },
    Logger: { log: (...args) => calls.urlFetch.push({ log: args.map(String).join(' ') }) },
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

check('setup регистрирует webhook на текущем /exec без раскрытия токена', () => {
  const { context, calls } = loadGs({ db });
  const result = context.setupTelegramWebhook();
  eq(result, undefined, 'setup не возвращает ответ Bot API');
  eq(calls.urlFetch.length, 1, 'один вызов Bot API');
  eq(calls.urlFetch[0].url, 'https://api.telegram.org/bottest-token/setWebhook', 'метод setWebhook');
  const payload = JSON.parse(calls.urlFetch[0].options.payload);
  eq(payload.url, 'https://script.google.com/macros/s/test-exec/exec?telegram=test-secret', 'URL webhook');
  eq(Object.keys(payload).join(','), 'url', 'только URL в payload');
  eq(calls.urlFetch[0].options.payload.includes('test-token'), false, 'токен не попадает в payload');
  eq(calls.urlFetch.filter(call => call.log).length, 0, 'setup ничего не печатает');
});

check('setup заменяет editor /dev на публичный /exec', () => {
  const { context, calls } = loadGs({ db, scriptUrl: 'https://script.google.com/macros/s/test-dev/dev' });
  context.setupTelegramWebhook();
  const payload = JSON.parse(calls.urlFetch[0].options.payload);
  eq(payload.url, 'https://script.google.com/macros/s/test-dev/exec?telegram=test-secret', 'публичный URL webhook');
});

check('setup использует явный TELEGRAM_EXEC_URL при наличии нескольких развёртываний', () => {
  const { context, calls } = loadGs({ db, properties: { TELEGRAM_EXEC_URL: 'https://script.google.com/macros/s/selected/exec' } });
  context.setupTelegramWebhook();
  const payload = JSON.parse(calls.urlFetch[0].options.payload);
  eq(payload.url, 'https://script.google.com/macros/s/selected/exec?telegram=test-secret', 'явный публичный URL webhook');
});

check('delete отключает webhook без раскрытия токена', () => {
  const { context, calls } = loadGs({ db });
  const result = context.deleteTelegramWebhook();
  eq(result, undefined, 'delete не возвращает ответ Bot API');
  eq(calls.urlFetch.length, 1, 'один вызов Bot API');
  eq(calls.urlFetch[0].url, 'https://api.telegram.org/bottest-token/deleteWebhook', 'метод deleteWebhook');
  eq(calls.urlFetch[0].options.payload, '{}', 'пустой payload');
  eq(calls.urlFetch.filter(call => call.log).length, 0, 'delete ничего не печатает');
});

check('polling setup отключает webhook и создаёт один минутный триггер', () => {
  const triggers = [];
  const { context, calls } = loadGs({ db, triggers });
  context.setupTelegramPolling();
  eq(calls.urlFetch[0].url, 'https://api.telegram.org/bottest-token/deleteWebhook', 'webhook отключён');
  eq(triggers.length, 1, 'один триггер');
  eq(triggers[0].handlerFunction, 'pollTelegramUpdates', 'обработчик polling');
  eq(triggers[0].minutes, 1, 'интервал минуты');
  context.setupTelegramPolling();
  eq(triggers.length, 1, 'повторный setup не дублирует триггер');
});

check('polling обрабатывает сообщения и продвигает offset', () => {
  const update = { update_id: 100, message: { message_id: 1, from: { id: 42 }, chat: { id: 42, type: 'private' }, text: '/start' } };
  const { context, state, calls } = loadGs({ db, telegramResponses: { getUpdates: [update] } });
  context.pollTelegramUpdates();
  eq(state.properties.TELEGRAM_UPDATE_OFFSET, '101', 'следующий offset');
  const payload = JSON.parse(calls.urlFetch[0].options.payload);
  eq(payload.offset, 0, 'первый запуск без смещения');
  eq(payload.allowed_updates.join(','), 'message,callback_query', 'типы обновлений');
  const reply = sentPayload(calls, 1);
  eq(reply.text, 'Выберите шаблон:', 'ответ на /start');
  eq(reply.reply_markup.is_persistent, true, 'постоянная клавиатура');
});

check('polling после ошибки повторяет update и подтверждает только после успеха', () => {
  let fail = true;
  const update = { update_id: 100, message: { message_id: 1, from: { id: 42 }, chat: { id: 42, type: 'private' }, text: '/start' } };
  const { context, state, calls } = loadGs({
    db,
    properties: { TELEGRAM_UPDATE_OFFSET: '100' },
    telegramResponses: { getUpdates: [update] },
    failTelegram: method => fail && method === 'sendMessage',
  });
  let threw = false;
  try { context.pollTelegramUpdates(); } catch (_) { threw = true; }
  eq(threw, true, 'ошибка отправки видна триггеру');
  eq(state.properties.TELEGRAM_UPDATE_OFFSET, '100', 'offset не продвинут после ошибки');
  fail = false;
  context.pollTelegramUpdates();
  eq(state.properties.TELEGRAM_UPDATE_OFFSET, '101', 'offset после успешной обработки');
  eq(calls.urlFetch.filter(call => call.url.endsWith('/sendMessage')).length, 2, 'одна повторная отправка');
});

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

function expenseFixture() {
  return {
    categories: ['Еда', 'Такси'],
    catIds: ['c1', 'c2'],
    templates: [{ id: 't1', name: 'Кофе', amount: 12.5, cat: 0, catId: 'c1', comment: 'Латте', oneoff: true }],
    expenses: [],
  };
}

check('расход из шаблона сохраняет копейки, категорию и московскую дату', () => {
  const expenseDb = expenseFixture();
  const now = new Date('2026-11-12T21:30:00Z');
  const { context } = loadGs({ db: expenseDb, now });
  const rec = context._telegramExpenseFromTemplate(expenseDb.templates[0], expenseDb, now);
  eq(rec.cat, 0, 'позиция категории');
  eq(rec.catId, 'c1', 'постоянный id категории');
  eq(rec.amount, 12.5, 'сумма без округления');
  eq(rec.date, '2026-11-13', 'дата Europe/Moscow');
  eq(rec.comment, 'Кофе: Латте', 'комментарий');
  eq(rec.oneoff, true, 'разовый расход');
  eq(rec.source, 'telegram', 'источник записи');
  eq(typeof rec.id, 'string', 'строковый id');
  eq(rec.id, 'uuid-1', 'id из Utilities.getUuid');
  eq(rec.updatedAt > 0, true, 'время изменения');
});

check('legacy special и пустой комментарий соответствуют addFromTemplate', () => {
  const expenseDb = expenseFixture();
  const template = { ...expenseDb.templates[0], catId: undefined, comment: '', oneoff: null, special: true };
  const { context } = loadGs({ db: expenseDb, now: '2026-11-12T21:30:00Z' });
  const legacy = context._telegramExpenseFromTemplate(template, expenseDb, new Date('2026-11-12T21:30:00Z'));
  eq(legacy.catId, 'c1', 'catId из текущего справочника');
  eq(legacy.comment, 'Кофе', 'название без двоеточия');
  eq(legacy.oneoff, true, 'legacy special');
  const regular = context._telegramExpenseFromTemplate({ ...template, special: false }, expenseDb, new Date('2026-11-12T21:30:00Z'));
  eq(regular.oneoff, null, 'обычный расход');
  const obligatoryDb = { ...expenseDb, catOblig: { c1: true } };
  const obligatory = context._telegramExpenseFromTemplate(template, obligatoryDb, new Date('2026-11-12T21:30:00Z'));
  eq(obligatory.oneoff, null, 'legacy special игнорируется в обязательной категории');
});

check('кнопка шаблона пишет расход и шлёт клавиатуру и отмену отдельно', () => {
  const { context, state, calls } = loadGs({ db: expenseFixture(), now: '2026-11-12T21:30:00Z' });
  context._telegramHandleMessage(message('Кофе — 12,50 ₽'));
  eq(state.db.expenses.length, 1, 'расход сохранён на Drive');
  eq(state.db.expenses[0].source, 'telegram', 'источник сохранённой записи');
  eq(state.db.expenses[0].date, '2026-11-13', 'дата сохранённой записи');
  eq(calls.urlFetch.length, 2, 'два отдельных sendMessage');
  const keyboard = sentPayload(calls, 0);
  eq(keyboard.reply_markup.is_persistent, true, 'свежая постоянная клавиатура');
  eq(keyboard.reply_markup.keyboard[0][0].text, 'Кофе — 12,50 ₽', 'актуальный шаблон');
  const confirmation = sentPayload(calls, 1);
  eq(confirmation.text.includes('Кофе'), true, 'название в подтверждении');
  eq(confirmation.text.includes('12,50'), true, 'сумма в подтверждении');
  eq(confirmation.reply_markup.inline_keyboard[0][0].callback_data, 'undo:' + state.db.expenses[0].id, 'callback отмены');
  eq(confirmation.reply_markup.keyboard, undefined, 'без смешения типов markup');
});

check('повтор message_id не дублирует расход, новый message_id создаёт второй', () => {
  const { context, state, calls } = loadGs({ db: expenseFixture(), now: '2026-11-12T21:30:00Z' });
  const key = 'message:42:1';
  state.properties['message:42:old'] = '0';
  context._telegramHandleMessage(message('Кофе — 12,50 ₽'));
  eq(state.db.expenses.length, 1, 'первая запись');
  eq(state.cache[key], '1', 'done-маркер Cache');
  eq(calls.cache.find(call => call.key === key).expirationInSeconds, 600, 'TTL Cache');
  eq(Number(state.properties[key]), Date.parse('2026-11-12T21:30:00Z'), 'done-маркер Properties');
  eq(state.properties['message:42:old'], undefined, 'устаревшие ключи очищены');
  delete state.cache[key];
  context._telegramHandleMessage(message('Кофе — 12,50 ₽'));
  eq(state.db.expenses.length, 1, 'Properties тоже блокирует повтор');
  eq(calls.urlFetch.length, 2, 'повтор не шлёт второе подтверждение');
  context._telegramHandleMessage(message('Кофе — 12,50 ₽', { message_id: 2 }));
  eq(state.db.expenses.length, 2, 'новое нажатие создаёт второй расход');
  eq(calls.urlFetch.length, 4, 'два подтверждения для двух нажатий');
  eq(state.db.expenses[0].id === state.db.expenses[1].id, false, 'разные id расходов');
});

check('ошибка Drive не оставляет done-маркер и допускает повтор', () => {
  let failWrite = true;
  const { context, state, calls } = loadGs({
    db: expenseFixture(),
    now: '2026-11-12T21:30:00Z',
    failWrite: () => failWrite,
  });
  const key = 'message:42:1';
  context._telegramHandleMessage(message('Кофе — 12,50 ₽'));
  eq(state.db.expenses.length, 0, 'запись не сохранена');
  eq(calls.urlFetch.length, 1, 'только сообщение об ошибке');
  const failure = sentPayload(calls);
  eq(failure.text.includes('повтор'), true, 'просьба повторить позже');
  eq(failure.reply_markup && failure.reply_markup.inline_keyboard, undefined, 'нет кнопки отмены');
  eq(state.cache[key], undefined, 'нет done-маркера Cache');
  eq(state.properties[key], undefined, 'нет done-маркера Properties');
  failWrite = false;
  context._telegramHandleMessage(message('Кофе — 12,50 ₽'));
  eq(state.db.expenses.length, 1, 'повторная доставка записана');
  eq(calls.urlFetch.length, 3, 'после повтора клавиатура и подтверждение');
});

const messageMarkerFailures = [
  { name: 'Cache', option: 'failCachePut' },
  { name: 'Properties', option: 'failPropertySet' },
];
for (const failure of messageMarkerFailures) {
  check('сбой done-маркера ' + failure.name + ' не дублирует расход при повторе', () => {
    let fail = true;
    const { context, state, calls } = loadGs({
      db: expenseFixture(),
      now: '2026-11-12T21:30:00Z',
      [failure.option]: key => fail && key === 'message:42:1',
    });
    const key = 'message:42:1';
    context._telegramHandleMessage(message('Кофе — 12,50 ₽'));
    eq(state.db.expenses.length, 1, 'Drive-запись уже выполнена');
    const committedId = state.db.expenses[0].id;
    eq(calls.urlFetch.length, 1, 'только сообщение об ошибке маркера');
    eq(sentPayload(calls).text.includes('повтор'), true, 'просьба повторить позже');
    eq(state.cache[key], undefined, 'частичный Cache-маркер удалён');
    eq(state.properties[key], undefined, 'частичный Properties-маркер удалён');

    fail = false;
    context._telegramHandleMessage(message('Кофе — 12,50 ₽'));
    eq(state.db.expenses.length, 1, 'повтор не создаёт второй расход');
    eq(state.db.expenses[0].id, committedId, 'повтор использует committed id');
    eq(calls.drive.filter(call => call.method === 'setContent').length, 1, 'Drive перезаписан только один раз');
    eq(calls.urlFetch.length, 3, 'повтор восстанавливает клавиатуру и подтверждение');
  });
}

for (const notification of ['keyboard', 'confirmation']) {
  check('сбой sendMessage (' + notification + ') восстанавливается повтором без записи Drive', () => {
    let fail = true;
    const { context, state, calls } = loadGs({
      db: expenseFixture(),
      now: '2026-11-12T21:30:00Z',
      failTelegram: (method, payload) => fail && method === 'sendMessage' &&
        (notification === 'keyboard'
          ? payload.text === 'Выберите шаблон:'
          : payload.text.indexOf('Добавлен расход:') === 0),
    });
    const first = JSON.parse(post(context, { message: message('Кофе — 12,50 ₽') }).getData());
    eq(typeof first.error, 'string', 'первый webhook сообщает об ошибке Telegram');
    eq(state.db.expenses.length, 1, 'расход уже сохранён');
    const committed = JSON.stringify(state.db);
    const committedId = state.db.expenses[0].id;

    fail = false;
    const retry = JSON.parse(post(context, { message: message('Кофе — 12,50 ₽') }).getData());
    eq(retry.ok, true, 'повторный webhook успешен');
    eq(JSON.stringify(state.db), committed, 'повтор не перезаписывает расход');
    eq(calls.drive.filter(call => call.method === 'setContent').length, 1, 'Drive не перезаписан повтором');
    eq(calls.urlFetch.length, 3, 'повтор отправляет только недоставленные уведомления');
    const confirmation = sentPayload(calls, calls.urlFetch.length - 1);
    eq(confirmation.text.indexOf('Добавлен расход:'), 0, 'подтверждение восстановлено');
    eq(confirmation.reply_markup.inline_keyboard[0][0].callback_data, 'undo:' + committedId, 'восстановлена отмена committed id');
  });
}

check('одинаковые подписи активных шаблонов не создают неоднозначный расход', () => {
  const fixture = expenseFixture();
  fixture.templates.push({
    ...fixture.templates[0], id: 't2', cat: 1, catId: 'c2', comment: 'Другой комментарий', oneoff: false,
  });
  const { context, state, calls } = loadGs({ db: fixture });
  context._telegramHandleMessage(message('Кофе — 12,50 ₽'));
  eq(state.db.expenses.length, 0, 'неоднозначная кнопка ничего не записывает');
  eq(calls.urlFetch.length, 1, 'только просьба устранить неоднозначность');
  const payload = sentPayload(calls);
  eq(payload.text.includes('одинаков'), true, 'объяснение неоднозначности');
  eq(payload.reply_markup.keyboard.length > 0, true, 'свежая клавиатура возвращена');
});

check('изменение шаблона между выбором и блокировкой отменяет запись', () => {
  let harness;
  let mutate = true;
  harness = loadGs({
    db: expenseFixture(),
    onLockWait() {
      if (!mutate) return;
      mutate = false;
      const changed = harness.state.db;
      changed.templates[0].amount = 99;
      harness.state.files['file-1'].content = JSON.stringify(changed);
    },
  });
  harness.context._telegramHandleMessage(message('Кофе — 12,50 ₽'));
  eq(harness.state.db.expenses.length, 0, 'устаревший выбор не создаёт расход');
  eq(harness.calls.urlFetch.length, 1, 'только свежая клавиатура');
  const payload = sentPayload(harness.calls);
  eq(payload.reply_markup.keyboard[0][0].text, 'Кофе — 99 ₽', 'клавиатура отражает изменённый шаблон');
});

check('пустая клавиатура предлагает создать шаблоны в приложении', () => {
  const { context, calls } = loadGs({ db: { templates: [], expenses: [] } });
  context._telegramHandleMessage(message('/start'));
  const payload = sentPayload(calls);
  eq(payload.text.includes('Создайте шаблоны в приложении'), true, 'инструкция для пустого списка');
  eq(payload.reply_markup.keyboard.length, 0, 'клавиатура остаётся пустой');
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

check('callback отменяет только bot-расход и идемпотентен', () => {
  let now = Date.parse('2026-11-12T21:30:00Z');
  const fixture = expenseFixture();
  fixture.expenses.push({ id: 'client300', amount: 300, updatedAt: 300 });
  const { context, state, calls } = loadGs({ db: fixture, now: () => now });
  context._telegramHandleMessage(message('Кофе — 12,50 ₽'));
  const rec = state.db.expenses.find(e => e.source === 'telegram');
  const callback = {
    id: 'cb-undo',
    from: { id: 42 },
    message: { message_id: 77, chat: { id: 42, type: 'private' } },
    data: 'undo:' + rec.id,
  };

  const beforeForeign = JSON.stringify(state.db);
  post(context, { callback_query: {
    ...callback,
    id: 'cb-foreign',
    from: { id: 43 },
    message: { message_id: 77, chat: { id: 43, type: 'private' } },
  } });
  eq(JSON.stringify(state.db), beforeForeign, 'чужой callback не меняет DB');
  eq(calls.urlFetch.length, 2, 'чужой callback не имеет побочных эффектов');

  now += 1000;
  post(context, { callback_query: callback });
  const undone = state.db.expenses.find(e => e.id === rec.id);
  eq(undone._deleted, true, 'мягкое удаление');
  eq(undone.amount, 0, 'сумма обнулена');
  eq(undone.updatedAt, now, 'новый updatedAt');
  eq(state.cache['callback:cb-undo'], '1', 'done-маркер callback в Cache');
  eq(Number(state.properties['callback:cb-undo']), now, 'done-маркер callback в Properties');
  eq(calls.cache.find(call => call.key === 'callback:cb-undo').expirationInSeconds, 600, 'TTL callback');
  eq(calls.urlFetch.length, 4, 'ответ на callback и редактирование сообщения');
  eq(calls.urlFetch[2].url, 'https://api.telegram.org/bottest-token/answerCallbackQuery', 'answerCallbackQuery');
  const answer = JSON.parse(calls.urlFetch[2].options.payload);
  eq(answer.callback_query_id, 'cb-undo', 'id отвеченного callback');
  eq(calls.urlFetch[3].url, 'https://api.telegram.org/bottest-token/editMessageText', 'editMessageText');
  const edit = JSON.parse(calls.urlFetch[3].options.payload);
  eq(edit.chat_id, 42, 'чат редактируемого подтверждения');
  eq(edit.message_id, 77, 'сообщение редактируемого подтверждения');
  eq(edit.text.includes('Отмен'), true, 'подтверждение отмены');
  eq(!edit.reply_markup || !edit.reply_markup.inline_keyboard || edit.reply_markup.inline_keyboard.length === 0,
    true, 'inline-кнопка удалена');

  const afterUndo = JSON.stringify(state.db);
  now += 1000;
  post(context, { callback_query: callback });
  eq(JSON.stringify(state.db), afterUndo, 'повтор callback не меняет updatedAt и DB');
  eq(calls.urlFetch.length, 4, 'повтор callback не имеет побочных эффектов');

  const beforeClient = JSON.stringify(state.db);
  post(context, { callback_query: { ...callback, id: 'cb-client', data: 'undo:client300' } });
  eq(JSON.stringify(state.db), beforeClient, 'обычная клиентская запись не изменена');
  eq(calls.urlFetch.length, 5, 'ошибка отмены отвечает на callback');
  eq(calls.urlFetch[4].url, 'https://api.telegram.org/bottest-token/answerCallbackQuery', 'ответ на отказ отмены');
  const rejected = JSON.parse(calls.urlFetch[4].options.payload);
  eq(rejected.callback_query_id, 'cb-client', 'id отклонённого callback');
  eq(typeof rejected.text, 'string', 'текст ошибки отмены');
});

check('не-force push сохраняет bot-записи по id и updatedAt', () => {
  const current = { expenses: [
    { id: 'add100', amount: 100, updatedAt: 100, source: 'telegram' },
    { id: 'del200', amount: 0, _deleted: true, updatedAt: 200, source: 'telegram' },
    { id: 'client300', amount: 300, updatedAt: 300 },
  ] };
  const incoming = { expenses: [
    { id: 'del200', amount: 0, _deleted: true, updatedAt: 150, source: 'telegram' },
    { id: 'client300', amount: 300, updatedAt: 300 },
  ] };
  const { context, state } = loadGs({ db: current });
  const result = context.saveData(JSON.stringify(incoming), false);
  eq(result.ok, true, 'не-force push принят');
  const merged = state.db;
  eq(merged.expenses.filter(e => e.id === 'add100').length, 1, 'старый push не теряет bot add');
  eq(merged.expenses.find(e => e.id === 'del200').updatedAt, 200, 'новая отмена бота побеждает');
  eq(merged.expenses.find(e => e.id === 'client300').source, undefined, 'обычные записи не смешиваем');

  const newer = loadGs({ db: { expenses: [
    { id: 'add200', amount: 200, updatedAt: 200, source: 'telegram' },
  ] } });
  newer.context.saveData(JSON.stringify({ expenses: [
    { id: 'add200', amount: 0, _deleted: true, updatedAt: 250, source: 'telegram' },
  ] }), false);
  const winner = newer.state.db.expenses.find(e => e.id === 'add200');
  eq(winner._deleted, true, 'входящий tombstone с updatedAt 250 побеждает bot add 200');
  eq(winner.updatedAt, 250, 'updatedAt входящего tombstone');
});

check('force-restore не подмешивает текущие bot-записи', () => {
  const { context, state } = loadGs({ db: { expenses: [
    { id: 'add100', amount: 100, updatedAt: 100, source: 'telegram' },
  ] } });
  const incoming = { expenses: [{ id: 'client300', amount: 300, updatedAt: 300 }] };
  const result = context.saveData(JSON.stringify(incoming), true);
  eq(result.ok, true, 'force-restore принят');
  eq(state.db.expenses.length, 1, 'force оставляет только входящий payload');
  eq(state.db.expenses[0].id, 'client300', 'текущий bot-расход не восстановлен');
});

function undoCallback(id, data) {
  return {
    id,
    from: { id: 42 },
    message: { message_id: 77, chat: { id: 42, type: 'private' }, text: 'Добавлен расход: Кофе — 100 ₽' },
    data,
  };
}

function undoDb() {
  return { expenses: [
    { id: 'bot100', amount: 100, updatedAt: 100, source: 'telegram' },
    { id: 'deleted200', amount: 0, _deleted: true, updatedAt: 200, source: 'telegram' },
    { id: 'client300', amount: 300, updatedAt: 300 },
  ] };
}

const terminalCallbacks = [
  { name: 'malformed', data: 'not-undo' },
  { name: 'nonexistent', data: 'undo:missing' },
  { name: 'client', data: 'undo:client300' },
  { name: 'deleted', data: 'undo:deleted200' },
];
for (const scenario of terminalCallbacks) {
  check('terminal callback дедуплицируется: ' + scenario.name, () => {
    const { context, state, calls } = loadGs({ db: undoDb(), now: 1000 });
    const callback = undoCallback('cb-' + scenario.name, scenario.data);
    const before = JSON.stringify(state.db);
    post(context, { callback_query: callback });
    eq(calls.urlFetch.length, 1, 'первый terminal callback получил ответ');
    eq(state.cache['callback:cb-' + scenario.name], '1', 'terminal marker Cache');
    eq(Number(state.properties['callback:cb-' + scenario.name]), 1000, 'terminal marker Properties');
    post(context, { callback_query: callback });
    eq(calls.urlFetch.length, 1, 'повтор terminal callback не имеет побочных эффектов');
    eq(JSON.stringify(state.db), before, 'terminal callback не меняет DB');
  });
}

const undoWriteFailures = [
  { name: 'Cache', option: 'failCachePut' },
  { name: 'Properties', option: 'failPropertySet' },
  { name: 'Drive', option: 'failWrite' },
];
for (const failure of undoWriteFailures) {
  check('сбой ' + failure.name + ' не оставляет частичную отмену и допускает retry', () => {
    let fail = true;
    const { context, state, calls } = loadGs({
      db: undoDb(),
      now: 1000,
      [failure.option]: failure.option === 'failPropertySet'
        ? key => fail && key === 'callback:cb-retry'
        : () => fail,
    });
    const callback = undoCallback('cb-retry', 'undo:bot100');
    const before = JSON.stringify(state.db);
    post(context, { callback_query: callback });
    eq(JSON.stringify(state.db), before, 'DB не изменена после сбоя ' + failure.name);
    eq(state.cache['callback:cb-retry'], undefined, 'частичный Cache-маркер удалён');
    eq(state.properties['callback:cb-retry'], undefined, 'частичный Properties-маркер удалён');
    eq(calls.urlFetch.length, 1, 'только честный ответ об ошибке');
    eq(JSON.parse(calls.urlFetch[0].options.payload).text.includes('повтор'), true, 'ответ предлагает retry');

    fail = false;
    post(context, { callback_query: callback });
    const rec = state.db.expenses.find(e => e.id === 'bot100');
    eq(rec._deleted, true, 'retry сохраняет tombstone');
    eq(rec.amount, 0, 'retry обнуляет сумму');
    eq(state.cache['callback:cb-retry'], '1', 'retry сохраняет marker');
    eq(calls.urlFetch.length, 3, 'retry отвечает и обновляет подтверждение');
    eq(calls.urlFetch[2].url.endsWith('/editMessageText'), true, 'retry убирает кнопку через editMessageText');
  });
}

check('равный updatedAt не воскрешает текущий bot tombstone', () => {
  const { context, state } = loadGs({ db: { expenses: [
    { id: 'del200', amount: 0, _deleted: true, updatedAt: 200, source: 'telegram' },
  ] } });
  context.saveData(JSON.stringify({ expenses: [
    { id: 'del200', amount: 200, updatedAt: 200, source: 'telegram' },
  ] }), false);
  eq(state.db.expenses[0]._deleted, true, 'при tie остаётся текущий tombstone');
  eq(state.db.expenses[0].amount, 0, 'сумма tombstone не восстановлена');
});

check('undo в ту же миллисекунду увеличивает updatedAt', () => {
  const fixture = undoDb();
  fixture.expenses[0].updatedAt = 1000;
  const { context, state } = loadGs({ db: fixture, now: 1000 });
  post(context, { callback_query: undoCallback('cb-same-ms', 'undo:bot100') });
  eq(state.db.expenses[0].updatedAt, 1001, 'updatedAt строго больше прежнего значения');
  eq(state.db.expenses[0]._deleted, true, 'tombstone сохранён');
});

for (const method of ['answerCallbackQuery', 'editMessageText']) {
  check('сбой Telegram ' + method + ' сохраняет tombstone и idempotency, но возвращает ошибку', () => {
    const { context, state, calls } = loadGs({
      db: undoDb(),
      now: 1000,
      failTelegram: called => called === method,
    });
    const callback = undoCallback('cb-api-' + method, 'undo:bot100');
    const response = JSON.parse(post(context, { callback_query: callback }).getData());
    eq(typeof response.error, 'string', 'webhook не сообщает успех при сбое ' + method);
    eq(response.error.includes(method), true, 'ошибка называет failed Bot API method');
    const rec = state.db.expenses.find(e => e.id === 'bot100');
    eq(rec._deleted, true, 'durable tombstone сохранён');
    eq(rec.amount, 0, 'durable сумма сохранена');
    eq(state.cache['callback:cb-api-' + method], '1', 'idempotency marker сохранён');
    eq(Number(state.properties['callback:cb-api-' + method]), 1000, 'Properties marker сохранён');
    const after = JSON.stringify(state.db);
    const callCount = calls.urlFetch.length;
    const retry = JSON.parse(post(context, { callback_query: callback }).getData());
    eq(retry.ok, true, 'повтор обработан как уже завершённый');
    eq(calls.urlFetch.length, callCount, 'повтор не вызывает Telegram после post-commit сбоя');
    eq(JSON.stringify(state.db), after, 'повтор не меняет durable tombstone');
  });
}

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

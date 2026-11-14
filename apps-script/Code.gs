// ===== BUDGET TRACKER APPS SCRIPT v10.5 — Drive Storage =====
// Деплой: Расширения → Apps Script → Развернуть → Новое развертывание
// Тип: Веб-приложение | Выполнять как: Я | Доступ: Все
// Данные хранятся в файле nto_data.json в Google Drive (не в таблице)
//
// SECRET: оставь пустым — проверки нет (как раньше). Задай строку —
// и тот же секрет нужно ввести в приложении (Настройки → Google Drive).
// Защищает данные, если URL веб-приложения утечёт.

const FILE_DATA = 'nto_data.json';
const SECRET = '';
// Версия скрипта уходит в каждом JSON-ответе (v10.5): приложение сверяет её со
// своей и в Настройках подсказывает, что скрипт пора переразвернуть.
const VERSION = '10.5';
const BAK_PREFIX = 'nto_data.bak.';   // nto_data.bak.YYYY-MM-DD.json
const BAK_KEEP = 7;                    // суточных копий храним столько

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.message || body.callback_query) {
      const p = e.parameter || {};
      const props = PropertiesService.getScriptProperties();
      if (p.telegram !== props.getProperty('TELEGRAM_WEBHOOK_SECRET')) return out({ ok: true });
      const update = body.message || body.callback_query;
      const chat = body.message ? update.chat : update.message && update.message.chat;
      if (!_telegramAllowed(update.from, chat)) return out({ ok: true });
      if (body.message) _telegramHandleMessage(body.message);
      else _telegramUndo(body.callback_query);
      return out({ ok: true });
    }
    if (SECRET && body.token !== SECRET) return out({ error: 'Unauthorized' });
    const action = body.action || '';
    if (action === 'ping') return out({ ok: true });
    if (action === 'push') return out(saveData(JSON.stringify(body.data || {}), !!body.force));
    if (action === 'pull') return readData(body.hash);
    if (action === 'listBackups') return out(listBackups());
    if (action === 'readBackup') return readBackup(body.data && body.data.id);
    return out({ error: 'Unknown action: ' + action });
  } catch(err) {
    return out({ error: err.message });
  }
}

function _telegramApi(method, payload) {
  const token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  const response = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/' + method, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  return JSON.parse(response.getContentText());
}

function _telegramTemplateLabel(template) {
  const value = Number(template.amount) || 0;
  const amount = Number.isInteger(value) ? String(value) : value.toFixed(2).replace('.', ',');
  return template.name + ' — ' + amount + ' ₽';
}

function _telegramKeyboard(db, page) {
  const templates = (db.templates || []).filter(function(t) { return !t._deleted; });
  const pageCount = Math.max(1, Math.ceil(templates.length / 10));
  page = Math.min(Math.max(Math.floor(Number(page) || 0), 0), pageCount - 1);
  const rows = [];
  const visible = templates.slice(page * 10, page * 10 + 10);
  for (let i = 0; i < visible.length; i += 2) {
    const row = [{ text: _telegramTemplateLabel(visible[i]) }];
    if (visible[i + 1]) row.push({ text: _telegramTemplateLabel(visible[i + 1]) });
    rows.push(row);
  }
  const navigation = [];
  if (page > 0) navigation.push({ text: 'Назад ' + page + '/' + pageCount });
  if (page < pageCount - 1) navigation.push({ text: 'Ещё ' + (page + 2) + '/' + pageCount });
  if (navigation.length) rows.push(navigation);
  return { keyboard: rows, resize_keyboard: true, is_persistent: true, one_time_keyboard: false };
}

function _telegramAllowed(from, chat) {
  if (!from || !chat || chat.type !== 'private') return false;
  const allowed = PropertiesService.getScriptProperties().getProperty('TELEGRAM_ALLOWED_USER_ID');
  return String(from.id) === String(allowed);
}

function _telegramExpenseFromTemplate(template, db, now) {
  const catId = (db.catIds || [])[template.cat];
  const obligatory = !!(catId && db.catOblig && db.catOblig[catId]);
  const oneoff = !!template.oneoff || (!!template.special && !obligatory);
  return {
    id: Utilities.getUuid(),
    cat: template.cat,
    catId: template.catId || catId,
    amount: template.amount,
    date: Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    comment: template.comment ? template.name + ': ' + template.comment : template.name,
    oneoff: oneoff ? true : null,
    updatedAt: now.getTime(),
    source: 'telegram',
  };
}

function _telegramAddTemplate(message, template) {
  const key = 'message:' + message.chat.id + ':' + message.message_id;
  const lock = LockService.getScriptLock();
  const cache = CacheService.getScriptCache();
  const props = PropertiesService.getScriptProperties();
  let db;
  let rec;
  try {
    lock.waitLock(10000);
    const now = new Date();
    const all = props.getProperties();
    Object.keys(all).forEach(function(name) {
      if ((name.indexOf('message:') === 0 || name.indexOf('callback:') === 0) &&
          now.getTime() - Number(all[name]) >= 24 * 3600 * 1000) {
        props.deleteProperty(name);
      }
    });
    if (cache.get(key) || props.getProperty(key)) return null;
    const file = getDataFile();
    db = file ? JSON.parse(file.getBlob().getDataAsString()) : { templates: [], expenses: [] };
    if (!db.expenses) db.expenses = [];
    rec = _telegramExpenseFromTemplate(template, db, now);
    db.expenses.push(rec);
    const content = JSON.stringify(db);
    if (file) {
      backupIfDue(file);
      file.setContent(content);
    } else {
      const created = DriveApp.createFile(FILE_DATA, content, MimeType.PLAIN_TEXT);
      props.setProperty('dataFileId', created.getId());
    }
    try {
      cache.put(key, '1', 600);
      props.setProperty(key, String(now.getTime()));
    } catch(err) {
      try { cache.remove(key); } catch(_) {}
      try { props.deleteProperty(key); } catch(_) {}
      throw err;
    }
  } catch(err) {
    _telegramApi('sendMessage', {
      chat_id: message.chat.id,
      text: 'Не удалось сохранить расход. Попробуйте повторить позже.',
    });
    return null;
  } finally {
    try { lock.releaseLock(); } catch(_) {}
  }
  _telegramApi('sendMessage', {
    chat_id: message.chat.id,
    text: 'Выберите шаблон:',
    reply_markup: _telegramKeyboard(db, 0),
  });
  _telegramApi('sendMessage', {
    chat_id: message.chat.id,
    text: 'Добавлен расход: ' + _telegramTemplateLabel(template),
    reply_markup: { inline_keyboard: [[{ text: 'Отменить', callback_data: 'undo:' + rec.id }]] },
  });
  return rec;
}

function _telegramUndo(callbackQuery) {
  const message = callbackQuery.message || {};
  if (!_telegramAllowed(callbackQuery.from, message.chat)) return;
  const data = String(callbackQuery.data || '');
  if (data.indexOf('undo:') !== 0 || !data.slice(5)) {
    _telegramApi('answerCallbackQuery', {
      callback_query_id: callbackQuery.id,
      text: 'Некорректная отмена расхода.',
    });
    return;
  }
  const id = data.slice(5);
  const key = 'callback:' + callbackQuery.id;
  const lock = LockService.getScriptLock();
  const cache = CacheService.getScriptCache();
  const props = PropertiesService.getScriptProperties();
  let outcome = 'duplicate';
  try {
    lock.waitLock(10000);
    const now = new Date();
    const all = props.getProperties();
    Object.keys(all).forEach(function(name) {
      if ((name.indexOf('message:') === 0 || name.indexOf('callback:') === 0) &&
          now.getTime() - Number(all[name]) >= 24 * 3600 * 1000) {
        props.deleteProperty(name);
      }
    });
    if (cache.get(key) || props.getProperty(key)) return;
    const file = getDataFile();
    const db = file ? JSON.parse(file.getBlob().getDataAsString()) : { expenses: [] };
    const rec = (db.expenses || []).find(function(e) { return e.id === id; });
    if (!rec || rec.source !== 'telegram') {
      outcome = 'invalid';
    } else if (rec._deleted) {
      outcome = 'deleted';
    } else {
      rec._deleted = true;
      rec.amount = 0;
      rec.updatedAt = now.getTime();
      backupIfDue(file);
      file.setContent(JSON.stringify(db));
      try {
        cache.put(key, '1', 600);
        props.setProperty(key, String(now.getTime()));
      } catch(err) {
        try { cache.remove(key); } catch(_) {}
        try { props.deleteProperty(key); } catch(_) {}
        throw err;
      }
      outcome = 'ok';
    }
  } catch(err) {
    outcome = 'error';
  } finally {
    try { lock.releaseLock(); } catch(_) {}
  }
  if (outcome === 'ok') {
    _telegramApi('answerCallbackQuery', {
      callback_query_id: callbackQuery.id,
      text: 'Расход отменён.',
    });
    _telegramApi('editMessageText', {
      chat_id: message.chat.id,
      message_id: message.message_id,
      text: 'Отменено: ' + String(message.text || 'Расход'),
      reply_markup: { inline_keyboard: [] },
    });
  } else if (outcome !== 'duplicate') {
    _telegramApi('answerCallbackQuery', {
      callback_query_id: callbackQuery.id,
      text: outcome === 'error' ? 'Не удалось отменить расход. Попробуйте повторить позже.' :
        outcome === 'deleted' ? 'Этот расход уже отменён.' : 'Можно отменить только расход, добавленный ботом.',
    });
  }
}

function _telegramHandleMessage(message) {
  let db;
  try {
    const file = getDataFile();
    db = file ? JSON.parse(file.getBlob().getDataAsString()) : { templates: [], expenses: [] };
  } catch(err) {
    _telegramApi('sendMessage', {
      chat_id: message.chat.id,
      text: 'Не удалось прочитать данные. Попробуйте повторить позже.',
    });
    return;
  }
  const text = String(message.text || '');
  const navigation = text.match(/^(Ещё|Назад) (\d+)\/(\d+)$/);
  const template = (db.templates || []).find(function(t) {
    return !t._deleted && _telegramTemplateLabel(t) === text;
  });
  if (template) {
    _telegramAddTemplate(message, template);
    return;
  }
  let page = 0;
  let reply = 'Выберите шаблон кнопкой ниже.';
  if (text === '/start' || navigation) reply = 'Выберите шаблон:';
  if (navigation) page = Number(navigation[2]) - 1;
  _telegramApi('sendMessage', {
    chat_id: message.chat.id,
    text: reply,
    reply_markup: _telegramKeyboard(db, page),
  });
}

function doGet(e) {
  const p = e.parameter || {};
  if (SECRET && p.token !== SECRET) return out({ error: 'Unauthorized' });
  const action = p.action || '';
  if (action === 'ping') return out({ ok: true });
  if (action === 'pull') return readData(p.hash);
  return out({ info: 'Budget Tracker API v' + VERSION });
}

// Файл ищем по сохранённому ID (стабильно), имя — только как fallback.
// getFilesByName может вернуть дубликат, если гонка двух push создала второй файл.
function getDataFile() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('dataFileId');
  if (id) {
    try {
      const f = DriveApp.getFileById(id);
      if (!f.isTrashed()) return f;
    } catch(_) {}
  }
  const it = DriveApp.getFilesByName(FILE_DATA);
  while (it.hasNext()) {
    const f = it.next();
    if (!f.isTrashed()) {
      props.setProperty('dataFileId', f.getId());
      return f;
    }
  }
  return null;
}

function _mergeTelegramExpenses(currentDb, incomingDb) {
  const merged = Object.assign({}, incomingDb);
  const expenses = (incomingDb.expenses || []).slice();
  const byId = Object.create(null);
  expenses.forEach(function(e, index) {
    if (e.id !== undefined && e.id !== null) byId[e.id] = index;
  });
  ((currentDb && currentDb.expenses) || []).forEach(function(current) {
    if (current.source !== 'telegram' || current.id === undefined || current.id === null) return;
    const index = byId[current.id];
    if (index === undefined) {
      byId[current.id] = expenses.length;
      expenses.push(current);
    } else if ((Number(current.updatedAt) || 0) > (Number(expenses[index].updatedAt) || 0)) {
      expenses[index] = current;
    }
  });
  merged.expenses = expenses;
  return merged;
}

function saveData(content, force) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); // одновременные push с двух устройств — по очереди
    const file = getDataFile();
    if (file) {
      // Страховка от обнулённого клиента: payload сильно меньше файла на Drive —
      // отклоняем. Осознанная перезапись — кнопка «Выгрузить» шлёт force.
      if (!force) {
        const oldSize = file.getSize();
        if (oldSize > 20000 && content.length < oldSize * 0.3) {
          return { error: 'Push отклонён: локальных данных заметно меньше, чем на Drive. Проверьте данные и нажмите «Выгрузить в Drive».' };
        }
        const currentDb = JSON.parse(file.getBlob().getDataAsString());
        const incomingDb = JSON.parse(content);
        content = JSON.stringify(_mergeTelegramExpenses(currentDb, incomingDb));
      }
      backupIfDue(file);
      file.setContent(content);
    } else {
      const created = DriveApp.createFile(FILE_DATA, content, MimeType.PLAIN_TEXT);
      PropertiesService.getScriptProperties().setProperty('dataFileId', created.getId());
    }
    return { ok: true };
  } catch(err) {
    return { error: err.message };
  } finally {
    try { lock.releaseLock(); } catch(_) {}
  }
}

// Раз в сутки перед перезаписью откладываем копию nto_data.bak.YYYY-MM-DD.json,
// старше BAK_KEEP штук — в корзину. До v10.5 копия была одна и перезаписывалась:
// если мусор уехал на Drive вчера, сегодня копия уже была затёрта тем же мусором.
function backupIfDue(file) {
  try {
    const props = PropertiesService.getScriptProperties();
    const last = Number(props.getProperty('lastBakTs') || 0);
    if (Date.now() - last < 24 * 3600 * 1000) return;
    const content = file.getBlob().getDataAsString();
    const day = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const name = BAK_PREFIX + day + '.json';
    const existing = DriveApp.getFilesByName(name);
    if (existing.hasNext()) existing.next().setContent(content);
    else DriveApp.createFile(name, content, MimeType.PLAIN_TEXT);
    props.setProperty('lastBakTs', String(Date.now()));
    const all = backupFiles();
    for (let i = BAK_KEEP; i < all.length; i++) all[i].file.setTrashed(true);
  } catch(_) {}
}

// Копии на Drive, свежие первыми. Старая одиночная nto_data.bak.json (до v10.5)
// тоже в списке — по дате последнего изменения.
function backupFiles() {
  const res = [];
  const it = DriveApp.searchFiles("title contains 'nto_data.bak' and trashed = false");
  while (it.hasNext()) {
    const f = it.next();
    const n = f.getName();
    if (n.indexOf('nto_data.bak') !== 0) continue;
    const m = n.match(/^nto_data\.bak\.(\d{4}-\d{2}-\d{2})\.json$/);
    const date = m ? m[1] : Utilities.formatDate(f.getLastUpdated(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    res.push({ file: f, id: f.getId(), name: n, date: date, size: f.getSize(), legacy: !m });
  }
  res.sort(function(a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
  return res;
}

function listBackups() {
  try {
    return { ok: true, backups: backupFiles().map(function(b) {
      return { id: b.id, name: b.name, date: b.date, size: b.size, legacy: b.legacy };
    }) };
  } catch(err) { return { error: err.message }; }
}

// Содержимое копии по id. Отдаём только файлы с именем копии: id из запроса
// не должен превращать скрипт в читалку произвольных файлов Drive.
function readBackup(id) {
  try {
    if (!id) return out({ error: 'Нет id копии' });
    const f = DriveApp.getFileById(String(id));
    if (f.isTrashed() || f.getName().indexOf('nto_data.bak') !== 0) return out({ error: 'Это не копия данных' });
    return ContentService.createTextOutput(f.getBlob().getDataAsString())
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) { return out({ error: err.message }); }
}

// hash — SHA-256 (hex) содержимого, каким его видел клиент. Совпало — отдаём
// короткое {unchanged:true} вместо всего файла: приложение опрашивает Drive
// каждые 5 минут, и почти всегда там ничего не менялось. (v10.4)
function readData(hash) {
  try {
    const file = getDataFile();
    if (!file) return out({ empty: true });
    const content = file.getBlob().getDataAsString();
    if (hash && sha256Hex(content) === String(hash).toLowerCase()) return out({ unchanged: true });
    return ContentService.createTextOutput(content)
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) { return out({ error: err.message }); }
}

function sha256Hex(str) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
  return bytes.map(function(b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function out(obj) {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) obj.version = VERSION;
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

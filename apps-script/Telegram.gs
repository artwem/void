// ===== TELEGRAM BOT — необязательный модуль Code.gs =====
// Для бота оба файла находятся в одном Apps Script-проекте и глобальном контексте.

function _telegramHandleUpdate(body, p) {
  const props = PropertiesService.getScriptProperties();
  if (p.telegram !== props.getProperty('TELEGRAM_WEBHOOK_SECRET')) return out({ ok: true });
  const update = body.message || body.callback_query;
  const chat = body.message ? update.chat : update.message && update.message.chat;
  if (!_telegramAllowed(update.from, chat)) return out({ ok: true });
  if (body.message) _telegramHandleMessage(body.message);
  else _telegramUndo(body.callback_query);
  return out({ ok: true });
}

function _telegramApi(method, payload) {
  const token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  const response = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/' + method, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const result = JSON.parse(response.getContentText());
  if (!result || result.ok !== true) {
    throw new Error('Telegram API ' + method + ': ' + (result && result.description || 'ok:false'));
  }
  return result;
}

function setupTelegramWebhook() {
  const props = PropertiesService.getScriptProperties();
  const secret = props.getProperty('TELEGRAM_WEBHOOK_SECRET');
  const execUrl = props.getProperty('TELEGRAM_EXEC_URL') || ScriptApp.getService().getUrl();
  const url = execUrl.replace(/\/dev$/, '/exec') + '?telegram=' + encodeURIComponent(secret);
  _telegramApi('setWebhook', { url: url });
}

function deleteTelegramWebhook() {
  _telegramApi('deleteWebhook', {});
}

function disableTelegram() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'pollTelegramUpdates') ScriptApp.deleteTrigger(trigger);
  });
  deleteTelegramWebhook();
}

function setupTelegramPolling() {
  deleteTelegramWebhook();
  const exists = ScriptApp.getProjectTriggers().some(function(trigger) {
    return trigger.getHandlerFunction() === 'pollTelegramUpdates';
  });
  if (!exists) ScriptApp.newTrigger('pollTelegramUpdates').timeBased().everyMinutes(1).create();
}

function pollTelegramUpdates() {
  const props = PropertiesService.getScriptProperties();
  const offset = Number(props.getProperty('TELEGRAM_UPDATE_OFFSET') || 0);
  const updates = _telegramApi('getUpdates', {
    offset: offset,
    timeout: 0,
    allowed_updates: ['message', 'callback_query'],
  }).result || [];
  updates.forEach(function(update) {
    if (update.message) {
      if (_telegramAllowed(update.message.from, update.message.chat)) _telegramHandleMessage(update.message);
    } else if (update.callback_query) {
      const query = update.callback_query;
      if (_telegramAllowed(query.from, query.message && query.message.chat)) _telegramUndo(query);
    }
    props.setProperty('TELEGRAM_UPDATE_OFFSET', String(update.update_id + 1));
  });
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

function _telegramKeyboardSignature(db) {
  return JSON.stringify((db.templates || []).filter(function(t) { return !t._deleted; }).map(function(t) {
    return { id: t.id, name: t.name, cat: t.cat, catId: t.catId, amount: t.amount, comment: t.comment, oneoff: t.oneoff, special: t.special };
  }));
}

function _telegramRememberKeyboard(db) {
  PropertiesService.getScriptProperties().setProperty('TELEGRAM_KEYBOARD_SIGNATURE', _telegramKeyboardSignature(db));
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

function _telegramCleanupMarkers(props, now) {
  const all = props.getProperties();
  Object.keys(all).forEach(function(name) {
    const operation = name.indexOf('operation:message:') === 0;
    if (!operation && name.indexOf('message:') !== 0 && name.indexOf('callback:') !== 0) return;
    let timestamp = Number(all[name]);
    if (operation) {
      try { timestamp = Number(JSON.parse(all[name]).createdAt); } catch(_) { return; }
    }
    if (now.getTime() - timestamp >= 24 * 3600 * 1000) props.deleteProperty(name);
  });
}

function _telegramAddTemplate(message) {
  const key = 'message:' + message.chat.id + ':' + message.message_id;
  const operationKey = 'operation:' + key;
  const lock = LockService.getScriptLock();
  const cache = CacheService.getScriptCache();
  const props = PropertiesService.getScriptProperties();
  let db;
  let rec;
  let operation;
  let outcome = 'error';
  try {
    lock.waitLock(10000);
    const now = new Date();
    _telegramCleanupMarkers(props, now);
    const savedOperation = props.getProperty(operationKey);
    operation = savedOperation ? JSON.parse(savedOperation) : null;
    const notified = operation && operation.committed && operation.notifications &&
      operation.notifications.keyboard && operation.notifications.confirmation;
    if (notified || (!operation && (cache.get(key) || props.getProperty(key)))) return null;

    const file = getDataFile();
    db = file ? JSON.parse(file.getBlob().getDataAsString()) : { templates: [], expenses: [] };
    if (!db.expenses) db.expenses = [];
    rec = operation ? db.expenses.find(function(e) { return e.id === operation.id; }) : null;
    if (rec) {
      operation.committed = true;
    } else if (!operation || !operation.committed) {
      const text = String(message.text || '');
      const matches = (db.templates || []).filter(function(t) {
        return !t._deleted && _telegramTemplateLabel(t) === text;
      });
      if (matches.length !== 1) {
        outcome = matches.length ? 'ambiguous' : 'changed';
      } else {
        rec = _telegramExpenseFromTemplate(matches[0], db, now);
        if (operation) {
          rec.id = operation.id;
        } else {
          operation = {
            id: rec.id,
            label: _telegramTemplateLabel(matches[0]),
            committed: false,
            notifications: { keyboard: false, confirmation: false },
            createdAt: now.getTime(),
          };
          props.setProperty(operationKey, JSON.stringify(operation));
        }
        db.expenses.push(rec);
        const content = JSON.stringify(db);
        if (file) {
          backupIfDue(file);
          file.setContent(content);
        } else {
          const created = DriveApp.createFile(FILE_DATA, content, MimeType.PLAIN_TEXT);
          props.setProperty('dataFileId', created.getId());
        }
        operation.committed = true;
      }
    }
    if (operation && operation.committed && outcome !== 'changed' && outcome !== 'ambiguous') {
      props.setProperty(operationKey, JSON.stringify(operation));
      try {
        cache.put(key, '1', 600);
        props.setProperty(key, String(now.getTime()));
      } catch(err) {
        try { cache.remove(key); } catch(_) {}
        try { props.deleteProperty(key); } catch(_) {}
        throw err;
      }
      outcome = 'committed';
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
  if (outcome === 'changed' || outcome === 'ambiguous') {
    _telegramApi('sendMessage', {
      chat_id: message.chat.id,
      text: outcome === 'ambiguous'
        ? 'Несколько шаблонов имеют одинаковые название и сумму. Измените их в приложении.'
        : 'Шаблон изменился. Выберите актуальный шаблон:',
      reply_markup: _telegramKeyboard(db, 0),
    });
    _telegramRememberKeyboard(db);
    return null;
  }
  const keyboardSignature = _telegramKeyboardSignature(db);
  if (props.getProperty('TELEGRAM_KEYBOARD_SIGNATURE') !== keyboardSignature) {
    _telegramApi('sendMessage', {
      chat_id: message.chat.id,
      text: 'Шаблоны обновлены:',
      reply_markup: _telegramKeyboard(db, 0),
    });
    props.setProperty('TELEGRAM_KEYBOARD_SIGNATURE', keyboardSignature);
  }
  if (!operation.notifications.confirmation) {
    _telegramApi('sendMessage', {
      chat_id: message.chat.id,
      text: 'Добавлен расход: ' + operation.label,
      reply_markup: { inline_keyboard: [[{ text: 'Отменить', callback_data: 'undo:' + operation.id }]] },
    });
    operation.notifications.confirmation = true;
    props.setProperty(operationKey, JSON.stringify(operation));
  }
  return rec;
}

function _telegramUndo(callbackQuery) {
  const message = callbackQuery.message || {};
  if (!_telegramAllowed(callbackQuery.from, message.chat)) return;
  const key = 'callback:' + callbackQuery.id;
  const lock = LockService.getScriptLock();
  const cache = CacheService.getScriptCache();
  const props = PropertiesService.getScriptProperties();
  let outcome = 'duplicate';
  try {
    lock.waitLock(10000);
    const now = new Date();
    _telegramCleanupMarkers(props, now);
    if (cache.get(key) || props.getProperty(key)) return;
    const data = String(callbackQuery.data || '');
    let file;
    let db;
    let rec;
    if (data.indexOf('undo:') !== 0 || !data.slice(5)) {
      outcome = 'malformed';
    } else {
      const id = data.slice(5);
      file = getDataFile();
      db = file ? JSON.parse(file.getBlob().getDataAsString()) : { expenses: [] };
      rec = (db.expenses || []).find(function(e) { return e.id === id; });
      if (!rec || rec.source !== 'telegram') outcome = 'invalid';
      else if (rec._deleted) outcome = 'deleted';
      else outcome = 'ok';
    }
    cache.put(key, '1', 600);
    props.setProperty(key, String(now.getTime()));
    if (outcome === 'ok') {
      rec._deleted = true;
      rec.amount = 0;
      rec.updatedAt = Math.max(now.getTime(), (Number(rec.updatedAt) || 0) + 1);
      backupIfDue(file);
      file.setContent(JSON.stringify(db));
    }
  } catch(err) {
    try { cache.remove(key); } catch(_) {}
    try { props.deleteProperty(key); } catch(_) {}
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
        outcome === 'deleted' ? 'Этот расход уже отменён.' :
        outcome === 'malformed' ? 'Некорректная отмена расхода.' : 'Можно отменить только расход, добавленный ботом.',
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
  const templates = (db.templates || []).filter(function(t) {
    return !t._deleted && _telegramTemplateLabel(t) === text;
  });
  if (templates.length > 1) {
    _telegramApi('sendMessage', {
      chat_id: message.chat.id,
      text: 'Несколько шаблонов имеют одинаковые название и сумму. Измените их в приложении.',
      reply_markup: _telegramKeyboard(db, 0),
    });
    _telegramRememberKeyboard(db);
    return;
  }
  if (templates.length === 1) {
    _telegramAddTemplate(message);
    return;
  }
  let page = 0;
  let reply = 'Выберите шаблон кнопкой ниже.';
  if (text === '/start' || navigation) reply = 'Выберите шаблон:';
  if (navigation) page = Number(navigation[2]) - 1;
  if (!(db.templates || []).some(function(t) { return !t._deleted; })) {
    reply += '\nАктивных шаблонов нет. Создайте шаблоны в приложении.';
  }
  _telegramApi('sendMessage', {
    chat_id: message.chat.id,
    text: reply,
    reply_markup: _telegramKeyboard(db, page),
  });
  _telegramRememberKeyboard(db);
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
    } else if ((Number(current.updatedAt) || 0) >= (Number(expenses[index].updatedAt) || 0)) {
      expenses[index] = current;
    }
  });
  merged.expenses = expenses;
  return merged;
}

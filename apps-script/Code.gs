// ===== BUDGET TRACKER APPS SCRIPT v10.2 — Drive Storage =====
// Деплой: Расширения → Apps Script → Развернуть → Новое развертывание
// Тип: Веб-приложение | Выполнять как: Я | Доступ: Все
// Данные хранятся в файле nto_data.json в Google Drive (не в таблице)
//
// SECRET: оставь пустым — проверки нет (как раньше). Задай строку —
// и тот же секрет нужно ввести в приложении (Настройки → Google Drive).
// Защищает данные, если URL веб-приложения утечёт.

const FILE_DATA = 'nto_data.json';
const SECRET = '';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (SECRET && body.token !== SECRET) return out({ error: 'Unauthorized' });
    const action = body.action || '';
    if (action === 'ping') return out({ ok: true, version: '10.2' });
    if (action === 'push') return out(saveData(JSON.stringify(body.data || {})));
    if (action === 'pull') return readData();
    return out({ error: 'Unknown action: ' + action });
  } catch(err) {
    return out({ error: err.message });
  }
}

function doGet(e) {
  const p = e.parameter || {};
  if (SECRET && p.token !== SECRET) return out({ error: 'Unauthorized' });
  const action = p.action || '';
  if (action === 'ping') return out({ ok: true, version: '10.2' });
  if (action === 'pull') return readData();
  return out({ info: 'Budget Tracker API v10.2' });
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

function saveData(content) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); // одновременные push с двух устройств — по очереди
    const file = getDataFile();
    if (file) {
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

function readData() {
  try {
    const file = getDataFile();
    if (!file) return out({ empty: true });
    return ContentService.createTextOutput(file.getBlob().getDataAsString())
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) { return out({ error: err.message }); }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===== BUDGET TRACKER APPS SCRIPT v10.4 — Drive Storage =====
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
    if (action === 'ping') return out({ ok: true, version: '10.4' });
    if (action === 'push') return out(saveData(JSON.stringify(body.data || {}), !!body.force));
    if (action === 'pull') return readData(body.hash);
    return out({ error: 'Unknown action: ' + action });
  } catch(err) {
    return out({ error: err.message });
  }
}

function doGet(e) {
  const p = e.parameter || {};
  if (SECRET && p.token !== SECRET) return out({ error: 'Unauthorized' });
  const action = p.action || '';
  if (action === 'ping') return out({ ok: true, version: '10.4' });
  if (action === 'pull') return readData(p.hash);
  return out({ info: 'Budget Tracker API v10.4' });
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

// Раз в сутки перед перезаписью откладываем копию в nto_data.bak.json
function backupIfDue(file) {
  try {
    const props = PropertiesService.getScriptProperties();
    const last = Number(props.getProperty('lastBakTs') || 0);
    if (Date.now() - last < 24 * 3600 * 1000) return;
    const content = file.getBlob().getDataAsString();
    const bakId = props.getProperty('bakFileId');
    let bak = null;
    if (bakId) {
      try { const f = DriveApp.getFileById(bakId); if (!f.isTrashed()) bak = f; } catch(_) {}
    }
    if (bak) bak.setContent(content);
    else {
      const created = DriveApp.createFile('nto_data.bak.json', content, MimeType.PLAIN_TEXT);
      props.setProperty('bakFileId', created.getId());
    }
    props.setProperty('lastBakTs', String(Date.now()));
  } catch(_) {}
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
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

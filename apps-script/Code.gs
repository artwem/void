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

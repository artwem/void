// ─── GOOGLE SHEETS SYNC ──────────────────────────────────────────────
// Простой GET-подход: action + JSON данные в URL параметрах.
// Кнопки «Загрузить» и «Выгрузить» — ручная синхронизация.
// При старте — автоматический pull. Автопуш при закрытии — отключён.

const APPS_SCRIPT_CODE = window._APPS_SCRIPT_CODE || '';

// ── Копирование скрипта ───────────────────────────────────────────────
function copyAppsScript(){
  const code = window._APPS_SCRIPT_CODE || '';
  if(!code){ toast('Скрипт не загружен'); return; }
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(code)
      .then(()=>toast('✓ Скрипт скопирован!'))
      .catch(()=>showScriptModal());
  } else {
    showScriptModal();
  }
}

function showScriptModal(){
  document.getElementById('script-code-ta').value = window._APPS_SCRIPT_CODE || '';
  openModal('modal-script');
}

function copyScriptFromModal(){
  const ta = document.getElementById('script-code-ta');
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(ta.value)
      .then(()=>toast('✓ Скрипт скопирован!'))
      .catch(()=>toast('Выделите текст и нажмите Ctrl+C'));
  } else {
    toast('Выделите текст и нажмите Ctrl+C');
  }
}

// ── URL настройки ─────────────────────────────────────────────────────
function openSyncSettings(){
  document.getElementById('sync-url-input').value = DB.syncUrl || '';
  openModal('modal-sync');
}

function saveSyncUrl(){
  const url = document.getElementById('sync-url-input').value.trim();
  DB.syncUrl = url;
  saveSyncUrlEverywhere(url);
  saveDB();
  closeModal('modal-sync');
  renderSettings();
  toast('URL сохранён');
}

// ── Базовый запрос через JSONP (обходит CORS полностью) ──────────────
function syncGET(params) {
  return new Promise((resolve, reject) => {
    // Уникальное имя callback-функции
    const cb = '_sc' + Date.now() + Math.random().toString(36).slice(2,6);
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timeout — проверьте URL скрипта'));
    }, 20000);

    function cleanup() {
      clearTimeout(timeout);
      delete window[cb];
      const el = document.getElementById(cb);
      if (el) el.remove();
    }

    // Apps Script вернёт: callback({"ok":true,...})
    window[cb] = (data) => { cleanup(); resolve(data); };

    const qs = Object.entries(params)
      .map(([k,v]) => k + '=' + encodeURIComponent(typeof v === 'object' ? JSON.stringify(v) : v))
      .join('&');
    const url = DB.syncUrl + '?' + qs + '&callback=' + cb;

    const script = document.createElement('script');
    script.id = cb;
    script.src = url;
    script.onerror = () => { cleanup(); reject(new Error('Скрипт не загрузился — проверьте URL')); };
    document.head.appendChild(script);
  });
}

// ── Тест соединения ───────────────────────────────────────────────────
async function testSync(){
  if(!DB.syncUrl){ toast('URL не задан'); return; }
  const el = document.getElementById('sync-test-result');
  el.textContent = '…';
  try {
    const d = await syncGET({action:'ping'});
    el.textContent = d.ok ? '✓ Подключено' : '✗ Ошибка';
    toast(d.ok ? 'Подключение успешно!' : 'Ошибка: '+(d.error||'?'));
  } catch(e) {
    el.textContent = '✗ Недоступно';
    toast('Ошибка: ' + e.message);
  }
}

// ── Pull — загрузить из таблицы ───────────────────────────────────────
async function pullFromSheets(){
  if(!DB.syncUrl){ toast('URL не задан'); return; }
  setSyncStatus('syncing');
  try {
    const d = await syncGET({action:'pull'});
    if(d.error){ setSyncStatus('error'); toast('Ошибка: '+d.error); return; }
    mergePullData(d);
    DB._dirty = false;
    localStorage.setItem('budgetDB_v2', JSON.stringify(DB));
    renderBudget();
    const ts = new Date().toISOString();
    localStorage.setItem('lastSync', ts);
    sessionStorage.setItem('lastSync', ts);
    setSyncStatus('ok', ts);
    toast('✓ Загружено из таблицы!');
  } catch(e) {
    setSyncStatus('error');
    toast('Ошибка загрузки: ' + e.message);
  }
}

// ── Push — выгрузить в таблицу ────────────────────────────────────────
async function pushToSheets(){
  if(!DB.syncUrl){ toast('URL не задан'); return; }
  setSyncStatus('syncing');
  try {
    const data = buildPayload();
    const d = await syncGET({action:'push', data: JSON.stringify(data)});
    if(d.error){ setSyncStatus('error'); toast('Ошибка: '+d.error); return; }
    DB._dirty = false;
    const ts = new Date().toISOString();
    localStorage.setItem('lastSync', ts);
    sessionStorage.setItem('lastSync', ts);
    setSyncStatus('ok', ts);
    const w = d.written || {};
    toast('✓ Записано: ячеек=' + (w.cells||0) + ' комм.=' + (w.comments||0));
  } catch(e) {
    setSyncStatus('error');
    toast('Ошибка выгрузки: ' + e.message);
  }
}

// ── Виджет статуса синхронизации ──────────────────────────────────────
function setSyncStatus(state, isoTs){
  const widget = document.getElementById('sync-widget');
  const dot    = document.getElementById('sync-dot');
  const text   = document.getElementById('sync-text');
  if(!widget) return;
  widget.style.display = 'flex';
  dot.className = 'sync-dot ' + state;
  if(state === 'syncing'){
    text.textContent = 'Синхр…';
  } else if(state === 'ok' && isoTs){
    const d = new Date(isoTs);
    const hhmm = d.getHours().toString().padStart(2,'0')+':'+d.getMinutes().toString().padStart(2,'0');
    text.textContent = new Date().toDateString()===d.toDateString() ? hhmm : d.getDate()+'.'+(d.getMonth()+1)+' '+hhmm;
  } else if(state === 'error'){
    text.textContent = 'Ошибка';
  } else {
    text.textContent = 'Не синхр.';
  }
}

function syncWidgetTap(){
  if(!DB.syncUrl){ openSyncSettings(); return; }
  const action = confirm('Синхронизация\n\nОК — Загрузить из таблицы\nОтмена — Выгрузить в таблицу');
  if(action) pullFromSheets(); else pushToSheets();
}

function initSyncWidget(){
  if(!DB.syncUrl) return;
  const lastSync = localStorage.getItem('lastSync') || sessionStorage.getItem('lastSync');
  setSyncStatus(lastSync ? 'ok' : 'none', lastSync);
}

// ── Loader кода Apps Script ───────────────────────────────────────────
async function loadAppsScriptCode() {
  try {
    const r = await fetch('./apps-script/Code.gs');
    if(r.ok) { window._APPS_SCRIPT_CODE = await r.text(); return; }
  } catch(_) {}
  // Inline fallback — обновляется при каждой сборке
  window._APPS_SCRIPT_CODE = "// ===== BUDGET TRACKER APPS SCRIPT v9 =====\n// GET-only. action \u0438 data \u043f\u0435\u0440\u0435\u0434\u0430\u044e\u0442\u0441\u044f \u043a\u0430\u043a URL \u043f\u0430\u0440\u0430\u043c\u0435\u0442\u0440\u044b.\n// \u0414\u0435\u043f\u043b\u043e\u0439: \u0420\u0430\u0441\u0448\u0438\u0440\u0435\u043d\u0438\u044f \u2192 Apps Script \u2192 \u0420\u0430\u0437\u0432\u0435\u0440\u043d\u0443\u0442\u044c \u2192 \u041d\u043e\u0432\u043e\u0435 \u0440\u0430\u0437\u0432\u0435\u0440\u0442\u044b\u0432\u0430\u043d\u0438\u0435\n// \u0422\u0438\u043f: \u0412\u0435\u0431-\u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435 | \u0412\u044b\u043f\u043e\u043b\u043d\u044f\u0442\u044c \u043a\u0430\u043a: \u042f | \u0414\u043e\u0441\u0442\u0443\u043f: \u0412\u0441\u0435\n\nconst SHEET_DAYS     = '\u041f\u043e \u0434\u043d\u044f\u043c';\nconst SHEET_TEMPLATE = '\u0428\u0430\u0431\u043b\u043e\u043d';\nconst SHEET_COMMENTS = '\u041a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0438';\nconst SHEET_ASSETS   = '\u0410\u043a\u0442\u0438\u0432\u044b \u043d\u0430 01';\nconst SHEET_INCOME   = '\u0414\u043e\u0445\u043e\u0434\u044b';\nconst MONTHS_RU = ['\u042f\u043d\u0432\u0430\u0440\u044c','\u0424\u0435\u0432\u0440\u0430\u043b\u044c','\u041c\u0430\u0440\u0442','\u0410\u043f\u0440\u0435\u043b\u044c','\u041c\u0430\u0439','\u0418\u044e\u043d\u044c',\n                   '\u0418\u044e\u043b\u044c','\u0410\u0432\u0433\u0443\u0441\u0442','\u0421\u0435\u043d\u0442\u044f\u0431\u0440\u044c','\u041e\u043a\u0442\u044f\u0431\u0440\u044c','\u041d\u043e\u044f\u0431\u0440\u044c','\u0414\u0435\u043a\u0430\u0431\u0440\u044c'];\nconst DEFAULT_CATS = [\n  '\u0416\u041a\u0423 + \u0436\u0438\u043b\u044c\u0435','\u0422\u0440\u0430\u043d\u0441\u043f\u043e\u0440\u0442','\u0421\u0432\u044f\u0437\u044c + \u0438\u043d\u0442\u0435\u0440\u043d\u0435\u0442','\u0415\u0434\u0430+\u0425\u043e\u0437\u0442\u043e\u0432\u0430\u0440\u044b, \u0443\u0445\u043e\u0434',\n  '\u0415\u0434\u0430 \u0432\u043d\u0435 \u0434\u043e\u043c\u0430','\u0414\u043e\u0441\u0442\u0430\u0432\u043a\u0430','\u041e\u0434\u0435\u0436\u0434\u0430','\u0417\u0443\u0431\u044b','\u0410\u043a\u0442\u0438\u0432\u043d\u043e\u0441\u0442\u0438','\u0425\u043e\u0442\u0435\u043b\u043a\u0438',\n  '\u0420\u0430\u0437\u0432\u043b\u0435\u0447\u0435\u043d\u0438\u044f','\u041f\u043e\u0434\u0430\u0440\u043a\u0438','\u0422\u0430\u043a\u0441\u0438','\u0414\u043e\u043c, \u0431\u044b\u0442, \u0434\u0440\u0443\u0433\u043e\u0435','\u041c\u0430\u043c\u0430','\u041d\u0435\u043f\u0440\u0435\u0434\u0432\u0438\u0434\u0435\u043d\u043d\u044b\u0435 \u0440\u0430\u0441\u0445\u043e\u0434\u044b'\n];\nconst DEFAULT_LIMITS = [15000,3000,1500,20000,8000,5000,5000,3000,4000,5000,3000,3000,2000,4000,5000,5000];\n\n// \u0415\u0434\u0438\u043d\u0441\u0442\u0432\u0435\u043d\u043d\u0430\u044f \u0442\u043e\u0447\u043a\u0430 \u0432\u0445\u043e\u0434\u0430 \u2014 doGet\nfunction doGet(e) {\n  const p = e.parameter || {};\n  const action = p.action || '';\n  const cb = p.callback || null; // JSONP callback name\n  try {\n    if (action === 'ping') return out({ ok: true, version: '9.1' }, cb);\n    if (action === 'pull') return out(pullAll(), cb);\n    if (action === 'push') {\n      const raw = p.data || '{}';\n      const data = JSON.parse(raw);\n      return out({ success: true, written: pushAll(data) }, cb);\n    }\n    return out({ error: 'Unknown action: ' + action }, cb);\n  } catch(err) {\n    return out({ error: err.message }, cb);\n  }\n}\n\n// doPost \u0442\u043e\u0436\u0435 \u043f\u043e\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u043c \u043d\u0430 \u0432\u0441\u044f\u043a\u0438\u0439 \u0441\u043b\u0443\u0447\u0430\u0439\nfunction doPost(e) { return doGet(e); }\n\nfunction out(obj, callback) {\n  if (callback) {\n    // JSONP \u2014 \u043e\u0431\u043e\u0440\u0430\u0447\u0438\u0432\u0430\u0435\u043c \u0432 callback() \u0434\u043b\u044f \u043e\u0431\u0445\u043e\u0434\u0430 CORS\n    return ContentService.createTextOutput(callback + '(' + JSON.stringify(obj) + ')')\n      .setMimeType(ContentService.MimeType.JAVASCRIPT);\n  }\n  return ContentService.createTextOutput(JSON.stringify(obj))\n    .setMimeType(ContentService.MimeType.JSON);\n}\n\n// \u2500\u2500 HELPERS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nfunction fmtDate(d) {\n  return d.getFullYear() + '-' +\n    String(d.getMonth()+1).padStart(2,'0') + '-' +\n    String(d.getDate()).padStart(2,'0');\n}\n\nfunction cellToDate(v) {\n  if (v instanceof Date) return v;\n  if (typeof v === 'number' && v > 40000)\n    return new Date(Math.round((v - 25569) * 86400000));\n  return null;\n}\n\nfunction colLetter(n) {\n  let s = '';\n  while (n > 0) { s = String.fromCharCode(64 + (n-1)%26 + 1) + s; n = Math.floor((n-1)/26); }\n  return s;\n}\n\nfunction ensureSheet(ss, name, headers) {\n  let sh = ss.getSheetByName(name);\n  if (!sh) {\n    sh = ss.insertSheet(name);\n    if (headers && headers.length)\n      sh.getRange(1,1,1,headers.length).setValues([headers]);\n  }\n  return sh;\n}\n\nfunction monthSheetName(yr, mo) { return MONTHS_RU[mo] + ' ' + yr; }\n\n// \u2500\u2500 \u041f\u0415\u0420\u0412\u042b\u0419 \u0417\u0410\u041f\u0423\u0421\u041a: \u0441\u043e\u0437\u0434\u0430\u0442\u044c \u043d\u0443\u0436\u043d\u044b\u0435 \u043b\u0438\u0441\u0442\u044b \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nfunction setupSheets(ss) {\n  if (!ss.getSheetByName(SHEET_TEMPLATE)) {\n    const t = ss.insertSheet(SHEET_TEMPLATE);\n    const rows = [['\u0421\u0442\u0430\u0442\u044c\u044f \u0420\u0430\u0441\u0445\u043e\u0434\u043e\u0432','\u0421\u0443\u043c\u043c\u0430/\u041c\u0435\u0441','\u0414\u043e\u043b\u044f \u041e\u0431\u0449\u0430\u044f','\u0414\u043e\u043b\u044f \u041b\u0438\u043c\u0438\u0442\u0430','\u041b\u0438\u043c\u0438\u0442\u044b']];\n    DEFAULT_CATS.forEach((c,i) => rows.push([c,0,0,0,DEFAULT_LIMITS[i]||0]));\n    rows.push(['\u0418\u0442\u043e\u0433\u043e',0,0,0,'=SUM(E2:E'+(rows.length)+')']);\n    t.getRange(1,1,rows.length,5).setValues(rows);\n  }\n  if (!ss.getSheetByName(SHEET_DAYS)) {\n    const ds = ss.insertSheet(SHEET_DAYS);\n    const yr = new Date().getFullYear();\n    const dates = [null];\n    for (let d = new Date(yr,0,1); d.getFullYear()===yr; d.setDate(d.getDate()+1))\n      dates.push(new Date(d));\n    ds.getRange(1,1,1,dates.length).setValues([dates]);\n    ds.getRange(1,2,1,dates.length-1).setNumberFormat('dd.mm');\n    const td = ss.getSheetByName(SHEET_TEMPLATE).getDataRange().getValues();\n    let row = 2;\n    for (let r = 1; r < td.length; r++) {\n      const c = td[r][0];\n      if (c && String(c) !== '\u0418\u0442\u043e\u0433\u043e') { ds.getRange(row,1).setValue(c); row++; }\n    }\n    ds.getRange(row,1).setValue('\u0418\u0442\u043e\u0433\u043e');\n  }\n  ensureSheet(ss, SHEET_ASSETS, ['\u0414\u0430\u0442\u0430','\u0421\u0431\u0435\u0440','\u0410\u043b\u044c\u0444\u0430','\u0422\u0438\u043d\u044c','\u0426\u0438\u0444\u0440\u0430+\u0424\u0440\u0438\u0434\u043e\u043c','\u0413\u0430\u0437\u043f\u0440\u043e\u043c','\u042f\u043d\u0434\u0435\u043a\u0441','\u041e\u0437\u043e\u043d','\u0424\u0438\u043d\u0443\u0441\u043b\u0443\u0433\u0438','\u0420\u0421\u0425\u0411','\u041a\u0420\u0415\u0414\u0418\u0422(\u0421\u041f\u041b\u0418\u0422)','\u041e\u0431\u0449\u0438\u0439 \u0430\u043a\u0442\u0438\u0432']);\n  ensureSheet(ss, SHEET_INCOME, ['id','date','source','amount','comment','month']);\n  ensureSheet(ss, SHEET_COMMENTS, ['catIdx','date','comment','category']);\n}\n\nfunction getOrCreateMonthSheet(ss, yr, mo) {\n  const name = monthSheetName(yr, mo);\n  let sh = ss.getSheetByName(name);\n  if (!sh) {\n    const tmpl = ss.getSheetByName(SHEET_TEMPLATE);\n    sh = tmpl.copyTo(ss);\n    sh.setName(name);\n    sh.getRange(1,6).setValue(new Date(yr, mo, 1));\n  }\n  return sh;\n}\n\n// \u2500\u2500 PULL \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nfunction pullAll() {\n  const ss = SpreadsheetApp.getActiveSpreadsheet();\n  setupSheets(ss);\n\n  const daysSheet = ss.getSheetByName(SHEET_DAYS);\n  const daysData = daysSheet.getDataRange().getValues();\n  const header = daysData[0];\n\n  // \u041a\u0430\u0440\u0442\u0430 \u0434\u0430\u0442\u0430 \u2192 \u043a\u043e\u043b\u043e\u043d\u043a\u0430\n  const dateColMap = {};\n  for (let c = 1; c < header.length; c++) {\n    const d = cellToDate(header[c]);\n    if (d) dateColMap[fmtDate(d)] = c;\n  }\n\n  // \u041a\u0430\u0440\u0442\u0430 \u043a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u044f \u2192 \u0441\u0442\u0440\u043e\u043a\u0430\n  const catRowMap = {};\n  const categories = [];\n  for (let r = 1; r < daysData.length; r++) {\n    const cat = String(daysData[r][0] || '');\n    if (cat && cat !== '\u0418\u0442\u043e\u0433\u043e') { catRowMap[cat] = r; categories.push(cat); }\n  }\n\n  // \u0420\u0430\u0441\u0445\u043e\u0434\u044b \u0438\u0437 \u043c\u0430\u0442\u0440\u0438\u0446\u044b\n  const expenseMap = {};\n  for (const cat of categories) {\n    const ri = catRowMap[cat];\n    const ci = categories.indexOf(cat);\n    for (const [ds, col] of Object.entries(dateColMap)) {\n      const v = daysData[ri][col];\n      if (v === null || v === '' || v === undefined) continue;\n      const num = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\\d.]/g,''));\n      if (!isNaN(num) && num > 0) {\n        const key = ci + '_' + ds.replace(/-/g,'');\n        expenseMap[key] = { id:'gs_'+key, cat:ci, amount:num, date:ds, comment:'' };\n      }\n    }\n  }\n\n  // \u041a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0438\n  const commSh = ss.getSheetByName(SHEET_COMMENTS);\n  if (commSh) {\n    const cd = commSh.getDataRange().getValues();\n    for (let r = 1; r < cd.length; r++) {\n      const key = cd[r][0] + '_' + String(cd[r][1]).replace(/-/g,'');\n      if (expenseMap[key] && cd[r][2]) expenseMap[key].comment = String(cd[r][2]);\n    }\n  }\n\n  // \u0414\u043e\u0445\u043e\u0434\u044b\n  const incSh = ss.getSheetByName(SHEET_INCOME);\n  const incomes = [];\n  if (incSh) {\n    const id = incSh.getDataRange().getValues();\n    for (let r = 1; r < id.length; r++) {\n      if (!id[r][0]) continue;\n      const dateVal = id[r][1];\n      const dateStr = dateVal instanceof Date ? fmtDate(dateVal) : String(dateVal);\n      incomes.push({ id:String(id[r][0]), date:dateStr,\n        source:String(id[r][2]||''), amount:+id[r][3]||0, comment:String(id[r][4]||'') });\n    }\n  }\n\n  // \u0410\u043a\u0442\u0438\u0432\u044b\n  const aSh = ss.getSheetByName(SHEET_ASSETS);\n  const assets = [], banks = [], creditBanks = [];\n  if (aSh) {\n    const ad = aSh.getDataRange().getValues();\n    const ah = ad[0];\n    const bankCols = [];\n    for (let c = 1; c < ah.length-1; c++) {\n      const name = String(ah[c]||'').trim();\n      if (!name) continue;\n      const isCredit = name.toUpperCase().includes('\u041a\u0420\u0415\u0414\u0418\u0422');\n      bankCols.push({name, c, isCredit});\n      if (isCredit) creditBanks.push(name); else banks.push(name);\n    }\n    const allB = [...banks,...creditBanks];\n    for (let r = 1; r < ad.length; r++) {\n      const d = cellToDate(ad[r][0]);\n      if (!d) continue;\n      const ds = fmtDate(d);\n      for (const {name, c} of bankCols) {\n        const v = ad[r][c];\n        if (v===null||v===''||v===undefined) continue;\n        const num = typeof v==='number' ? v : parseFloat(String(v).replace(/[^\\d.]/g,''));\n        if (isNaN(num)) continue;\n        assets.push({ id:'gs_a_'+allB.indexOf(name)+'_'+ds.replace(/-/g,''),\n          bank:allB.indexOf(name), amount:Math.abs(num), date:ds });\n      }\n    }\n  }\n\n  // \u041b\u0438\u043c\u0438\u0442\u044b \u0438\u0437 \u043c\u0435\u0441\u044f\u0447\u043d\u044b\u0445 \u043b\u0438\u0441\u0442\u043e\u0432\n  const tmplSh = ss.getSheetByName(SHEET_TEMPLATE);\n  const tmplLims = {};\n  if (tmplSh) {\n    const td = tmplSh.getDataRange().getValues();\n    for (let r = 1; r < td.length; r++) {\n      if (td[r][0] && String(td[r][0])!=='\u0418\u0442\u043e\u0433\u043e' && typeof td[r][4]==='number')\n        tmplLims[String(td[r][0])] = td[r][4];\n    }\n  }\n  const limits = {};\n  ss.getSheets().forEach(sh => {\n    const name = sh.getName();\n    MONTHS_RU.forEach((mon,idx) => {\n      if (!name.startsWith(mon+' ')) return;\n      const yr = parseInt(name.split(' ')[1]);\n      if (isNaN(yr)) return;\n      const key = yr+'-'+String(idx+1).padStart(2,'0');\n      const sd = sh.getDataRange().getValues();\n      const lims = {};\n      for (let r = 1; r < sd.length; r++) {\n        if (sd[r][0] && String(sd[r][0])!=='\u0418\u0442\u043e\u0433\u043e' && typeof sd[r][4]==='number')\n          lims[String(sd[r][0])] = sd[r][4];\n      }\n      limits[key] = categories.map(c => lims[c]||tmplLims[c]||0);\n    });\n  });\n  const now = new Date();\n  for (let i = 0; i < 3; i++) {\n    let m = now.getMonth()+i, y = now.getFullYear();\n    if (m>11){m-=12;y++;}\n    const k = y+'-'+String(m+1).padStart(2,'0');\n    if (!limits[k]) limits[k] = categories.map(c => tmplLims[c]||0);\n  }\n\n  return { expenses:Object.values(expenseMap), categories, limits, assets, banks, creditBanks, incomes };\n}\n\n// \u2500\u2500 PUSH \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nfunction pushAll(data) {\n  const ss = SpreadsheetApp.getActiveSpreadsheet();\n  setupSheets(ss);\n\n  const categories = data.categories || [];\n  const written = { cells:0, comments:0, incomes:0, assets:0 };\n\n  // --- 1. \u041d\u043e\u0432\u044b\u0435 \u043a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u0438 ---\n  const dsSh = ss.getSheetByName(SHEET_DAYS);\n  const dsData = dsSh.getDataRange().getValues();\n  const catRowMap = {};\n  for (let r = 1; r < dsData.length; r++) {\n    const c = String(dsData[r][0]||'');\n    if (c && c !== '\u0418\u0442\u043e\u0433\u043e') catRowMap[c] = r;\n  }\n  for (const cat of categories) {\n    if (catRowMap[cat] || cat === '\u0418\u0442\u043e\u0433\u043e') continue;\n    let iRow = dsSh.getLastRow();\n    for (let r = 1; r <= dsSh.getLastRow(); r++) {\n      if (dsSh.getRange(r,1).getValue()==='\u0418\u0442\u043e\u0433\u043e') { iRow = r; break; }\n    }\n    dsSh.insertRowBefore(iRow);\n    dsSh.getRange(iRow,1).setValue(cat);\n    catRowMap[cat] = iRow-1;\n    const tmpl = ss.getSheetByName(SHEET_TEMPLATE);\n    if (tmpl) {\n      const td = tmpl.getDataRange().getValues();\n      let ti = tmpl.getLastRow();\n      for (let r = 0; r < td.length; r++) { if (td[r][0]==='\u0418\u0442\u043e\u0433\u043e') { ti=r+1; break; } }\n      tmpl.insertRowBefore(ti);\n      tmpl.getRange(ti,1).setValue(cat);\n      tmpl.getRange(ti,5).setValue(0);\n    }\n  }\n\n  // --- 2. \u0420\u0430\u0441\u0445\u043e\u0434\u044b \u2192 \u044f\u0447\u0435\u0439\u043a\u0438 \u0432 \"\u041f\u043e \u0434\u043d\u044f\u043c\" ---\n  // \u041f\u0435\u0440\u0435\u0447\u0438\u0442\u044b\u0432\u0430\u0435\u043c \u043f\u043e\u0441\u043b\u0435 \u0432\u043e\u0437\u043c\u043e\u0436\u043d\u043e\u0433\u043e \u0434\u043e\u0431\u0430\u0432\u043b\u0435\u043d\u0438\u044f \u0441\u0442\u0440\u043e\u043a\n  const freshData = dsSh.getDataRange().getValues();\n  const freshHeader = freshData[0];\n  const freshCatMap = {};\n  for (let r = 1; r < freshData.length; r++) {\n    const c = String(freshData[r][0]||'');\n    if (c && c !== '\u0418\u0442\u043e\u0433\u043e') freshCatMap[c] = r;\n  }\n  const dateColMap = {};\n  for (let c = 1; c < freshHeader.length; c++) {\n    const d = cellToDate(freshHeader[c]);\n    if (d) dateColMap[fmtDate(d)] = c;\n  }\n\n  // \u0413\u0440\u0443\u043f\u043f\u0438\u0440\u0443\u0435\u043c \u0440\u0430\u0441\u0445\u043e\u0434\u044b \u043f\u043e \u044f\u0447\u0435\u0439\u043a\u0435 (\u0441\u0443\u043c\u043c\u0438\u0440\u0443\u0435\u043c \u0435\u0441\u043b\u0438 \u043d\u0435\u0441\u043a\u043e\u043b\u044c\u043a\u043e \u0437\u0430 \u0434\u0435\u043d\u044c)\n  const cellMap = {};\n  const commentMap = {};\n  for (const exp of (data.expenses||[])) {\n    const catName = categories[exp.cat];\n    if (!catName) continue;\n    const col = dateColMap[exp.date];\n    const row = freshCatMap[catName];\n    if (col===undefined || row===undefined) continue;\n    const key = row+'_'+col;\n    cellMap[key] = (cellMap[key]||0) + exp.amount;\n    if (exp.comment) commentMap[exp.cat+'_'+exp.date] = { cat:exp.cat, date:exp.date, comment:exp.comment, catName };\n  }\n  for (const [key,amount] of Object.entries(cellMap)) {\n    const [r,c] = key.split('_').map(Number);\n    dsSh.getRange(r+1,c+1).setValue(amount);\n    written.cells++;\n  }\n\n  // --- 3. \u041a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0438 ---\n  const commSh = ensureSheet(ss, SHEET_COMMENTS, ['catIdx','date','comment','category']);\n  const commData = commSh.getDataRange().getValues();\n  const existComm = {};\n  for (let r = 1; r < commData.length; r++) {\n    if (commData[r][0]!=='') existComm[commData[r][0]+'_'+commData[r][1]] = r+1;\n  }\n  for (const [key,info] of Object.entries(commentMap)) {\n    if (existComm[key]) commSh.getRange(existComm[key],3).setValue(info.comment);\n    else { commSh.appendRow([info.cat,info.date,info.comment,info.catName]); existComm[key]=commSh.getLastRow(); }\n    written.comments++;\n  }\n\n  // --- 4. \u041b\u0438\u043c\u0438\u0442\u044b ---\n  Object.entries(data.limits||{}).forEach(([key,limArr]) => {\n    if (!Array.isArray(limArr)) return;\n    const [yr,mo] = key.split('-').map(Number);\n    const mSh = getOrCreateMonthSheet(ss, yr, mo-1);\n    const md = mSh.getDataRange().getValues();\n    const mCatRow = {};\n    for (let r = 1; r < md.length; r++) {\n      if (md[r][0] && String(md[r][0])!=='\u0418\u0442\u043e\u0433\u043e') mCatRow[String(md[r][0])] = r+1;\n    }\n    categories.forEach((cat,idx) => {\n      const lim = limArr[idx]; if (lim===undefined) return;\n      if (mCatRow[cat]) { mSh.getRange(mCatRow[cat],5).setValue(lim); return; }\n      let iRow = mSh.getLastRow();\n      for (let r = 1; r <= mSh.getLastRow(); r++) {\n        if (mSh.getRange(r,1).getValue()==='\u0418\u0442\u043e\u0433\u043e') { iRow=r; break; }\n      }\n      mSh.insertRowBefore(iRow);\n      mSh.getRange(iRow,1).setValue(cat);\n      mSh.getRange(iRow,5).setValue(lim);\n    });\n  });\n\n  // --- 5. \u0410\u043a\u0442\u0438\u0432\u044b ---\n  const allBanks = [...(data.banks||[]),...(data.creditBanks||[])];\n  if (allBanks.length && (data.assets||[]).length) {\n    const aSh = ss.getSheetByName(SHEET_ASSETS);\n    const ah = aSh.getDataRange().getValues()[0];\n    const colByBank = {};\n    for (let c = 1; c < ah.length; c++) colByBank[String(ah[c]||'')] = c;\n    for (const bank of allBanks) {\n      if (!colByBank[bank]) {\n        const lc = aSh.getLastColumn();\n        aSh.insertColumnBefore(lc);\n        aSh.getRange(1,lc).setValue(bank);\n        colByBank[bank] = lc;\n      }\n    }\n    const freshA = aSh.getDataRange().getValues();\n    const dateRowMap = {};\n    for (let r = 1; r < freshA.length; r++) {\n      const d = cellToDate(freshA[r][0]);\n      if (d) dateRowMap[fmtDate(d)] = r+1;\n    }\n    for (const a of (data.assets||[])) {\n      const bname = allBanks[a.bank]; if (!bname) continue;\n      const col = colByBank[bname]; if (!col) continue;\n      let row = dateRowMap[a.date];\n      if (!row) {\n        aSh.appendRow([new Date(a.date)]);\n        row = aSh.getLastRow();\n        dateRowMap[a.date] = row;\n        const lc = aSh.getLastColumn();\n        aSh.getRange(row,lc).setFormula('=IF(SUM(B'+row+':'+colLetter(lc-1)+row+')=0,,SUM(B'+row+':'+colLetter(lc-1)+row+'))');\n      }\n      aSh.getRange(row,col).setValue(a.amount);\n      written.assets++;\n    }\n  }\n\n  // --- 6. \u0414\u043e\u0445\u043e\u0434\u044b ---\n  const incSh = ensureSheet(ss, SHEET_INCOME, ['id','date','source','amount','comment','month']);\n  const incData = incSh.getDataRange().getValues();\n  const existInc = {};\n  for (let r = 1; r < incData.length; r++) {\n    if (incData[r][0]) existInc[String(incData[r][0])] = r+1;\n  }\n  for (const inc of (data.incomes||[])) {\n    const row = [inc.id, inc.date, inc.source, inc.amount, inc.comment||'', (inc.date||'').slice(0,7)];\n    if (existInc[inc.id]) incSh.getRange(existInc[inc.id],1,1,row.length).setValues([row]);\n    else { incSh.appendRow(row); existInc[inc.id]=incSh.getLastRow(); }\n    written.incomes++;\n  }\n\n  return written;\n}\n";
}

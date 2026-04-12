// ─── GOOGLE SHEETS SYNC ──────────────────────────────────────────────

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

function clearSyncUrl(){
  document.getElementById('sync-url-input').value = '';
  document.getElementById('sync-url-input').focus();
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

// ── Запрос к Apps Script ─────────────────────────────────────────────
// POST с Content-Type: text/plain — единственный надёжный способ.
// text/plain не вызывает preflight OPTIONS, CORS не блокирует.
async function syncRequest(action, data) {
  const body = JSON.stringify({ action, data: data || null });
  const r = await fetch(DB.syncUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body,
    redirect: 'follow'
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const text = await r.text();
  try { return JSON.parse(text); }
  catch(e) { throw new Error('Ответ: ' + text.slice(0, 100)); }
}

// ── Тест соединения ───────────────────────────────────────────────────
async function testSync(){
  if(!DB.syncUrl){ toast('URL не задан'); return; }
  const el = document.getElementById('sync-test-result');
  el.textContent = '…';
  try {
    const d = await syncRequest('ping');
    el.textContent = d.ok ? '✓ Подключено' : '✗ Ошибка';
    if(d.ok && d.spreadsheetUrl){
      localStorage.setItem('spreadsheetUrl', d.spreadsheetUrl);
      renderSettings();
    }
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
    const d = await syncRequest('pull');
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
    const d = await syncRequest('push', data);
    if(d.error){ setSyncStatus('error'); toast('Ошибка: '+d.error); return; }
    DB._dirty = false;
    const ts = new Date().toISOString();
    localStorage.setItem('lastSync', ts);
    sessionStorage.setItem('lastSync', ts);
    setSyncStatus('ok', ts);
    const w = d.written || {};
    DB.catRenames = [];
    DB.bankRenames = [];
    // Clean up _deleted expenses — already zeroed in sheet
    DB.expenses = DB.expenses.filter(e => !e._deleted);
    localStorage.setItem('budgetDB_v2', JSON.stringify(DB));
    toast('✓ Выгружено в таблицу!');
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
  if(!DB.syncUrl){ widget.style.display = 'none'; return; }
  widget.style.display = 'flex';

  if(state === 'syncing'){
    dot.className = 'sync-dot syncing';
    text.textContent = 'Синхр…';
    return;
  }

  if(state === 'error'){
    // On error — show last sync time in amber, not the word "Ошибка"
    const lastSync = localStorage.getItem('lastSync') || sessionStorage.getItem('lastSync');
    if(lastSync){ _renderSyncTime(dot, text, lastSync, true); }
    else { dot.className = 'sync-dot none'; text.textContent = 'Не синхр.'; }
    return;
  }

  if(state === 'ok' && isoTs){ _renderSyncTime(dot, text, isoTs, false); return; }

  dot.className = 'sync-dot none';
  text.textContent = 'Не синхр.';
}

function _renderSyncTime(dot, text, isoTs, wasError){
  const d = new Date(isoTs);
  const diffMin = (Date.now() - d) / 60000;
  const hhmm = d.getHours().toString().padStart(2,'0')+':'+d.getMinutes().toString().padStart(2,'0');
  text.textContent = new Date().toDateString()===d.toDateString()
    ? hhmm : d.getDate()+'.'+(d.getMonth()+1)+' '+hhmm;
  if(wasError)        dot.className = 'sync-dot error';
  else if(diffMin < 5) dot.className = 'sync-dot ok';      // green = fresh
  else                 dot.className = 'sync-dot syncing';  // amber = stale
}

function syncWidgetTap(){
  if(!DB.syncUrl){ openSyncSettings(); return; }
  openModal('modal-sync-choice');
}

function initSyncWidget(){
  if(!DB.syncUrl) return;
  const lastSync = localStorage.getItem('lastSync') || sessionStorage.getItem('lastSync');
  setSyncStatus(lastSync ? 'ok' : 'none', lastSync);
}

// ── Автосинхронизация ────────────────────────────────────────────────
let _autoSyncTimer = null;

function getSyncInterval(){
  const v = parseInt(localStorage.getItem('syncInterval') || '15');
  return Math.max(5, Math.min(3600, isNaN(v) ? 15 : v));
}

function saveSyncInterval(val){
  const secs = Math.max(5, Math.min(3600, parseInt(val) || 15));
  document.getElementById('sync-interval-input').value = secs;
  localStorage.setItem('syncInterval', String(secs));
  if(_autoSyncTimer){ clearInterval(_autoSyncTimer); _autoSyncTimer = null; }
  startAutoSync();
  toast('Интервал: ' + secs + ' с');
}

let _syncInFlight = false;

function startAutoSync(){
  if(!DB.syncUrl || _autoSyncTimer) return;
  const ms = getSyncInterval() * 1000;
  _autoSyncTimer = setInterval(async () => {
    if(!DB.syncUrl || document.hidden) return;
    if(!DB._dirty) return;
    if(_syncInFlight) return; // previous push still running — skip
    _syncInFlight = true;
    try {
      const data = buildPayload();
      const d = await syncRequest('push', data);
      if(d && !d.error){
        DB._dirty = false;
        DB.catRenames = [];
        DB.bankRenames = [];
        DB.expenses = DB.expenses.filter(e => !e._deleted);
        const ts = new Date().toISOString();
        localStorage.setItem('lastSync', ts);
        sessionStorage.setItem('lastSync', ts);
        localStorage.setItem('budgetDB_v2', JSON.stringify(DB));
        setSyncStatus('ok', ts);
      }
    } catch(e) {}
    _syncInFlight = false;
  }, ms);
}



// ── Loader кода Apps Script ───────────────────────────────────────────
async function loadAppsScriptCode() {
  try {
    const r = await fetch('./apps-script/Code.gs');
    if(r.ok) { window._APPS_SCRIPT_CODE = await r.text(); return; }
  } catch(_) {}
  // Inline fallback — обновляется при каждой сборке
  window._APPS_SCRIPT_CODE = "// ===== BUDGET TRACKER APPS SCRIPT v9 =====\n// GET-only. action \u0438 data \u043f\u0435\u0440\u0435\u0434\u0430\u044e\u0442\u0441\u044f \u043a\u0430\u043a URL \u043f\u0430\u0440\u0430\u043c\u0435\u0442\u0440\u044b.\n// \u0414\u0435\u043f\u043b\u043e\u0439: \u0420\u0430\u0441\u0448\u0438\u0440\u0435\u043d\u0438\u044f \u2192 Apps Script \u2192 \u0420\u0430\u0437\u0432\u0435\u0440\u043d\u0443\u0442\u044c \u2192 \u041d\u043e\u0432\u043e\u0435 \u0440\u0430\u0437\u0432\u0435\u0440\u0442\u044b\u0432\u0430\u043d\u0438\u0435\n// \u0422\u0438\u043f: \u0412\u0435\u0431-\u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435 | \u0412\u044b\u043f\u043e\u043b\u043d\u044f\u0442\u044c \u043a\u0430\u043a: \u042f | \u0414\u043e\u0441\u0442\u0443\u043f: \u0412\u0441\u0435\n\nconst SHEET_DAYS     = '\u041f\u043e \u0434\u043d\u044f\u043c';\nconst SHEET_TEMPLATE = '\u0428\u0430\u0431\u043b\u043e\u043d';\nconst SHEET_COMMENTS = '\u041a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0438';\nconst SHEET_ASSETS   = '\u0410\u043a\u0442\u0438\u0432\u044b';\nconst SHEET_INCOME   = '\u0414\u043e\u0445\u043e\u0434\u044b';\nconst SHEET_COLORS   = '\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438';\nconst MONTHS_RU = ['\u042f\u043d\u0432\u0430\u0440\u044c','\u0424\u0435\u0432\u0440\u0430\u043b\u044c','\u041c\u0430\u0440\u0442','\u0410\u043f\u0440\u0435\u043b\u044c','\u041c\u0430\u0439','\u0418\u044e\u043d\u044c',\n                   '\u0418\u044e\u043b\u044c','\u0410\u0432\u0433\u0443\u0441\u0442','\u0421\u0435\u043d\u0442\u044f\u0431\u0440\u044c','\u041e\u043a\u0442\u044f\u0431\u0440\u044c','\u041d\u043e\u044f\u0431\u0440\u044c','\u0414\u0435\u043a\u0430\u0431\u0440\u044c'];\nconst DEFAULT_CATS = [\n  '\u0416\u041a\u0423 + \u0436\u0438\u043b\u044c\u0435','\u0422\u0440\u0430\u043d\u0441\u043f\u043e\u0440\u0442','\u0421\u0432\u044f\u0437\u044c + \u0438\u043d\u0442\u0435\u0440\u043d\u0435\u0442','\u0415\u0434\u0430+\u0425\u043e\u0437\u0442\u043e\u0432\u0430\u0440\u044b, \u0443\u0445\u043e\u0434',\n  '\u0415\u0434\u0430 \u0432\u043d\u0435 \u0434\u043e\u043c\u0430','\u0414\u043e\u0441\u0442\u0430\u0432\u043a\u0430','\u041e\u0434\u0435\u0436\u0434\u0430','\u0417\u0443\u0431\u044b','\u0410\u043a\u0442\u0438\u0432\u043d\u043e\u0441\u0442\u0438','\u0425\u043e\u0442\u0435\u043b\u043a\u0438',\n  '\u0420\u0430\u0437\u0432\u043b\u0435\u0447\u0435\u043d\u0438\u044f','\u041f\u043e\u0434\u0430\u0440\u043a\u0438','\u0422\u0430\u043a\u0441\u0438','\u0414\u043e\u043c, \u0431\u044b\u0442, \u0434\u0440\u0443\u0433\u043e\u0435','\u041c\u0430\u043c\u0430','\u041d\u0435\u043f\u0440\u0435\u0434\u0432\u0438\u0434\u0435\u043d\u043d\u044b\u0435 \u0440\u0430\u0441\u0445\u043e\u0434\u044b'\n];\nconst DEFAULT_LIMITS = [15000,3000,1500,20000,8000,5000,5000,3000,4000,5000,3000,3000,2000,4000,5000,5000];\n\n// POST \u0441 Content-Type: text/plain \u2014 \u0431\u0435\u0437 CORS preflight\nfunction doPost(e) {\n  try {\n    const body = JSON.parse(e.postData.contents);\n    const action = body.action || '';\n    if (action === 'ping') return out({ ok: true, version: '9.2' });\n    if (action === 'pull') return out(pullAll());\n    if (action === 'push') return out({ success: true, written: pushAll(body.data || {}) });\n    return out({ error: 'Unknown action: ' + action });\n  } catch(err) {\n    return out({ error: err.message });\n  }\n}\n\n// GET \u043e\u0441\u0442\u0430\u0432\u043b\u044f\u0435\u043c \u0434\u043b\u044f \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0438 \u0432\u0440\u0443\u0447\u043d\u0443\u044e \u0432 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0435\nfunction doGet(e) {\n  const action = (e.parameter && e.parameter.action) || '';\n  if (action === 'ping') return out({ ok: true, version: '9.2' });\n  if (action === 'pull') return out(pullAll());\n  return out({ info: 'Budget Tracker API v9.2. Use POST for push.' });\n}\n\nfunction out(obj) {\n  return ContentService.createTextOutput(JSON.stringify(obj))\n    .setMimeType(ContentService.MimeType.JSON);\n}\n\n// \u2500\u2500 HELPERS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// Timezone of the spreadsheet\nconst SS_TZ = Session.getScriptTimeZone();\n\n// Convert any cell value to YYYY-MM-DD string. Returns '' if not a date.\nfunction cellToDateStr(v) {\n  if (!v && v !== 0) return '';\n  // Already a YYYY-MM-DD string\n  if (typeof v === 'string' && /^\\d{4}-\\d{2}-\\d{2}$/.test(v)) return v;\n  // Date object \u2014 use Utilities.formatDate with spreadsheet timezone\n  if (v instanceof Date) return Utilities.formatDate(v, SS_TZ, 'yyyy-MM-dd');\n  // Numeric serial (Google Sheets date stored as number)\n  if (typeof v === 'number' && v > 40000) {\n    const d = new Date(Math.round((v - 25569) * 86400000));\n    return Utilities.formatDate(d, SS_TZ, 'yyyy-MM-dd');\n  }\n  return '';\n}\n\n// Legacy alias \u2014 returns Date object (used only for \u041f\u043e \u0434\u043d\u044f\u043c header loop)\nfunction cellToDate(v) {\n  const s = cellToDateStr(v);\n  if (!s) return null;\n  const p = s.split('-').map(Number);\n  return new Date(p[0], p[1]-1, p[2]);\n}\n\n// fmtDate kept as alias\nfunction fmtDate(d) { return cellToDateStr(d); }\n\nfunction colLetter(n) {\n  let s = '';\n  while (n > 0) { s = String.fromCharCode(64 + (n-1)%26 + 1) + s; n = Math.floor((n-1)/26); }\n  return s;\n}\n\nfunction ensureSheet(ss, name, headers) {\n  let sh = ss.getSheetByName(name);\n  if (!sh) {\n    sh = ss.insertSheet(name);\n    if (headers && headers.length)\n      sh.getRange(1,1,1,headers.length).setValues([headers]);\n  }\n  return sh;\n}\n\nfunction monthSheetName(yr, mo) { return MONTHS_RU[mo] + ' ' + yr; }\n\n// \u2500\u2500 \u041f\u0415\u0420\u0412\u042b\u0419 \u0417\u0410\u041f\u0423\u0421\u041a: \u0441\u043e\u0437\u0434\u0430\u0442\u044c \u043d\u0443\u0436\u043d\u044b\u0435 \u043b\u0438\u0441\u0442\u044b \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nfunction setupSheets(ss) {\n  if (!ss.getSheetByName(SHEET_TEMPLATE)) {\n    const t = ss.insertSheet(SHEET_TEMPLATE);\n    const rows = [['\u0421\u0442\u0430\u0442\u044c\u044f \u0420\u0430\u0441\u0445\u043e\u0434\u043e\u0432','\u0421\u0443\u043c\u043c\u0430/\u041c\u0435\u0441','\u0414\u043e\u043b\u044f \u041e\u0431\u0449\u0430\u044f','\u0414\u043e\u043b\u044f \u041b\u0438\u043c\u0438\u0442\u0430','\u041b\u0438\u043c\u0438\u0442\u044b']];\n    DEFAULT_CATS.forEach((c,i) => rows.push([c,0,0,0,DEFAULT_LIMITS[i]||0]));\n    rows.push(['\u0418\u0442\u043e\u0433\u043e',0,0,0,'=SUM(E2:E'+(rows.length)+')']);\n    t.getRange(1,1,rows.length,5).setValues(rows);\n  }\n  if (!ss.getSheetByName(SHEET_DAYS)) {\n    const ds = ss.insertSheet(SHEET_DAYS);\n    const yr = new Date().getFullYear();\n    const dates = [''];\n    for (let d = new Date(yr,0,1); d.getFullYear()===yr; d.setDate(d.getDate()+1))\n      dates.push(new Date(d));\n    ds.getRange(1,1,1,dates.length).setValues([dates]);\n    ds.getRange(1,2,1,dates.length-1).setNumberFormat('dd.mm');\n    const td = ss.getSheetByName(SHEET_TEMPLATE).getDataRange().getValues();\n    let row = 2;\n    for (let r = 1; r < td.length; r++) {\n      const c = td[r][0];\n      if (c && String(c) !== '\u0418\u0442\u043e\u0433\u043e') { ds.getRange(row,1).setValue(c); row++; }\n    }\n    ds.getRange(row,1).setValue('\u0418\u0442\u043e\u0433\u043e');\n  }\n  ensureSheet(ss, SHEET_ASSETS, ['\u041e\u0431\u0449\u0438\u0439 \u0430\u043a\u0442\u0438\u0432','\u0414\u0430\u0442\u0430']);\n  ensureSheet(ss, SHEET_INCOME, ['id','date','source','amount','comment','month']);\n  ensureSheet(ss, SHEET_COMMENTS, ['catIdx','date','comment','category']);\n  ensureSheet(ss, SHEET_COLORS, ['\u041a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u044f','\u0426\u0432\u0435\u0442']);\n}\n\nfunction getOrCreateMonthSheet(ss, yr, mo) {\n  const name = monthSheetName(yr, mo);\n  let sh = ss.getSheetByName(name);\n  if (!sh) {\n    const tmpl = ss.getSheetByName(SHEET_TEMPLATE);\n    sh = tmpl.copyTo(ss);\n    sh.setName(name);\n    sh.getRange(1,6).setValue(new Date(yr, mo, 1));\n  }\n  return sh;\n}\n\n// \u2500\u2500 PULL \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nfunction pullAll() {\n  const ss = SpreadsheetApp.getActiveSpreadsheet();\n  setupSheets(ss);\n\n  const daysSheet = ss.getSheetByName(SHEET_DAYS);\n  const daysData = daysSheet.getDataRange().getValues();\n  const header = daysData[0];\n\n  // \u041a\u0430\u0440\u0442\u0430 \u0434\u0430\u0442\u0430 \u2192 \u043a\u043e\u043b\u043e\u043d\u043a\u0430\n  const dateColMap = {};\n  for (let c = 1; c < header.length; c++) {\n    const ds = cellToDateStr(header[c]);\n    if (ds) dateColMap[ds] = c;\n  }\n\n  // \u041a\u0430\u0440\u0442\u0430 \u043a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u044f \u2192 \u0441\u0442\u0440\u043e\u043a\u0430\n  const catRowMap = {};\n  const categories = [];\n  for (let r = 1; r < daysData.length; r++) {\n    const cat = String(daysData[r][0] || '');\n    if (cat && cat !== '\u0418\u0442\u043e\u0433\u043e') { catRowMap[cat] = r; categories.push(cat); }\n  }\n\n  // \u0420\u0430\u0441\u0445\u043e\u0434\u044b \u0438\u0437 \u043c\u0430\u0442\u0440\u0438\u0446\u044b\n  const expenseMap = {};\n  for (const cat of categories) {\n    const ri = catRowMap[cat];\n    const ci = categories.indexOf(cat);\n    for (const [ds, col] of Object.entries(dateColMap)) {\n      const v = daysData[ri][col];\n      if (v === null || v === '' || v === undefined) continue;\n      const num = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\\d.]/g,''));\n      if (!isNaN(num) && num > 0) {\n        const key = ci + '_' + ds.replace(/-/g,'');\n        expenseMap[key] = { id:'gs_'+key, cat:ci, amount:num, date:ds, comment:'' };\n      }\n    }\n  }\n\n  // \u041a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0438 \u2014 \u0434\u0430\u0442\u0430 \u043c\u043e\u0436\u0435\u0442 \u0431\u044b\u0442\u044c Date-\u043e\u0431\u044a\u0435\u043a\u0442\u043e\u043c \u0438\u043b\u0438 \u0441\u0442\u0440\u043e\u043a\u043e\u0439\n  const commSh = ss.getSheetByName(SHEET_COMMENTS);\n  if (commSh) {\n    const cd = commSh.getDataRange().getValues();\n    for (let r = 1; r < cd.length; r++) {\n      const catIdx = cd[r][0];\n      if (catIdx === '' || catIdx === null || catIdx === undefined) continue;\n      const dateStr = cellToDateStr(cd[r][1]) || String(cd[r][1]);\n      const key = catIdx + '_' + dateStr.replace(/-/g,'');\n      if (expenseMap[key] && cd[r][2]) expenseMap[key].comment = String(cd[r][2]);\n    }\n  }\n\n  // \u0414\u043e\u0445\u043e\u0434\u044b\n  const incSh = ss.getSheetByName(SHEET_INCOME);\n  const incomes = [];\n  if (incSh) {\n    const id = incSh.getDataRange().getValues();\n    for (let r = 1; r < id.length; r++) {\n      if (!id[r][0]) continue;\n      const dateStr = cellToDateStr(id[r][1]) || String(id[r][1]||'');\n      incomes.push({ id:String(id[r][0]), date:dateStr,\n        source:String(id[r][2]||''), amount:+id[r][3]||0, comment:String(id[r][4]||'') });\n    }\n  }\n\n  // \u0410\u043a\u0442\u0438\u0432\u044b \u2014 \u0444\u043e\u0440\u043c\u0430\u0442: \u041e\u0431\u0449\u0438\u0439 \u0430\u043a\u0442\u0438\u0432 | \u0414\u0430\u0442\u0430 | \u0411\u0430\u043d\u043a\u0438... | \u041a\u0440\u0435\u0434\u0438\u0442\u044b...\n  const aSh = ss.getSheetByName(SHEET_ASSETS);\n  const assets = [], banks = [], creditBanks = [];\n  if (aSh) {\n    const ad = aSh.getDataRange().getValues();\n    const ah = ad[0];\n    // Col 0 = \u041e\u0431\u0449\u0438\u0439 \u0430\u043a\u0442\u0438\u0432, Col 1 = \u0414\u0430\u0442\u0430, Col 2+ = banks\n    for (let c = 2; c < ah.length; c++) {\n      const name = String(ah[c]||'').trim();\n      if (!name) continue;\n      const isCred = /\u043a\u0440\u0435\u0434\u0438\u0442/i.test(name);\n      if (isCred) creditBanks.push(name); else banks.push(name);\n    }\n    const allB = [...banks, ...creditBanks];\n    for (let r = 1; r < ad.length; r++) {\n      const ds = cellToDateStr(ad[r][1]); // col index 1 = \u0414\u0430\u0442\u0430\n      if (!ds) continue;\n      for (let c = 2; c < ah.length; c++) {\n        const name = String(ah[c]||'').trim();\n        if (!name) continue;\n        const v = ad[r][c];\n        if (v===null||v===''||v===undefined) continue;\n        const num = typeof v==='number' ? v : parseFloat(String(v).replace(/[^\\d.]/g,''));\n        if (isNaN(num)) continue;\n        const bankIdx = allB.indexOf(name);\n        assets.push({ id:'gs_a_'+bankIdx+'_'+ds.replace(/-/g,''),\n          bank: bankIdx, bankName: name, amount: Math.abs(num), date: ds });\n      }\n    }\n  }\n\n  // \u041b\u0438\u043c\u0438\u0442\u044b \u0438\u0437 \u043c\u0435\u0441\u044f\u0447\u043d\u044b\u0445 \u043b\u0438\u0441\u0442\u043e\u0432\n  const tmplSh = ss.getSheetByName(SHEET_TEMPLATE);\n  const tmplLims = {};\n  if (tmplSh) {\n    const td = tmplSh.getDataRange().getValues();\n    for (let r = 1; r < td.length; r++) {\n      if (td[r][0] && String(td[r][0])!=='\u0418\u0442\u043e\u0433\u043e' && typeof td[r][4]==='number')\n        tmplLims[String(td[r][0])] = td[r][4];\n    }\n  }\n  const limits = {};\n  ss.getSheets().forEach(sh => {\n    const name = sh.getName();\n    MONTHS_RU.forEach((mon,idx) => {\n      if (!name.startsWith(mon+' ')) return;\n      const yr = parseInt(name.split(' ')[1]);\n      if (isNaN(yr)) return;\n      const key = yr+'-'+String(idx+1).padStart(2,'0');\n      const sd = sh.getDataRange().getValues();\n      const lims = {};\n      for (let r = 1; r < sd.length; r++) {\n        if (sd[r][0] && String(sd[r][0])!=='\u0418\u0442\u043e\u0433\u043e' && typeof sd[r][4]==='number')\n          lims[String(sd[r][0])] = sd[r][4];\n      }\n      limits[key] = categories.map(c => lims[c]||tmplLims[c]||0);\n    });\n  });\n  const now = new Date();\n  for (let i = 0; i < 3; i++) {\n    let m = now.getMonth()+i, y = now.getFullYear();\n    if (m>11){m-=12;y++;}\n    const k = y+'-'+String(m+1).padStart(2,'0');\n    if (!limits[k]) limits[k] = categories.map(c => tmplLims[c]||0);\n  }\n\n  // Read catColors from \u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438 sheet \u2014 format: \u041a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u044f | \u0426\u0432\u0435\u0442\n  let catColors = {};\n  const colorSh = ss.getSheetByName(SHEET_COLORS);\n  if (colorSh) {\n    const cd = colorSh.getDataRange().getValues();\n    // Build catName \u2192 color map\n    const colorByCat = {};\n    for (let r = 1; r < cd.length; r++) {\n      if (cd[r][0] && cd[r][1]) colorByCat[String(cd[r][0])] = String(cd[r][1]);\n    }\n    // Convert to index-based using categories array\n    categories.forEach((cat, idx) => {\n      if (colorByCat[cat]) catColors[idx] = colorByCat[cat];\n    });\n  }\n\n  return { expenses: Object.values(expenseMap), categories, limits, assets, banks, creditBanks, incomes, catColors };\n}\n\n// \u2500\u2500 PUSH \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nfunction pushAll(data) {\n  const ss = SpreadsheetApp.getActiveSpreadsheet();\n  setupSheets(ss);\n\n  const categories = data.categories || [];\n  const written = { cells:0, comments:0, incomes:0, assets:0 };\n\n  // --- 0. \u041f\u0435\u0440\u0435\u0438\u043c\u0435\u043d\u043e\u0432\u0430\u043d\u0438\u044f \u0431\u0430\u043d\u043a\u043e\u0432 \u0432 \u043b\u0438\u0441\u0442\u0435 \u0410\u043a\u0442\u0438\u0432\u044b ---\n  const bankRenames = data.bankRenames || [];\n  if (bankRenames.length) {\n    const aSh2 = ss.getSheetByName(SHEET_ASSETS);\n    if (aSh2) {\n      const hRow = aSh2.getRange(1, 1, 1, aSh2.getLastColumn()).getValues()[0];\n      bankRenames.forEach(function(r) {\n        hRow.forEach((name, i) => {\n          if (String(name||'').trim() === r.from) {\n            aSh2.getRange(1, i+1).setValue(r.to);\n          }\n        });\n      });\n    }\n    // Also rename in color sheet if bank names are stored there (future-proof)\n  }\n\n  // --- 1. \u041f\u0435\u0440\u0435\u0438\u043c\u0435\u043d\u043e\u0432\u0430\u043d\u0438\u044f \u043a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u0439 ---\n  const renames = data.catRenames || [];\n  const dsSh = ss.getSheetByName(SHEET_DAYS);\n  if (renames.length) {\n    const dsRenameData = dsSh.getDataRange().getValues();\n    renames.forEach(function(r) {\n      for (let row = 1; row < dsRenameData.length; row++) {\n        if (String(dsRenameData[row][0]) === r.from) {\n          dsSh.getRange(row+1, 1).setValue(r.to);\n          dsRenameData[row][0] = r.to;\n        }\n      }\n    });\n  }\n\n  // --- 1b. \u041d\u043e\u0432\u044b\u0435 \u043a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u0438 \u2014 \u0442\u043e\u043b\u044c\u043a\u043e \u0432 \u041f\u043e \u0434\u043d\u044f\u043c (\u0428\u0430\u0431\u043b\u043e\u043d \u0444\u043e\u0440\u043c\u0443\u043b\u0430\u043c\u0438 \u0441\u0430\u043c \u043f\u043e\u0434\u0442\u044f\u043d\u0435\u0442) ---\n  const dsData = dsSh.getDataRange().getValues();\n  const catRowMap = {};\n  for (let r = 1; r < dsData.length; r++) {\n    const c = String(dsData[r][0]||'');\n    if (c && c !== '\u0418\u0442\u043e\u0433\u043e') catRowMap[c] = r;\n  }\n  for (const cat of categories) {\n    if (catRowMap[cat] || cat === '\u0418\u0442\u043e\u0433\u043e') continue;\n    let iRow = dsSh.getLastRow();\n    for (let r = 1; r <= dsSh.getLastRow(); r++) {\n      if (dsSh.getRange(r,1).getValue()==='\u0418\u0442\u043e\u0433\u043e') { iRow = r; break; }\n    }\n    dsSh.insertRowBefore(iRow);\n    dsSh.getRange(iRow,1).setValue(cat);\n    catRowMap[cat] = iRow-1;\n  }\n\n  // --- 1c. \u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u0446\u0432\u0435\u0442\u0430 \u043a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u0439 \u043d\u0430 \u043b\u0438\u0441\u0442 \"\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438\" ---\n  // --- 1c. \u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u0446\u0432\u0435\u0442\u0430 \u043a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u0439: \u041a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u044f | \u0426\u0432\u0435\u0442 ---\n  const catColors = data.catColors || {};\n  {\n    const colorSh = ensureSheet(ss, SHEET_COLORS, ['\u041a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u044f','\u0426\u0432\u0435\u0442']);\n    const colorData = colorSh.getDataRange().getValues();\n    const colorRowMap = {};\n    for (let r = 1; r < colorData.length; r++) {\n      if (colorData[r][0]) colorRowMap[String(colorData[r][0])] = r + 1;\n    }\n    // Apply renames: update category name in color sheet too\n    renames.forEach(function(r) {\n      if (colorRowMap[r.from]) {\n        colorSh.getRange(colorRowMap[r.from], 1).setValue(r.to);\n        colorRowMap[r.to] = colorRowMap[r.from];\n        delete colorRowMap[r.from];\n      }\n    });\n    // Write each category color\n    categories.forEach((cat, idx) => {\n      const color = catColors[idx] || catColors[String(idx)] || '';\n      if (!color) return;\n      if (colorRowMap[cat]) {\n        colorSh.getRange(colorRowMap[cat], 2).setValue(color);\n      } else {\n        colorSh.appendRow([cat, color]);\n        colorRowMap[cat] = colorSh.getLastRow();\n      }\n    });\n    written.colors = Object.keys(catColors).length;\n  }\n\n  // --- 2. \u0420\u0430\u0441\u0445\u043e\u0434\u044b \u2192 \u044f\u0447\u0435\u0439\u043a\u0438 \u0432 \"\u041f\u043e \u0434\u043d\u044f\u043c\" ---\n  // \u041f\u0435\u0440\u0435\u0447\u0438\u0442\u044b\u0432\u0430\u0435\u043c \u043f\u043e\u0441\u043b\u0435 \u0432\u043e\u0437\u043c\u043e\u0436\u043d\u043e\u0433\u043e \u0434\u043e\u0431\u0430\u0432\u043b\u0435\u043d\u0438\u044f \u0441\u0442\u0440\u043e\u043a\n  const freshData = dsSh.getDataRange().getValues();\n  const freshHeader = freshData[0];\n  const freshCatMap = {};\n  for (let r = 1; r < freshData.length; r++) {\n    const c = String(freshData[r][0]||'');\n    if (c && c !== '\u0418\u0442\u043e\u0433\u043e') freshCatMap[c] = r;\n  }\n  const dateColMap = {};\n  for (let c = 1; c < freshHeader.length; c++) {\n    const ds = cellToDateStr(freshHeader[c]);\n    if (ds) dateColMap[ds] = c;\n  }\n\n  // \u0413\u0440\u0443\u043f\u043f\u0438\u0440\u0443\u0435\u043c \u0440\u0430\u0441\u0445\u043e\u0434\u044b \u043f\u043e \u044f\u0447\u0435\u0439\u043a\u0435\n  // amount=0 \u0438\u043b\u0438 _deleted=true \u2192 \u043f\u0438\u0448\u0435\u043c 0 (\u043e\u0447\u0438\u0449\u0430\u0435\u043c \u044f\u0447\u0435\u0439\u043a\u0443)\n  const cellMap = {};\n  const commentMap = {};\n  for (const exp of (data.expenses||[])) {\n    const catName = categories[exp.cat];\n    if (!catName) continue;\n    const col = dateColMap[exp.date];\n    const row = freshCatMap[catName];\n    if (col===undefined || row===undefined) continue;\n    const key = row+'_'+col;\n    if (exp._deleted || exp.amount === 0) {\n      cellMap[key] = 0; // \u044f\u0432\u043d\u043e \u043e\u0431\u043d\u0443\u043b\u044f\u0435\u043c\n    } else {\n      // \u0415\u0441\u043b\u0438 \u0443\u0436\u0435 \u0435\u0441\u0442\u044c \u0437\u043d\u0430\u0447\u0435\u043d\u0438\u0435 \u2014 \u0431\u0435\u0440\u0451\u043c \u043c\u0430\u043a\u0441\u0438\u043c\u0443\u043c (\u043d\u0435 \u0441\u0443\u043c\u043c\u0438\u0440\u0443\u0435\u043c, \u0442.\u043a. \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435 \u0445\u0440\u0430\u043d\u0438\u0442 \u0438\u0442\u043e\u0433)\n      cellMap[key] = exp.amount;\n    }\n    if (exp.comment && !exp._deleted) {\n      commentMap[exp.cat+'_'+exp.date] = { cat:exp.cat, date:exp.date, comment:exp.comment, catName };\n    }\n  }\n  for (const [key,amount] of Object.entries(cellMap)) {\n    const [r,c] = key.split('_').map(Number);\n    dsSh.getRange(r+1,c+1).setValue(amount === 0 ? '' : amount);\n    written.cells++;\n  }\n\n  // --- 3. \u041a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0438 ---\n  const commSh = ensureSheet(ss, SHEET_COMMENTS, ['catIdx','date','comment','category']);\n  const commData = commSh.getDataRange().getValues();\n  const existComm = {};\n  for (let r = 1; r < commData.length; r++) {\n    if (commData[r][0]==='' || commData[r][0]===null) continue;\n    const dv = commData[r][1];\n    const ds = dv instanceof Date ? fmtDate(dv) : String(dv);\n    existComm[commData[r][0]+'_'+ds] = r+1;\n  }\n  for (const [key,info] of Object.entries(commentMap)) {\n    if (existComm[key]) commSh.getRange(existComm[key],3).setValue(info.comment);\n    else { commSh.appendRow([info.cat,info.date,info.comment,info.catName]); existComm[key]=commSh.getLastRow(); }\n    written.comments++;\n  }\n\n  // --- 4. \u041b\u0438\u043c\u0438\u0442\u044b ---\n  Object.entries(data.limits||{}).forEach(([key,limArr]) => {\n    if (!Array.isArray(limArr)) return;\n    const [yr,mo] = key.split('-').map(Number);\n    const mSh = getOrCreateMonthSheet(ss, yr, mo-1);\n    const md = mSh.getDataRange().getValues();\n    const mCatRow = {};\n    for (let r = 1; r < md.length; r++) {\n      if (md[r][0] && String(md[r][0])!=='\u0418\u0442\u043e\u0433\u043e') mCatRow[String(md[r][0])] = r+1;\n    }\n    categories.forEach((cat,idx) => {\n      const lim = limArr[idx]; if (lim===undefined) return;\n      if (mCatRow[cat]) { mSh.getRange(mCatRow[cat],5).setValue(lim); return; }\n      let iRow = mSh.getLastRow();\n      for (let r = 1; r <= mSh.getLastRow(); r++) {\n        if (mSh.getRange(r,1).getValue()==='\u0418\u0442\u043e\u0433\u043e') { iRow=r; break; }\n      }\n      mSh.insertRowBefore(iRow);\n      mSh.getRange(iRow,1).setValue(cat);\n      mSh.getRange(iRow,5).setValue(lim);\n    });\n  });\n\n  // --- 5. \u0410\u043a\u0442\u0438\u0432\u044b ---\n  const regularBanks = data.banks || [];\n  const creditBanksList = data.creditBanks || [];\n  const allBanks = [...regularBanks, ...creditBanksList];\n\n  if (allBanks.length && (data.assets||[]).length) {\n    const aSh = ss.getSheetByName(SHEET_ASSETS);\n    if (!aSh) return written;\n\n    // Helper: read current header as {name: 1basedCol}\n    function getColMap() {\n      const h = aSh.getRange(1, 1, 1, aSh.getLastColumn()).getValues()[0];\n      const m = {};\n      h.forEach((v, i) => { const n = String(v||'').trim(); if (n) m[n] = i + 1; });\n      return m;\n    }\n\n    let colMap = getColMap();\n\n    // Layout: col1=\u041e\u0431\u0449\u0438\u0439 \u0430\u043a\u0442\u0438\u0432, col2=\u0414\u0430\u0442\u0430, col3..=regular, then credit\n    // Ensure base columns exist\n    if (!colMap['\u041e\u0431\u0449\u0438\u0439 \u0430\u043a\u0442\u0438\u0432']) { aSh.getRange(1,1).setValue('\u041e\u0431\u0449\u0438\u0439 \u0430\u043a\u0442\u0438\u0432'); colMap = getColMap(); }\n    if (!colMap['\u0414\u0430\u0442\u0430'])        { aSh.getRange(1,2).setValue('\u0414\u0430\u0442\u0430');         colMap = getColMap(); }\n\n    // Add missing regular banks: insert before the first credit column (or before last col if no credits)\n    for (const bank of regularBanks) {\n      if (colMap[bank]) continue;\n      // Find insertion point: before first credit bank column, or before \u041e\u0431\u0449\u0438\u0439 \u0430\u043a\u0442\u0438\u0432 if it got shifted\n      const creditCols = creditBanksList.map(b => colMap[b]).filter(Boolean);\n      const firstCreditCol = creditCols.length ? Math.min(...creditCols) : aSh.getLastColumn() + 1;\n      // insertColumnBefore shifts everything right, then clear the new column and set header\n      aSh.insertColumnBefore(firstCreditCol);\n      aSh.getRange(1, firstCreditCol, aSh.getLastRow(), 1).clearContent();\n      aSh.getRange(1, firstCreditCol).setValue(bank);\n      colMap = getColMap();\n    }\n\n    // Add missing credit banks: append after last column\n    for (const bank of creditBanksList) {\n      if (colMap[bank]) continue;\n      const newCol = aSh.getLastColumn() + 1;\n      aSh.getRange(1, newCol).setValue(bank);\n      colMap = getColMap();\n    }\n\n    // Final column map\n    colMap = getColMap();\n    const totalCol = colMap['\u041e\u0431\u0449\u0438\u0439 \u0430\u043a\u0442\u0438\u0432'] || 1;\n    const dateCol  = colMap['\u0414\u0430\u0442\u0430'] || 2;\n\n    // Build date \u2192 row map\n    const lastRow = aSh.getLastRow();\n    const dateRowMap = {};\n    if (lastRow > 1) {\n      aSh.getRange(2, dateCol, lastRow - 1, 1).getValues().forEach((r, i) => {\n        const ds = cellToDateStr(r[0]);\n        if (ds) dateRowMap[ds] = i + 2;\n      });\n    }\n\n    // Write bank values\n    for (const a of (data.assets||[])) {\n      if (!a.date || !String(a.date).match(/^\\d{4}-\\d{2}-\\d{2}$/)) continue;\n      // Always prefer bankName (reliable) over bank index (can drift after sync)\n      const bname = a.bankName || allBanks[a.bank];\n      if (!bname) continue;\n      const col = colMap[bname];\n      if (!col) continue;\n      let row = dateRowMap[a.date];\n      if (!row) {\n        const newRow = aSh.getLastRow() + 1;\n        aSh.getRange(newRow, dateCol).setValue(a.date);\n        aSh.getRange(newRow, dateCol).setNumberFormat('@');\n        row = newRow;\n        dateRowMap[a.date] = row;\n      }\n      aSh.getRange(row, col).setValue(a.amount);\n      written.assets++;\n    }\n\n    // Recalculate \u041e\u0431\u0449\u0438\u0439 \u0430\u043a\u0442\u0438\u0432 for all data rows\n    colMap = getColMap();\n    const finalLastRow = aSh.getLastRow();\n    if (finalLastRow > 1) {\n      const allData = aSh.getRange(2, 1, finalLastRow - 1, aSh.getLastColumn()).getValues();\n      allData.forEach((rowData, i) => {\n        if (!cellToDateStr(rowData[colMap['\u0414\u0430\u0442\u0430'] - 1])) return;\n        let total = 0;\n        regularBanks.forEach(b => { const c = colMap[b]; if (c) total += parseFloat(rowData[c-1]) || 0; });\n        creditBanksList.forEach(b => { const c = colMap[b]; if (c) total -= parseFloat(rowData[c-1]) || 0; });\n        aSh.getRange(i + 2, colMap['\u041e\u0431\u0449\u0438\u0439 \u0430\u043a\u0442\u0438\u0432']).setValue(total || '');\n      });\n    }\n  }\n\n  // --- 6. \u0414\u043e\u0445\u043e\u0434\u044b ---\n  const incSh = ensureSheet(ss, SHEET_INCOME, ['id','date','source','amount','comment','month']);\n  const incData = incSh.getDataRange().getValues();\n  const existInc = {};\n  for (let r = 1; r < incData.length; r++) {\n    if (incData[r][0]) existInc[String(incData[r][0])] = r+1;\n  }\n  for (const inc of (data.incomes||[])) {\n    const incDateStr = inc.date instanceof Date ? fmtDate(inc.date) : String(inc.date||'');\n    if (!incDateStr) continue;\n    const row = [inc.id, incDateStr, inc.source, inc.amount, inc.comment||'', incDateStr.slice(0,7)];\n    if (existInc[inc.id]) incSh.getRange(existInc[inc.id],1,1,row.length).setValues([row]);\n    else { incSh.appendRow(row); existInc[inc.id]=incSh.getLastRow(); }\n    written.incomes++;\n  }\n\n  return written;\n}\n";
}

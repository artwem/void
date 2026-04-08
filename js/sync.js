// ─── GOOGLE SHEETS SYNC ─────────────────────────────────────────────
// APPS_SCRIPT_CODE is in apps-script/Code.gs
// Loaded via fetch in sync.js
const APPS_SCRIPT_CODE = window._APPS_SCRIPT_CODE || '';

function copyAppsScript(){
  // Code is already loaded at startup — clipboard call is synchronous within click handler
  const code = window._APPS_SCRIPT_CODE || '';
  if(!code){ toast('Скрипт не загружен, откройте файл apps-script/Code.gs'); return; }
  // clipboard.writeText must be called directly in click handler (no async before it)
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(code)
      .then(()=>toast('✓ Скрипт скопирован!'))
      .catch(()=>showScriptModal());
  } else {
    showScriptModal();
  }
}

function showScriptModal(){
  const ta = document.getElementById('script-code-ta');
  ta.value = window._APPS_SCRIPT_CODE || '';
  openModal('modal-script');
}

function copyScriptFromModal(){
  // Called directly from button click — clipboard access is allowed
  const ta = document.getElementById('script-code-ta');
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(ta.value)
      .then(()=>toast('✓ Скрипт скопирован!'))
      .catch(()=>{ ta.select(); toast('Нажмите Ctrl+C чтобы скопировать'); });
  } else {
    ta.select();
    toast('Нажмите Ctrl+C чтобы скопировать');
  }
}

function openSyncSettings(){
  document.getElementById('sync-url-input').value=DB.syncUrl||'';
  openModal('modal-sync');
}

function saveSyncUrl(){
  const url = document.getElementById('sync-url-input').value.trim();
  DB.syncUrl = url;
  saveSyncUrlEverywhere(url);  // saves to localStorage + sessionStorage + cookie
  saveDB();
  closeModal('modal-sync');
  renderSettings();
  toast('URL сохранён');
}

// Safe URL limit for iOS Safari PWA — stay well under 2000 chars
const URL_SAFE_LIMIT = 1800;

async function getRequest(url) {
  const r = await fetch(url, { method: 'GET', redirect: 'follow' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const text = await r.text();
  try { return JSON.parse(text); }
  catch(e) { throw new Error('Ответ сервера: ' + text.slice(0, 120)); }
}

async function doSyncRequest(params) {
  const action = params.action || '';
  const baseUrl = DB.syncUrl + '?action=' + encodeURIComponent(action);

  // ping and pull — no data needed, single GET
  if (action !== 'push') {
    return getRequest(baseUrl);
  }

  // push — split into chunks to stay under iOS URL limit
  return pushInChunks(params.data);
}

async function pushInChunks(data) {
  console.log('[sync] push start: expenses=' + (data.expenses||[]).length +
    ' incomes=' + (data.incomes||[]).length +
    ' assets=' + (data.assets||[]).length);
  // Send metadata + structure first (small), then expenses in batches
  const baseUrl = DB.syncUrl + '?action=push';

  // Step 1: push structure (categories, banks, limits, assets, incomes)
  const meta = {
    categories:  data.categories  || [],
    catColors:   data.catColors   || {},
    banks:       data.banks       || [],
    creditBanks: data.creditBanks || [],
    limits:      data.limits      || {},
    assets:      data.assets      || [],
    incomes:     data.incomes     || [],
    expenses:    []  // no expenses in meta push
  };
  await sendChunk(baseUrl, meta, 'meta');

  // Step 2: push expenses in batches of ~20
  const expenses = data.expenses || [];
  const BATCH = 20;
  for (let i = 0; i < expenses.length; i += BATCH) {
    const batch = expenses.slice(i, i + BATCH);
    await sendChunk(baseUrl, {
      categories: data.categories || [],
      expenses: batch,
      banks: [], creditBanks: [], limits: {}, assets: [], incomes: []
    }, 'exp_' + i);
  }

  return { success: true };
}

async function sendChunk(baseUrl, payload, label) {
  if(window._onChunkSent) window._onChunkSent();
  console.log('[sync] chunk', label, 'expenses:', (payload.expenses||[]).length,
    'categories:', (payload.categories||[]).length);
  const json = JSON.stringify(payload);
  const encoded = btoa(unescape(encodeURIComponent(json)));
  const url = baseUrl + '&data=' + encodeURIComponent(encoded) + '&enc=b64';

  if (url.length > URL_SAFE_LIMIT) {
    // Still too large — use plain JSON, truncated if needed
    const plain = json.length > 1200 ? json.slice(0, 1200) + '...trunc}' : json;
    const fallback = baseUrl + '&data=' + encodeURIComponent(plain);
    console.warn('Chunk ' + label + ' too large, using plain JSON');
    return getRequest(fallback);
  }
  return getRequest(url);
}

async function testSync(){
  if(!DB.syncUrl){toast('URL не задан');return;}
  const el = document.getElementById('sync-test-result');
  el.textContent='…';
  try{
    const d = await doSyncRequest({action:'ping'});
    el.textContent = d.ok ? '✓ Подключено' : ('✗ '+( d.error||'Ошибка'));
    toast(d.ok ? 'Подключение успешно!' : 'Ошибка: '+(d.error||'неизвестно'));
  }catch(e){
    el.textContent='✗ Недоступно';
    toast('Не удалось подключиться: '+e.message);
  }
}

async function pullFromSheets(){
  if(!DB.syncUrl){toast('URL не задан');return;}
  setSyncStatus('syncing');
  try{
    const d = await doSyncRequest({action:'pull'});
    if(d.error){ setSyncStatus('error'); toast('Ошибка: '+d.error); return; }
    mergePullData(d);
    if(d.banks&&d.banks.length) DB.banks=d.banks;
    saveDB();
    renderBudget();
    const ts = new Date().toISOString();
    localStorage.setItem('lastSync', ts);
    setSyncStatus('ok', ts);
    toast('Загружено из таблицы!');
  }catch(e){
    setSyncStatus('error');
    toast('Ошибка: '+e.message);
  }
}

async function pushToSheets(){
  if(!DB.syncUrl){toast('URL не задан');return;}
  setSyncStatus('syncing');
  try{
    const payload = buildPayload();
    const expCount = (payload.expenses||[]).length;
    const totalChunks = Math.ceil(expCount / 20) + 1;
    let sent = 0;
    window._onChunkSent = () => {
      sent++;
      if(totalChunks > 2) toast('Выгружаем ' + sent + '/' + totalChunks + '...');
    };
    const d = await doSyncRequest({action:'push', data: payload});
    window._onChunkSent = null;
    if(d && d.success !== false){
      const ts = new Date().toISOString();
      localStorage.setItem('lastSync', ts);
      sessionStorage.setItem('lastSync', ts);
      DB._dirty = false;
      setSyncStatus('ok', ts);
      toast('✓ Выгружено в таблицу!');
    } else {
      setSyncStatus('error');
      toast('Ошибка: '+((d&&d.error)||'неизвестно'));
    }
  }catch(e){
    setSyncStatus('error');
    toast('Ошибка: '+e.message);
  }
}



// ─── APPS SCRIPT CODE ────────────────────────────────────────────────
// Inlined at build time — no fetch needed, clipboard works immediately on click
async function loadAppsScriptCode() {
  // Try fetch first (works on Netlify), fall back to inlined version
  try {
    const r = await fetch('./apps-script/Code.gs');
    if (r.ok) { window._APPS_SCRIPT_CODE = await r.text(); return; }
  } catch(_) {}
  // Inline fallback — always works
  window._APPS_SCRIPT_CODE = "// ===== BUDGET TRACKER APPS SCRIPT v8 =====\n// \u0410\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u0438 \u0441\u043e\u0437\u0434\u0430\u0451\u0442 \u0432\u0441\u0435 \u043d\u0443\u0436\u043d\u044b\u0435 \u043b\u0438\u0441\u0442\u044b \u043f\u0440\u0438 \u043f\u0435\u0440\u0432\u043e\u043c \u0437\u0430\u043f\u0443\u0441\u043a\u0435.\n// \u0414\u0435\u043f\u043b\u043e\u0439: \u0420\u0430\u0441\u0448\u0438\u0440\u0435\u043d\u0438\u044f \u2192 Apps Script \u2192 \u0420\u0430\u0437\u0432\u0435\u0440\u043d\u0443\u0442\u044c \u2192 \u041d\u043e\u0432\u043e\u0435 \u0440\u0430\u0437\u0432\u0435\u0440\u0442\u044b\u0432\u0430\u043d\u0438\u0435\n// \u0422\u0438\u043f: \u0412\u0435\u0431-\u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435 | \u0412\u044b\u043f\u043e\u043b\u043d\u044f\u0442\u044c \u043a\u0430\u043a: \u042f | \u0414\u043e\u0441\u0442\u0443\u043f: \u0412\u0441\u0435\n\nconst SHEET_DAYS     = '\u041f\u043e \u0434\u043d\u044f\u043c';\nconst SHEET_TEMPLATE = '\u0428\u0430\u0431\u043b\u043e\u043d';\nconst SHEET_COMMENTS = '\u041a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0438';\nconst SHEET_ASSETS   = '\u0410\u043a\u0442\u0438\u0432\u044b \u043d\u0430 01';\nconst SHEET_INCOME   = '\u0414\u043e\u0445\u043e\u0434\u044b';\nconst MONTHS_RU = ['\u042f\u043d\u0432\u0430\u0440\u044c','\u0424\u0435\u0432\u0440\u0430\u043b\u044c','\u041c\u0430\u0440\u0442','\u0410\u043f\u0440\u0435\u043b\u044c','\u041c\u0430\u0439','\u0418\u044e\u043d\u044c',\n                   '\u0418\u044e\u043b\u044c','\u0410\u0432\u0433\u0443\u0441\u0442','\u0421\u0435\u043d\u0442\u044f\u0431\u0440\u044c','\u041e\u043a\u0442\u044f\u0431\u0440\u044c','\u041d\u043e\u044f\u0431\u0440\u044c','\u0414\u0435\u043a\u0430\u0431\u0440\u044c'];\nconst DEFAULT_CATS = [\n  '\u0416\u041a\u0423 + \u0436\u0438\u043b\u044c\u0435','\u0422\u0440\u0430\u043d\u0441\u043f\u043e\u0440\u0442','\u0421\u0432\u044f\u0437\u044c + \u0438\u043d\u0442\u0435\u0440\u043d\u0435\u0442','\u0415\u0434\u0430+\u0425\u043e\u0437\u0442\u043e\u0432\u0430\u0440\u044b, \u0443\u0445\u043e\u0434',\n  '\u0415\u0434\u0430 \u0432\u043d\u0435 \u0434\u043e\u043c\u0430','\u0414\u043e\u0441\u0442\u0430\u0432\u043a\u0430','\u041e\u0434\u0435\u0436\u0434\u0430','\u0417\u0443\u0431\u044b','\u0410\u043a\u0442\u0438\u0432\u043d\u043e\u0441\u0442\u0438','\u0425\u043e\u0442\u0435\u043b\u043a\u0438',\n  '\u0420\u0430\u0437\u0432\u043b\u0435\u0447\u0435\u043d\u0438\u044f','\u041f\u043e\u0434\u0430\u0440\u043a\u0438','\u0422\u0430\u043a\u0441\u0438','\u0414\u043e\u043c, \u0431\u044b\u0442, \u0434\u0440\u0443\u0433\u043e\u0435','\u041c\u0430\u043c\u0430','\u041d\u0435\u043f\u0440\u0435\u0434\u0432\u0438\u0434\u0435\u043d\u043d\u044b\u0435 \u0440\u0430\u0441\u0445\u043e\u0434\u044b'\n];\nconst DEFAULT_LIMITS = [15000,3000,1500,20000,8000,5000,5000,3000,4000,5000,3000,3000,2000,4000,5000,5000];\n\nfunction doGet(e) {\n  const action = (e.parameter && e.parameter.action) || '';\n  let data = null;\n  if (e.parameter && e.parameter.data) {\n    try {\n      if (e.parameter.enc === 'b64') {\n        // Decode base64 + UTF-8\n        const decoded = decodeURIComponent(escape(Utilities.base64Decode(\n          e.parameter.data, Utilities.Charset.UTF_8\n        ).map(b => String.fromCharCode(b)).join('')));\n        data = JSON.parse(decoded);\n      } else {\n        data = JSON.parse(e.parameter.data);\n      }\n    } catch(err) { data = null; }\n  }\n  return handleRequest(action, data);\n}\n\n// Keep doPost as alias in case of future use\nfunction doPost(e) { return doGet(e); }\n\nfunction handleRequest(action, data) {\n  let result = {};\n  try {\n    if      (action === 'ping') result = { ok: true, version: '8.2' };\n    else if (action === 'pull') result = pullData();\n    else if (action === 'push') {\n      const payload = (typeof data === 'string') ? JSON.parse(data) : data;\n      if (!payload) throw new Error('Empty payload');\n      pushData(payload);\n      result = { success: true };\n    }\n    else result = { error: 'Unknown action: \"' + action + '\". Valid: ping, pull, push' };\n  } catch(err) {\n    result = { error: err.message };\n  }\n  return ContentService.createTextOutput(JSON.stringify(result))\n    .setMimeType(ContentService.MimeType.JSON);\n}\n\n// \u2500\u2500 HELPERS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nfunction fmtDate(d) {\n  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');\n}\nfunction monthSheetName(yr, mo) { return MONTHS_RU[mo]+' '+yr; }\n\nfunction readSheetLimits(sheetData) {\n  const r2 = {};\n  for (let r = 1; r < sheetData.length; r++) {\n    const cat = sheetData[r][0], lim = sheetData[r][4];\n    if (cat && String(cat) !== '\u0418\u0442\u043e\u0433\u043e')\n      r2[String(cat)] = (typeof lim === 'number' && lim > 0) ? lim : 0;\n  }\n  return r2;\n}\n\n// Create sheet only if missing, with optional headers\nfunction ensureSheet(ss, name, headers) {\n  let sheet = ss.getSheetByName(name);\n  if (!sheet) {\n    sheet = ss.insertSheet(name);\n    if (headers) sheet.getRange(1,1,1,headers.length).setValues([headers]);\n  }\n  return sheet;\n}\n\n// \u2500\u2500 SETUP: Create all required sheets if missing \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nfunction setupSheets(ss) {\n  // 1. \u0428\u0430\u0431\u043b\u043e\u043d \u2014 rows: header + each category + \u0418\u0442\u043e\u0433\u043e\n  let tmpl = ss.getSheetByName(SHEET_TEMPLATE);\n  if (!tmpl) {\n    tmpl = ss.insertSheet(SHEET_TEMPLATE);\n    const rows = [['\u0421\u0442\u0430\u0442\u044c\u044f \u0420\u0430\u0441\u0445\u043e\u0434\u043e\u0432','\u0421\u0443\u043c\u043c\u0430/\u041c\u0435\u0441','\u0414\u043e\u043b\u044f \u041e\u0431\u0449\u0430\u044f','\u0414\u043e\u043b\u044f \u041b\u0438\u043c\u0438\u0442\u0430','\u041b\u0438\u043c\u0438\u0442\u044b',null,'\u0418\u0442\u043e\u0433\u043e \u0434\u043e\u0445\u043e\u0434\u043e\u0432','\u0410\u0432\u0430\u043d\u0441',null]];\n    DEFAULT_CATS.forEach((cat, i) => rows.push([cat, 0, 0, 0, DEFAULT_LIMITS[i]||0]));\n    rows.push(['\u0418\u0442\u043e\u0433\u043e', 0, 0, 0, '=SUM(E2:E'+(rows.length)+')']);\n    tmpl.getRange(1,1,rows.length,9).setValues(rows);\n  }\n\n  // 2. \u041f\u043e \u0434\u043d\u044f\u043c \u2014 row 1 = header with dates for current year\n  if (!ss.getSheetByName(SHEET_DAYS)) {\n    const daysSheet = ss.insertSheet(SHEET_DAYS);\n    const now = new Date();\n    const year = now.getFullYear();\n    const startDate = new Date(year, 0, 1); // Jan 1\n    const dates = [null]; // col A = category name\n    for (let d = new Date(startDate); d.getFullYear() === year; d.setDate(d.getDate()+1)) {\n      dates.push(new Date(d));\n    }\n    daysSheet.getRange(1,1,1,dates.length).setValues([dates]);\n    // Format date columns\n    const dateFormat = daysSheet.getRange(1, 2, 1, dates.length-1);\n    dateFormat.setNumberFormat('dd.mm');\n    // Add category rows\n    const tmplData = tmpl.getDataRange().getValues();\n    let rowIdx = 2;\n    for (let r = 1; r < tmplData.length; r++) {\n      const cat = tmplData[r][0];\n      if (cat && String(cat) !== '\u0418\u0442\u043e\u0433\u043e') {\n        daysSheet.getRange(rowIdx, 1).setValue(cat);\n        rowIdx++;\n      }\n    }\n    // Add \u0418\u0442\u043e\u0433\u043e row with SUM formula\n    daysSheet.getRange(rowIdx, 1).setValue('\u0418\u0442\u043e\u0433\u043e');\n    for (let c = 2; c <= dates.length; c++) {\n      const col = columnLetter(c);\n      daysSheet.getRange(rowIdx, c).setFormula('=SUM('+col+'2:'+col+(rowIdx-1)+')');\n    }\n  }\n\n  // 3. \u0410\u043a\u0442\u0438\u0432\u044b \u043d\u0430 01\n  ensureSheet(ss, SHEET_ASSETS, ['\u0414\u0430\u0442\u0430','\u0421\u0431\u0435\u0440','\u0410\u043b\u044c\u0444\u0430','\u0422\u0438\u043d\u044c\u043a','\u0426\u0438\u0444\u0440\u0430+\u0424\u0440\u0438\u0434\u043e\u043c','\u0413\u0430\u0437\u043f\u0440\u043e\u043c','\u042f\u043d\u0434\u0435\u043a\u0441','\u041e\u0437\u043e\u043d','\u0424\u0438\u043d\u0443\u0441\u043b\u0443\u0433\u0438','\u0420\u0421\u0425\u0411','\u041a\u0420\u0415\u0414\u0418\u0422(\u0421\u041f\u041b\u0418\u0422)','\u041e\u0431\u0449\u0438\u0439 \u0430\u043a\u0442\u0438\u0432']);\n\n  // 4. \u0414\u043e\u0445\u043e\u0434\u044b\n  ensureSheet(ss, SHEET_INCOME, ['id','date','source','amount','comment','month']);\n\n  // 5. \u041a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0438\n  ensureSheet(ss, SHEET_COMMENTS, ['catIdx','date','comment','category']);\n}\n\nfunction columnLetter(n) {\n  let s = '';\n  while (n > 0) { s = String.fromCharCode(65+(n-1)%26)+s; n = Math.floor((n-1)/26); }\n  return s;\n}\n\nfunction getOrCreateMonthSheet(ss, yr, mo) {\n  const name = monthSheetName(yr, mo);\n  let sheet = ss.getSheetByName(name);\n  if (!sheet) {\n    const tmpl = ss.getSheetByName(SHEET_TEMPLATE);\n    if (!tmpl) { setupSheets(ss); }\n    sheet = ss.getSheetByName(SHEET_TEMPLATE).copyTo(ss);\n    sheet.setName(name);\n    sheet.getRange(1,6).setValue(new Date(yr, mo, 1));\n  }\n  return sheet;\n}\n\n// \u2500\u2500 PULL \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nfunction pullData() {\n  const ss = SpreadsheetApp.getActiveSpreadsheet();\n  setupSheets(ss);\n\n  // --- Expenses ---\n  const daysSheet = ss.getSheetByName(SHEET_DAYS);\n  const daysData = daysSheet.getDataRange().getValues();\n  const headerRow = daysData[0];\n\n  const dateColMap = {};\n  for (let c = 1; c < headerRow.length; c++)\n    if (headerRow[c] instanceof Date) dateColMap[fmtDate(headerRow[c])] = c;\n\n  const catRowMap = {}, categories = [];\n  for (let r = 1; r < daysData.length; r++) {\n    const cat = daysData[r][0];\n    if (cat && String(cat) !== '\u0418\u0442\u043e\u0433\u043e') { catRowMap[String(cat)] = r; categories.push(String(cat)); }\n  }\n\n  const expenseMap = {};\n  for (const cat of categories) {\n    const r = catRowMap[cat], catIdx = categories.indexOf(cat);\n    for (const [dateStr, c] of Object.entries(dateColMap)) {\n      const val = daysData[r][c];\n      if (val === null || val === undefined || val === '') continue;\n      const num = typeof val === 'number' ? val : parseFloat(String(val).replace(/[^0-9.]/g,''));\n      if (!isNaN(num) && num > 0) {\n        const key = catIdx+'_'+dateStr.replace(/-/g,'');\n        expenseMap[key] = { id:'gs_'+key, cat:catIdx, amount:num, date:dateStr, comment:'' };\n      }\n    }\n  }\n\n  // Merge comments\n  const commData = ss.getSheetByName(SHEET_COMMENTS).getDataRange().getValues();\n  for (let r = 1; r < commData.length; r++) {\n    const [catIdx, dateStr, comment] = commData[r];\n    if (catIdx===''||catIdx===null) continue;\n    const key = catIdx+'_'+String(dateStr).replace(/-/g,'');\n    if (expenseMap[key] && comment) expenseMap[key].comment = String(comment);\n  }\n\n  // --- Incomes ---\n  const incSheet = ss.getSheetByName(SHEET_INCOME);\n  const incData = incSheet.getDataRange().getValues();\n  const incomes = [];\n  for (let r = 1; r < incData.length; r++) {\n    const [id, date, source, amount, comment] = incData[r];\n    if (!id) continue;\n    incomes.push({ id: String(id), date: String(date instanceof Date ? fmtDate(date) : date),\n      source: String(source||''), amount: +amount||0, comment: String(comment||'') });\n  }\n\n  // --- Assets ---\n  const aSheet = ss.getSheetByName(SHEET_ASSETS);\n  const aData = aSheet.getDataRange().getValues();\n  const aHeader = aData[0];\n  const banks = [], creditBanks = [], bankCols = [];\n  for (let c = 1; c < aHeader.length - 1; c++) {\n    const name = String(aHeader[c]||'').trim();\n    if (!name) continue;\n    const isCredit = name.toUpperCase().includes('\u041a\u0420\u0415\u0414\u0418\u0422');\n    bankCols.push({ name, colIdx: c, isCredit });\n    if (isCredit) creditBanks.push(name); else banks.push(name);\n  }\n  const allBanks = [...banks, ...creditBanks];\n  const assets = [];\n  for (let r = 1; r < aData.length; r++) {\n    if (!(aData[r][0] instanceof Date)) continue;\n    const dateStr = fmtDate(aData[r][0]);\n    for (const {name, colIdx} of bankCols) {\n      const val = aData[r][colIdx];\n      if (val===null||val===undefined||val==='') continue;\n      const num = typeof val==='number' ? val : parseFloat(String(val).replace(/[^0-9.]/g,''));\n      if (isNaN(num)) continue;\n      assets.push({ id:'gs_asset_'+allBanks.indexOf(name)+'_'+dateStr.replace(/-/g,''),\n        bank: allBanks.indexOf(name), amount: Math.abs(num), date: dateStr });\n    }\n  }\n\n  // --- Limits ---\n  const tmplSheet = ss.getSheetByName(SHEET_TEMPLATE);\n  const templateLimits = readSheetLimits(tmplSheet.getDataRange().getValues());\n  const limits = {};\n  ss.getSheets().forEach(s => {\n    const name = s.getName();\n    MONTHS_RU.forEach((mon, idx) => {\n      if (name.startsWith(mon+' ')) {\n        const yr = parseInt(name.split(' ')[1]);\n        if (!isNaN(yr)) {\n          const key = yr+'-'+String(idx+1).padStart(2,'0');\n          const sl = readSheetLimits(s.getDataRange().getValues());\n          limits[key] = categories.map(cat => sl[cat]>0 ? sl[cat] : (templateLimits[cat]||0));\n        }\n      }\n    });\n  });\n  const now = new Date();\n  for (let i = 0; i < 3; i++) {\n    let m = now.getMonth()+i, yr = now.getFullYear();\n    if (m>11){m-=12;yr++;}\n    const key = yr+'-'+String(m+1).padStart(2,'0');\n    if (!limits[key]) limits[key] = categories.map(cat => templateLimits[cat]||0);\n  }\n\n  return { expenses: Object.values(expenseMap), categories, limits, assets, banks, creditBanks, incomes };\n}\n\n// \u2500\u2500 PUSH \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nfunction pushData(data) {\n  const ss = SpreadsheetApp.getActiveSpreadsheet();\n  setupSheets(ss);\n\n  Logger.log('pushData received: expenses=' + (data.expenses||[]).length +\n    ' cats=' + (data.categories||[]).length +\n    ' incomes=' + (data.incomes||[]).length);\n  const categories = data.categories || [];\n\n  // --- Push expenses ---\n  const daysSheet = ss.getSheetByName(SHEET_DAYS);\n  const sheetData = daysSheet.getDataRange().getValues();\n  const headerRow = sheetData[0];\n  const dateColMap = {};\n  for (let c = 1; c < headerRow.length; c++) {\n    const cell = headerRow[c];\n    if (cell instanceof Date) {\n      dateColMap[fmtDate(cell)] = c;\n    } else if (typeof cell === 'number' && cell > 40000) {\n      // Google Sheets serial date number \u2192 JS Date\n      const jsDate = new Date((cell - 25569) * 86400 * 1000);\n      dateColMap[fmtDate(jsDate)] = c;\n    }\n  }\n  Logger.log('dateColMap keys: ' + Object.keys(dateColMap).slice(0,5).join(', ') + '...');\n  const catRowMap = {};\n  for (let r = 1; r < sheetData.length; r++) {\n    const cat = sheetData[r][0];\n    if (cat && String(cat) !== '\u0418\u0442\u043e\u0433\u043e') catRowMap[String(cat)] = r;\n  }\n  Logger.log('catRowMap keys: ' + Object.keys(catRowMap).slice(0,5).join(', '));\n  // Add new categories to \u041f\u043e \u0434\u043d\u044f\u043c and \u0428\u0430\u0431\u043b\u043e\u043d\n  for (const cat of categories) {\n    if (!catRowMap[cat] && cat !== '\u0418\u0442\u043e\u0433\u043e') {\n      // Find \u0418\u0442\u043e\u0433\u043e row\n      let itogoRow = daysSheet.getLastRow();\n      for (let r = 1; r <= daysSheet.getLastRow(); r++) {\n        if (daysSheet.getRange(r,1).getValue() === '\u0418\u0442\u043e\u0433\u043e') { itogoRow = r; break; }\n      }\n      daysSheet.insertRowBefore(itogoRow);\n      daysSheet.getRange(itogoRow, 1).setValue(cat);\n      catRowMap[cat] = itogoRow - 1;\n      // Also add to \u0428\u0430\u0431\u043b\u043e\u043d \u2014 before its \u0418\u0442\u043e\u0433\u043e row\n      const tmpl = ss.getSheetByName(SHEET_TEMPLATE);\n      const tmplData = tmpl.getDataRange().getValues();\n      let tmplItogoRow = tmpl.getLastRow();\n      for (let r = 1; r <= tmplData.length; r++) {\n        if (tmplData[r-1] && tmplData[r-1][0] === '\u0418\u0442\u043e\u0433\u043e') { tmplItogoRow = r; break; }\n      }\n      tmpl.insertRowBefore(tmplItogoRow);\n      tmpl.getRange(tmplItogoRow, 1).setValue(cat);\n      tmpl.getRange(tmplItogoRow, 5).setValue(0);\n    }\n  }\n  // Write expense values\n  const cellMap = {};\n  for (const exp of (data.expenses||[])) {\n    const catName = categories[exp.cat]; if(!catName) continue;\n    const col = dateColMap[exp.date], row = catRowMap[catName];\n    if (col===undefined||row===undefined) continue;\n    cellMap[row+'_'+col] = (cellMap[row+'_'+col]||0) + exp.amount;\n  }\n  for (const [key, amount] of Object.entries(cellMap)) {\n    const [r,c] = key.split('_').map(Number);\n    daysSheet.getRange(r+1,c+1).setValue(amount);\n  }\n\n  // --- Push comments ---\n  const commSheet = ss.getSheetByName(SHEET_COMMENTS);\n  const existingComm = {};\n  const commData = commSheet.getDataRange().getValues();\n  for (let r = 1; r < commData.length; r++) {\n    const [ci, ds] = commData[r];\n    if (ci!==''&&ci!==null) existingComm[ci+'_'+ds] = r+1;\n  }\n  for (const exp of (data.expenses||[])) {\n    if (!exp.comment) continue;\n    const mapKey = exp.cat+'_'+exp.date;\n    if (existingComm[mapKey]) commSheet.getRange(existingComm[mapKey],3).setValue(exp.comment);\n    else { commSheet.appendRow([exp.cat, exp.date, exp.comment, categories[exp.cat]||'']); existingComm[mapKey]=commSheet.getLastRow(); }\n  }\n\n  // --- Push incomes ---\n  const incSheet = ss.getSheetByName(SHEET_INCOME);\n  const incData = incSheet.getDataRange().getValues();\n  const existingInc = {};\n  for (let r = 1; r < incData.length; r++) {\n    if (incData[r][0]) existingInc[String(incData[r][0])] = r+1;\n  }\n  for (const inc of (data.incomes||[])) {\n    const row = [inc.id, inc.date, inc.source, inc.amount, inc.comment||'', inc.date.slice(0,7)];\n    if (existingInc[inc.id]) {\n      incSheet.getRange(existingInc[inc.id], 1, 1, row.length).setValues([row]);\n    } else {\n      incSheet.appendRow(row);\n      existingInc[inc.id] = incSheet.getLastRow();\n    }\n  }\n\n  // --- Push assets ---\n  const allBanksPush = [...(data.banks||[]), ...(data.creditBanks||[])];\n  if (allBanksPush.length > 0) {\n    const aSheet = ss.getSheetByName(SHEET_ASSETS);\n    const aData = aSheet.getDataRange().getValues();\n    const aHeader = aData[0];\n    const colByBank = {};\n    for (let c = 1; c < aHeader.length; c++) colByBank[String(aHeader[c]||'')] = c;\n    for (const bank of allBanksPush) {\n      if (!colByBank[bank]) {\n        const lastCol = aSheet.getLastColumn();\n        aSheet.insertColumnBefore(lastCol);\n        aSheet.getRange(1, lastCol).setValue(bank);\n        colByBank[bank] = lastCol;\n      }\n    }\n    const dateRowMap = {};\n    const freshData = aSheet.getDataRange().getValues();\n    for (let r = 1; r < freshData.length; r++) {\n      if (freshData[r][0] instanceof Date) dateRowMap[fmtDate(freshData[r][0])] = r+1;\n    }\n    const assetMap = {};\n    for (const a of (data.assets||[])) {\n      const bname = allBanksPush[a.bank]; if(!bname) continue;\n      assetMap[a.date+'|'+bname] = { amount: a.amount, date: a.date, bank: bname };\n    }\n    for (const {amount, date, bank} of Object.values(assetMap)) {\n      const col = colByBank[bank]; if(!col) continue;\n      let row = dateRowMap[date];\n      if (!row) {\n        aSheet.appendRow([new Date(date)]);\n        row = aSheet.getLastRow();\n        dateRowMap[date] = row;\n        const lastDataCol = columnLetter(aSheet.getLastColumn()-1);\n        aSheet.getRange(row, aSheet.getLastColumn()).setFormula(\n          '=IF(SUM(B'+row+':'+lastDataCol+row+')=0,,SUM(B'+row+':'+lastDataCol+row+'))'\n        );\n      }\n      aSheet.getRange(row, col).setValue(amount);\n    }\n  }\n\n  // --- Push limits ---\n  if (data.limits) {\n    Object.entries(data.limits).forEach(([key, limArr]) => {\n      const [yr, mo] = key.split('-').map(Number);\n      const mSheet = getOrCreateMonthSheet(ss, yr, mo-1);\n      const mData = mSheet.getDataRange().getValues();\n      const mCatRow = {};\n      for (let r = 1; r < mData.length; r++) {\n        const cat = mData[r][0];\n        if (cat && String(cat)!=='\u0418\u0442\u043e\u0433\u043e') mCatRow[String(cat)] = r+1;\n      }\n      categories.forEach((cat, idx) => {\n        const lim = limArr[idx]; if(lim===undefined) return;\n        if (mCatRow[cat]) mSheet.getRange(mCatRow[cat],5).setValue(lim);\n        else {\n          let itogoRow = mSheet.getLastRow();\n          for (let r = 1; r <= mSheet.getLastRow(); r++) {\n            if (mSheet.getRange(r,1).getValue()==='\u0418\u0442\u043e\u0433\u043e') { itogoRow = r; break; }\n          }\n          mSheet.insertRowBefore(itogoRow);\n          mSheet.getRange(itogoRow, 1).setValue(cat);\n          mSheet.getRange(itogoRow, 5).setValue(lim);\n        }\n      });\n    });\n  }\n}\n";
}

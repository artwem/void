// ─── GOOGLE SHEETS SYNC ─────────────────────────────────────────────
// APPS_SCRIPT_CODE is in apps-script/Code.gs
// Loaded via fetch in sync.js
const APPS_SCRIPT_CODE = window._APPS_SCRIPT_CODE || '';

function copyAppsScript(){
  const code = window._APPS_SCRIPT_CODE || '';
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(code)
      .then(()=>toast('Скрипт скопирован!'))
      .catch(()=>showScriptModal(code));
  } else {
    showScriptModal(code);
  }
}

function showScriptModal(code){
  // Don't auto-select — causes freeze on mobile with large text
  const ta = document.getElementById('script-code-ta');
  ta.value = code || window._APPS_SCRIPT_CODE || '';
  openModal('modal-script');
}

function copyScriptFromModal(){
  const ta = document.getElementById('script-code-ta');
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(ta.value)
      .then(()=>toast('Скрипт скопирован!'))
      .catch(()=>toast('Не удалось — выделите текст вручную и скопируйте'));
  } else {
    // Fallback without select() to avoid freezing
    toast('Выделите текст в поле и скопируйте (Ctrl+A, Ctrl+C)');
  }
}

function openSyncSettings(){
  document.getElementById('sync-url-input').value=DB.syncUrl||'';
  openModal('modal-sync');
}

function saveSyncUrl(){
  const url = document.getElementById('sync-url-input').value.trim();
  DB.syncUrl = url;
  localStorage.setItem('syncUrl', url);
  saveDB();
  closeModal('modal-sync');
  renderSettings();
  toast('URL сохранён');
}

async function doSyncRequest(params){
  // Always pass action in URL so it survives Google's redirects.
  // Data payload goes in POST body (stays intact on same-origin redirects).
  const url = DB.syncUrl + '?action=' + encodeURIComponent(params.action || '');
  const r = await fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(params),
    redirect: 'follow'
  });
  const text = await r.text();
  return JSON.parse(text);
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
    const d = await doSyncRequest({action:'push', data: payload});
    if(d.success){
      const ts = new Date().toISOString();
      localStorage.setItem('lastSync', ts);
      DB._dirty = false;
      setSyncStatus('ok', ts);
      toast('Выгружено в таблицу!');
    } else {
      setSyncStatus('error');
      toast('Ошибка: '+(d.error||'неизвестно'));
    }
  }catch(e){
    setSyncStatus('error');
    toast('Ошибка: '+e.message);
  }
}



// ─── APPS SCRIPT CODE LOADER ─────────────────────────────────────────
// Loads Code.gs content and makes it available to showScriptModal
async function loadAppsScriptCode() {
  try {
    const r = await fetch('./apps-script/Code.gs');
    window._APPS_SCRIPT_CODE = await r.text();
  } catch(e) {
    // Fallback: inline placeholder
    window._APPS_SCRIPT_CODE = '// Could not load Code.gs - see apps-script/Code.gs';
  }
}

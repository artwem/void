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
  _resolvedUrl = null; // reset cache when URL changes
  localStorage.setItem('syncUrl', url);
  saveDB();
  closeModal('modal-sync');
  renderSettings();
  toast('URL сохранён');
}

// Apps Script redirect trick:
// Google redirects /exec → /exec/usercodehandler which loses POST body.
// Fix: first resolve the final URL via GET, then POST directly to it.
let _resolvedUrl = null;

async function resolveScriptUrl() {
  if (_resolvedUrl) return _resolvedUrl;
  try {
    const r = await fetch(DB.syncUrl + '?action=ping', {
      method: 'GET', redirect: 'follow'
    });
    _resolvedUrl = r.url.split('?')[0]; // final URL without params
    return _resolvedUrl;
  } catch(e) {
    return DB.syncUrl;
  }
}

async function doSyncRequest(params) {
  const action = params.action || '';

  // For ping and pull (no large body) — simple GET
  if (action === 'ping' || action === 'pull') {
    const url = DB.syncUrl + '?action=' + encodeURIComponent(action);
    const r = await fetch(url, { method: 'GET', redirect: 'follow' });
    return JSON.parse(await r.text());
  }

  // For push — POST to resolved final URL to avoid redirect body loss
  const finalUrl = await resolveScriptUrl();
  const body = JSON.stringify({ action, data: params.data });
  const r = await fetch(finalUrl + '?action=' + encodeURIComponent(action), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' }, // text/plain avoids CORS preflight
    body,
    redirect: 'follow'
  });
  return JSON.parse(await r.text());
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

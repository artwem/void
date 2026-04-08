// ─── INIT ────────────────────────────────────────────────────────────
function init(){
  loadDB();
  const now=new Date();
  currentMonth={y:now.getFullYear(),m:now.getMonth()};
  currentDay=today();
  document.getElementById('fab').style.display='flex';
  document.getElementById('fab').textContent='+';
  renderBudget();
  // Auto-sync on start if URL configured
  initSyncWidget();
  if(DB.syncUrl) autoSyncOnStart();
  // Auto-push on page close
  window.addEventListener('beforeunload', autoSyncOnClose);
  window.addEventListener('pagehide', autoSyncOnClose);
}

// ── SYNC STATUS WIDGET ──────────────────────────────────────────────
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
    const today = new Date().toDateString() === d.toDateString();
    text.textContent = today ? hhmm : d.getDate()+'.'+(d.getMonth()+1)+' '+hhmm;
  } else if(state === 'error'){
    text.textContent = 'Ошибка';
  } else {
    text.textContent = 'Не синхр.';
  }
}

function syncWidgetTap(){
  if(!DB.syncUrl){
    openSyncSettings();
    return;
  }
  // Show action sheet: push or pull
  const action = confirm('Синхронизация\n\nОК — Загрузить из таблицы\nОтмена — Выгрузить в таблицу');
  if(action) pullFromSheets();
  else pushToSheets();
}

function initSyncWidget(){
  if(!DB.syncUrl) return;
  const lastSync = localStorage.getItem('lastSync');
  setSyncStatus(lastSync ? 'ok' : 'none', lastSync);
}

async function autoSyncOnStart(){
  setSyncStatus('syncing');
  try{
    const d = await doSyncRequest({action:'pull'});
    if(d.error){ setSyncStatus('error'); return; }
    mergePullData(d);
    saveDB();
    renderBudget();
    const ts = new Date().toISOString();
    localStorage.setItem('lastSync', ts);
    setSyncStatus('ok', ts);
  } catch(e){ setSyncStatus('error'); }
}

function buildPayload(){
  return {
    expenses: DB.expenses,
    assets: DB.assets,
    categories: DB.categories,
    catColors: DB.catColors || {},
    banks: DB.banks,
    creditBanks: DB.creditBanks || [],
    limits: DB.limits,
    incomes: DB.incomes || []
  };
}

function autoSyncOnClose(){
  if(!DB.syncUrl || !DB._dirty) return;
  const body = JSON.stringify({action:'push', data: buildPayload()});
  // sendBeacon with POST body — most reliable on page close
  if(navigator.sendBeacon){
    const blob = new Blob([body], {type:'application/json'});
    navigator.sendBeacon(DB.syncUrl + '?action=push', blob);
  } else {
    fetch(DB.syncUrl + '?action=push', {method:'POST', headers:{'Content-Type':'application/json'}, body, keepalive:true}).catch(()=>{});
  }
  DB._dirty = false;
  localStorage.setItem('lastSync', new Date().toISOString());
}

function mergePullData(d){
  if(d.categories && d.categories.length) DB.categories = d.categories;
  if(d.limits) Object.assign(DB.limits, d.limits);

  // Merge expenses — preserve app-only comments
  if(d.expenses && d.expenses.length){
    const appComments = {};
    DB.expenses.forEach(e => { if(e.comment) appComments[e.id] = e.comment; });
    const appOnly = DB.expenses.filter(e => !e.id.startsWith('gs_'));
    const sheetEntries = d.expenses.map(e => ({...e, comment: e.comment || appComments[e.id] || ''}));
    DB.expenses = [...appOnly, ...sheetEntries];
  }

  // Merge assets — sheet wins, preserve app-only entries
  if(d.assets && d.assets.length){
    const appOnly = DB.assets.filter(a => !String(a.id||'').startsWith('gs_asset_'));
    DB.assets = [...appOnly, ...d.assets];
  }

  // Merge incomes
  if(d.incomes && d.incomes.length){
    const appOnlyInc = DB.incomes.filter(i => !String(i.id||'').startsWith('gs_inc_'));
    DB.incomes = [...appOnlyInc, ...d.incomes];
  }

  // Merge banks — add any new banks from sheet not yet in app
  if(d.banks && d.banks.length){
    d.banks.forEach(b => { if(!DB.banks.includes(b)) DB.banks.push(b); });
  }
  if(d.creditBanks && d.creditBanks.length){
    if(!DB.creditBanks) DB.creditBanks = [];
    d.creditBanks.forEach(b => { if(!DB.creditBanks.includes(b)) DB.creditBanks.push(b); });
  }
}





loadAppsScriptCode().then(() => init());

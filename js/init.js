// ─── INIT ────────────────────────────────────────────────────────────
function init(){
  initOverlays();
  loadDB();
  const now=new Date();
  currentMonth={y:now.getFullYear(),m:now.getMonth()};
  currentDay=today();
  document.getElementById('fab').style.display='flex';
  document.getElementById('fab').textContent='+';
  if(typeof renderBudget === 'function') renderBudget();
  // Auto-sync on start if URL configured
  initSyncWidget();
  if(DB.syncUrl) autoSyncOnStart();
  // Auto-push on page close
  // Автопуш при закрытии отключён — используй кнопку «Выгрузить»
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



function initSyncWidget(){
  if(!DB.syncUrl) return;
  const lastSync = localStorage.getItem('lastSync');
  setSyncStatus(lastSync ? 'ok' : 'none', lastSync);
}

let _syncInProgress = false;

async function autoSyncOnStart(){
  if(_syncInProgress) return;
  _syncInProgress = true;
  setSyncStatus('syncing');
  try{
    const d = await doSyncRequest({action:'pull'});
    if(d.error){ setSyncStatus('error'); _syncInProgress = false; return; }
    mergePullData(d);
    // Save quietly — don't mark dirty (pull data shouldn't trigger push)
    DB._dirty = false;
    localStorage.setItem('budgetDB_v2', JSON.stringify(DB));
    renderBudget();
    const ts = new Date().toISOString();
    localStorage.setItem('lastSync', ts);
    setSyncStatus('ok', ts);
  } catch(e){ setSyncStatus('error'); }
  _syncInProgress = false;
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

let _lastCloseSync = 0;

function autoSyncOnClose(){
  // Debounce: iOS fires pagehide on every background switch, limit to once per 30s
  const now = Date.now();
  if(!DB.syncUrl || !DB._dirty) return;
  if(now - _lastCloseSync < 30000) return;
  _lastCloseSync = now;
  DB._dirty = false;
  localStorage.setItem('lastSync', new Date().toISOString());
  // Use pushDiff via GET — reliable across redirects
  // Fire-and-forget each operation, no await needed here
  const data = buildPayload();
  _fireAndForgetPush(data);
}

function _fireAndForgetPush(data) {
  // Build minimal URL-safe requests and fire them all
  const urls = buildPushUrls(data);
  urls.forEach(url => {
    // Use sendBeacon for reliability at page close
    if(navigator.sendBeacon && url.length < 2000){
      navigator.sendBeacon(url);
    } else {
      fetch(url, {method:'GET', keepalive:true}).catch(()=>{});
    }
  });
}

function buildPushUrls(data) {
  const urls = [];
  const base = DB.syncUrl;
  const encode = (obj) => {
    const j = JSON.stringify(obj, null, 0);
    return base + '?action=push&data=' + encodeURIComponent(btoa(unescape(encodeURIComponent(j)))) + '&enc=b64';
  };

  // Expenses grouped by date
  const byDate = {};
  (data.expenses||[]).forEach(e => { if(!byDate[e.date]) byDate[e.date]=[]; byDate[e.date].push(e); });
  Object.entries(byDate).forEach(([date, exps]) => {
    const url = encode({op:'expenses', date, expenses:exps, categories:data.categories});
    if(url.length <= 1600) urls.push(url);
    else exps.forEach(e => urls.push(encode({op:'expenses', date, expenses:[e], categories:data.categories})));
  });

  // Incomes
  (data.incomes||[]).forEach(inc => urls.push(encode({op:'incomes', incomes:[inc]})));

  return urls;
}

function mergePullData(d){
  if(d.categories && d.categories.length) DB.categories = d.categories;
  if(d.limits) Object.assign(DB.limits, d.limits);

  // Merge expenses:
  // - Sheet entries (gs_*) always replace — sheet is source of truth
  // - App entries that match a sheet cat+date get dropped (sheet already has them summed)
  // - Deleted entries (_deleted) are cleaned up if sheet no longer has them
  // - Comments preserved from app if sheet has no comment
  if(d.expenses !== undefined){
    const sheetById = {};
    (d.expenses||[]).forEach(e => { sheetById[e.id] = e; });

    // Build set of cat+date covered by sheet
    const sheetKeys = new Set((d.expenses||[]).map(e => e.cat+'_'+e.date));

    // Preserve comments from app entries
    const appComments = {};
    DB.expenses.forEach(e => { if(e.comment) appComments[e.id] = e.comment; });

    // Keep app-only entries that don't conflict with sheet data
    // and remove _deleted entries that sheet confirms are zero
    const keepApp = DB.expenses.filter(e => {
      if(e._deleted) return false; // clean up deleted
      if(e.id.startsWith('gs_')) return false; // always replace with sheet version
      // App entry with same cat+date as sheet — drop it, sheet has the total
      if(sheetKeys.has(e.cat+'_'+e.date)) return false;
      return true;
    });

    // Sheet entries with comments restored
    const sheetEntries = (d.expenses||[]).map(e => ({
      ...e,
      comment: e.comment || appComments[e.id] || ''
    }));

    DB.expenses = [...keepApp, ...sheetEntries];
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

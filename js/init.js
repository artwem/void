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
  if(DB.syncUrl){ autoSyncOnStart(); startAutoSync(); }
  // Auto-push on page close
  // Автопуш при закрытии отключён — используй кнопку «Выгрузить»
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

function normDate(d) {
  // Ensure date is always YYYY-MM-DD string, never a Date object or number
  if (!d) return '';
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  // If it's a Date object or ISO string, extract local date
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d).slice(0,10);
  return dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0');
}

function buildPayload(){
  // Normalize all dates before sending to Apps Script
  const expenses = (DB.expenses||[]).map(e => ({...e, date: normDate(e.date)}));
  // Recompute bank index from bankName before sending — prevents index drift
  const allBanksNow = [...(DB.banks||[]), ...(DB.creditBanks||[])];
  const assets = (DB.assets||[]).map(a => {
    const normalized = {...a, date: normDate(a.date)};
    if (a.bankName) {
      const idx = allBanksNow.indexOf(a.bankName);
      if (idx >= 0) normalized.bank = idx;
    }
    return normalized;
  });
  const incomes  = (DB.incomes||[]).map(i => ({...i, date: normDate(i.date)}));
  return {
    expenses, assets, incomes,
    categories: DB.categories,
    catColors: DB.catColors || {},
    catRenames: DB.catRenames || [],
    bankRenames: DB.bankRenames || [],
    banks: DB.banks,
    creditBanks: DB.creditBanks || [],
    limits: DB.limits
  };
}



function mergePullData(d){
  if(d.categories && d.categories.length) DB.categories = d.categories;
  if(d.catColors !== undefined) DB.catColors = d.catColors;
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

    // Sheet entries — normalize dates and restore comments
    const sheetEntries = (d.expenses||[])
      .map(e => ({...e, date: normDate(e.date), comment: e.comment || appComments[e.id] || ''}))
      .filter(e => e.date);

    DB.expenses = [...keepApp, ...sheetEntries];
  }

  // Merge assets — sheet wins, preserve app-only entries
  if(d.assets && d.assets.length){
    const appOnly = DB.assets.filter(a => !String(a.id||'').startsWith('gs_'));
    const allBanksForMerge = [...(d.banks||[]), ...(d.creditBanks||[])];
    const sheetAssets = (d.assets||[]).map(a => {
      const normalized = {...a, date: normDate(a.date)};
      // Recompute bank index from bankName using pulled banks list
      if (a.bankName && allBanksForMerge.length) {
        const idx = allBanksForMerge.indexOf(a.bankName);
        if (idx >= 0) normalized.bank = idx;
      }
      return normalized;
    }).filter(a => a.date);
    DB.assets = [...appOnly, ...sheetAssets];
  }

  // Merge incomes — sheet is source of truth, deduplicate by id
  if(d.incomes !== undefined){
    const sheetIds = new Set((d.incomes||[]).map(i => i.id));
    // Keep app-only entries not yet in sheet
    const appOnly = (DB.incomes||[]).filter(i => !sheetIds.has(i.id));
    DB.incomes = [...appOnly, ...(d.incomes||[])];
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

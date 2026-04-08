// ─── RENDER: SETTINGS ───────────────────────────────────────────────
function renderSettings(){
  const hasSyncUrl = !!DB.syncUrl;
  document.getElementById('sync-url-display').textContent = hasSyncUrl ? DB.syncUrl.slice(0,40)+'…' : 'Не задан';
  ['sync-test-row','sync-pull-row','sync-push-row','sync-last-row'].forEach(id=>{
    document.getElementById(id).style.display = hasSyncUrl?'flex':'none';
  });
  const lastSync = localStorage.getItem('lastSync') || sessionStorage.getItem('lastSync');
  if(lastSync){
    const d = new Date(lastSync);
    document.getElementById('sync-last-time').textContent =
      d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
  }
  const cl=document.getElementById('cat-settings-list');
  cl.innerHTML=DB.categories.map((c,i)=>`
    <div class="setting-row">
      <div style="display:flex;align-items:center;gap:8px;flex:1">
        <div style="width:10px;height:10px;border-radius:50%;background:${getCatColor(i)};flex-shrink:0"></div>
        <span class="setting-label">${c}</span>
      </div>
      <span class="setting-value">${fmt(getLimits(currentMonth.y,currentMonth.m)[i]||0)} / мес</span>
    </div>
  `).join('');
}

// ─── CAT MANAGER ────────────────────────────────────────────────────
function openCatManager(){
  renderCatManager();
  openModal('modal-cats');
}

function renderCatManager(){
  document.getElementById('cat-manager-list').innerHTML = DB.categories.map((c,i)=>`
    <div class="setting-row" style="cursor:default;gap:6px">
      <input type="color" value="${getCatColor(i)}" style="width:26px;height:26px;border:none;padding:0;border-radius:50%;cursor:pointer;flex-shrink:0;background:none" onchange="setCatColor(${i},this.value)" title="Цвет категории"/>
      <span class="setting-label" style="flex:1">${c}</span>
      ${DB.categories.length>1?`<button class="btn danger small" onclick="removeCategory(${i})">✕</button>`:''}
    </div>
  `).join('');
}

function addCategory(){
  const name=document.getElementById('new-cat-name').value.trim();
  if(!name) return;
  DB.categories.push(name);
  // Add default limit for current month
  const k=monthKey(currentMonth.y,currentMonth.m);
  const existing=getLimits(currentMonth.y,currentMonth.m);
  DB.limits[k]=[...existing,3000];
  saveDB();
  document.getElementById('new-cat-name').value='';
  renderCatManager();
  toast('Категория добавлена');
}

function setCatColor(i, color){
  if(!DB.catColors) DB.catColors = {};
  DB.catColors[i] = color;
  saveDB();
}

function removeCategory(i){
  if(DB.categories.length<=1) return;
  DB.categories.splice(i,1);
  // Update limits & expenses references
  Object.keys(DB.limits).forEach(k=>{
    if(DB.limits[k]) DB.limits[k].splice(i,1);
  });
  DB.expenses.forEach(e=>{if(e.cat>i)e.cat--;else if(e.cat===i)e.cat=0;});
  saveDB();
  renderCatManager();
  toast('Категория удалена');
}

// ─── EXPORT CSV ─────────────────────────────────────────────────────
function exportCSV(){
  const rows=[['id','категория','сумма','дата','комментарий']];
  DB.expenses.forEach(e=>{
    rows.push([e.id,DB.categories[e.cat]||'',e.amount,e.date,e.comment||'']);
  });
  const csv=rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n');
  const a=document.createElement('a');
  a.href='data:text/csv;charset=utf-8,\uFEFF'+encodeURIComponent(csv);
  a.download='budget_'+today()+'.csv';
  a.click();
  toast('CSV скачан');
}

function confirmClearData(){
  openModal('modal-confirm-clear');
}

function doClearData(){
  DB.expenses=[];
  DB.assets=[];
  DB.incomes=[];
  DB.limits={};
  saveDB();
  closeModal('modal-confirm-clear');
  renderBudget();
  toast('Данные удалены');
}

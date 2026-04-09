// ─── RENDER: SETTINGS ───────────────────────────────────────────────
function renderSettings(){
  const hasSyncUrl = !!DB.syncUrl;
  document.getElementById('sync-url-display').textContent =
    hasSyncUrl ? DB.syncUrl.slice(0,40)+'…' : 'Не задан';
  ['sync-test-row','sync-pull-row','sync-push-row','sync-last-row'].forEach(id=>{
    document.getElementById(id).style.display = hasSyncUrl ? 'flex' : 'none';
  });
  const lastSync = localStorage.getItem('lastSync') || sessionStorage.getItem('lastSync');
  if(lastSync){
    const d = new Date(lastSync);
    document.getElementById('sync-last-time').textContent =
      d.toLocaleDateString('ru-RU') + ' ' +
      d.toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'});
  }
  const lims = getLimits(currentMonth.y, currentMonth.m);
  document.getElementById('cat-settings-list').innerHTML = DB.categories.map((c,i) => `
    <div class="setting-row">
      <div style="display:flex;align-items:center;gap:8px;flex:1">
        <div style="width:10px;height:10px;border-radius:50%;background:${getCatColor(i)};flex-shrink:0"></div>
        <span class="setting-label">${c}</span>
      </div>
      <span class="setting-value">${fmt(lims[i]||0)} / мес</span>
    </div>
  `).join('');
}

// ─── CAT MANAGER ────────────────────────────────────────────────────
function openCatManager(){
  renderCatManager();
  openModal('modal-cats');
}

function renderCatManager(){
  document.getElementById('cat-manager-list').innerHTML = DB.categories.map((c,i) => {
    const delBtn = DB.categories.length > 1
      ? '<button class="btn danger small" onclick="removeCategory('+i+')">✕</button>'
      : '';
    return '<div class="setting-row" style="cursor:default;gap:6px;flex-wrap:nowrap" id="cat-row-'+i+'">'
      + '<input type="color" value="'+getCatColor(i)+'"'
      + ' style="width:26px;height:26px;border:none;padding:0;border-radius:50%;cursor:pointer;flex-shrink:0;background:none"'
      + ' onchange="setCatColor('+i+',this.value)" title="Цвет категории"/>'
      + '<span class="setting-label" style="flex:1;cursor:pointer" onclick="startEditCat('+i+')">'+c+'</span>'
      + '<button class="btn small" style="padding:5px 8px;flex-shrink:0" onclick="startEditCat('+i+')" title="Переименовать">✎</button>'
      + delBtn
      + '</div>';
  }).join('');
}

function startEditCat(i){
  const row = document.getElementById('cat-row-'+i);
  if(!row) return;
  const oldName = DB.categories[i];
  const color = getCatColor(i);
  row.innerHTML =
    '<input type="color" value="'+color+'"'
    + ' style="width:26px;height:26px;border:none;padding:0;border-radius:50%;cursor:pointer;flex-shrink:0;background:none"'
    + ' onchange="setCatColor('+i+',this.value)"/>'
    + '<input type="text" id="cat-edit-'+i+'" value="'+oldName+'"'
    + ' style="flex:1;padding:6px 8px;font-size:14px;border:0.5px solid var(--border2);border-radius:var(--r-sm);background:var(--card);color:var(--text);font-family:inherit"'
    + ' onkeydown="if(event.key===\'Enter\')saveCatName('+i+');if(event.key===\'Escape\')renderCatManager()"/>'
    + '<button class="btn primary small" onclick="saveCatName('+i+')">✓</button>'
    + '<button class="btn small" onclick="renderCatManager()">✕</button>';
  setTimeout(function(){
    var inp = document.getElementById('cat-edit-'+i);
    if(inp){ inp.focus(); inp.select(); }
  }, 50);
}

function saveCatName(i){
  const inp = document.getElementById('cat-edit-'+i);
  if(!inp) return;
  const newName = inp.value.trim();
  if(!newName){ toast('Название не может быть пустым'); return; }
  if(newName === DB.categories[i]){ renderCatManager(); return; }
  if(DB.categories.includes(newName)){ toast('Такая категория уже есть'); return; }
  const oldName = DB.categories[i];
  DB.categories[i] = newName;
  if(!DB.catRenames) DB.catRenames = [];
  DB.catRenames.push({from: oldName, to: newName, ts: Date.now()});
  saveDB();
  renderCatManager();
  toast('Переименовано: ' + oldName + ' → ' + newName);
}

function addCategory(){
  const name = document.getElementById('new-cat-name').value.trim();
  if(!name){ toast('Введите название'); return; }
  if(DB.categories.includes(name)){ toast('Уже существует'); return; }
  DB.categories.push(name);
  Object.keys(DB.limits).forEach(k=>{
    if(Array.isArray(DB.limits[k])) DB.limits[k].push(3000);
  });
  saveDB();
  document.getElementById('new-cat-name').value = '';
  renderCatManager();
  toast('Добавлено: ' + name);
}

function setCatColor(i, color){
  if(!DB.catColors) DB.catColors = {};
  DB.catColors[i] = color;
  saveDB();
}

function removeCategory(i){
  if(DB.categories.length <= 1) return;
  const name = DB.categories[i];
  DB.categories.splice(i, 1);
  // Shift catColors keys
  const newColors = {};
  Object.entries(DB.catColors||{}).forEach(([k,v]) => {
    const ki = parseInt(k);
    if(ki < i) newColors[ki] = v;
    else if(ki > i) newColors[ki-1] = v;
  });
  DB.catColors = newColors;
  Object.keys(DB.limits).forEach(k=>{
    if(Array.isArray(DB.limits[k])) DB.limits[k].splice(i, 1);
  });
  DB.expenses.forEach(e=>{
    if(e.cat > i) e.cat--;
    else if(e.cat === i) e.cat = 0;
  });
  saveDB();
  renderCatManager();
  toast('Удалено: ' + name);
}

// ─── EXPORT CSV ─────────────────────────────────────────────────────
function exportCSV(){
  const rows = [['id','категория','сумма','дата','комментарий']];
  DB.expenses.filter(e => !e._deleted).forEach(e=>{
    rows.push([e.id, DB.categories[e.cat]||'', e.amount, e.date, e.comment||'']);
  });
  const csv = rows.map(r =>
    r.map(v => '"'+String(v).replace(/"/g,'""')+'"').join(',')
  ).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(csv);
  a.download = 'budget_' + today() + '.csv';
  a.click();
  toast('CSV скачан');
}

function confirmClearData(){
  openModal('modal-confirm-clear');
}

function doClearData(){
  DB.expenses = [];
  DB.assets = [];
  DB.incomes = [];
  DB.limits = {};
  DB.catRenames = [];
  saveDB();
  closeModal('modal-confirm-clear');
  renderBudget();
  toast('Данные удалены');
}

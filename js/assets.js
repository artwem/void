// ─── RENDER: ASSETS ─────────────────────────────────────────────────
function isCredit(bankName){
  // Check explicit creditBanks list (source of truth)
  return (DB.creditBanks||[]).includes(bankName);
}

function renderAssetsHistory(rows, showAll){
  const tbl = document.getElementById('assets-history-table');
  if(!tbl) return;
  const LIMIT = 5;
  const visible = showAll ? rows : rows.slice(0, LIMIT);
  const hasMore = rows.length > LIMIT;

  tbl.innerHTML = '';

  // Header
  const hdr = tbl.insertRow();
  hdr.style.background = 'var(--bg)';
  [{t:'Дата',a:'left'},{t:'Общий актив',a:'right'},{t:'',a:'center'}].forEach(({t,a}) => {
    const th = document.createElement('th');
    th.textContent = t;
    th.style.cssText = 'padding:6px 8px;text-align:'+a+';color:var(--muted);font-weight:500;font-size:11px';
    hdr.appendChild(th);
  });

  // Data rows
  visible.forEach((r) => {
    const prev = rows[rows.indexOf(r) + 1];
    const diff = prev ? r.total - prev.total : null;

    const tr = tbl.insertRow();
    tr.style.cssText = 'border-top:0.5px solid var(--border)';

    const _date = r.date; // capture for closure

    const td1 = tr.insertCell();
    td1.style.cssText = 'padding:12px 8px;font-size:13px;color:var(--muted);cursor:pointer;-webkit-tap-highlight-color:rgba(0,0,0,.05)';
    td1.textContent = r.date;

    const td2 = tr.insertCell();
    td2.style.cssText = 'padding:12px 8px;font-size:13px;font-weight:600;text-align:right;color:var(--text)';
    td2.textContent = fmt(r.total);
    if(diff !== null){
      const sp = document.createElement('span');
      sp.style.cssText = 'font-size:11px;margin-left:6px;color:'+(diff>=0?'#1d9e75':'var(--red)');
      sp.textContent = (diff>=0?'+':'')+fmtShort(diff)+'₽';
      td2.appendChild(sp);
    }

    // Edit button — separate cell, big tap target
    const td3 = tr.insertCell();
    td3.style.cssText = 'padding:8px 6px;text-align:center;width:44px';
    const editBtn = document.createElement('button');
    editBtn.className = 'btn small';
    editBtn.textContent = '✎';
    editBtn.style.cssText = 'width:36px;height:36px;font-size:16px;padding:0;display:flex;align-items:center;justify-content:center';
    editBtn.addEventListener('click', function(e){ e.stopPropagation(); openEditAssetDate(_date); });
    td3.appendChild(editBtn);
  });

  // Show more / collapse button
  if(hasMore){
    const tr = tbl.insertRow();
    const td = tr.insertCell();
    td.colSpan = 2;
    td.style.padding = '8px';
    const btn = document.createElement('button');
    btn.className = 'btn small';
    btn.style.cssText = 'font-size:12px;width:100%';
    if(!showAll){
      btn.textContent = 'Показать все ' + rows.length + ' записей';
      btn.onclick = expandAssetsHistory;
    } else {
      btn.textContent = 'Скрыть ▲';
      btn.onclick = collapseAssetsHistory;
    }
    td.appendChild(btn);
  }
}

let _assetsHistoryRows = [];

function expandAssetsHistory(){
  renderAssetsHistory(_assetsHistoryRows, true);
}

function collapseAssetsHistory(){
  renderAssetsHistory(_assetsHistoryRows, false);
}

function renderAssets(){
  const byBank={};
  const allBanks = [...(DB.banks||[]), ...(DB.creditBanks||[])];
  DB.assets.forEach(a=>{
    // Prefer bankName (string), fall back to index lookup
    const bname = a.bankName || allBanks[a.bank] || '?';
    if(!byBank[bname]) byBank[bname]={latest:0,date:''};
    if(!byBank[bname].date||a.date>=byBank[bname].date){byBank[bname].latest=a.amount;byBank[bname].date=a.date;}
  });
  // Total = sum of normal - sum of credit
  let total=0;
  Object.entries(byBank).forEach(([name,data])=>{
    total += isCredit(name) ? -data.latest : data.latest;
  });
  document.getElementById('total-val').textContent=fmt(total);
  const list=document.getElementById('assets-list');
  list.innerHTML='';
  // All registered banks — regular first, credit last
  const allBanksOrdered = [...(DB.banks||[]), ...(DB.creditBanks||[])];
  if(!allBanksOrdered.length){
    list.innerHTML='<div style="padding:20px 0;text-align:center;color:var(--muted);font-size:13px">Нет банков. Нажмите «Управлять»</div>';
  } else {
    allBanksOrdered.forEach(name => {
      const credit = isCredit(name);
      const data = byBank[name] || {latest:0, date:''};
      const hasData = !!data.date;
      const row = document.createElement('div');
      row.className = 'asset-row';
      row.style.cssText = 'gap:8px';
      const namePart = document.createElement('div');
      namePart.style.cssText = 'flex:1;min-width:0';
      const creditBadge = credit ? ' <span style="font-size:10px;background:var(--red-bg);color:var(--red);padding:1px 5px;border-radius:4px;margin-left:4px">кредит</span>' : '';
      namePart.innerHTML = `<div class="asset-name">${name}${creditBadge}</div>`
        + (hasData ? `<div style="font-size:11px;color:var(--muted);margin-top:2px">обновлено ${data.date}</div>`
                   : `<div style="font-size:11px;color:var(--hint);margin-top:2px">нет данных</div>`);
      const amtSpan = document.createElement('span');
      amtSpan.className = 'asset-amount';
      amtSpan.style.color = credit ? 'var(--red)' : '';
      amtSpan.textContent = hasData ? (credit ? '−' : '') + fmt(data.latest) : '—';
      const editBtn = document.createElement('button');
      editBtn.className = 'btn small';
      editBtn.textContent = '✎';
      editBtn.style.cssText = 'width:36px;height:36px;font-size:16px;padding:0;display:flex;align-items:center;justify-content:center;flex-shrink:0';
      editBtn.addEventListener('click', () => openAssetModal(name));
      row.appendChild(namePart);
      row.appendChild(amtSpan);
      row.appendChild(editBtn);
      list.appendChild(row);
    });
  }
  // Chart
  const assetsSorted=[...DB.assets].sort((a,b)=>a.date.localeCompare(b.date));
  const byDate={};
  assetsSorted.forEach(a=>{
    const key = a.bankName || allBanks[a.bank] || String(a.bank);
    if(!byDate[a.date])byDate[a.date]={};
    byDate[a.date][key]=a.amount;
  });
  const allDates=Object.keys(byDate).sort();
  const labels=[],data=[];
  const running={};
  allDates.forEach(date=>{
    Object.assign(running,byDate[date]);
    labels.push(date.slice(5));
    // Subtract credit banks from total
    let total = 0;
    Object.entries(running).forEach(([bname,amt]) => {
      total += (DB.creditBanks||[]).includes(bname) ? -amt : amt;
    });
    data.push(Math.round(total));
  });
  if(charts.assets) charts.assets.destroy();
  if(labels.length>0){
    charts.assets=new Chart(document.getElementById('chartAssets'),{
      type:'line',
      data:{labels,datasets:[{data,borderColor:'#185fa5',backgroundColor:'rgba(24,95,165,.08)',fill:true,tension:0.3,pointRadius:3,pointBackgroundColor:'#185fa5',borderWidth:2}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:v=>fmt(v.raw)}}},scales:{x:{grid:{display:false},ticks:{font:{size:9},color:'#888'}},y:{grid:{color:'rgba(128,128,128,.1)'},ticks:{callback:v=>fmtShort(v)+'₽',font:{size:9},color:'#888'}}}}
    });
  }

  // History table
  const wrap = document.getElementById('assets-history-wrap');
  const tbl = document.getElementById('assets-history-table');
  if(wrap && tbl && allDates.length > 0){
    wrap.style.display = 'block';
    const rows = allDates.map((date, idx) => ({date, total: data[idx]}))
                         .sort((a,b) => b.date.localeCompare(a.date));
    _assetsHistoryRows = rows;
    renderAssetsHistory(rows, false);
  } else if(wrap){
    wrap.style.display = 'none';
  }
}

// ─── ASSET CRUD ─────────────────────────────────────────────────────
function openAssetModal(prefillBankName){
  const allBanks = [...(DB.banks||[]), ...(DB.creditBanks||[])];
  document.getElementById('asset-bank').innerHTML = allBanks.map((b,i)=>{
    const credit = i >= (DB.banks||[]).length;
    return `<option value="${i}">${b}${credit?' (кредит)':''}</option>`;
  }).join('');
  document.getElementById('asset-date').value = today();
  document.getElementById('asset-amount').value='';
  if(prefillBankName !== undefined){
    const idx = allBanks.indexOf(prefillBankName);
    if(idx >= 0) document.getElementById('asset-bank').value = idx;
  }
  const delBtn = document.getElementById('asset-delete-date-btn');
  if(delBtn) delBtn.style.display = 'none';
  openModal('modal-asset');
}

function saveAsset(){
  const amt = parseFloat(document.getElementById('asset-amount').value);
  if(!amt||amt<=0){toast('Введите сумму');return;}
  const bankIdx = parseInt(document.getElementById('asset-bank').value);
  const allBanks = [...(DB.banks||[]), ...(DB.creditBanks||[])];
  const bankName = allBanks[bankIdx] || '';
  if(!bankName){toast('Банк не найден'); return;}
  // Store bankName as primary key — bank index can drift after sync
  DB.assets.push({id:uid(), bank:bankIdx, bankName, amount:amt, date:document.getElementById('asset-date').value});
  saveDB();
  closeModal('modal-asset');
  renderAssets();
  toast('Добавлено');
}

// ─── BANK MANAGER ───────────────────────────────────────────────────
function openBankManager(){
  renderBankManager();
  openModal('modal-banks');
}

function renderBankManager(){
  function bankRow(b, type, i) {
    const isCredit = type === 'credit';
    const badge = isCredit
      ? '<span style="font-size:10px;background:var(--red-bg);color:var(--red);padding:1px 5px;border-radius:4px;margin-left:6px">кредит</span>'
      : '';
    var t = type, ix = i;
    return '<div class="setting-row" style="cursor:default;gap:6px" id="bank-row-'+t+'-'+ix+'">'
      + '<span class="setting-label" style="flex:1;cursor:pointer" onclick="startEditBank(&quot;'+t+'&quot;,'+ix+')">'+b+badge+'</span>'
      + '<button class="btn small" style="padding:5px 8px;flex-shrink:0" onclick="startEditBank(&quot;'+t+'&quot;,'+ix+')" title="Переименовать">✎</button>'
      + '<button class="btn danger small" onclick="removeBank(&quot;'+t+'&quot;,'+ix+')">✕</button>'
      + '</div>';
  }
  const normalRows = (DB.banks||[]).map((b,i) => bankRow(b,'normal',i)).join('');
  const creditRows = (DB.creditBanks||[]).map((b,i) => bankRow(b,'credit',i)).join('');
  document.getElementById('bank-manager-list').innerHTML =
    (normalRows||'<div style="padding:8px 0;font-size:13px;color:var(--muted)">Нет счетов</div>') +
    '<div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;padding:10px 0 4px">Кредитные (вычитаются)</div>' +
    (creditRows||'<div style="padding:4px 0;font-size:13px;color:var(--muted)">Нет кредитных</div>');
}

function startEditBank(type, i){
  const row = document.getElementById('bank-row-'+type+'-'+i);
  if(!row) return;
  const arr = type === 'credit' ? (DB.creditBanks||[]) : (DB.banks||[]);
  const oldName = arr[i];
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.id = 'bank-edit-'+type+'-'+i;
  inp.value = oldName;
  inp.style.cssText = 'flex:1;padding:6px 8px;font-size:14px;border:0.5px solid var(--border2);border-radius:var(--r-sm);background:var(--card);color:var(--text);font-family:inherit';
  inp.addEventListener('keydown', function(e){
    if(e.key === 'Enter') saveBankName(type, i);
    if(e.key === 'Escape') renderBankManager();
  });
  const btnOk = document.createElement('button');
  btnOk.className = 'btn primary small';
  btnOk.textContent = '✓';
  btnOk.onclick = function(){ saveBankName(type, i); };
  const btnCancel = document.createElement('button');
  btnCancel.className = 'btn small';
  btnCancel.textContent = '✕';
  btnCancel.onclick = renderBankManager;
  row.innerHTML = '';
  row.append(inp, btnOk, btnCancel);
  setTimeout(function(){ inp.focus(); inp.select(); }, 50);
}

function saveBankName(type, i){
  const inp = document.getElementById('bank-edit-'+type+'-'+i);
  if(!inp) return;
  const newName = inp.value.trim();
  if(!newName){ toast('Название не может быть пустым'); return; }
  const arr = type === 'credit' ? DB.creditBanks : DB.banks;
  const oldName = arr[i];
  if(newName === oldName){ renderBankManager(); return; }
  const allNames = [...(DB.banks||[]), ...(DB.creditBanks||[])];
  if(allNames.includes(newName)){ toast('Такой банк уже есть'); return; }
  arr[i] = newName;
  // Update bankName in all assets
  DB.assets.forEach(a => { if(a.bankName === oldName) a.bankName = newName; });
  // Store rename for sync
  if(!DB.bankRenames) DB.bankRenames = [];
  DB.bankRenames.push({from: oldName, to: newName, ts: Date.now()});
  saveDB();
  renderBankManager();
  renderAssets();
  toast('Переименовано: ' + oldName + ' → ' + newName);
}

function toggleCreditCheckbox(){
  const cb = document.getElementById('new-bank-credit');
  const vis = document.getElementById('credit-checkbox-visual');
  cb.checked = !cb.checked;
  if(cb.checked){
    vis.style.background = 'var(--red)';
    vis.style.borderColor = 'var(--red)';
    vis.innerHTML = '<svg width="11" height="9" viewBox="0 0 11 9" fill="none"><path d="M1 4L4 7.5L10 1" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  } else {
    vis.style.background = 'var(--card)';
    vis.style.borderColor = 'var(--border2)';
    vis.innerHTML = '';
  }
}

function addBank(){
  const name = document.getElementById('new-bank-name').value.trim();
  if(!name) return;
  const isCreditBank = document.getElementById('new-bank-credit').checked;
  if(isCreditBank){
    if(!DB.creditBanks) DB.creditBanks=[];
    // Prefix with "Кредитка " if no credit-related word already in name
    const hasCredit = /кредит/i.test(name);
    const finalName = hasCredit ? name : 'Кредитка ' + name;
    DB.creditBanks.push(finalName);
    document.getElementById('new-bank-name').value = finalName; // show what was saved
  }
  else DB.banks.push(name);
  saveDB();
  document.getElementById('new-bank-name').value='';
  document.getElementById('new-bank-credit').checked=false;
  const vis = document.getElementById('credit-checkbox-visual');
  if(vis){ vis.style.background='var(--card)'; vis.style.borderColor='var(--border2)'; vis.innerHTML=''; }
  renderBankManager();
  toast(isCreditBank?'Кредитный счёт добавлен':'Банк добавлен');
}

function removeBank(type, i){
  const arr = type === 'credit' ? DB.creditBanks : DB.banks;
  const bankName = arr[i];
  const hasHistory = (DB.assets||[]).some(a => (a.bankName || '') === bankName);
  if(hasHistory){ toast('Нельзя удалить: у банка есть история данных'); return; }
  arr.splice(i, 1);
  if(!DB.bankDeletions) DB.bankDeletions = [];
  DB.bankDeletions.push(bankName);
  saveDB();
  renderBankManager();
  renderAssets();
  toast('Удалено: ' + bankName);
}

// ─── ASSET RECORD EDIT / DELETE ─────────────────────────────────────
let _editingAssetDate = null;

function openEditAssetDate(date){
  _editingAssetDate = date;
  const allBanks = [...(DB.banks||[]), ...(DB.creditBanks||[])];

  document.getElementById('asset-edit-title').textContent = 'Активы за ' + date;

  const container = document.getElementById('asset-edit-rows');
  container.innerHTML = '';

  // Show a row for every known bank — pre-fill from existing records
  const byBank = {};
  DB.assets.filter(a => a.date === date).forEach(a => { byBank[a.bankName] = a.amount; });

  allBanks.forEach((bankName, idx) => {
    const credit = isCredit(bankName);
    const existing = byBank[bankName];

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 0;border-top:0.5px solid var(--border)';

    const lbl = document.createElement('span');
    lbl.style.cssText = 'flex:1;font-size:13px;color:'+(credit?'var(--red)':'var(--text)');
    lbl.textContent = bankName;

    const inp = document.createElement('input');
    inp.type = 'number';
    inp.inputMode = 'decimal';
    inp.id = 'asset-edit-inp-'+idx;
    inp.placeholder = '0';
    inp.value = existing !== undefined ? existing : '';
    inp.style.cssText = 'width:120px;text-align:right;padding:6px 8px;font-size:14px;border:0.5px solid var(--border2);border-radius:var(--r-sm);background:var(--card);color:var(--text)';

    row.appendChild(lbl);
    row.appendChild(inp);
    container.appendChild(row);
  });

  if(!allBanks.length){
    container.innerHTML = '<div style="padding:16px 0;text-align:center;color:var(--muted);font-size:13px">Нет счетов. Добавьте банки в разделе «Управлять».</div>';
  }

  openModal('modal-asset-edit');
}

function saveAssetEdit(){
  if(!_editingAssetDate) return;
  const allBanks = [...(DB.banks||[]), ...(DB.creditBanks||[])];
  const date = _editingAssetDate;

  // Remove existing records for this date
  DB.assets = DB.assets.filter(a => a.date !== date);

  // Save new values for each bank that has a value
  allBanks.forEach((bankName, idx) => {
    const inp = document.getElementById('asset-edit-inp-'+idx);
    if(!inp) return;
    const val = parseFloat(inp.value);
    if(!val || val <= 0) return; // skip empty/zero
    DB.assets.push({
      id: uid(),
      bank: idx,
      bankName,
      amount: val,
      date
    });
  });

  saveDB();
  closeModal('modal-asset-edit');
  renderAssets();
  toast('Сохранено за ' + date);
}

function deleteAssetDateConfirm(){
  if(!_editingAssetDate) return;
  DB.assets = DB.assets.filter(a => a.date !== _editingAssetDate);
  saveDB();
  closeModal('modal-asset-edit');
  renderAssets();
  toast('Записи за ' + _editingAssetDate + ' удалены');
}

function deleteAssetDate(date){
  if(!date) return;
  DB.assets = DB.assets.filter(a => a.date !== date);
  saveDB();
  closeModal('modal-asset');
  renderAssets();
  toast('Записи за ' + date + ' удалены');
}

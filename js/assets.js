// ─── RENDER: ASSETS ─────────────────────────────────────────────────
function isCredit(bankName){
  // Check explicit creditBanks list (source of truth)
  return (DB.creditBanks||[]).includes(bankName);
}

function renderAssetsHistory(rows, showAll){
  const tbl = document.getElementById('assets-history-table');
  const LIMIT = 5;
  const visible = showAll ? rows : rows.slice(0, LIMIT);
  const hasMore = rows.length > LIMIT;

  let html = '<tr style="background:var(--bg)">'
    + '<th style="padding:6px 8px;text-align:left;color:var(--muted);font-weight:500;font-size:11px">Дата</th>'
    + '<th style="padding:6px 8px;text-align:right;color:var(--muted);font-weight:500;font-size:11px">Общий актив</th>'
    + '</tr>';

  visible.forEach((r, idx) => {
    const prev = rows[rows.indexOf(r) + 1];
    const diff = prev ? r.total - prev.total : null;
    const diffStr = diff !== null
      ? '<span style="font-size:10px;margin-left:6px;color:'+(diff>=0?'#1d9e75':'var(--red)')+'">'+
        (diff>=0?'+':'')+fmtShort(diff)+'₽</span>'
      : '';
    const dateAttr = 'openEditAssetDate(&quot;'+r.date+'&quot;)';
    html += '<tr style="border-top:0.5px solid var(--border);cursor:pointer" onclick="'+dateAttr+'" title="Редактировать / удалить">'
      + '<td style="padding:7px 8px;font-size:12px;color:var(--muted)">'+r.date+' <span style=\"opacity:.5;font-size:10px\">✎</span></td>'
      + '<td style="padding:7px 8px;font-size:13px;font-weight:600;text-align:right;color:var(--text)">'+fmt(r.total)+diffStr+'</td>'
      + '</tr>';
  });

  if(hasMore && !showAll){
    html += '<tr><td colspan="2" style="padding:8px;text-align:center">'
      + '<button class="btn small" style="font-size:12px;width:100%" onclick="expandAssetsHistory()">'
      + 'Показать все ' + rows.length + ' записей</button></td></tr>';
  } else if(hasMore && showAll){
    html += '<tr><td colspan="2" style="padding:8px;text-align:center">'
      + '<button class="btn small" style="font-size:12px;width:100%" onclick="collapseAssetsHistory()">'
      + 'Скрыть ▲</button></td></tr>';
  }

  tbl.innerHTML = html;
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
  // Normal banks first, then credit
  const sorted = Object.entries(byBank).sort((a,b)=>{
    const ac=isCredit(a[0]),bc=isCredit(b[0]);
    return ac===bc?0:ac?1:-1;
  });
  sorted.forEach(([name,data])=>{
    const credit=isCredit(name);
    const row=document.createElement('div');
    row.className='asset-row';
    row.innerHTML=`
      <span class="asset-name">${name}${credit?' <span style="font-size:10px;background:var(--red-bg);color:var(--red);padding:1px 5px;border-radius:4px;margin-left:4px">кредит</span>':''}</span>
      <span class="asset-amount" style="${credit?'color:var(--red)':''}">${credit?'−':''}${fmt(data.latest)}</span>`;
    list.appendChild(row);
  });
  if(!sorted.length) list.innerHTML='<div style="padding:20px 0;text-align:center;color:var(--muted);font-size:13px">Нет данных</div>';
  const blist=document.getElementById('banks-display');
  blist.innerHTML=[
    ...(DB.banks||[]).map(b=>`<div class="asset-row"><span class="asset-name">${b}</span><span style="font-size:11px;color:var(--hint)">счёт</span></div>`),
    ...(DB.creditBanks||[]).map(b=>`<div class="asset-row"><span class="asset-name">${b}</span><span style="font-size:11px;color:var(--red)">кредит</span></div>`)
  ].join('');
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
function openAssetModal(){
  const allBanks = [...(DB.banks||[]), ...(DB.creditBanks||[])];
  document.getElementById('asset-bank').innerHTML = allBanks.map((b,i)=>{
    const credit = i >= (DB.banks||[]).length;
    return `<option value="${i}">${b}${credit?' (кредит)':''}</option>`;
  }).join('');
  document.getElementById('asset-date').value = today();
  document.getElementById('asset-amount').value='';
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
  arr.splice(i, 1);
  // Remove all asset records for this bank
  DB.assets = DB.assets.filter(a => (a.bankName || '') !== bankName);
  saveDB();
  renderBankManager();
  renderAssets();
  toast('Удалено: ' + bankName);
}

// ─── ASSET RECORD EDIT / DELETE ─────────────────────────────────────
function openEditAssetDate(date){
  // Open modal pre-filled for editing a specific date
  const allBanks = [...(DB.banks||[]), ...(DB.creditBanks||[])];
  document.getElementById('asset-bank').innerHTML = allBanks.map((b,i) => {
    const credit = i >= (DB.banks||[]).length;
    return '<option value="'+i+'">'+b+(credit?' (кредит)':'')+'</option>';
  }).join('');
  document.getElementById('asset-date').value = date;
  // Pre-fill amount from most recent entry for first bank on this date
  const existing = DB.assets.filter(a => a.date === date);
  if(existing.length > 0){
    const bankIdx = allBanks.indexOf(existing[0].bankName);
    if(bankIdx >= 0) document.getElementById('asset-bank').value = bankIdx;
    document.getElementById('asset-amount').value = existing[0].amount;
  } else {
    document.getElementById('asset-amount').value = '';
  }
  document.getElementById('asset-comment').value = '';
  // Show delete-date button
  const delBtn = document.getElementById('asset-delete-date-btn');
  if(delBtn) { delBtn.style.display = 'block'; delBtn.dataset.date = date; }
  openModal('modal-asset');
}

function deleteAssetDate(date){
  if(!date) return;
  DB.assets = DB.assets.filter(a => a.date !== date);
  saveDB();
  closeModal('modal-asset');
  renderAssets();
  toast('Записи за ' + date + ' удалены');
}

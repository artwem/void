// ─── RENDER: ASSETS ─────────────────────────────────────────────────
function isCredit(bankName){
  // Check explicit creditBanks list (source of truth)
  return (DB.creditBanks||[]).includes(bankName);
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
    data.push(Math.round(Object.values(running).reduce((s,v)=>s+v,0)));
  });
  if(charts.assets) charts.assets.destroy();
  if(labels.length>0){
    charts.assets=new Chart(document.getElementById('chartAssets'),{
      type:'line',
      data:{labels,datasets:[{data,borderColor:'#185fa5',backgroundColor:'rgba(24,95,165,.08)',fill:true,tension:0.3,pointRadius:3,pointBackgroundColor:'#185fa5',borderWidth:2}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:v=>fmt(v.raw)}}},scales:{x:{grid:{display:false},ticks:{font:{size:9},color:'#888'}},y:{grid:{color:'rgba(128,128,128,.1)'},ticks:{callback:v=>fmtShort(v)+'₽',font:{size:9},color:'#888'}}}}
    });
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
  const normalRows = (DB.banks||[]).map((b,i)=>`
    <div class="setting-row" style="cursor:default">
      <span class="setting-label">${b}</span>
      <button class="btn danger small" onclick="removeBank('normal',${i})">Удалить</button>
    </div>`).join('');
  const creditRows = (DB.creditBanks||[]).map((b,i)=>`
    <div class="setting-row" style="cursor:default">
      <span class="setting-label">${b} <span style="font-size:10px;background:var(--red-bg);color:var(--red);padding:1px 5px;border-radius:4px">кредит</span></span>
      <button class="btn danger small" onclick="removeBank('credit',${i})">Удалить</button>
    </div>`).join('');
  document.getElementById('bank-manager-list').innerHTML =
    (normalRows||'<div style="padding:8px 0;font-size:13px;color:var(--muted)">Нет счетов</div>') +
    '<div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;padding:10px 0 4px">Кредитные (вычитаются)</div>' +
    (creditRows||'<div style="padding:4px 0;font-size:13px;color:var(--muted)">Нет кредитных</div>');
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
  if(type==='credit') DB.creditBanks.splice(i,1);
  else DB.banks.splice(i,1);
  saveDB();
  renderBankManager();
}

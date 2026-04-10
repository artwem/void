// ─── CALCULATOR ─────────────────────────────────────────────────────
let chartCalc = null;


function setCalcUnit(val, btn){
  document.getElementById('calc-unit').value = val;
  document.querySelectorAll('.cu-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  calcUpdate();
}

function calcUpdate(){
  const start    = parseFloat(document.getElementById('calc-start').value)    || 0;
  const monthly  = parseFloat(document.getElementById('calc-monthly').value)  || 0;
  const rate     = parseFloat(document.getElementById('calc-rate').value)     || 0;
  const duration = parseFloat(document.getElementById('calc-duration').value) || 1;
  const unit     = document.getElementById('calc-unit').value;
  const cap      = document.getElementById('calc-cap').value;

  // Convert everything to months (for loop), and days (for daily cap)
  let months, totalDays;
  if(unit==='years'){
    months    = Math.max(1, Math.min(600, Math.round(duration * 12)));
    totalDays = Math.round(duration * 365);
  } else if(unit==='days'){
    totalDays = Math.max(1, Math.round(duration));
    months    = Math.max(1, Math.round(totalDays / 30.4375));
  } else {
    months    = Math.max(1, Math.min(600, Math.round(duration)));
    totalDays = Math.round(months * 30.4375);
  }

  const r = rate / 100;

  // Build month-by-month schedule
  const balances  = [];  // total balance each month
  const invested  = [];  // cumulative invested each month

  let balance = start;
  let totalInvested = start;

  for(let mo=1; mo<=months; mo++){
    // Add monthly contribution at start of month
    if(mo>1){ balance += monthly; totalInvested += monthly; }

    // Apply interest for this month
    if(cap==='none'){
      // Simple interest: apply proportionally
      balance += balance * (r / 12);
    } else if(cap==='daily'){
      const daysInMonth = 30.4375;
      balance *= Math.pow(1 + r/365, daysInMonth);
    } else if(cap==='monthly'){
      balance *= (1 + r/12);
    }

    balances.push(Math.round(balance));
    invested.push(Math.round(totalInvested));
  }

  const finalBalance  = balances[months-1] || 0;
  const finalInvested = invested[months-1]  || 0;
  const profit        = finalBalance - finalInvested;
  const yearlyIncome  = months>=12 ? profit/(months/12) : profit*12/months;

  // Effective annual rate
  const effRate = finalInvested>0
    ? (Math.pow(finalBalance/finalInvested, 12/months) - 1)*100
    : 0;

  document.getElementById('calc-total').textContent     = fmtCalc(finalBalance);
  document.getElementById('calc-invested').textContent  = fmtCalc(finalInvested);
  document.getElementById('calc-profit').textContent    = fmtCalc(profit);
  document.getElementById('calc-yearly').textContent    = fmtCalc(Math.round(yearlyIncome));
  document.getElementById('calc-eff-rate').textContent  = effRate.toFixed(2)+'%';
  {
    let lbl;
    if(unit==='days') lbl = totalDays+' дн';
    else if(unit==='years') lbl = duration+' год';
    else lbl = months<12 ? months+' мес' : (months%12===0 ? months/12+' лет' : Math.floor(months/12)+'г '+months%12+'м');
    document.getElementById('calc-period-lbl').textContent = lbl;
  }

  // Chart — sample at most 60 points for performance
  const step = Math.max(1, Math.ceil(months/60));
  const labels=[], dataTotal=[], dataInvested=[];
  for(let i=0;i<months;i+=step){
    labels.push(i+1);
    dataTotal.push(balances[i]);
    dataInvested.push(invested[i]);
  }
  // Always include last point
  if((months-1)%step!==0){
    labels.push(months);
    dataTotal.push(balances[months-1]);
    dataInvested.push(invested[months-1]);
  }

  if(chartCalc) chartCalc.destroy();
  chartCalc = new Chart(document.getElementById('chartCalc'),{
    type:'line',
    data:{
      labels,
      datasets:[
        {label:'Итого',data:dataTotal,borderColor:'#1a1a18',backgroundColor:'rgba(26,26,24,.07)',fill:true,tension:0.3,pointRadius:0,borderWidth:2},
        {label:'Вложено',data:dataInvested,borderColor:'#c8c7c0',backgroundColor:'transparent',fill:false,tension:0.3,pointRadius:0,borderWidth:1.5,borderDash:[4,3]}
      ]
    },
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:false},tooltip:{callbacks:{label:v=>v.dataset.label+': '+fmtCalc(v.raw)}}},scales:{x:{grid:{display:false},ticks:{font:{size:9},color:'#888',maxTicksLimit:8,callback:(v,i)=>{const mo=labels[i];return mo%12===0?mo/12+'г':mo;}}},y:{min:0,grid:{color:'rgba(128,128,128,.08)'},ticks:{callback:v=>fmtShort(v)+'₽',font:{size:9},color:'#888',maxTicksLimit:6}}}}
  });

  // Store data for table toggle
  window._calcData = {balances, invested, months};
  renderCalcTable();
}

function renderCalcTable(){
  const d = window._calcData;
  if(!d) return;
  const {balances, invested, months} = d;
  const byMonth = document.getElementById('calc-table-month-btn') &&
                  document.getElementById('calc-table-month-btn').classList.contains('active');

  const table = document.getElementById('calc-table');
  let html = '<div style="display:flex;gap:6px;padding:0 14px 10px">'
    + '<button class="cu-btn'+(byMonth?'':' active')+'" id="calc-table-year-btn" onclick="setCalcTableView(false)">По годам</button>'
    + '<button class="cu-btn'+(byMonth?' active':'')+'" id="calc-table-month-btn" onclick="setCalcTableView(true)">По месяцам</button>'
    + '</div>';

  html += '<table style="width:100%;border-collapse:collapse;font-size:12px">';
  const colLabel = byMonth ? 'Месяц' : 'Год';
  html += '<tr style="background:var(--bg)">'
    + '<th style="padding:7px 10px;text-align:left;color:var(--muted);font-weight:500">'+colLabel+'</th>'
    + '<th style="padding:7px 10px;text-align:right;color:var(--muted);font-weight:500">Вложено</th>'
    + '<th style="padding:7px 10px;text-align:right;color:var(--muted);font-weight:500">Проценты</th>'
    + '<th style="padding:7px 10px;text-align:right;color:var(--muted);font-weight:500">Итого</th>'
    + '</tr>';

  if(byMonth){
    for(let mo=1; mo<=months; mo++){
      const tot = balances[mo-1]||0;
      const inv = invested[mo-1]||0;
      const prc = tot - inv;
      const isLast = mo===months;
      const label = mo < 12 ? mo+' мес'
        : (mo%12===0 ? mo/12+' лет' : Math.floor(mo/12)+'г '+mo%12+'м');
      html += '<tr style="'+(isLast?'font-weight:600;background:var(--bg);':'')+'border-top:0.5px solid var(--border)">'
        + '<td style="padding:6px 10px">'+label+'</td>'
        + '<td style="padding:6px 10px;text-align:right;color:var(--muted)">'+fmtCalc(inv)+'</td>'
        + '<td style="padding:6px 10px;text-align:right;color:var(--green)">'+fmtCalc(prc)+'</td>'
        + '<td style="padding:6px 10px;text-align:right">'+fmtCalc(tot)+'</td>'
        + '</tr>';
    }
  } else {
    for(let yr=1; yr<=Math.ceil(months/12); yr++){
      const mo = Math.min(yr*12, months) - 1;
      const tot = balances[mo]||0;
      const inv = invested[mo]||0;
      const prc = tot - inv;
      const isLast = yr===Math.ceil(months/12);
      html += '<tr style="'+(isLast?'font-weight:600;background:var(--bg);':'')+'border-top:0.5px solid var(--border)">'
        + '<td style="padding:8px 10px">'+yr+' год</td>'
        + '<td style="padding:8px 10px;text-align:right;color:var(--muted)">'+fmtCalc(inv)+'</td>'
        + '<td style="padding:8px 10px;text-align:right;color:var(--green)">'+fmtCalc(prc)+'</td>'
        + '<td style="padding:8px 10px;text-align:right">'+fmtCalc(tot)+'</td>'
        + '</tr>';
    }
  }
  html += '</table>';
  table.innerHTML = html;
}

function setCalcTableView(byMonth){
  // Re-render table with new view
  const d = window._calcData;
  if(!d) return;
  const {balances, invested, months} = d;
  const table = document.getElementById('calc-table');

  let html = '<div style="display:flex;gap:6px;padding:0 14px 10px">'
    + '<button class="cu-btn'+(byMonth?'':' active')+'" id="calc-table-year-btn" onclick="setCalcTableView(false)">По годам</button>'
    + '<button class="cu-btn'+(byMonth?' active':'')+'" id="calc-table-month-btn" onclick="setCalcTableView(true)">По месяцам</button>'
    + '</div>';

  html += '<table style="width:100%;border-collapse:collapse;font-size:12px">';
  html += '<tr style="background:var(--bg)">'
    + '<th style="padding:7px 10px;text-align:left;color:var(--muted);font-weight:500">'+(byMonth?'Месяц':'Год')+'</th>'
    + '<th style="padding:7px 10px;text-align:right;color:var(--muted);font-weight:500">Вложено</th>'
    + '<th style="padding:7px 10px;text-align:right;color:var(--muted);font-weight:500">Проценты</th>'
    + '<th style="padding:7px 10px;text-align:right;color:var(--muted);font-weight:500">Итого</th>'
    + '</tr>';

  if(byMonth){
    for(let mo=1; mo<=months; mo++){
      const tot = balances[mo-1]||0, inv = invested[mo-1]||0, prc = tot-inv;
      const isLast = mo===months;
      const label = mo<12 ? mo+' мес' : (mo%12===0 ? mo/12+' лет' : Math.floor(mo/12)+'г '+mo%12+'м');
      html += '<tr style="'+(isLast?'font-weight:600;background:var(--bg);':'')+'border-top:0.5px solid var(--border)">'
        + '<td style="padding:6px 10px">'+label+'</td>'
        + '<td style="padding:6px 10px;text-align:right;color:var(--muted)">'+fmtCalc(inv)+'</td>'
        + '<td style="padding:6px 10px;text-align:right;color:var(--green)">'+fmtCalc(prc)+'</td>'
        + '<td style="padding:6px 10px;text-align:right">'+fmtCalc(tot)+'</td>'
        + '</tr>';
    }
  } else {
    for(let yr=1; yr<=Math.ceil(months/12); yr++){
      const mo = Math.min(yr*12,months)-1;
      const tot = balances[mo]||0, inv = invested[mo]||0, prc = tot-inv;
      const isLast = yr===Math.ceil(months/12);
      html += '<tr style="'+(isLast?'font-weight:600;background:var(--bg);':'')+'border-top:0.5px solid var(--border)">'
        + '<td style="padding:8px 10px">'+yr+' год</td>'
        + '<td style="padding:8px 10px;text-align:right;color:var(--muted)">'+fmtCalc(inv)+'</td>'
        + '<td style="padding:8px 10px;text-align:right;color:var(--green)">'+fmtCalc(prc)+'</td>'
        + '<td style="padding:8px 10px;text-align:right">'+fmtCalc(tot)+'</td>'
        + '</tr>';
    }
  }
  html += '</table>';
  table.innerHTML = html;
}

function fmtCalc(n){
  return Math.round(n).toLocaleString('ru-RU')+' ₽';
}

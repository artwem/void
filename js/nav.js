// ─── NAV / PAGES ────────────────────────────────────────────────────
let currentPage = 'budget';
function showPage(name,btn){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('page-'+name).classList.add('active');
  if(btn) btn.classList.add('active');
  currentPage = name;
  document.getElementById('fab').style.display = (name==='budget'||name==='day') ? 'flex' : 'none';
  document.getElementById('fab').textContent = '+';
  if(name==='budget') renderBudget();
  if(name==='day') renderDay();
  if(name==='stats') renderStats();
  if(name==='assets') renderAssets();
  if(name==='calc'){
    // Pre-fill start amount with current total assets
    const allBanks = [...(DB.banks||[]), ...(DB.creditBanks||[])];
    const byBank = {};
    (DB.assets||[]).forEach(a => {
      const bname = a.bankName || allBanks[a.bank] || '';
      if(!byBank[bname] || a.date > byBank[bname].date) byBank[bname] = a;
    });
    let total = 0;
    Object.entries(byBank).forEach(([name, a]) => {
      total += (DB.creditBanks||[]).includes(name) ? -a.amount : a.amount;
    });
    if(total > 0) document.getElementById('calc-start').value = Math.round(total);
    setTimeout(calcUpdate, 50);
  }
  if(name==='income') renderIncome();
  if(name==='settings') renderSettings();
}

// ─── MONTH NAV ──────────────────────────────────────────────────────
function changeMonth(d){
  currentMonth.m+=d;
  if(currentMonth.m>11){currentMonth.m=0;currentMonth.y++;}
  if(currentMonth.m<0){currentMonth.m=11;currentMonth.y--;}
  renderBudget();
  syncBudgetMonthInput();
}

function syncBudgetMonthInput(){
  const inp = document.getElementById('budget-month-inp');
  if(inp) inp.value = currentMonth.y+'-'+String(currentMonth.m+1).padStart(2,'0');
}

function onBudgetMonthChange(val){
  if(!val) return;
  const [y,m] = val.split('-').map(Number);
  currentMonth = {y, m:m-1};
  renderBudget();
}

// ─── DAY NAV ────────────────────────────────────────────────────────
function changeDay(d){
  // Parse as local date (add T12:00:00 to avoid UTC midnight shift)
  const dt = new Date(currentDay + 'T12:00:00');
  dt.setDate(dt.getDate()+d);
  currentDay = dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0');
  renderDay();
}

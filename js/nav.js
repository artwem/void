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
  if(name==='calc'){setTimeout(calcUpdate,50);}
  if(name==='income') renderIncome();
  if(name==='settings') renderSettings();
}

// ─── MONTH NAV ──────────────────────────────────────────────────────
function changeMonth(d){
  currentMonth.m+=d;
  if(currentMonth.m>11){currentMonth.m=0;currentMonth.y++;}
  if(currentMonth.m<0){currentMonth.m=11;currentMonth.y--;}
  renderBudget();
}

// ─── DAY NAV ────────────────────────────────────────────────────────
function changeDay(d){
  const dt = new Date(currentDay);
  dt.setDate(dt.getDate()+d);
  currentDay = dt.toISOString().split('T')[0];
  renderDay();
}

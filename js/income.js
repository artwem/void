// ─── INCOME ─────────────────────────────────────────────────────────
let currentIncomeMonth = null;
let editingIncomeId = null;

function getIncomeMonthExpenses(y, m){
  const k = monthKey(y, m);
  return (DB.incomes||[]).filter(i => i.date.startsWith(k));
}

function renderIncome(){
  if(!currentIncomeMonth){
    const now = new Date();
    currentIncomeMonth = {y: now.getFullYear(), m: now.getMonth()};
  }
  const {y, m} = currentIncomeMonth;
  document.getElementById('income-month-label').textContent = MONTHS_RU[m]+' '+y;
  syncIncomeMonthInput();

  const incomes = getIncomeMonthExpenses(y, m);
  const totalIncome = incomes.reduce((s,i) => s+i.amount, 0);
  const totalExpenses = getMonthExpenses(y, m).reduce((s,e) => s+e.amount, 0);
  const balance = totalIncome - totalExpenses;

  document.getElementById('income-total').textContent = fmt(totalIncome);
  document.getElementById('income-expenses').textContent = fmt(totalExpenses);
  const balEl = document.getElementById('income-balance');
  balEl.textContent = fmt(Math.abs(balance));
  balEl.className = 's-val ' + (balance >= 0 ? 'ok' : 'over');

  const list = document.getElementById('income-list');
  list.innerHTML = '';
  if(!incomes.length){
    list.innerHTML = '<div class="empty-day"><div style="font-size:28px">💰</div><p>Нет доходов за этот месяц</p></div>';
    return;
  }
  // Sort by date then amount
  const sorted = [...incomes].sort((a,b) => a.date.localeCompare(b.date) || b.amount - a.amount);
  sorted.forEach(inc => {
    const row = document.createElement('div');
    row.className = 'setting-row';
    row.style.cursor = 'pointer';
    row.innerHTML = `
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:500">${inc.source}</div>
        <div style="font-size:11px;color:var(--muted)">${inc.date}${inc.comment ? ' · '+inc.comment : ''}</div>
      </div>
      <span style="font-size:15px;font-weight:600;color:var(--green);flex-shrink:0">+${fmt(inc.amount)}</span>
      <button style="padding:4px 8px;background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;flex-shrink:0" onclick="editIncome('${inc.id}',event)">✎</button>
    `;
    list.appendChild(row);
  });
}

function onIncomeMonthChange(val){
  if(!val) return;
  const [y,m] = val.split('-').map(Number);
  currentIncomeMonth = {y, m:m-1};
  renderIncome();
}

function syncIncomeMonthInput(){
  if(!currentIncomeMonth) return;
  const inp = document.getElementById('income-month-inp');
  if(inp) inp.value = currentIncomeMonth.y+'-'+String(currentIncomeMonth.m+1).padStart(2,'0');
}

function changeIncomeMonth(d){
  if(!currentIncomeMonth){
    const now = new Date();
    currentIncomeMonth = {y: now.getFullYear(), m: now.getMonth()};
  }
  currentIncomeMonth.m += d;
  if(currentIncomeMonth.m > 11){currentIncomeMonth.m = 0; currentIncomeMonth.y++;}
  if(currentIncomeMonth.m < 0){currentIncomeMonth.m = 11; currentIncomeMonth.y--;}
  renderIncome();
  syncIncomeMonthInput();
}

function openAddIncome(){
  editingIncomeId = null;
  document.getElementById('income-modal-title').textContent = 'Добавить доход';
  document.getElementById('inc-delete-btn').style.display = 'none';
  document.getElementById('inc-source').value = '';
  document.getElementById('inc-amount').value = '';
  document.getElementById('inc-date').value = today();
  document.getElementById('inc-comment').value = '';
  openModal('modal-income');
}

function editIncome(id, e){
  if(e) e.stopPropagation();
  const inc = (DB.incomes||[]).find(i => i.id === id);
  if(!inc) return;
  editingIncomeId = id;
  document.getElementById('income-modal-title').textContent = 'Редактировать доход';
  document.getElementById('inc-delete-btn').style.display = 'block';
  document.getElementById('inc-source').value = inc.source;
  document.getElementById('inc-amount').value = inc.amount;
  document.getElementById('inc-date').value = inc.date;
  document.getElementById('inc-comment').value = inc.comment || '';
  openModal('modal-income');
}

function saveIncome(){
  const source = document.getElementById('inc-source').value.trim();
  const amt = parseFloat(document.getElementById('inc-amount').value);
  if(!source){ toast('Укажите источник'); return; }
  if(!amt || amt <= 0){ toast('Введите сумму'); return; }
  const obj = { source, amount: amt, date: document.getElementById('inc-date').value, comment: document.getElementById('inc-comment').value };
  if(!DB.incomes) DB.incomes = [];
  if(editingIncomeId){
    const idx = DB.incomes.findIndex(i => i.id === editingIncomeId);
    if(idx >= 0) DB.incomes[idx] = {...DB.incomes[idx], ...obj};
  } else {
    obj.id = uid();
    DB.incomes.push(obj);
  }
  saveDB();
  closeModal('modal-income');
  renderIncome();
  toast(editingIncomeId ? 'Обновлено' : 'Доход добавлен');
}

function deleteIncome(){
  if(!editingIncomeId) return;
  DB.incomes = (DB.incomes||[]).filter(i => i.id !== editingIncomeId);
  saveDB();
  closeModal('modal-income');
  renderIncome();
  toast('Удалено');
}

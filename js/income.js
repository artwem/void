// ─── INCOME ─────────────────────────────────────────────────────────
let currentIncomeMonth = null;
let editingIncomeId = null;
let _selectedIncomeTag = null;

function getIncomeTagColor(tagName){
  const idx = (DB.incomeTags||[]).indexOf(tagName);
  if(idx < 0) return '#7f8c8d';
  return (DB.incomeTagColors && DB.incomeTagColors[idx]) || INCOME_TAG_COLORS[idx % INCOME_TAG_COLORS.length];
}

function renderIncomeTagsInModal(){
  const wrap = document.getElementById('inc-tag-chips');
  if(!wrap) return;
  wrap.innerHTML = '';
  const tags = DB.incomeTags || [];
  const noTag = document.createElement('span');
  noTag.textContent = 'Без тега';
  const noSel = !_selectedIncomeTag;
  noTag.style.cssText = 'display:inline-flex;align-items:center;padding:4px 12px;border-radius:20px;font-size:13px;cursor:pointer;user-select:none;border:1.5px solid '+(noSel?'var(--accent)':'var(--border2)')+';color:'+(noSel?'var(--accent)':'var(--muted)');
  noTag.onclick = () => { _selectedIncomeTag = null; renderIncomeTagsInModal(); };
  wrap.appendChild(noTag);
  tags.forEach(tag => {
    const active = _selectedIncomeTag === tag;
    const color = getIncomeTagColor(tag);
    const chip = document.createElement('span');
    chip.textContent = tag;
    chip.style.cssText = 'display:inline-flex;align-items:center;padding:4px 12px;border-radius:20px;font-size:13px;cursor:pointer;user-select:none;border:1.5px solid '+(active?color:'var(--border2)')+';color:'+(active?color:'var(--text)')+';background:'+(active?color+'18':'transparent');
    chip.onclick = () => { _selectedIncomeTag = tag; renderIncomeTagsInModal(); };
    wrap.appendChild(chip);
  });
}



function renderIncome(){
  if(!currentIncomeMonth){
    const now = new Date();
    currentIncomeMonth = {y: now.getFullYear(), m: now.getMonth()};
  }
  const {y, m} = currentIncomeMonth;
  document.getElementById('income-month-label').textContent = MONTHS_RU[m]+' '+y;
  syncIncomeMonthInput();

  const k = monthKey(y, m);
  const incomes = (DB.incomes||[]).filter(i => i.date.startsWith(k));
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
    const tagColor = inc.tag ? getIncomeTagColor(inc.tag) : '';
    const tagBadge = inc.tag ? `<span style="display:inline-block;font-size:10px;padding:1px 8px;border-radius:10px;background:${tagColor}18;color:${tagColor};border:1px solid ${tagColor}44;margin-top:3px">${esc(inc.tag)}</span>` : '';
    row.innerHTML = `
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:500">${esc(inc.source)}</div>
        <div style="font-size:11px;color:var(--muted)">${esc(inc.date)}${inc.comment ? ' · '+esc(inc.comment) : ''}</div>
        ${tagBadge}
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
  currentIncomeMonth.m += d;
  if(currentIncomeMonth.m > 11){currentIncomeMonth.m = 0; currentIncomeMonth.y++;}
  if(currentIncomeMonth.m < 0){currentIncomeMonth.m = 11; currentIncomeMonth.y--;}
  renderIncome();
  syncIncomeMonthInput();
}

function openAddIncome(){
  editingIncomeId = null;
  _selectedIncomeTag = null;
  document.getElementById('income-modal-title').textContent = 'Добавить доход';
  document.getElementById('inc-delete-btn').style.display = 'none';
  document.getElementById('inc-source').value = '';
  document.getElementById('inc-amount').value = '';
  document.getElementById('inc-date').value = today();
  document.getElementById('inc-comment').value = '';
  renderIncomeTagsInModal();
  openModal('modal-income');
}

function editIncome(id, e){
  if(e) e.stopPropagation();
  const inc = (DB.incomes||[]).find(i => i.id === id);
  if(!inc) return;
  editingIncomeId = id;
  _selectedIncomeTag = inc.tag || null;
  document.getElementById('income-modal-title').textContent = 'Редактировать доход';
  document.getElementById('inc-delete-btn').style.display = 'block';
  document.getElementById('inc-source').value = inc.source;
  document.getElementById('inc-amount').value = inc.amount;
  document.getElementById('inc-date').value = inc.date;
  document.getElementById('inc-comment').value = inc.comment || '';
  renderIncomeTagsInModal();
  openModal('modal-income');
}

function saveIncome(){
  const source = document.getElementById('inc-source').value.trim();
  const amt = parseFloat(document.getElementById('inc-amount').value);
  if(!source){ toast('Укажите источник'); return; }
  if(!amt || amt <= 0){ toast('Введите сумму'); return; }
  const obj = { source, amount: amt, date: document.getElementById('inc-date').value, comment: document.getElementById('inc-comment').value, tag: _selectedIncomeTag || '' };
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

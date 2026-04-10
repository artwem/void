// ─── RENDER: BUDGET ─────────────────────────────────────────────────
function renderBudget(){
  const {y,m} = currentMonth;
  document.getElementById('month-label').textContent = MONTHS_RU[m]+' '+y;
  const limits = getLimits(y,m);
  const list = document.getElementById('cat-list');
  list.innerHTML = '';
  let totalSpent=0, totalLimit=0;

  // Pre-calculate spent per category
  const spentArr = DB.categories.map((_,i) => getCatSpent(i,y,m));
  DB.categories.forEach((_,i) => { totalSpent += spentArr[i]; totalLimit += limits[i]||0; });

  // Group by color — same color = same group
  const colorGroups = {}; // color → [indices]
  DB.categories.forEach((_,i) => {
    const c = getCatColor(i);
    if(!colorGroups[c]) colorGroups[c] = [];
    colorGroups[c].push(i);
  });

  const rendered = new Set();

  DB.categories.forEach((_,i) => {
    if(rendered.has(i)) return;
    const color = getCatColor(i);
    const groupIndices = colorGroups[color];

    if(groupIndices.length > 1){
      groupIndices.forEach(idx => rendered.add(idx));

      const groupSpent = groupIndices.reduce((s,idx) => s + spentArr[idx], 0);
      const groupLimit = groupIndices.reduce((s,idx) => s + (limits[idx]||0), 0);
      const groupPct   = groupLimit > 0 ? (groupSpent/groupLimit)*100 : 0;
      const groupOver  = groupSpent > groupLimit && groupLimit > 0;

      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'border-radius:var(--r);border:1.5px solid '+color+';overflow:hidden;margin-bottom:2px';

      const hdr = document.createElement('div');
      hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 12px 6px;background:'+color+'18';

      // Visible color input — works on iOS because it's in normal document flow
      const grpColorInput = document.createElement('input');
      grpColorInput.type = 'color';
      grpColorInput.value = color;
      const _color = color;
      grpColorInput.style.cssText = 'width:22px;height:22px;border:none;padding:0;border-radius:50%;cursor:pointer;flex-shrink:0;background:none;-webkit-appearance:none';
      grpColorInput.title = 'Изменить цвет группы';
      grpColorInput.addEventListener('change', function(){ setGroupColor(_color, this.value); });

      const grpLeft = document.createElement('div');
      grpLeft.style.cssText = 'display:flex;align-items:center;gap:6px';
      grpLeft.appendChild(grpColorInput);

      // Build right side via DOM
      const grpRight = document.createElement('div');
      grpRight.style.cssText = 'display:flex;align-items:center;gap:8px';
      const s1 = document.createElement('span');
      s1.style.cssText = 'font-size:12px;font-weight:600;color:'+(groupOver?'var(--red)':'var(--text)');
      s1.textContent = fmt(groupSpent);
      const s2 = document.createElement('span');
      s2.style.cssText = 'font-size:11px;color:var(--muted)';
      s2.textContent = '/ '+fmt(groupLimit);
      const s3 = document.createElement('span');
      s3.style.cssText = 'font-size:10px;padding:1px 6px;border-radius:4px;font-weight:600;background:'+(groupOver?'var(--red-light)':color+'22')+';color:'+(groupOver?'var(--red)':color);
      s3.textContent = groupPct.toFixed(0)+'%';
      grpRight.append(s1, s2, s3);
      hdr.appendChild(grpLeft);
      hdr.appendChild(grpRight);
      wrapper.appendChild(hdr);
      groupIndices.forEach(idx => wrapper.appendChild(makeCatRow(idx, spentArr[idx], limits[idx]||0, totalLimit, true)));
      list.appendChild(wrapper);
    } else {
      rendered.add(i);
      list.appendChild(makeCatRow(i, spentArr[i], limits[i]||0, totalLimit, false));
    }
  });
  const left = totalLimit - totalSpent;
  document.getElementById('sum-spent').textContent = fmt(totalSpent);
  document.getElementById('sum-limit').textContent = fmt(totalLimit);
  const leftEl = document.getElementById('sum-left');
  leftEl.textContent = fmt(Math.abs(left));
  leftEl.className = 's-val '+(left<0?'over':'ok');
}

function makeCatRow(i, spent, lim, totalLimit, inGroup){
  const pct = lim>0 ? (spent/lim)*100 : 0;
  const pctOfBudget = totalLimit>0 ? ((lim/totalLimit)*100) : 0;
  const isOver = spent>lim && lim>0;
  const bar = Math.min(pct,100);
  const barClass = pct<70?'pf-ok':pct<100?'pf-warn':'pf-over';
  const badgeClass = isOver?'badge-over':pct>=70?'badge-warn':'badge-ok';
  const badgeText = isOver?'Превышен':pct.toFixed(0)+'%';
  const color = getCatColor(i);

  const row = document.createElement('div');
  row.className = 'cat-row'+(isOver?' over':'');
  if(inGroup){
    row.style.borderRadius = '0';
    row.style.border = 'none';
    row.style.borderTop = '0.5px solid var(--border)';
  } else {
    // Colored left border for standalone
    row.style.borderLeft = '3px solid '+color;
  }
  row.innerHTML = `
    <div class="cat-top">
      <span class="cat-name">${DB.categories[i]}</span>
      <div class="cat-badges">
        <span class="badge ${badgeClass}">${badgeText}</span>
      </div>
    </div>
    <div class="cat-nums">
      <span class="cat-spent">${fmt(spent)}</span>
      <span class="cat-limit-txt">из ${fmt(lim)} · ${pctOfBudget.toFixed(0)}% бюджета</span>
    </div>
    <div class="progress"><div class="progress-fill ${barClass}" style="width:${bar}%"></div></div>
  `;
  row.onclick = () => { openAddExpense(i); };
  return row;
}

// ─── EXPENSE CRUD ───────────────────────────────────────────────────
let _addMode = true; // true = add to existing, false = replace

function toggleAddMode(){
  _addMode = !_addMode;
  const vis = document.getElementById('add-mode-visual');
  if(!vis) return;
  if(_addMode){
    vis.style.borderColor = 'var(--border2)';
    vis.style.background = 'var(--card)';
    vis.innerHTML = '<svg width="11" height="9" viewBox="0 0 11 9" fill="none"><path d="M1 4L4 7.5L10 1" stroke="var(--text)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  } else {
    vis.style.borderColor = 'var(--border2)';
    vis.style.background = 'var(--card)';
    vis.innerHTML = '';
  }
}

function updateExpCatHint(){
  const cat = parseInt(document.getElementById('exp-cat').value);
  const date = document.getElementById('exp-date').value || currentDay || today();
  const hint = document.getElementById('exp-cat-hint');
  const spentEl = document.getElementById('exp-cat-spent');
  if(isNaN(cat) || !hint) return;
  const existing = DB.expenses.find(e => e.cat===cat && e.date===date && !e._deleted);
  if(existing && existing.amount > 0){
    hint.style.display = 'block';
    spentEl.textContent = fmt(existing.amount);
    // Reset to add mode when hint appears
    _addMode = true;
    const vis = document.getElementById('add-mode-visual');
    if(vis){
      vis.style.borderColor = 'var(--border2)';
      vis.style.background = 'var(--card)';
      vis.innerHTML = '<svg width="11" height="9" viewBox="0 0 11 9" fill="none"><path d="M1 4L4 7.5L10 1" stroke="var(--text)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }
  } else {
    hint.style.display = 'none';
  }
}

function openAddExpense(prefillCat){
  editingExpenseId = null;
  _addMode = true;
  document.getElementById('expense-modal-title').textContent='Добавить расход';
  document.getElementById('exp-delete-btn').style.display='none';
  populateCatSelect('exp-cat');
  document.getElementById('exp-date').value = currentPage==='day' ? currentDay : today();
  document.getElementById('exp-amount').value='';
  document.getElementById('exp-comment').value='';
  openModal('modal-expense');
  if(prefillCat !== undefined) setTimeout(()=>{ document.getElementById('exp-cat').value = prefillCat; updateExpCatHint(); }, 50);
  else setTimeout(updateExpCatHint, 50);
}

function editExpense(id, e){
  if(e) e.stopPropagation();
  const exp = DB.expenses.find(x=>x.id===id);
  if(!exp) return;
  editingExpenseId = id;
  document.getElementById('expense-modal-title').textContent='Редактировать';
  document.getElementById('exp-delete-btn').style.display='block';
  populateCatSelect('exp-cat');
  document.getElementById('exp-cat').value = exp.cat;
  document.getElementById('exp-amount').value = exp.amount;
  document.getElementById('exp-date').value = exp.date;
  document.getElementById('exp-comment').value = exp.comment||'';
  openModal('modal-expense');
  setTimeout(updateExpCatHint, 50);
}

function saveExpense(){
  const amt = parseFloat(document.getElementById('exp-amount').value);
  if(!amt||amt<=0){toast('Введите сумму');return;}
  const cat  = parseInt(document.getElementById('exp-cat').value);
  const date = document.getElementById('exp-date').value;
  const comment = document.getElementById('exp-comment').value;

  if(editingExpenseId){
    const idx = DB.expenses.findIndex(e=>e.id===editingExpenseId);
    if(idx>=0) DB.expenses[idx] = {...DB.expenses[idx], cat, amount:amt, date, comment};
  } else {
    const existing = DB.expenses.find(e => e.cat===cat && e.date===date && !e._deleted);
    if(existing){
      if(_addMode){
        existing.amount = Math.round((existing.amount + amt) * 100) / 100;
        if(comment) existing.comment = (existing.comment ? existing.comment + '; ' : '') + comment;
      } else {
        existing.amount = amt;
        if(comment !== undefined) existing.comment = comment;
      }
    } else {
      DB.expenses.push({ id:'gs_'+cat+'_'+date.replace(/-/g,''), cat, amount:amt, date, comment });
    }
  }
  saveDB();
  closeModal('modal-expense');
  if(currentPage==='day') renderDay();
  else renderBudget();
  toast(editingExpenseId?'Обновлено':'Сохранено');
}

function deleteExpense(){
  if(!editingExpenseId) return;
  const exp = DB.expenses.find(e=>e.id===editingExpenseId);
  if(exp){
    exp.amount = 0;
    exp.comment = '';
    exp._deleted = true;
    saveDB();
  }
  closeModal('modal-expense');
  if(currentPage==='day') renderDay();
  else renderBudget();
  toast('Удалено');
}

function populateCatSelect(id){
  document.getElementById(id).innerHTML = DB.categories.map((c,i)=>`<option value="${i}">${c}</option>`).join('');
}

// ─── LIMIT EDITOR ───────────────────────────────────────────────────
function openLimitEditor(){
  const sel = document.getElementById('limit-month-sel');
  const opts = [];
  const now = new Date();
  for(let i=0;i<13;i++){
    let m=now.getMonth()-i, y=now.getFullYear();
    if(m<0){m+=12;y--;}
    opts.push({y,m,label:MONTHS_RU[m]+' '+y,key:monthKey(y,m)});
  }
  sel.innerHTML = opts.map(o=>`<option value="${o.key}">${o.label}</option>`).join('');
  sel.value = monthKey(currentMonth.y,currentMonth.m);
  loadLimitEditor();
  openModal('modal-limits');
}

function loadLimitEditor(){
  const key = document.getElementById('limit-month-sel').value;
  const [y,m] = key.split('-').map(Number);
  const limits = getLimits(y,m-1);
  const rows = document.getElementById('limit-editor-rows');
  rows.innerHTML = DB.categories.map((c,i)=>`
    <div class="limit-edit-row">
      <span class="limit-edit-name">${c}</span>
      <input class="limit-edit-input" type="number" id="lim_${i}" value="${limits[i]||0}" inputmode="decimal"/>
    </div>
  `).join('');
}

function saveLimits(){
  const key = document.getElementById('limit-month-sel').value;
  const newLimits = DB.categories.map((_,i)=>{
    const v = parseFloat(document.getElementById('lim_'+i).value)||0;
    return v;
  });
  DB.limits[key] = newLimits;
  saveDB();
  closeModal('modal-limits');
  renderBudget();
  toast('Лимиты сохранены');
}

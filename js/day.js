// ─── RENDER: DAY ────────────────────────────────────────────────────
function onDayCalChange(val){
  if(!val) return;
  currentDay = val;
  renderDay();
}

function renderDay(){
  const d = new Date(currentDay+'T12:00:00');
  const weekdays = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
  const calInp = document.getElementById('day-cal-input');
  if(calInp) calInp.value = currentDay;
  document.getElementById('day-label').textContent =
    weekdays[d.getDay()]+', '+d.getDate()+' '+SHORT_MONTHS[d.getMonth()]+' '+d.getFullYear();
  const entries = getDayExpenses(currentDay);
  const total = entries.reduce((s,e)=>s+e.amount,0);
  document.getElementById('day-total').textContent = fmt(total);
  const list = document.getElementById('entry-list');
  list.innerHTML='';
  if(!entries.length){
    list.innerHTML='<div class="empty-day"><div style="font-size:32px">📭</div><p>Нет расходов за этот день</p><p>Нажмите + чтобы добавить</p></div>';
    return;
  }
  entries.sort((a,b)=>(b.amount-a.amount));
  entries.forEach(e=>{
    const catName = DB.categories[e.cat]||'Неизвестно';
    const row=document.createElement('div');
    row.className='entry-row';
    row.innerHTML=`
      <div class="entry-dot" style="background:${getCatColor(e.cat)}"></div>
      <div class="entry-info">
        <div class="entry-cat">${catName}</div>
        ${e.comment?`<div class="entry-note">${e.comment}</div>`:''}
      </div>
      <div class="entry-amount">${fmt(e.amount)}</div>
      <button class="entry-del" onclick="editExpense('${e.id}',event)">✎</button>
    `;
    list.appendChild(row);
  });
}

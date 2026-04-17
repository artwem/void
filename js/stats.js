// ─── RENDER: STATS ──────────────────────────────────────────────────
function renderStats(){
  const now = new Date();

  // Build last 6 months data
  const last6 = [];
  for(let i=5;i>=0;i--){
    let m=now.getMonth()-i, y=now.getFullYear();
    if(m<0){m+=12;y--;}
    const exps = getMonthExpenses(y,m);
    const totalExp = exps.reduce((s,e)=>s+e.amount,0);
    const totalInc = (DB.incomes||[])
      .filter(inc=>inc.date && inc.date.startsWith(monthKey(y,m)))
      .reduce((s,inc)=>s+inc.amount,0);
    last6.push({label:SHORT_MONTHS[m]+"'"+String(y).slice(2), totalExp, totalInc, y, m, exps});
  }

  document.getElementById('pie-month-label').textContent = MONTHS_RU[currentMonth.m]+' '+currentMonth.y;

  // ── 1. Расходы по месяцам ──────────────────────────────────────────
  if(charts.monthly) charts.monthly.destroy();
  charts.monthly = new Chart(document.getElementById('chartMonthly'),{
    type:'bar',
    data:{
      labels: last6.map(x=>x.label),
      datasets:[{
        data: last6.map(x=>Math.round(x.totalExp)),
        backgroundColor: last6.map((_,i)=>i===5?'#185fa5':'rgba(128,128,128,0.35)'),
        borderRadius:5, borderSkipped:false
      }]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{legend:{display:false}, tooltip:{callbacks:{label:v=>fmt(v.raw)}}},
      scales:{
        x:{grid:{display:false}, ticks:{font:{size:10},color:'#888'}},
        y:{grid:{color:'rgba(128,128,128,.1)'}, ticks:{callback:v=>fmtShort(v)+'₽',font:{size:9},color:'#888'}}
      }
    }
  });

  // ── 2. Структура текущего месяца ───────────────────────────────────
  const {y,m} = currentMonth;
  const curExp = getMonthExpenses(y,m);
  const catTotals = DB.categories.map((_,i)=>curExp.filter(e=>e.cat===i).reduce((s,e)=>s+e.amount,0));
  const nonZero = catTotals.map((v,i)=>({v:Math.round(v),i})).filter(x=>x.v>0).sort((a,b)=>b.v-a.v);
  const pieEl = document.getElementById('chartPie');
  pieEl.innerHTML = '';
  if(nonZero.length){
    const grandTotal = nonZero.reduce((s,x)=>s+x.v,0);
    const maxVal = nonZero[0].v;
    nonZero.forEach(x=>{
      const pct = grandTotal>0 ? (x.v/grandTotal*100).toFixed(1) : 0;
      const barW = maxVal>0 ? (x.v/maxVal*100) : 0;
      const color = getCatColor(x.i);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 0';
      const dot = document.createElement('div');
      dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:'+color+';flex-shrink:0';
      const col = document.createElement('div');
      col.style.cssText = 'flex:1;min-width:0';
      const nameEl = document.createElement('div');
      nameEl.style.cssText = 'font-size:11px;color:#888;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px';
      nameEl.textContent = DB.categories[x.i]||'';
      const track = document.createElement('div');
      track.style.cssText = 'height:6px;background:rgba(128,128,128,.15);border-radius:3px;overflow:hidden';
      const fill = document.createElement('div');
      fill.style.cssText = 'height:100%;width:'+barW+'%;background:'+color+';border-radius:3px;transition:width .3s';
      track.appendChild(fill);
      col.appendChild(nameEl);
      col.appendChild(track);
      const vals = document.createElement('div');
      vals.style.cssText = 'text-align:right;flex-shrink:0';
      const amtEl = document.createElement('div');
      amtEl.style.cssText = 'font-size:12px;font-weight:600;color:#888';
      amtEl.textContent = fmt(x.v);
      const pctEl = document.createElement('div');
      pctEl.style.cssText = 'font-size:10px;color:#666';
      pctEl.textContent = pct+'%';
      vals.appendChild(amtEl);
      vals.appendChild(pctEl);
      row.appendChild(dot); row.appendChild(col); row.appendChild(vals);
      pieEl.appendChild(row);
    });
  }

  // ── 3. Доходы vs Расходы ───────────────────────────────────────────
  if(charts.incVsExp) charts.incVsExp.destroy();
  charts.incVsExp = new Chart(document.getElementById('chartIncomeVsExp'),{
    type:'bar',
    data:{
      labels: last6.map(x=>x.label),
      datasets:[
        {
          label:'Доходы',
          data: last6.map(x=>Math.round(x.totalInc)),
          backgroundColor:'rgba(29,158,117,0.7)',
          borderRadius:4, borderSkipped:false, order:2
        },
        {
          label:'Расходы',
          data: last6.map(x=>Math.round(x.totalExp)),
          backgroundColor:'rgba(216,90,48,0.7)',
          borderRadius:4, borderSkipped:false, order:1
        }
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{
          display:true,
          labels:{color:'#888', font:{size:10}, boxWidth:10, padding:8}
        },
        tooltip:{callbacks:{label:v=>v.dataset.label+': '+fmt(v.raw)}}
      },
      scales:{
        x:{grid:{display:false}, ticks:{font:{size:10},color:'#888'}},
        y:{grid:{color:'rgba(128,128,128,.1)'}, ticks:{callback:v=>fmtShort(v)+'₽',font:{size:9},color:'#888'}}
      }
    }
  });

  // ── 4. Расходы по группам (stacked) ───────────────────────────────
  // Build color groups — same color = same group
  const colorGroups = {};
  DB.categories.forEach((_,i)=>{
    const c = getCatColor(i);
    if(!colorGroups[c]) colorGroups[c] = {color:c, indices:[]};
    colorGroups[c].indices.push(i);
  });
  const groups = Object.values(colorGroups);

  // Dataset per group — stacked bars
  const groupDatasets = groups.map(g=>{
    const data = last6.map(month=>{
      return Math.round(
        g.indices.reduce((s,ci)=>{
          return s + month.exps.filter(e=>e.cat===ci).reduce((ss,e)=>ss+e.amount,0);
        },0)
      );
    });
    // Label = first category name in group (or all if single)
    const label = g.indices.length === 1
      ? DB.categories[g.indices[0]]||''
      : g.indices.map(i=>DB.categories[i]||'').join(', ');
    const shortLabel = label.length > 16 ? label.slice(0,16)+'…' : label;
    return {
      label: shortLabel,
      data,
      backgroundColor: g.color,
      stack:'expenses',
      borderRadius:0,
      borderSkipped:false
    };
  }).filter(ds=>ds.data.some(v=>v>0)); // skip empty groups

  // ── 5. Норма накопления ────────────────────────────────────────────
  const savingsRates = last6.map(x=>x.totalInc>0 ? Math.round((x.totalInc-x.totalExp)/x.totalInc*100) : null);
  const validRates = savingsRates.filter(v=>v!==null);
  const avgRate = validRates.length ? Math.round(validRates.reduce((s,v)=>s+v,0)/validRates.length) : null;
  const avgEl = document.getElementById('savings-rate-avg');
  if(avgRate!==null){
    avgEl.textContent = 'Норма сб. '+avgRate+'%';
    avgEl.style.color = avgRate>=0 ? '#1d9e75' : '#d85a30';
  } else {
    avgEl.textContent = '';
  }
  if(charts.savingsRate) charts.savingsRate.destroy();
  charts.savingsRate = new Chart(document.getElementById('chartSavingsRate'),{
    type:'bar',
    data:{
      labels: last6.map(x=>x.label),
      datasets:[{
        data: savingsRates.map(v=>v===null?0:v),
        backgroundColor: savingsRates.map(v=>v===null?'rgba(128,128,128,0.2)':v>=0?'rgba(29,158,117,0.7)':'rgba(216,90,48,0.7)'),
        borderRadius:4, borderSkipped:false
      }]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{label:v=>savingsRates[v.dataIndex]===null?'Нет данных':v.raw+'%'}}
      },
      scales:{
        x:{grid:{display:false}, ticks:{font:{size:10},color:'#888'}},
        y:{grid:{color:'rgba(128,128,128,.1)'}, ticks:{callback:v=>v+'%',font:{size:9},color:'#888'}}
      }
    }
  });

  if(charts.grouped) charts.grouped.destroy();
  if(groupDatasets.length){
    charts.grouped = new Chart(document.getElementById('chartGrouped'),{
      type:'bar',
      data:{labels:last6.map(x=>x.label), datasets:groupDatasets},
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{
          legend:{
            display:true,
            labels:{color:'#888', font:{size:9}, boxWidth:8, padding:6}
          },
          tooltip:{
            callbacks:{
              label:v=>v.dataset.label+': '+fmt(v.raw)
            }
          }
        },
        scales:{
          x:{stacked:true, grid:{display:false}, ticks:{font:{size:10},color:'#888'}},
          y:{stacked:true, grid:{color:'rgba(128,128,128,.1)'}, ticks:{callback:v=>fmtShort(v)+'₽',font:{size:9},color:'#888'}}
        }
      }
    });
  }
}

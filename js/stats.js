// ─── RENDER: STATS ──────────────────────────────────────────────────
function renderStats(){
  const now = new Date();
  const last6 = [];
  for(let i=5;i>=0;i--){
    let m=now.getMonth()-i, y=now.getFullYear();
    if(m<0){m+=12;y--;}
    const total=getMonthExpenses(y,m).reduce((s,e)=>s+e.amount,0);
    last6.push({label:SHORT_MONTHS[m]+"'"+String(y).slice(2),total,y,m});
  }
  document.getElementById('pie-month-label').textContent=MONTHS_RU[currentMonth.m]+' '+currentMonth.y;
  if(charts.monthly) charts.monthly.destroy();
  charts.monthly=new Chart(document.getElementById('chartMonthly'),{
    type:'bar',
    data:{labels:last6.map(x=>x.label),datasets:[{data:last6.map(x=>Math.round(x.total)),backgroundColor:last6.map((_,i)=>i===5?'#185fa5':'rgba(128,128,128,0.35)'),borderRadius:5,borderSkipped:false}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:v=>fmt(v.raw)}}},scales:{x:{grid:{display:false},ticks:{font:{size:10},color:'#888'}},y:{grid:{color:'rgba(128,128,128,.1)'},ticks:{callback:v=>fmtShort(v)+'₽',font:{size:9},color:'#888'}}}}
  });
  const {y,m}=currentMonth;
  const curExp=getMonthExpenses(y,m);
  const catTotals=DB.categories.map((_,i)=>curExp.filter(e=>e.cat===i).reduce((s,e)=>s+e.amount,0));
  // Sort by color so same-color categories are adjacent in pie
  const nonZero=catTotals.map((v,i)=>({v:Math.round(v),i})).filter(x=>x.v>0)
    .sort((a,b)=>getCatColor(a.i).localeCompare(getCatColor(b.i)));
  if(charts.pie) charts.pie.destroy();
  charts.pie=new Chart(document.getElementById('chartPie'),{
    type:'doughnut',
    data:{labels:nonZero.map(x=>DB.categories[x.i]),datasets:[{data:nonZero.map(x=>x.v),backgroundColor:nonZero.map(x=>getCatColor(x.i)),borderWidth:2,borderColor:'rgba(0,0,0,0)'}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'55%',plugins:{legend:{position:'right',labels:{color:'var(--text)',font:{size:10},padding:6,boxWidth:10,generateLabels:chart=>{const d=chart.data;return d.labels.map((l,i)=>({text:l.length>13?l.slice(0,13)+'…':l,fillStyle:d.datasets[0].backgroundColor[i],strokeStyle:'transparent',lineWidth:0,index:i}));}}}}}
  });
  const sorted=[...nonZero].sort((a,b)=>b.v-a.v).slice(0,7);
  const topH=Math.max(140,sorted.length*36+40);
  document.getElementById('chart-top-wrap').style.height=topH+'px';
  if(charts.top) charts.top.destroy();
  charts.top=new Chart(document.getElementById('chartTop'),{
    type:'bar',
    data:{labels:sorted.map(x=>DB.categories[x.i]),datasets:[{data:sorted.map(x=>x.v),backgroundColor:sorted.map(x=>getCatColor(x.i)),borderRadius:4,borderSkipped:false}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:v=>fmt(v.raw)}}},scales:{x:{grid:{color:'rgba(128,128,128,.1)'},ticks:{callback:v=>fmtShort(v)+'₽',font:{size:9},color:'#888'}},y:{grid:{display:false},ticks:{font:{size:10},color:'#888'}}}}
  });
}

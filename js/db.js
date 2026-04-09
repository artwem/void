// ─── DATA ───────────────────────────────────────────────────────────
const DEFAULT_CATS = [
  'ЖКУ + жилье','Транспорт','Связь + интернет','Еда+Хозтовары, уход',
  'Еда вне дома','Доставка','Одежда','Зубы','Активности','Хотелки',
  'Развлечения','Подарки','Такси','Дом, быт, другое','Мама','Непредвиденные расходы'
];
const DEFAULT_LIMITS = [15000,3000,1500,20000,8000,5000,5000,3000,4000,5000,3000,3000,2000,4000,5000,5000];
const CAT_COLORS = ['#378add','#1d9e75','#d85a30','#ba7517','#d4537e','#639922','#534ab7','#e67e22','#185fa5','#993556','#3b6d11','#a32d2d','#0f6e56','#8e44ad','#993c1d','#7f8c8d'];
const MONTHS_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const SHORT_MONTHS = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];

let DB = {
  categories: [...DEFAULT_CATS],
  catColors: {},
  expenses: [],
  incomes: [],
  assets: [],
  banks: ['Сбер','Альфа','Тиньк','Цифра+Фридом','Газпром','Яндекс','Озон','Финуслуги','РСХБ'],
  creditBanks: ['КРЕДИТ(СПЛИТ)'],
  limits: {},  // key: "YYYY-MM", value: array of limits per category
  syncUrl: ''
};

let currentMonth = {y:0,m:0};
let currentDay = '';
let editingExpenseId = null;
let charts = {};

function loadDB(){
  const saved = localStorage.getItem('budgetDB_v2');
  if(saved){
    try{const d=JSON.parse(saved);Object.assign(DB,d);}catch(e){}
  } else {
    const expenses = localStorage.getItem('expenses');
    if(expenses) DB.expenses = JSON.parse(expenses);
    const assets = localStorage.getItem('assets');
    if(assets) DB.assets = JSON.parse(assets);
    const banks = localStorage.getItem('banks');
    if(banks) DB.banks = JSON.parse(banks);
    const limits = localStorage.getItem('limits');
    if(limits){
      const arr = JSON.parse(limits);
      const now = new Date();
      DB.limits[monthKey(now.getFullYear(),now.getMonth())] = arr;
    }
  }
  // syncUrl: read from multiple storages — iOS PWA has isolated localStorage
  DB.syncUrl = (
    localStorage.getItem('syncUrl') ||
    sessionStorage.getItem('syncUrl') ||
    readSyncUrlFromCookie() ||
    ''
  );
  // If found in a secondary source, persist to localStorage for next time
  if (DB.syncUrl && !localStorage.getItem('syncUrl')) {
    localStorage.setItem('syncUrl', DB.syncUrl);
  }
  if(!DB.banks || !DB.banks.length) DB.banks = ['Сбер','Альфа','Тиньк','Цифра+Фридом','Газпром','Яндекс','Озон','Финуслуги','РСХБ'];
  if(!DB.creditBanks) DB.creditBanks = ['КРЕДИТ(СПЛИТ)'];
  if(!DB.catColors) DB.catColors = {};
  if(!DB.incomes) DB.incomes = [];
  if(!DB.categories || !DB.categories.length) DB.categories = [...DEFAULT_CATS];
  if(!DB.limits) DB.limits = {};
}

function saveDB(){
  DB._dirty = true;
  localStorage.setItem('budgetDB_v2', JSON.stringify(DB));
}

// Save without marking dirty — used after pull sync to avoid triggering push
function saveDBQuiet(){
  localStorage.setItem('budgetDB_v2', JSON.stringify(DB));
}

// ─── SYNC URL PERSISTENCE ────────────────────────────────────────────
// iOS PWA has separate localStorage from Safari — use cookies as bridge
function saveSyncUrlEverywhere(url){
  try { localStorage.setItem('syncUrl', url); } catch(_){}
  try { sessionStorage.setItem('syncUrl', url); } catch(_){}
  writeSyncUrlToCookie(url);
}

function writeSyncUrlToCookie(url){
  try {
    // expires in 1 year
    const exp = new Date(Date.now() + 365*24*60*60*1000).toUTCString();
    // encode URL to avoid cookie parsing issues
    // Use root path so cookie works on GitHub Pages subpaths like /repo-name/
    const cookiePath = location.pathname.split('/').slice(0, 2).join('/') || '/';
    document.cookie = 'syncUrl=' + encodeURIComponent(url) + '; expires=' + exp + '; path=' + cookiePath + '; SameSite=Lax';
  } catch(_){}
}

function readSyncUrlFromCookie(){
  try {
    const match = document.cookie.match(/(?:^|; )syncUrl=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : '';
  } catch(_){ return ''; }
}

// ─── HELPERS ────────────────────────────────────────────────────────
function monthKey(y,m){return y+'-'+String(m+1).padStart(2,'0')}
function fmt(n){return Math.round(n).toLocaleString('ru-RU')+'₽'}
function fmtShort(n){if(Math.abs(n)>=1000)return Math.round(n/1000)+'к';return Math.round(n)+''}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6)}
function today(){return new Date().toISOString().split('T')[0]}

function getLimits(y,m){
  const k = monthKey(y,m);
  if(DB.limits[k]) return DB.limits[k];
  // fallback: look for most recent prior limits
  const keys = Object.keys(DB.limits).sort();
  const prior = keys.filter(k2=>k2<=k).pop();
  if(prior) return DB.limits[prior];
  return DB.categories.map((_,i)=>DEFAULT_LIMITS[i]||3000);
}

function getCatColor(i){
  if(DB.catColors && DB.catColors[i]) return DB.catColors[i];
  return CAT_COLORS[i % CAT_COLORS.length];
}

function getMonthExpenses(y,m){
  const k = monthKey(y,m);
  return DB.expenses.filter(e=>e.date.startsWith(k) && !e._deleted);
}

function getDayExpenses(date){
  return DB.expenses.filter(e=>e.date===date && !e._deleted);
}

function getCatSpent(catIdx,y,m){
  return getMonthExpenses(y,m).filter(e=>e.cat===catIdx).reduce((s,e)=>s+e.amount,0);
}

// ─── TOAST ──────────────────────────────────────────────────────────
function toast(msg){
  const el=document.getElementById('toast');
  el.textContent=msg;el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'),2200);
}

// ─── MODAL HELPERS ──────────────────────────────────────────────────
function openModal(id){document.getElementById(id).classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}
// Close on backdrop click
// Overlay click-outside handler — runs after full DOM load
function initOverlays(){
  document.querySelectorAll('.overlay').forEach(el=>{
    el.addEventListener('click',e=>{if(e.target===el)el.classList.remove('open');});
  });
}

// ─── DATA ───────────────────────────────────────────────────────────

const CAT_COLORS = ['#378add','#1d9e75','#d85a30','#ba7517','#d4537e','#639922','#534ab7','#e67e22','#185fa5','#993556','#3b6d11','#a32d2d','#0f6e56','#8e44ad','#993c1d','#7f8c8d'];

// ─── DEFAULTS (first run only) ───────────────────────────────────────
const DEFAULT_CATS = [
  'ЖКУ + аренда','Ремонт и быт',        // Жильё   — синий  #185fa5
  'Продукты','Кафе и доставка',          // Еда     — зелёный #1d9e75
  'Транспорт и такси','Авто',            // Транспорт — оранжевый #d85a30
  'Аптека и врачи','Спорт',             // Здоровье — фиолетовый #8e44ad
  'Одежда и уход','Подписки и связь',   // Личное  — красный #d4537e
  'Подарки','Непредвиденные'            // Разное  — серый #7f8c8d
];
const DEFAULT_LIMITS = [15000,3000, 18000,6000, 4000,5000, 3000,2000, 5000,2000, 3000,5000];
const DEFAULT_COLORS = {
  0:'#185fa5', 1:'#185fa5',   // Жильё
  2:'#1d9e75', 3:'#1d9e75',   // Еда
  4:'#d85a30', 5:'#d85a30',   // Транспорт
  6:'#8e44ad', 7:'#8e44ad',   // Здоровье
  8:'#d4537e', 9:'#d4537e',   // Личное
  10:'#7f8c8d',11:'#7f8c8d'   // Разное
};
const MONTHS_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const SHORT_MONTHS = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];

let DB = {
  categories: [],
  catColors: {},
  expenses: [],
  incomes: [],
  assets: [],
  banks: [],
  creditBanks: [],
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
  if(!DB.banks) DB.banks = [];
  if(!DB.creditBanks) DB.creditBanks = [];
  if(!DB.catColors) DB.catColors = {};
  if(!DB.incomes) DB.incomes = [];
  if(!DB.catRenames) DB.catRenames = [];
  if(!DB.bankRenames) DB.bankRenames = [];
  if(!DB.bankDeletions) DB.bankDeletions = [];
  if(!DB.categories) DB.categories = [];
  if(!DB.limits) DB.limits = {};
  // First run — no data at all: populate with defaults so app isn't empty
  if(!saved && !DB.categories.length){
    DB.categories = [...DEFAULT_CATS];
    DB.catColors  = {...DEFAULT_COLORS};
    const k = monthKey(new Date().getFullYear(), new Date().getMonth());
    DB.limits[k]  = [...DEFAULT_LIMITS];
  }
}

function saveDB(){
  DB._dirty = true;
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
function fmtShort(n){
  const a = Math.abs(n);
  if(a >= 1000000) return (n/1000000).toFixed(1).replace('.0','')+'М';
  if(a >= 1000)    return (n/1000).toFixed(0)+'к';
  return Math.round(n)+'';
}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6)}
function today(){
  const d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

function getLimits(y,m){
  const k = monthKey(y,m);
  if(DB.limits[k]) return DB.limits[k];
  // fallback: look for most recent prior limits
  const keys = Object.keys(DB.limits).sort();
  const prior = keys.filter(k2=>k2<=k).pop();
  if(prior) return DB.limits[prior];
  return DB.categories.map((_,i) => DEFAULT_LIMITS[i] || 3000);
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
// Close on backdrop click — runs after full DOM load
function initOverlays(){
  document.querySelectorAll('.overlay').forEach(el=>{
    el.addEventListener('click',e=>{if(e.target===el)el.classList.remove('open');});
  });
}

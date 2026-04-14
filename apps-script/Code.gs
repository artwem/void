// ===== BUDGET TRACKER APPS SCRIPT v9 =====
// GET-only. action и data передаются как URL параметры.
// Деплой: Расширения → Apps Script → Развернуть → Новое развертывание
// Тип: Веб-приложение | Выполнять как: Я | Доступ: Все

const SHEET_DAYS     = 'По дням'; // prefix — actual sheets: 'По дням 2026', 'По дням 2027', etc.
const SHEET_TEMPLATE = 'Шаблон';
const SHEET_COMMENTS = 'Комментарии';
const SHEET_ASSETS   = 'Активы';
const SHEET_INCOME   = 'Доходы';
const SHEET_COLORS   = 'Настройки';
const MONTHS_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                   'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
// Дефолтные категории — используются только при создании пустого Шаблона
const DEFAULT_CATS = [
  'ЖКУ + аренда','Ремонт и быт',
  'Продукты','Кафе и доставка',
  'Транспорт и такси','Авто',
  'Аптека и врачи','Спорт',
  'Одежда и уход','Подписки и связь',
  'Подарки','Непредвиденные'
];
const DEFAULT_LIMITS = [15000,3000, 18000,6000, 4000,5000, 3000,2000, 5000,2000, 3000,5000];
const DEFAULT_COLORS = {
  'ЖКУ + аренда':'#185fa5',    'Ремонт и быт':'#185fa5',
  'Продукты':'#1d9e75',         'Кафе и доставка':'#1d9e75',
  'Транспорт и такси':'#d85a30','Авто':'#d85a30',
  'Аптека и врачи':'#8e44ad',   'Спорт':'#8e44ad',
  'Одежда и уход':'#d4537e',    'Подписки и связь':'#d4537e',
  'Подарки':'#7f8c8d',          'Непредвиденные':'#7f8c8d'
};

// POST с Content-Type: text/plain — без CORS preflight
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action || '';
    if (action === 'ping') return out({ ok: true, version: '9.2', spreadsheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl() });
    if (action === 'pull') return out(pullAll());
    if (action === 'push') return out({ success: true, written: pushAll(body.data || {}) });
    return out({ error: 'Unknown action: ' + action });
  } catch(err) {
    return out({ error: err.message });
  }
}

// GET оставляем для проверки вручную в браузере
function doGet(e) {
  const action = (e.parameter && e.parameter.action) || '';
  if (action === 'ping') return out({ ok: true, version: '9.2', spreadsheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl() });
  if (action === 'pull') return out(pullAll());
  return out({ info: 'Budget Tracker API v9.2. Use POST for push.' });
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── HELPERS ────────────────────────────────────────────────────────────
// Timezone of the spreadsheet
const SS_TZ = Session.getScriptTimeZone();

// Convert any cell value to YYYY-MM-DD string. Returns '' if not a date.
function cellToDateStr(v) {
  if (!v && v !== 0) return '';
  // Already a YYYY-MM-DD string
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  // Date object — use Utilities.formatDate with spreadsheet timezone
  if (v instanceof Date) return Utilities.formatDate(v, SS_TZ, 'yyyy-MM-dd');
  // Numeric serial (Google Sheets date stored as number)
  if (typeof v === 'number' && v > 40000) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return Utilities.formatDate(d, SS_TZ, 'yyyy-MM-dd');
  }
  return '';
}

// Legacy alias — returns Date object (used only for По дням header loop)
function cellToDate(v) {
  const s = cellToDateStr(v);
  if (!s) return null;
  const p = s.split('-').map(Number);
  return new Date(p[0], p[1]-1, p[2]);
}

// fmtDate kept as alias
function fmtDate(d) { return cellToDateStr(d); }

function colLetter(n) {
  let s = '';
  while (n > 0) { s = String.fromCharCode(64 + (n-1)%26 + 1) + s; n = Math.floor((n-1)/26); }
  return s;
}

function ensureSheet(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (headers && headers.length)
      sh.getRange(1,1,1,headers.length).setValues([headers]);
  }
  return sh;
}

function monthSheetName(yr, mo) { return MONTHS_RU[mo] + ' ' + yr; }

function daysSheetName(yr) { return SHEET_DAYS + ' ' + yr; }

function getOrCreateDaysSheet(ss, yr) {
  const name = daysSheetName(yr);
  let ds = ss.getSheetByName(name);
  if (ds) return ds;

  // Create new year sheet — clone structure from any existing days sheet
  ds = ss.insertSheet(name);
  const dates = [''];
  for (let d = new Date(yr,0,1); d.getFullYear()===yr; d.setDate(d.getDate()+1))
    dates.push(new Date(d));
  const totalCols = dates.length;
  ds.getRange(1,1,1,totalCols).setValues([dates]);
  ds.getRange(1,2,1,totalCols-1).setNumberFormat('dd.mm');

  // Итого row with open-ended SUM
  ds.getRange(2,1).setValue('Итого');
  const formulas = [];
  for (let c = 2; c <= totalCols; c++) {
    const col = colLetter(c);
    formulas.push('=IF(SUM('+col+'3:'+col+')=0,"",SUM('+col+'3:'+col+'))');
  }
  ds.getRange(2, 2, 1, formulas.length).setFormulas([formulas]);

  // Copy categories from the most recent existing days sheet
  const existing = ss.getSheets()
    .filter(s => s.getName().startsWith(SHEET_DAYS + ' '))
    .filter(s => s.getName() !== name)
    .sort((a,b) => b.getName().localeCompare(a.getName()));
  if (existing.length) {
    const src = existing[0].getDataRange().getValues();
    let row = 3;
    for (let r = 1; r < src.length; r++) {
      const cat = String(src[r][0]||'');
      if (cat && cat !== 'Итого') { ds.getRange(row,1).setValue(cat); row++; }
    }
  }
  return ds;
}

// ── ПЕРВЫЙ ЗАПУСК: создать нужные листы ───────────────────────────────
function setupSheets(ss) {
  // Template sheet — pre-filled with default categories and limits
  if (!ss.getSheetByName(SHEET_TEMPLATE)) {
    const t = ss.insertSheet(SHEET_TEMPLATE);
    t.getRange(1,1,1,5).setValues([['Статья Расходов','Сумма/Мес','Доля Общая','Доля Лимита','Лимиты']]);
    // Row 2 = Итого (fixed, never moves)
    t.getRange(2,1).setValue('Итого');
    t.getRange(2,5).setFormula('=SUM(E3:E)');
    // Rows 3+ = default categories
    DEFAULT_CATS.forEach((cat, i) => {
      t.getRange(i+3, 1).setValue(cat);
      t.getRange(i+3, 5).setValue(DEFAULT_LIMITS[i] || 0);
    });
  }

  // По дням YYYY — migrate legacy sheet first, then create if needed
  const curYr = new Date().getFullYear();
  const legacyDays = ss.getSheetByName(SHEET_DAYS);
  if (legacyDays && !ss.getSheetByName(daysSheetName(curYr))) {
    legacyDays.setName(daysSheetName(curYr));
  }
  if (!ss.getSheetByName(daysSheetName(curYr))) {
    getOrCreateDaysSheet(ss, curYr);
  }
  // Always ensure current month sheet exists
  const now = new Date();
  getOrCreateMonthSheet(ss, now.getFullYear(), now.getMonth());

  ensureSheet(ss, SHEET_ASSETS, ['Общий актив','Дата']);

  // Hidden service sheets
  const incSh  = ensureSheet(ss, SHEET_INCOME,   ['id','date','source','amount','comment','month']);
  const commSh = ensureSheet(ss, SHEET_COMMENTS, ['catIdx','date','comment','category']);
  const colSh  = ensureSheet(ss, SHEET_COLORS,   ['Категория','Цвет']);
  if (incSh.isSheetHidden()  === false) incSh.hideSheet();
  if (commSh.isSheetHidden() === false) commSh.hideSheet();
  if (colSh.isSheetHidden()  === false) colSh.hideSheet();
  // Pre-fill colors sheet with defaults if empty
  if (colSh.getLastRow() <= 1) {
    const colorRows = DEFAULT_CATS.map(cat => [cat, DEFAULT_COLORS[cat] || '#7f8c8d']);
    colSh.getRange(2, 1, colorRows.length, 2).setValues(colorRows);
  }
}

function getOrCreateMonthSheet(ss, yr, mo) {
  const name = monthSheetName(yr, mo);
  let sh = ss.getSheetByName(name);
  if (!sh) {
    const tmpl = ss.getSheetByName(SHEET_TEMPLATE);
    sh = tmpl.copyTo(ss);
    sh.setName(name);
    sh.getRange(1,6).setValue(new Date(yr, mo, 1));
  }
  return sh;
}

// ── PULL ──────────────────────────────────────────────────────────────
function pullAll() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  setupSheets(ss);

  // Collect categories from most recent days sheet
  const allDaysSheets = ss.getSheets()
    .filter(s => s.getName().startsWith(SHEET_DAYS + ' '))
    .sort((a,b) => b.getName().localeCompare(a.getName())); // newest first

  // Use newest sheet for category list
  const primarySheet = allDaysSheets[0] || ss.getSheetByName(SHEET_DAYS);
  const primaryData = primarySheet ? primarySheet.getDataRange().getValues() : [[]];
  const catRowMap = {};
  const categories = [];
  for (let r = 1; r < primaryData.length; r++) {
    const cat = String(primaryData[r][0] || '');
    if (cat && cat !== 'Итого') { catRowMap[cat] = r; categories.push(cat); }
  }

  // Read expenses from ALL year sheets
  const expenseMap = {};
  for (const daysSheet of allDaysSheets) {
    const daysData = daysSheet.getDataRange().getValues();
    const header = daysData[0];

    const dateColMap = {};
    for (let c = 1; c < header.length; c++) {
      const ds = cellToDateStr(header[c]);
      if (ds) dateColMap[ds] = c;
    }

    // Build local catRowMap for this sheet (may differ from primary)
    const localCatRow = {};
    for (let r = 1; r < daysData.length; r++) {
      const cat = String(daysData[r][0] || '');
      if (cat && cat !== 'Итого') localCatRow[cat] = r;
    }

    for (const cat of categories) {
      const ri = localCatRow[cat];
      if (ri === undefined) continue;
      const ci = categories.indexOf(cat);
      for (const [ds, col] of Object.entries(dateColMap)) {
        const v = daysData[ri][col];
        if (v === null || v === '' || v === undefined) continue;
        const num = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.]/g,''));
        if (!isNaN(num) && num > 0) {
          const key = ci + '_' + ds.replace(/-/g,'');
          expenseMap[key] = { id:'gs_'+key, cat:ci, amount:num, date:ds, comment:'' };
        }
      }
    }
  }

  // Комментарии — дата может быть Date-объектом или строкой
  const commSh = ss.getSheetByName(SHEET_COMMENTS);
  if (commSh) {
    const cd = commSh.getDataRange().getValues();
    for (let r = 1; r < cd.length; r++) {
      const catIdx = cd[r][0];
      if (catIdx === '' || catIdx === null || catIdx === undefined) continue;
      const dateStr = cellToDateStr(cd[r][1]) || String(cd[r][1]);
      const key = catIdx + '_' + dateStr.replace(/-/g,'');
      if (expenseMap[key] && cd[r][2]) expenseMap[key].comment = String(cd[r][2]);
    }
  }

  // Доходы
  const incSh = ss.getSheetByName(SHEET_INCOME);
  const incomes = [];
  if (incSh) {
    const id = incSh.getDataRange().getValues();
    for (let r = 1; r < id.length; r++) {
      if (!id[r][0]) continue;
      const dateStr = cellToDateStr(id[r][1]) || String(id[r][1]||'');
      incomes.push({ id:String(id[r][0]), date:dateStr,
        source:String(id[r][2]||''), amount:+id[r][3]||0, comment:String(id[r][4]||'') });
    }
  }

  // Активы — формат: Общий актив | Дата | Банки... | Кредиты...
  const aSh = ss.getSheetByName(SHEET_ASSETS);
  const assets = [], banks = [], creditBanks = [];
  if (aSh) {
    const ad = aSh.getDataRange().getValues();
    const ah = ad[0];
    // Col 0 = Общий актив, Col 1 = Дата, Col 2+ = banks
    for (let c = 2; c < ah.length; c++) {
      const name = String(ah[c]||'').trim();
      if (!name) continue;
      const isCred = /кредит/i.test(name);
      if (isCred) creditBanks.push(name); else banks.push(name);
    }
    const allB = [...banks, ...creditBanks];
    for (let r = 1; r < ad.length; r++) {
      const ds = cellToDateStr(ad[r][1]); // col index 1 = Дата
      if (!ds) continue;
      for (let c = 2; c < ah.length; c++) {
        const name = String(ah[c]||'').trim();
        if (!name) continue;
        const v = ad[r][c];
        if (v===null||v===''||v===undefined) continue;
        const num = typeof v==='number' ? v : parseFloat(String(v).replace(/[^\d.]/g,''));
        if (isNaN(num)) continue;
        const bankIdx = allB.indexOf(name);
        assets.push({ id:'gs_a_'+bankIdx+'_'+ds.replace(/-/g,''),
          bank: bankIdx, bankName: name, amount: Math.abs(num), date: ds });
      }
    }
  }

  // Лимиты из месячных листов
  const tmplSh = ss.getSheetByName(SHEET_TEMPLATE);
  const tmplLims = {};
  if (tmplSh) {
    const td = tmplSh.getDataRange().getValues();
    for (let r = 1; r < td.length; r++) {
      if (td[r][0] && String(td[r][0])!=='Итого' && typeof td[r][4]==='number')
        tmplLims[String(td[r][0])] = td[r][4];
    }
  }
  const limits = {};
  ss.getSheets().forEach(sh => {
    const name = sh.getName();
    MONTHS_RU.forEach((mon,idx) => {
      if (!name.startsWith(mon+' ')) return;
      const yr = parseInt(name.split(' ')[1]);
      if (isNaN(yr)) return;
      const key = yr+'-'+String(idx+1).padStart(2,'0');
      const sd = sh.getDataRange().getValues();
      const lims = {};
      for (let r = 1; r < sd.length; r++) {
        if (sd[r][0] && String(sd[r][0])!=='Итого' && typeof sd[r][4]==='number')
          lims[String(sd[r][0])] = sd[r][4];
      }
      limits[key] = categories.map(c => lims[c]||tmplLims[c]||0);
    });
  });
  const now = new Date();
  for (let i = 0; i < 3; i++) {
    let m = now.getMonth()+i, y = now.getFullYear();
    if (m>11){m-=12;y++;}
    const k = y+'-'+String(m+1).padStart(2,'0');
    if (!limits[k]) limits[k] = categories.map(c => tmplLims[c]||0);
  }

  // Read catColors from Настройки sheet — format: Категория | Цвет
  let catColors = {};
  const colorSh = ss.getSheetByName(SHEET_COLORS);
  if (colorSh) {
    const cd = colorSh.getDataRange().getValues();
    // Build catName → color map
    const colorByCat = {};
    for (let r = 1; r < cd.length; r++) {
      if (cd[r][0] && cd[r][1]) colorByCat[String(cd[r][0])] = String(cd[r][1]);
    }
    // Convert to index-based using categories array
    categories.forEach((cat, idx) => {
      if (colorByCat[cat]) catColors[idx] = colorByCat[cat];
    });
  }

  return { expenses: Object.values(expenseMap), categories, limits, assets, banks, creditBanks, incomes, catColors };
}

// ── PUSH ──────────────────────────────────────────────────────────────
function pushAll(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  setupSheets(ss);

  const categories = data.categories || [];
  const written = { cells:0, comments:0, incomes:0, assets:0 };

  // --- 0. Переименования банков в листе Активы ---
  const bankRenames = data.bankRenames || [];
  if (bankRenames.length) {
    const aSh2 = ss.getSheetByName(SHEET_ASSETS);
    if (aSh2) {
      const hRow = aSh2.getRange(1, 1, 1, aSh2.getLastColumn()).getValues()[0];
      bankRenames.forEach(function(r) {
        hRow.forEach((name, i) => {
          if (String(name||'').trim() === r.from) {
            aSh2.getRange(1, i+1).setValue(r.to);
          }
        });
      });
    }
    // Also rename in color sheet if bank names are stored there (future-proof)
  }

  // --- 1. Переименования и новые категории — во ВСЕХ листах «По дням YYYY» ---
  const renames = data.catRenames || [];
  const allDaysSheetsForPush = ss.getSheets()
    .filter(s => s.getName().startsWith(SHEET_DAYS + ' '))
    .sort((a,b) => b.getName().localeCompare(a.getName()));

  // Use newest sheet as primary for category management
  const curYrForPush = new Date().getFullYear();
  const primaryDsSh = allDaysSheetsForPush[0] || ss.getSheetByName(daysSheetName(curYrForPush));

  // Apply renames to ALL year sheets
  if (renames.length) {
    allDaysSheetsForPush.forEach(function(sh) {
      const d = sh.getDataRange().getValues();
      renames.forEach(function(r) {
        for (let row = 1; row < d.length; row++) {
          if (String(d[row][0]) === r.from) {
            sh.getRange(row+1, 1).setValue(r.to);
            d[row][0] = r.to;
          }
        }
      });
    });
  }

  // Add new categories to ALL year sheets
  // Append category AFTER the last data row (never before Итого on row 2)
  // Structure: row1=header, row2=Итого(fixed), row3..=categories
  function ensureCatInSheet(sh, cat) {
    const d = sh.getDataRange().getValues();
    const existing = {};
    for (let r = 1; r < d.length; r++) {
      const c = String(d[r][0]||'');
      if (c && c !== 'Итого') existing[c] = r;
    }
    if (existing[cat] || cat === 'Итого') return existing;
    // Append after last row — Итого stays on row 2, categories grow downward
    const newRow = sh.getLastRow() + 1;
    sh.getRange(newRow, 1).setValue(cat);
    existing[cat] = newRow - 1;
    return existing;
  }

  // Add new categories to all По дням sheets AND Template
  const catRowMap = {};
  const tmplShForCats = ss.getSheetByName(SHEET_TEMPLATE);
  for (const cat of categories) {
    allDaysSheetsForPush.forEach(sh => ensureCatInSheet(sh, cat));
    // Also ensure category exists in Template (for month sheets)
    if (tmplShForCats) {
      const td = tmplShForCats.getDataRange().getValues();
      const tExists = td.some((r,i) => i>0 && String(r[0]) === cat);
      if (!tExists) {
        tmplShForCats.appendRow([cat, 0, 0, 0, 0]);
      }
    }
  }
  // Rebuild from primary
  const primaryData = primaryDsSh.getDataRange().getValues();
  for (let r = 1; r < primaryData.length; r++) {
    const c = String(primaryData[r][0]||'');
    if (c && c !== 'Итого') catRowMap[c] = r;
  }

  // --- 1c. Цвета категорий → лист "Настройки" ---
  const catColors = data.catColors || {};
  {
    const colorSh = ensureSheet(ss, SHEET_COLORS, ['Категория','Цвет']);
    const colorData = colorSh.getDataRange().getValues();
    const colorRowMap = {};
    for (let r = 1; r < colorData.length; r++) {
      if (colorData[r][0]) colorRowMap[String(colorData[r][0])] = r + 1;
    }
    // Apply renames: update category name in color sheet too
    renames.forEach(function(r) {
      if (colorRowMap[r.from]) {
        colorSh.getRange(colorRowMap[r.from], 1).setValue(r.to);
        colorRowMap[r.to] = colorRowMap[r.from];
        delete colorRowMap[r.from];
      }
    });
    // Write each category color
    categories.forEach((cat, idx) => {
      const color = catColors[idx] || catColors[String(idx)] || '';
      if (!color) return;
      if (colorRowMap[cat]) {
        colorSh.getRange(colorRowMap[cat], 2).setValue(color);
      } else {
        colorSh.appendRow([cat, color]);
        colorRowMap[cat] = colorSh.getLastRow();
      }
    });
    written.colors = Object.keys(catColors).length;
  }

  // --- 2. Расходы → ячейки в нужный лист «По дням YYYY» ---
  // Group expenses by year, write to corresponding sheet
  const expByYear = {};
  const commentMap = {};
  for (const exp of (data.expenses||[])) {
    const catName = categories[exp.cat];
    if (!catName || !exp.date) continue;
    const yr = exp.date.slice(0,4);
    if (!expByYear[yr]) expByYear[yr] = [];
    expByYear[yr].push(exp);
    if (exp.comment && !exp._deleted) {
      commentMap[exp.cat+'_'+exp.date] = { cat:exp.cat, date:exp.date, comment:exp.comment, catName };
    }
  }

  for (const [yr, exps] of Object.entries(expByYear)) {
    const yrNum = parseInt(yr);
    const sh = getOrCreateDaysSheet(ss, yrNum);
    const freshData = sh.getDataRange().getValues();
    const freshHeader = freshData[0];
    const freshCatMap = {};
    for (let r = 1; r < freshData.length; r++) {
      const c = String(freshData[r][0]||'');
      if (c && c !== 'Итого') freshCatMap[c] = r;
    }
    const dateColMap = {};
    for (let c = 1; c < freshHeader.length; c++) {
      const ds = cellToDateStr(freshHeader[c]);
      if (ds) dateColMap[ds] = c;
    }
    const cellMap = {};
    for (const exp of exps) {
      const catName = categories[exp.cat];
      if (!catName) continue;
      const col = dateColMap[exp.date];
      const row = freshCatMap[catName];
      if (col===undefined || row===undefined) continue;
      const key = row+'_'+col;
      cellMap[key] = (exp._deleted || exp.amount === 0) ? 0 : exp.amount;
    }
    for (const [key,amount] of Object.entries(cellMap)) {
      const [r,c] = key.split('_').map(Number);
      sh.getRange(r+1,c+1).setValue(amount === 0 ? '' : amount);
      written.cells++;
    }
  }

  // --- 3. Комментарии ---
  const commSh = ensureSheet(ss, SHEET_COMMENTS, ['catIdx','date','comment','category']);
  const commData = commSh.getDataRange().getValues();
  const existComm = {};
  for (let r = 1; r < commData.length; r++) {
    if (commData[r][0]==='' || commData[r][0]===null) continue;
    const dv = commData[r][1];
    const ds = dv instanceof Date ? fmtDate(dv) : String(dv);
    existComm[commData[r][0]+'_'+ds] = r+1;
  }
  for (const [key,info] of Object.entries(commentMap)) {
    if (existComm[key]) commSh.getRange(existComm[key],3).setValue(info.comment);
    else { commSh.appendRow([info.cat,info.date,info.comment,info.catName]); existComm[key]=commSh.getLastRow(); }
    written.comments++;
  }

  // --- 4. Лимиты ---
  // Helper: write categories+limits to a month/template sheet
  function writeLimitsToSheet(sh, categories, limArr) {
    const md = sh.getDataRange().getValues();
    const mCatRow = {};
    for (let r = 1; r < md.length; r++) {
      if (md[r][0] && String(md[r][0])!=='Итого') mCatRow[String(md[r][0])] = r+1;
    }
    categories.forEach((cat, idx) => {
      const lim = limArr[idx]; if (lim === undefined) return;
      if (mCatRow[cat]) {
        sh.getRange(mCatRow[cat], 5).setValue(lim);
      } else {
        // Append new category row
        const newRow = sh.getLastRow() + 1;
        sh.getRange(newRow, 1).setValue(cat);
        sh.getRange(newRow, 5).setValue(lim);
        mCatRow[cat] = newRow;
      }
    });
  }

  // Update Template limits (used as default for new month sheets)
  const tmplShForLimits = ss.getSheetByName(SHEET_TEMPLATE);

  Object.entries(data.limits||{}).forEach(([key,limArr]) => {
    if (!Array.isArray(limArr)) return;
    const [yr,mo] = key.split('-').map(Number);
    const mSh = getOrCreateMonthSheet(ss, yr, mo-1);
    writeLimitsToSheet(mSh, categories, limArr);
    // Mirror to Template so future month sheets inherit correct limits
    if (tmplShForLimits) writeLimitsToSheet(tmplShForLimits, categories, limArr);
  });

  // --- 5. Активы ---
  const regularBanks = data.banks || [];
  const creditBanksList = data.creditBanks || [];
  const allBanks = [...regularBanks, ...creditBanksList];

  if (allBanks.length && (data.assets||[]).length) {
    const aSh = ss.getSheetByName(SHEET_ASSETS);
    if (!aSh) return written;

    // Helper: read current header as {name: 1basedCol}
    function getColMap() {
      const h = aSh.getRange(1, 1, 1, aSh.getLastColumn()).getValues()[0];
      const m = {};
      h.forEach((v, i) => { const n = String(v||'').trim(); if (n) m[n] = i + 1; });
      return m;
    }

    let colMap = getColMap();

    // Layout: col1=Общий актив, col2=Дата, col3..=regular, then credit
    // Ensure base columns exist
    if (!colMap['Общий актив']) { aSh.getRange(1,1).setValue('Общий актив'); colMap = getColMap(); }
    if (!colMap['Дата'])        { aSh.getRange(1,2).setValue('Дата');         colMap = getColMap(); }

    // Add missing regular banks: insert before the first credit column (or before last col if no credits)
    for (const bank of regularBanks) {
      if (colMap[bank]) continue;
      const creditCols = creditBanksList.map(b => colMap[b]).filter(Boolean);
      if (creditCols.length) {
        const firstCreditCol = Math.min(...creditCols);
        aSh.insertColumnBefore(firstCreditCol);
        aSh.getRange(1, firstCreditCol, aSh.getLastRow(), 1).clearContent();
        aSh.getRange(1, firstCreditCol).setValue(bank);
      } else {
        aSh.getRange(1, aSh.getLastColumn() + 1).setValue(bank);
      }
      colMap = getColMap();
    }

    // Add missing credit banks: append after last column
    for (const bank of creditBanksList) {
      if (colMap[bank]) continue;
      const newCol = aSh.getLastColumn() + 1;
      aSh.getRange(1, newCol).setValue(bank);
      colMap = getColMap();
    }

    // Final column map
    colMap = getColMap();
    const totalCol = colMap['Общий актив'] || 1;
    const dateCol  = colMap['Дата'] || 2;

    // Build date → row map
    const lastRow = aSh.getLastRow();
    const dateRowMap = {};
    if (lastRow > 1) {
      aSh.getRange(2, dateCol, lastRow - 1, 1).getValues().forEach((r, i) => {
        const ds = cellToDateStr(r[0]);
        if (ds) dateRowMap[ds] = i + 2;
      });
    }

    // Write bank values
    for (const a of (data.assets||[])) {
      if (!a.date || !String(a.date).match(/^\d{4}-\d{2}-\d{2}$/)) continue;
      // Always prefer bankName (reliable) over bank index (can drift after sync)
      const bname = a.bankName || allBanks[a.bank];
      if (!bname) continue;
      const col = colMap[bname];
      if (!col) continue;
      let row = dateRowMap[a.date];
      if (!row) {
        const newRow = aSh.getLastRow() + 1;
        aSh.getRange(newRow, dateCol).setValue(a.date);
        aSh.getRange(newRow, dateCol).setNumberFormat('@');
        row = newRow;
        dateRowMap[a.date] = row;
      }
      aSh.getRange(row, col).setValue(a.amount);
      written.assets++;
    }

    // Recalculate Общий актив for all data rows
    colMap = getColMap();
    const finalLastRow = aSh.getLastRow();
    if (finalLastRow > 1) {
      const allData = aSh.getRange(2, 1, finalLastRow - 1, aSh.getLastColumn()).getValues();
      allData.forEach((rowData, i) => {
        if (!cellToDateStr(rowData[colMap['Дата'] - 1])) return;
        let total = 0;
        regularBanks.forEach(b => { const c = colMap[b]; if (c) total += parseFloat(rowData[c-1]) || 0; });
        creditBanksList.forEach(b => { const c = colMap[b]; if (c) total -= parseFloat(rowData[c-1]) || 0; });
        aSh.getRange(i + 2, colMap['Общий актив']).setValue(total || '');
      });
    }
  }

  // --- 6. Доходы ---
  const incSh = ensureSheet(ss, SHEET_INCOME, ['id','date','source','amount','comment','month']);
  const incData = incSh.getDataRange().getValues();
  const existInc = {};
  for (let r = 1; r < incData.length; r++) {
    if (incData[r][0]) existInc[String(incData[r][0])] = r+1;
  }
  for (const inc of (data.incomes||[])) {
    const incDateStr = inc.date instanceof Date ? fmtDate(inc.date) : String(inc.date||'');
    if (!incDateStr) continue;
    const row = [inc.id, incDateStr, inc.source, inc.amount, inc.comment||'', incDateStr.slice(0,7)];
    if (existInc[inc.id]) incSh.getRange(existInc[inc.id],1,1,row.length).setValues([row]);
    else { incSh.appendRow(row); existInc[inc.id]=incSh.getLastRow(); }
    written.incomes++;
  }

  return written;
}

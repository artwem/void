// ===== BUDGET TRACKER APPS SCRIPT v9 =====
// GET-only. action и data передаются как URL параметры.
// Деплой: Расширения → Apps Script → Развернуть → Новое развертывание
// Тип: Веб-приложение | Выполнять как: Я | Доступ: Все

const SHEET_DAYS     = 'По дням';
const SHEET_TEMPLATE = 'Шаблон';
const SHEET_COMMENTS = 'Комментарии';
const SHEET_ASSETS   = 'Активы';
const SHEET_INCOME   = 'Доходы';
const SHEET_COLORS   = 'Настройки';
const MONTHS_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                   'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const DEFAULT_CATS = [
  'ЖКУ + жилье','Транспорт','Связь + интернет','Еда+Хозтовары, уход',
  'Еда вне дома','Доставка','Одежда','Зубы','Активности','Хотелки',
  'Развлечения','Подарки','Такси','Дом, быт, другое','Мама','Непредвиденные расходы'
];
const DEFAULT_LIMITS = [15000,3000,1500,20000,8000,5000,5000,3000,4000,5000,3000,3000,2000,4000,5000,5000];

// POST с Content-Type: text/plain — без CORS preflight
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action || '';
    if (action === 'ping') return out({ ok: true, version: '9.2' });
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
  if (action === 'ping') return out({ ok: true, version: '9.2' });
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

// ── ПЕРВЫЙ ЗАПУСК: создать нужные листы ───────────────────────────────
function setupSheets(ss) {
  if (!ss.getSheetByName(SHEET_TEMPLATE)) {
    const t = ss.insertSheet(SHEET_TEMPLATE);
    const rows = [['Статья Расходов','Сумма/Мес','Доля Общая','Доля Лимита','Лимиты']];
    DEFAULT_CATS.forEach((c,i) => rows.push([c,0,0,0,DEFAULT_LIMITS[i]||0]));
    rows.push(['Итого',0,0,0,'=SUM(E2:E'+(rows.length)+')']);
    t.getRange(1,1,rows.length,5).setValues(rows);
  }
  if (!ss.getSheetByName(SHEET_DAYS)) {
    const ds = ss.insertSheet(SHEET_DAYS);
    const yr = new Date().getFullYear();
    const dates = [''];
    for (let d = new Date(yr,0,1); d.getFullYear()===yr; d.setDate(d.getDate()+1))
      dates.push(new Date(d));
    ds.getRange(1,1,1,dates.length).setValues([dates]);
    ds.getRange(1,2,1,dates.length-1).setNumberFormat('dd.mm');
    const td = ss.getSheetByName(SHEET_TEMPLATE).getDataRange().getValues();
    let row = 2;
    for (let r = 1; r < td.length; r++) {
      const c = td[r][0];
      if (c && String(c) !== 'Итого') { ds.getRange(row,1).setValue(c); row++; }
    }
    ds.getRange(row,1).setValue('Итого');
  }
  ensureSheet(ss, SHEET_ASSETS, ['Общий актив','Дата']);
  ensureSheet(ss, SHEET_INCOME, ['id','date','source','amount','comment','month']);
  ensureSheet(ss, SHEET_COMMENTS, ['catIdx','date','comment','category']);
  ensureSheet(ss, SHEET_COLORS, ['Категория','Цвет']);
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

  const daysSheet = ss.getSheetByName(SHEET_DAYS);
  const daysData = daysSheet.getDataRange().getValues();
  const header = daysData[0];

  // Карта дата → колонка
  const dateColMap = {};
  for (let c = 1; c < header.length; c++) {
    const ds = cellToDateStr(header[c]);
    if (ds) dateColMap[ds] = c;
  }

  // Карта категория → строка
  const catRowMap = {};
  const categories = [];
  for (let r = 1; r < daysData.length; r++) {
    const cat = String(daysData[r][0] || '');
    if (cat && cat !== 'Итого') { catRowMap[cat] = r; categories.push(cat); }
  }

  // Расходы из матрицы
  const expenseMap = {};
  for (const cat of categories) {
    const ri = catRowMap[cat];
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

  // --- 1. Переименования категорий ---
  const renames = data.catRenames || [];
  const dsSh = ss.getSheetByName(SHEET_DAYS);
  if (renames.length) {
    const dsRenameData = dsSh.getDataRange().getValues();
    renames.forEach(function(r) {
      for (let row = 1; row < dsRenameData.length; row++) {
        if (String(dsRenameData[row][0]) === r.from) {
          dsSh.getRange(row+1, 1).setValue(r.to);
          dsRenameData[row][0] = r.to;
        }
      }
    });
  }

  // --- 1b. Новые категории — только в По дням (Шаблон формулами сам подтянет) ---
  const dsData = dsSh.getDataRange().getValues();
  const catRowMap = {};
  for (let r = 1; r < dsData.length; r++) {
    const c = String(dsData[r][0]||'');
    if (c && c !== 'Итого') catRowMap[c] = r;
  }
  for (const cat of categories) {
    if (catRowMap[cat] || cat === 'Итого') continue;
    let iRow = dsSh.getLastRow();
    for (let r = 1; r <= dsSh.getLastRow(); r++) {
      if (dsSh.getRange(r,1).getValue()==='Итого') { iRow = r; break; }
    }
    dsSh.insertRowBefore(iRow);
    dsSh.getRange(iRow,1).setValue(cat);
    catRowMap[cat] = iRow-1;
  }

  // --- 1c. Сохранить цвета категорий на лист "Настройки" ---
  // --- 1c. Сохранить цвета категорий: Категория | Цвет ---
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

  // --- 2. Расходы → ячейки в "По дням" ---
  // Перечитываем после возможного добавления строк
  const freshData = dsSh.getDataRange().getValues();
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

  // Группируем расходы по ячейке
  // amount=0 или _deleted=true → пишем 0 (очищаем ячейку)
  const cellMap = {};
  const commentMap = {};
  for (const exp of (data.expenses||[])) {
    const catName = categories[exp.cat];
    if (!catName) continue;
    const col = dateColMap[exp.date];
    const row = freshCatMap[catName];
    if (col===undefined || row===undefined) continue;
    const key = row+'_'+col;
    if (exp._deleted || exp.amount === 0) {
      cellMap[key] = 0; // явно обнуляем
    } else {
      // Если уже есть значение — берём максимум (не суммируем, т.к. приложение хранит итог)
      cellMap[key] = exp.amount;
    }
    if (exp.comment && !exp._deleted) {
      commentMap[exp.cat+'_'+exp.date] = { cat:exp.cat, date:exp.date, comment:exp.comment, catName };
    }
  }
  for (const [key,amount] of Object.entries(cellMap)) {
    const [r,c] = key.split('_').map(Number);
    dsSh.getRange(r+1,c+1).setValue(amount === 0 ? '' : amount);
    written.cells++;
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
  Object.entries(data.limits||{}).forEach(([key,limArr]) => {
    if (!Array.isArray(limArr)) return;
    const [yr,mo] = key.split('-').map(Number);
    const mSh = getOrCreateMonthSheet(ss, yr, mo-1);
    const md = mSh.getDataRange().getValues();
    const mCatRow = {};
    for (let r = 1; r < md.length; r++) {
      if (md[r][0] && String(md[r][0])!=='Итого') mCatRow[String(md[r][0])] = r+1;
    }
    categories.forEach((cat,idx) => {
      const lim = limArr[idx]; if (lim===undefined) return;
      if (mCatRow[cat]) { mSh.getRange(mCatRow[cat],5).setValue(lim); return; }
      let iRow = mSh.getLastRow();
      for (let r = 1; r <= mSh.getLastRow(); r++) {
        if (mSh.getRange(r,1).getValue()==='Итого') { iRow=r; break; }
      }
      mSh.insertRowBefore(iRow);
      mSh.getRange(iRow,1).setValue(cat);
      mSh.getRange(iRow,5).setValue(lim);
    });
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
      // Find insertion point: before first credit bank column, or before Общий актив if it got shifted
      const creditCols = creditBanksList.map(b => colMap[b]).filter(Boolean);
      const firstCreditCol = creditCols.length ? Math.min(...creditCols) : aSh.getLastColumn() + 1;
      // insertColumnBefore shifts everything right, then clear the new column and set header
      aSh.insertColumnBefore(firstCreditCol);
      aSh.getRange(1, firstCreditCol, aSh.getLastRow(), 1).clearContent();
      aSh.getRange(1, firstCreditCol).setValue(bank);
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

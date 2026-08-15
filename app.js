'use strict';

const DB_NAME = 'pin-scanner-db';
const DB_VERSION = 1;
const STORE = 'pins';
let db;
let pins = [];
let currentPhoto = '';
let scanner = null;
let scanReturnToEditor = true;
let deferredInstallPrompt = null;

const $ = id => document.getElementById(id);
const fieldIds = ['barcode','name','set','theme','series','rarity','editionType','editionSize','originalPrice','releaseDate','origin','sourceUrl','notes'];

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.add('hidden'), 2400);
}

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $(id).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

function dbGetAll() {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function dbPut(pin) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put(pin);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function dbDelete(id) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function dbClear() {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function refreshPins() {
  pins = (await dbGetAll()).sort((a, b) => (b.updatedAt || b.dateAdded || '').localeCompare(a.updatedAt || a.dateAdded || ''));
  renderPins();
}

function escapeHtml(value='') {
  return String(value).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}

function renderPins() {
  const q = $('collectionSearch').value.trim().toLowerCase();
  const filtered = pins.filter(p => !q || fieldIds.some(k => String(p[k] || '').toLowerCase().includes(q)));
  $('pinCount').textContent = pins.length;
  $('setCount').textContent = new Set(pins.map(p => (p.set || '').trim().toLowerCase()).filter(Boolean)).size;
  $('limitedCount').textContent = pins.filter(p => /limited|\ble\b|\blr\b/i.test(`${p.rarity || ''} ${p.editionType || ''}`)).length;
  $('emptyState').classList.toggle('hidden', pins.length > 0);
  $('pinList').innerHTML = filtered.map(p => `
    <article class="pin-card" data-id="${escapeHtml(p.id)}">
      ${p.photo ? `<img src="${p.photo}" alt="${escapeHtml(p.name || 'Pin')}">` : '<div class="pin-thumb-empty"></div>'}
      <div>
        <h3>${escapeHtml(p.name || 'Unnamed pin')}</h3>
        <p>${escapeHtml(p.series || p.set || 'No set or series')}</p>
        <p>${escapeHtml(p.barcode || 'Photo / manual entry')}</p>
      </div>
      <button class="edit" type="button">Edit</button>
    </article>`).join('');
  document.querySelectorAll('.pin-card .edit').forEach(btn => btn.addEventListener('click', () => {
    openEditor(btn.closest('.pin-card').dataset.id);
  }));
}

function resetForm() {
  $('pinId').value = '';
  fieldIds.forEach(id => $(id).value = '');
  currentPhoto = '';
  updatePhotoPreview();
}

function updatePhotoPreview() {
  const has = Boolean(currentPhoto);
  $('pinPreview').classList.toggle('hidden', !has);
  $('photoPlaceholder').classList.toggle('hidden', has);
  $('sharePhotoBtn').classList.toggle('hidden', !has);
  if (has) $('pinPreview').src = currentPhoto;
}

function openEditor(id = '') {
  resetForm();
  if (id) {
    const p = pins.find(x => x.id === id);
    if (!p) return;
    $('pinId').value = p.id;
    fieldIds.forEach(k => $(k).value = p[k] || '');
    currentPhoto = p.photo || '';
    updatePhotoPreview();
    $('editorTitle').textContent = 'Edit Pin';
    $('deleteBtn').classList.remove('hidden');
  } else {
    $('editorTitle').textContent = 'Add Pin';
    $('deleteBtn').classList.add('hidden');
  }
  showView('editorView');
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function compressImage(file) {
  const url = await fileToDataUrl(file);
  const img = new Image();
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
  const max = 1600;
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', .82);
}

function queryFromForm() {
  return [$('name').value, $('series').value, $('set').value, $('theme').value, $('editionType').value].filter(Boolean).join(' ');
}

function webSearch(query) {
  if (!query.trim()) return toast('Add something to search first.');
  window.open(`https://www.google.com/search?q=${encodeURIComponent('Disney pin ' + query.trim())}`, '_blank', 'noopener');
}

function cleanBarcode(value='') {
  return String(value).replace(/[^0-9]/g, '');
}

function firstNonEmpty(...values) {
  return values.find(v => v !== undefined && v !== null && String(v).trim() !== '') || '';
}

function inferTheme(text='') {
  const hay = String(text).toLowerCase();
  const themes = [
    ['Mickey Mouse', ['mickey']], ['Minnie Mouse', ['minnie']], ['Stitch', ['stitch']],
    ['Winnie the Pooh', ['winnie the pooh','pooh']], ['Star Wars', ['star wars','mandalorian','grogu']],
    ['Marvel', ['marvel','avengers','spider-man','spiderman','iron man','captain america']],
    ['Frozen', ['frozen','elsa','anna','olaf']], ['The Little Mermaid', ['little mermaid','ariel']],
    ['Beauty and the Beast', ['beauty and the beast','belle']], ['Cinderella', ['cinderella']],
    ['Alice in Wonderland', ['alice in wonderland']], ['Peter Pan', ['peter pan','tinker bell','tinkerbell']],
    ['Toy Story', ['toy story','woody','buzz lightyear']], ['Cars', ['lightning mcqueen','pixar cars']],
    ['Disney Parks', ['disneyland','disney world','walt disney world','epcot','magic kingdom','animal kingdom']]
  ];
  const hit = themes.find(([, needles]) => needles.some(n => hay.includes(n)));
  return hit ? hit[0] : '';
}

function inferEdition(text='') {
  const hay = String(text);
  let m = hay.match(/limited\s+edition(?:\s+of)?\s*#?\s*([0-9,]+)/i) || hay.match(/LE\s*#?\s*([0-9,]+)/i);
  if (m) return { type: 'Limited Edition', size: m[1].replace(/,/g,'') };
  if (/limited\s+release|LR/i.test(hay)) return { type: 'Limited Release', size: '' };
  if (/open\s+edition|OE/i.test(hay)) return { type: 'Open Edition', size: '' };
  return { type: '', size: '' };
}

function inferReleaseDate(text='') {
  const m = String(text).match(/(20\d{2})[-\/](0?[1-9]|1[0-2])[-\/](0?[1-9]|[12]\d|3[01])/);
  if (!m) return '';
  return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
}

function priceFromProduct(product={}) {
  const direct = firstNonEmpty(product.price, product.msrp, product.list_price, product.lowest_recorded_price);
  if (direct !== '') {
    const n = Number(direct);
    return Number.isFinite(n) ? `$${n.toFixed(2)}` : String(direct);
  }
  const offers = Array.isArray(product.offers) ? product.offers : [];
  const vals = offers.map(o => Number(firstNonEmpty(o.price, o.sale_price))).filter(Number.isFinite);
  if (vals.length) return `$${Math.min(...vals).toFixed(2)}`;
  return '';
}

function applyProductToForm(product, sourceName, sourceUrl) {
  const title = firstNonEmpty(product.name, product.title);
  const description = firstNonEmpty(product.description, product.category);
  const brand = firstNonEmpty(product.brand, product.manufacturer);
  const category = firstNonEmpty(product.category, product.category_name);
  const combined = [title, description, brand, category].filter(Boolean).join(' ');
  const edition = inferEdition(combined);

  if (title && !$('name').value.trim()) $('name').value = title;
  if (!$('theme').value.trim()) $('theme').value = inferTheme(combined) || (brand && /disney/i.test(brand) ? 'Disney' : category);
  if (!$('series').value.trim()) $('series').value = firstNonEmpty(product.model, product.series, product.line);
  if (!$('set').value.trim()) $('set').value = firstNonEmpty(product.collection, product.product_line);
  if (!$('editionType').value.trim() && edition.type) $('editionType').value = edition.type;
  if (!$('editionSize').value.trim() && edition.size) $('editionSize').value = edition.size;
  if (!$('rarity').value.trim() && edition.type) $('rarity').value = edition.type;
  if (!$('originalPrice').value.trim()) $('originalPrice').value = priceFromProduct(product);
  if (!$('releaseDate').value.trim()) $('releaseDate').value = inferReleaseDate(combined);
  if (!$('origin').value.trim() && /disneyland/i.test(combined)) $('origin').value = 'Disneyland';
  else if (!$('origin').value.trim() && /walt disney world|disney world/i.test(combined)) $('origin').value = 'Walt Disney World';
  else if (!$('origin').value.trim() && /disney store|shopdisney/i.test(combined)) $('origin').value = 'Disney Store';
  $('sourceUrl').value = sourceUrl || $('sourceUrl').value;

  const noteBits = [];
  if (sourceName) noteBits.push(`Barcode match: ${sourceName}`);
  if (brand) noteBits.push(`Brand: ${brand}`);
  if (description && description !== category) noteBits.push(description);
  if (noteBits.length && !$('notes').value.trim()) $('notes').value = noteBits.join(' — ').slice(0, 900);
}

async function fetchJson(url, timeoutMs=9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}

async function lookupBarcode({openSearchOnFail=true} = {}) {
  const barcode = cleanBarcode($('barcode').value);
  if (!barcode) return toast('Scan or type a barcode first.');
  $('barcode').value = barcode;
  const btn = $('searchBarcodeBtn');
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Looking up barcode…';
  toast('Looking up barcode…');

  try {
    // Primary: upc.dev public lookup. No API key required for basic product data.
    try {
      const data = await fetchJson(`https://upc.dev/v1/product/${encodeURIComponent(barcode)}`);
      const product = data?.data || data?.product || null;
      if (product && firstNonEmpty(product.name, product.title)) {
        applyProductToForm(product, 'upc.dev', `https://upc.dev/v1/product/${barcode}`);
        toast('Match found — fields were autofilled. Please confirm them.');
        return true;
      }
    } catch (_) {}

    // Fallback: UPCitemdb's free trial lookup (subject to its public daily/rate limits).
    try {
      const data = await fetchJson(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(barcode)}`);
      const product = Array.isArray(data?.items) ? data.items[0] : null;
      if (product) {
        applyProductToForm(product, 'UPCitemdb', `https://www.upcitemdb.com/upc/${barcode}`);
        toast('Match found — fields were autofilled. Please confirm them.');
        return true;
      }
    } catch (_) {}

    toast('No automatic product match was found. Opening a Disney pin web search.');
    if (openSearchOnFail) webSearch(barcode);
    return false;
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

async function sharePhotoForSearch() {
  if (!currentPhoto) return;
  try {
    const blob = await (await fetch(currentPhoto)).blob();
    const file = new File([blob], 'pin.jpg', { type: 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Search this pin image' });
      toast('Choose Google or Lens from the share sheet.');
      return;
    }
  } catch (_) {}
  window.open('https://lens.google.com/', '_blank', 'noopener');
  toast('Lens opened. Upload the pin photo there.');
}

async function startScanner(returnToEditor = true) {
  scanReturnToEditor = returnToEditor;
  showView('scannerView');
  $('scannerMessage').textContent = 'Starting camera...';
  if (!window.Html5Qrcode) {
    $('scannerMessage').textContent = 'Barcode scanner could not load. Enter the number manually.';
    return;
  }
  try {
    scanner = new Html5Qrcode('reader');
    const config = { fps: 10, qrbox: { width: 280, height: 150 }, aspectRatio: 1.6 };
    await scanner.start({ facingMode: 'environment' }, config, onScanSuccess, () => {});
    $('scannerMessage').textContent = 'Hold the barcode steady inside the frame.';
  } catch (err) {
    $('scannerMessage').textContent = 'Camera scanning is unavailable. You can enter the barcode manually.';
  }
}

async function stopScanner() {
  if (scanner) {
    try { await scanner.stop(); } catch (_) {}
    try { await scanner.clear(); } catch (_) {}
    scanner = null;
  }
  $('reader').innerHTML = '';
}

async function onScanSuccess(decodedText) {
  await stopScanner();
  if (scanReturnToEditor) {
    $('barcode').value = decodedText;
    showView('editorView');
    toast('Barcode captured. Looking it up…');
    lookupBarcode();
  } else {
    openEditor();
    $('barcode').value = decodedText;
    toast('Barcode captured. Looking it up…');
    lookupBarcode();
  }
}

function exportRows() {
  return pins.map(p => ({
    Barcode: p.barcode || '',
    Name: p.name || '',
    Set: p.set || '',
    Theme: p.theme || '',
    Rarity: p.rarity || '',
    Series: p.series || '',
    'Edition Type': p.editionType || '',
    'Edition Size': p.editionSize || '',
    'Original Price': p.originalPrice || '',
    'Release Date': p.releaseDate || '',
    Origin: p.origin || '',
    'Source URL': p.sourceUrl || '',
    Notes: p.notes || '',
    'Date Added': p.dateAdded || ''
  }));
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function exportCsv() {
  if (!pins.length) return toast('Add at least one pin first.');
  const rows = exportRows();
  const headers = Object.keys(rows[0]);
  const quote = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.map(quote).join(','), ...rows.map(r => headers.map(h => quote(r[h])).join(','))].join('\r\n');
  downloadBlob(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), 'Disney-Pin-Collection.csv');
  toast('CSV export created.');
}

function exportXlsx() {
  if (!pins.length) return toast('Add at least one pin first.');
  if (!window.XLSX) {
    toast('Excel exporter needs an internet connection the first time.');
    return;
  }
  const ws = XLSX.utils.json_to_sheet(exportRows());
  ws['!cols'] = [14,32,26,22,18,26,18,14,16,14,18,40,36,22].map(wch => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Pins');
  XLSX.writeFile(wb, 'Disney-Pin-Collection.xlsx');
  toast('Excel export created.');
}

function exportBackup() {
  if (!pins.length) return toast('Add at least one pin first.');
  const payload = { app: 'My Pin Scanner', version: 1, exportedAt: new Date().toISOString(), pins };
  downloadBlob(new Blob([JSON.stringify(payload)], { type: 'application/json' }), 'Disney-Pin-Scanner-Backup.json');
  toast('Full backup created.');
}

async function importBackup(file) {
  let payload;
  try { payload = JSON.parse(await file.text()); } catch (_) { return toast('That backup file is not valid.'); }
  if (!payload || !Array.isArray(payload.pins)) return toast('That file is not a Pin Scanner backup.');
  if (!confirm(`Import ${payload.pins.length} pins? This will replace the collection currently stored on this device.`)) return;
  await dbClear();
  for (const p of payload.pins) await dbPut(p);
  await refreshPins();
  $('exportSheet').classList.add('hidden');
  toast('Backup imported.');
}

async function saveForm(event) {
  event.preventDefault();
  const name = $('name').value.trim();
  if (!name) return toast('Add or confirm the pin name before saving.');
  const id = $('pinId').value || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
  const existing = pins.find(p => p.id === id);
  const pin = {
    id,
    photo: currentPhoto,
    dateAdded: existing?.dateAdded || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  fieldIds.forEach(k => pin[k] = $(k).value.trim());
  const possibleDuplicate = pins.find(p => p.id !== id && pin.barcode && p.barcode === pin.barcode && (p.name || '').toLowerCase() === pin.name.toLowerCase());
  if (possibleDuplicate && !confirm('A pin with this barcode and name is already saved. Save another anyway?')) return;
  try {
    await dbPut(pin);
    await refreshPins();
    showView('homeView');
    toast('Pin saved.');
  } catch (err) {
    toast('Could not save. Try exporting a backup and freeing browser storage.');
  }
}

function isIos() { return /iphone|ipad|ipod/i.test(navigator.userAgent); }
function isStandalone() { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }

function bindEvents() {
  $('newPinBtn').addEventListener('click', () => openEditor());
  $('scanOnlyBtn').addEventListener('click', () => startScanner(false));
  $('editorBackBtn').addEventListener('click', () => showView('homeView'));
  $('scannerBackBtn').addEventListener('click', async () => { await stopScanner(); showView(scanReturnToEditor ? 'editorView' : 'homeView'); });
  $('manualBarcodeBtn').addEventListener('click', async () => { await stopScanner(); if (scanReturnToEditor) showView('editorView'); else openEditor(); setTimeout(() => $('barcode').focus(), 50); });
  $('scanBarcodeBtn').addEventListener('click', () => startScanner(true));
  $('searchBarcodeBtn').addEventListener('click', () => lookupBarcode());
  $('searchDetailsBtn').addEventListener('click', () => webSearch(queryFromForm()));
  $('sharePhotoBtn').addEventListener('click', sharePhotoForSearch);
  $('photoInput').addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    toast('Preparing photo...');
    try { currentPhoto = await compressImage(file); updatePhotoPreview(); toast('Photo added.'); }
    catch (_) { toast('Could not read that photo.'); }
    e.target.value = '';
  });
  $('pinForm').addEventListener('submit', saveForm);
  $('deleteBtn').addEventListener('click', async () => {
    const id = $('pinId').value;
    if (!id || !confirm('Delete this pin from your collection?')) return;
    await dbDelete(id); await refreshPins(); showView('homeView'); toast('Pin deleted.');
  });
  $('collectionSearch').addEventListener('input', renderPins);
  $('exportMenuBtn').addEventListener('click', () => $('exportSheet').classList.remove('hidden'));
  $('closeExportBtn').addEventListener('click', () => $('exportSheet').classList.add('hidden'));
  $('exportSheet').addEventListener('click', e => { if (e.target === $('exportSheet')) $('exportSheet').classList.add('hidden'); });
  $('exportCsvBtn').addEventListener('click', exportCsv);
  $('exportXlsxBtn').addEventListener('click', exportXlsx);
  $('exportBackupBtn').addEventListener('click', exportBackup);
  $('importBackupInput').addEventListener('change', e => { const f = e.target.files?.[0]; if (f) importBackup(f); e.target.value = ''; });

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); deferredInstallPrompt = e; $('installBtn').classList.remove('hidden');
  });
  $('installBtn').addEventListener('click', async () => {
    if (deferredInstallPrompt) { deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; $('installBtn').classList.add('hidden'); }
    else if (isIos() && !isStandalone()) alert('On iPhone: tap Safari Share, then tap Add to Home Screen.');
  });
}

async function init() {
  bindEvents();
  if (isIos() && !isStandalone()) {
    $('installBtn').classList.remove('hidden');
    $('installBtn').textContent = 'Install';
  }
  try { await openDb(); await refreshPins(); }
  catch (_) { toast('Browser storage could not be opened.'); }
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

init();

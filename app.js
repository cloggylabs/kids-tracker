'use strict';

/* ============================ Base de datos ============================ */

const DB_NAME = 'crece-db';
const DB_VERSION = 1;
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('kids')) {
        d.createObjectStore('kids', { keyPath: 'id' });
      }
      if (!d.objectStoreNames.contains('entries')) {
        const store = d.createObjectStore('entries', { keyPath: 'id' });
        store.createIndex('kidId', 'kidId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

function getAll(store) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const putRecord = (store, record) => tx(store, 'readwrite', s => s.put(record));
const deleteRecord = (store, id) => tx(store, 'readwrite', s => s.delete(id));

function getEntriesByKid(kidId) {
  return new Promise((resolve, reject) => {
    const req = db.transaction('entries').objectStore('entries').index('kidId').getAll(kidId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ============================ Estado ============================ */

let kids = [];
let activeKidId = null;
let entries = [];          // registros del niño activo, ordenados por fecha asc
let editingEntryId = null;
let editingKidId = null;
let pendingPhotoBlob = null;   // foto procesada pendiente de guardar
let photoRemoved = false;
const objectURLs = [];

const $ = sel => document.querySelector(sel);

const EMOJIS = ['🐣', '🦖', '🚀', '🌟', '🦄', '🐻', '🌸', '⚽', '🎨', '🐬'];

/* ============================ Idioma y tema ============================ */

const I18N = {
  es: {
    tabRecords: 'Registros', tabCharts: 'Gráficas', tabPhotos: 'Fotos', tabSettings: 'Ajustes',
    emptyKidsTitle: '¡Bienvenido a Crece!',
    emptyKidsBody: 'Agrega el primer perfil para empezar a registrar el crecimiento.',
    emptyKidsBtn: 'Agregar perfil',
    emptyRegTitle: 'Sin registros todavía',
    emptyRegBody: 'Toca el botón <strong>+</strong> para agregar el primer peso y talla.',
    emptyChartsTitle: 'Aún no hay datos que graficar',
    emptyChartsBody: 'Agrega al menos dos registros para ver el avance.',
    emptyPhotosTitle: 'Sin fotos todavía',
    emptyPhotosBody: 'Al agregar un registro puedes incluir una foto del momento.',
    weight: 'Peso', height: 'Talla', dataTable: 'Tabla de datos',
    thDate: 'Fecha', thAge: 'Edad', thWeight: 'Peso (kg)', thHeight: 'Talla (cm)',
    latest: 'Último',
    profile: 'Perfil', prefs: 'Preferencias', backup: 'Respaldo', storage: 'Almacenamiento',
    theme: 'Tema', themeAuto: 'Auto', themeLight: 'Claro', themeDark: 'Oscuro',
    language: 'Idioma',
    exportBtn: '⬇️ Exportar todos los datos', importBtn: '⬆️ Importar respaldo',
    backupNote: 'El respaldo incluye todos los perfiles, registros y fotos en un archivo JSON. Guárdalo en iCloud, Archivos o donde prefieras.',
    localNote: 'Todos los datos viven únicamente en este dispositivo. Nada se envía a internet.',
    newKid: 'Nuevo peque', editProfile: 'Editar perfil',
    nameLabel: 'Nombre', namePh: 'p. ej. Sofía', birthLabel: 'Fecha de nacimiento', emojiLabel: 'Emoji',
    cancel: 'Cancelar', save: 'Guardar', close: 'Cerrar',
    deleteProfile: 'Eliminar este perfil y sus datos',
    newEntry: 'Nuevo registro', editEntry: 'Editar registro',
    dateLabel: 'Fecha', weightLabel: 'Peso (kg)', heightLabel: 'Talla (cm)',
    photoLabel: 'Foto (opcional)', removePhoto: 'Quitar foto',
    noteLabel: 'Nota (opcional)', notePh: 'p. ej. control pediátrico',
    deleteEntryBtn: 'Eliminar este registro',
    addKid: '+ Agregar',
    entrySaved: 'Registro guardado ✓', entryDeleted: 'Registro eliminado',
    profileUpdated: 'Perfil actualizado', profileDeleted: 'Perfil eliminado',
    kidAdded: n => `¡${n} agregado! 🎉`,
    needData: 'Agrega al menos un peso, talla o foto',
    invalidImage: 'No se pudo leer esa imagen',
    confirmDeleteEntry: '¿Eliminar este registro?',
    confirmDeleteKid: n => `¿Eliminar el perfil de ${n} y TODOS sus registros y fotos? Esta acción no se puede deshacer.`,
    preparingBackup: 'Preparando respaldo…',
    invalidBackup: 'El archivo no es un respaldo válido',
    confirmImport: (k, e) => `Importar ${k} perfil(es) y ${e} registro(s). Los datos con el mismo identificador se sobrescriben. ¿Continuar?`,
    backupImported: 'Respaldo importado ✓',
    storageUsed: mb => `Espacio usado: ${mb} MB.`,
    storageNA: 'Espacio usado: no disponible.',
    bornOn: (d, a) => `Nació el ${d} · ${a}`,
    editProfileBtn: '✏️ Editar perfil',
    noProfile: 'No hay ningún perfil todavía.',
    support: 'Apoyo',
    tipNote: 'Esta app es gratuita y sin anuncios. Si te sirve, puedes apoyarme con una propina voluntaria.',
    tipBtn: '☕ Invítame un café',
    tipTitle: '¡Gracias por tu apoyo! ☕',
    tipScan: 'Escanea el código con tu app de pagos:',
    tipCopy: 'Copiar llave @NEQUIJOS86891',
    tipCopied: 'Llave copiada ✓',
    tipOr: 'o',
    tipWorldLabel: 'Resto del mundo — PayPal',
    tipPaypal: 'Donar con PayPal',
  },
  en: {
    tabRecords: 'Records', tabCharts: 'Charts', tabPhotos: 'Photos', tabSettings: 'Settings',
    emptyKidsTitle: 'Welcome to Crece!',
    emptyKidsBody: 'Add the first profile to start tracking growth.',
    emptyKidsBtn: 'Add profile',
    emptyRegTitle: 'No records yet',
    emptyRegBody: 'Tap the <strong>+</strong> button to add the first weight and height.',
    emptyChartsTitle: 'Nothing to chart yet',
    emptyChartsBody: 'Add at least two records to see the progress.',
    emptyPhotosTitle: 'No photos yet',
    emptyPhotosBody: 'When adding a record you can include a photo of the moment.',
    weight: 'Weight', height: 'Height', dataTable: 'Data table',
    thDate: 'Date', thAge: 'Age', thWeight: 'Weight (kg)', thHeight: 'Height (cm)',
    latest: 'Latest',
    profile: 'Profile', prefs: 'Preferences', backup: 'Backup', storage: 'Storage',
    theme: 'Theme', themeAuto: 'Auto', themeLight: 'Light', themeDark: 'Dark',
    language: 'Language',
    exportBtn: '⬇️ Export all data', importBtn: '⬆️ Import backup',
    backupNote: 'The backup includes every profile, record, and photo in a single JSON file. Keep it in iCloud, Files, or wherever you prefer.',
    localNote: 'All data lives only on this device. Nothing is sent to the internet.',
    newKid: 'New kid', editProfile: 'Edit profile',
    nameLabel: 'Name', namePh: 'e.g. Sofía', birthLabel: 'Date of birth', emojiLabel: 'Emoji',
    cancel: 'Cancel', save: 'Save', close: 'Close',
    deleteProfile: 'Delete this profile and its data',
    newEntry: 'New record', editEntry: 'Edit record',
    dateLabel: 'Date', weightLabel: 'Weight (kg)', heightLabel: 'Height (cm)',
    photoLabel: 'Photo (optional)', removePhoto: 'Remove photo',
    noteLabel: 'Note (optional)', notePh: 'e.g. pediatric checkup',
    deleteEntryBtn: 'Delete this record',
    addKid: '+ Add',
    entrySaved: 'Record saved ✓', entryDeleted: 'Record deleted',
    profileUpdated: 'Profile updated', profileDeleted: 'Profile deleted',
    kidAdded: n => `${n} added! 🎉`,
    needData: 'Add at least a weight, height, or photo',
    invalidImage: 'Could not read that image',
    confirmDeleteEntry: 'Delete this record?',
    confirmDeleteKid: n => `Delete ${n}'s profile and ALL their records and photos? This cannot be undone.`,
    preparingBackup: 'Preparing backup…',
    invalidBackup: 'That file is not a valid backup',
    confirmImport: (k, e) => `Import ${k} profile(s) and ${e} record(s). Data with the same identifier will be overwritten. Continue?`,
    backupImported: 'Backup imported ✓',
    storageUsed: mb => `Space used: ${mb} MB.`,
    storageNA: 'Space used: not available.',
    bornOn: (d, a) => `Born ${d} · ${a}`,
    editProfileBtn: '✏️ Edit profile',
    noProfile: 'No profile yet.',
    support: 'Support',
    tipNote: 'This app is free and ad-free. If it helps you, you can support me with a voluntary tip.',
    tipBtn: '☕ Buy me a coffee',
    tipTitle: 'Thanks for your support! ☕',
    tipScan: 'Scan the code with your payments app:',
    tipCopy: 'Copy key @NEQUIJOS86891',
    tipCopied: 'Key copied ✓',
    tipOr: 'or',
    tipWorldLabel: 'Rest of the world — PayPal',
    tipPaypal: 'Donate via PayPal',
  },
};

let lang = localStorage.getItem('crece-lang') || 'es';
let theme = localStorage.getItem('crece-theme') || 'auto';

function t(key, ...args) {
  const v = I18N[lang][key] ?? I18N.es[key] ?? key;
  return typeof v === 'function' ? v(...args) : v;
}

function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  document.querySelectorAll('#langSeg button').forEach(b => b.classList.toggle('active', b.dataset.langOpt === lang));
}

function applyTheme() {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  const dark = theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => { m.content = dark ? '#1a1a19' : '#fcfcfb'; });
  document.querySelectorAll('#themeSeg button').forEach(b => b.classList.toggle('active', b.dataset.themeOpt === theme));
}

/* ============================ Utilidades ============================ */

function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateShort(date) {
  return date.toLocaleDateString(lang, { month: 'short', year: '2-digit' });
}

function isoToDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function todayISO() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

function ageAt(birthISO, dateISO) {
  const b = isoToDate(birthISO);
  const d = isoToDate(dateISO);
  let months = (d.getFullYear() - b.getFullYear()) * 12 + (d.getMonth() - b.getMonth());
  if (d.getDate() < b.getDate()) months--;
  if (months < 0) return '—';
  if (months === 0) {
    const days = Math.floor((d - b) / 86400000);
    if (lang === 'en') return `${days} day${days === 1 ? '' : 's'}`;
    return `${days} día${days === 1 ? '' : 's'}`;
  }
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (lang === 'en') {
    if (y === 0) return `${m} month${m === 1 ? '' : 's'}`;
    if (m === 0) return `${y} year${y === 1 ? '' : 's'}`;
    return `${y}y ${m}m`;
  }
  if (y === 0) return `${m} mes${m === 1 ? '' : 'es'}`;
  if (m === 0) return `${y} año${y === 1 ? '' : 's'}`;
  return `${y} a ${m} m`;
}

/* Acepta coma o punto como separador decimal (el teclado iOS en español usa coma) */
function num(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function fmtNum(v, dec = 1) {
  return v === null ? '—' : v.toLocaleString(lang, { minimumFractionDigits: 0, maximumFractionDigits: dec });
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2600);
}

function revokeURLs() {
  objectURLs.forEach(u => URL.revokeObjectURL(u));
  objectURLs.length = 0;
}

function blobURL(blob) {
  const u = URL.createObjectURL(blob);
  objectURLs.push(u);
  return u;
}

/* Reduce la foto a máx. 1280px y la comprime a JPEG */
function processPhoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 1280;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        const scale = MAX / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('No se pudo procesar la foto')), 'image/jpeg', 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagen inválida')); };
    img.src = url;
  });
}

/* ============================ Niños (perfiles) ============================ */

function activeKid() {
  return kids.find(k => k.id === activeKidId) || null;
}

async function loadKids() {
  kids = (await getAll('kids')).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  if (!kids.some(k => k.id === activeKidId)) {
    activeKidId = kids[0]?.id ?? null;
  }
}

function renderKidChips() {
  const box = $('#kidChips');
  box.innerHTML = '';
  for (const kid of kids) {
    const chip = document.createElement('button');
    chip.className = 'kid-chip' + (kid.id === activeKidId ? ' active' : '');
    chip.textContent = `${kid.emoji} ${kid.name}`;
    chip.onclick = async () => {
      activeKidId = kid.id;
      await refresh();
    };
    box.appendChild(chip);
  }
  const add = document.createElement('button');
  add.className = 'kid-chip add';
  add.textContent = t('addKid');
  add.onclick = () => openKidDialog(null);
  box.appendChild(add);
}

function openKidDialog(kidId) {
  editingKidId = kidId;
  const kid = kids.find(k => k.id === kidId);
  const form = $('#kidForm');
  form.reset();
  $('#kidDialogTitle').textContent = kid ? t('editProfile') : t('newKid');
  $('#kidDeleteBtn').hidden = !kid;
  form.name.value = kid?.name ?? '';
  form.birthdate.value = kid?.birthdate ?? '';
  form.emoji.value = kid?.emoji ?? EMOJIS[0];
  renderEmojiRow(form.emoji.value);
  $('#kidDialog').showModal();
}

function renderEmojiRow(selected) {
  const row = $('#emojiRow');
  row.innerHTML = '';
  for (const e of EMOJIS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'emoji-btn' + (e === selected ? ' selected' : '');
    b.textContent = e;
    b.onclick = () => {
      $('#kidForm').emoji.value = e;
      renderEmojiRow(e);
    };
    row.appendChild(b);
  }
}

async function saveKid(form) {
  const kid = {
    id: editingKidId ?? crypto.randomUUID(),
    name: form.name.value.trim(),
    birthdate: form.birthdate.value,
    emoji: form.emoji.value,
  };
  await putRecord('kids', kid);
  activeKidId = kid.id;
  await refresh();
  toast(editingKidId ? t('profileUpdated') : t('kidAdded', kid.name));
}

async function deleteKid() {
  const kid = kids.find(k => k.id === editingKidId);
  if (!kid) return;
  if (!confirm(t('confirmDeleteKid', kid.name))) return;
  const kidEntries = await getEntriesByKid(kid.id);
  for (const e of kidEntries) await deleteRecord('entries', e.id);
  await deleteRecord('kids', kid.id);
  $('#kidDialog').close();
  activeKidId = null;
  await refresh();
  toast(t('profileDeleted'));
}

/* ============================ Registros ============================ */

async function loadEntries() {
  entries = activeKidId ? (await getEntriesByKid(activeKidId)).sort((a, b) => a.date.localeCompare(b.date)) : [];
}

function renderEntryList() {
  const list = $('#entryList');
  list.innerHTML = '';
  $('#emptyKids').hidden = kids.length > 0;
  $('#emptyRegistros').hidden = entries.length > 0 || !activeKidId || kids.length === 0;
  const kid = activeKid();
  const desc = [...entries].reverse(); // más reciente primero
  desc.forEach((e, i) => {
    const prev = desc[i + 1] ?? null;
    const li = document.createElement('li');
    li.className = 'entry-item';
    li.onclick = () => openEntryDialog(e.id);

    if (e.photo) {
      const img = document.createElement('img');
      img.className = 'entry-thumb';
      img.src = blobURL(e.photo);
      img.alt = '';
      li.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'entry-thumb placeholder';
      ph.textContent = kid?.emoji ?? '👶';
      li.appendChild(ph);
    }

    const body = document.createElement('div');
    body.className = 'entry-body';

    const dateEl = document.createElement('div');
    dateEl.className = 'entry-date';
    dateEl.innerHTML = `${fmtDate(e.date)}<span class="entry-age">${kid ? ageAt(kid.birthdate, e.date) : ''}</span>`;
    body.appendChild(dateEl);

    const measures = document.createElement('div');
    measures.className = 'entry-measures';
    if (e.weight !== null) {
      measures.appendChild(measureSpan('w', `${fmtNum(e.weight, 2)} kg`, delta(prev?.weight, e.weight, 'kg')));
    }
    if (e.height !== null) {
      measures.appendChild(measureSpan('h', `${fmtNum(e.height)} cm`, delta(prev?.height, e.height, 'cm')));
    }
    body.appendChild(measures);

    if (e.note) {
      const note = document.createElement('div');
      note.className = 'entry-note';
      note.textContent = e.note;
      body.appendChild(note);
    }

    li.appendChild(body);
    list.appendChild(li);
  });
}

function measureSpan(cls, text, deltaText) {
  const span = document.createElement('span');
  span.className = 'm';
  span.innerHTML = `<span class="dot ${cls}"></span>${text}${deltaText ? ` <span class="entry-delta">${deltaText}</span>` : ''}`;
  return span;
}

function delta(prev, curr, unit) {
  if (prev === null || prev === undefined || curr === null) return '';
  const d = curr - prev;
  if (d === 0) return '=';
  const sign = d > 0 ? '+' : '−';
  return `${sign}${fmtNum(Math.abs(d), 2)} ${unit}`;
}

function openEntryDialog(entryId) {
  if (!activeKidId) { openKidDialog(null); return; }
  editingEntryId = entryId;
  pendingPhotoBlob = null;
  photoRemoved = false;
  const entry = entries.find(e => e.id === entryId);
  const form = $('#entryForm');
  form.reset();
  $('#entryDialogTitle').textContent = entry ? t('editEntry') : t('newEntry');
  $('#entryDeleteBtn').hidden = !entry;
  form.date.value = entry?.date ?? todayISO();
  form.weight.value = entry?.weight ?? '';
  form.height.value = entry?.height ?? '';
  form.note.value = entry?.note ?? '';
  updatePhotoPreview(entry?.photo ?? null);
  $('#entryDialog').showModal();
  // Prevent the date input from auto-opening the native picker on mobile
  // by shifting initial focus to the weight field (date is already pre-filled)
  requestAnimationFrame(() => form.weight.focus());
}

function updatePhotoPreview(blob) {
  const box = $('#photoPreview');
  if (blob) {
    $('#photoPreviewImg').src = blobURL(blob);
    box.hidden = false;
  } else {
    box.hidden = true;
  }
}

async function saveEntry(form) {
  const weight = num(form.weight.value);
  const height = num(form.height.value);
  if (weight === null && height === null && !pendingPhotoBlob && !editingEntryId) {
    toast(t('needData'));
    return;
  }
  const existing = entries.find(e => e.id === editingEntryId);
  let photo = existing?.photo ?? null;
  if (photoRemoved) photo = null;
  if (pendingPhotoBlob) photo = pendingPhotoBlob;

  const entry = {
    id: editingEntryId ?? crypto.randomUUID(),
    kidId: activeKidId,
    date: form.date.value,
    weight,
    height,
    note: form.note.value.trim(),
    photo,
  };
  await putRecord('entries', entry);
  await refresh();
  toast(t('entrySaved'));
}

async function deleteEntry() {
  if (!editingEntryId) return;
  if (!confirm(t('confirmDeleteEntry'))) return;
  await deleteRecord('entries', editingEntryId);
  $('#entryDialog').close();
  await refresh();
  toast(t('entryDeleted'));
}

/* ============================ Gráficas ============================ */

function renderCharts() {
  const wPoints = entries.filter(e => e.weight !== null).map(e => ({ date: isoToDate(e.date), iso: e.date, value: e.weight }));
  const hPoints = entries.filter(e => e.height !== null).map(e => ({ date: isoToDate(e.date), iso: e.date, value: e.height }));
  const hasData = wPoints.length > 0 || hPoints.length > 0;

  $('#emptyGraficas').hidden = hasData;
  $('#weightCard').hidden = wPoints.length === 0;
  $('#heightCard').hidden = hPoints.length === 0;
  $('#tableCard').hidden = entries.length === 0;

  const css = getComputedStyle(document.documentElement);
  if (wPoints.length > 0) {
    $('#weightLatest').textContent = `${t('latest')}: ${fmtNum(wPoints[wPoints.length - 1].value, 2)} kg`;
    drawLineChart($('#weightChart'), wPoints, css.getPropertyValue('--series-weight').trim(), 'kg');
  }
  if (hPoints.length > 0) {
    $('#heightLatest').textContent = `${t('latest')}: ${fmtNum(hPoints[hPoints.length - 1].value)} cm`;
    drawLineChart($('#heightChart'), hPoints, css.getPropertyValue('--series-height').trim(), 'cm');
  }
  renderDataTable();
}

function niceTicks(min, max, count = 4) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const rawStep = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { ticks, lo, hi };
}

function drawLineChart(svg, points, color, unit) {
  const W = 600, H = 250;
  const M = { top: 18, right: 20, bottom: 32, left: 44 };
  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;

  const css = getComputedStyle(document.documentElement);
  const gridColor = css.getPropertyValue('--grid').trim();
  const baseColor = css.getPropertyValue('--baseline').trim();
  const mutedColor = css.getPropertyValue('--text-muted').trim();
  const surface = css.getPropertyValue('--surface-1').trim();
  const inkColor = css.getPropertyValue('--text-secondary').trim();

  const t0 = points[0].date.getTime();
  const t1 = points[points.length - 1].date.getTime();
  const tSpan = Math.max(t1 - t0, 86400000);
  const vals = points.map(p => p.value);
  const vMin = Math.min(...vals);
  const vMax = Math.max(...vals);
  const pad = Math.max((vMax - vMin) * 0.12, vMax * 0.02, 0.5);
  const { ticks, lo, hi } = niceTicks(vMin - pad, vMax + pad);

  const x = t => M.left + ((t - t0) / tSpan) * iw;
  const y = v => M.top + ih - ((v - lo) / (hi - lo)) * ih;

  let el = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">`;

  // rejilla horizontal (recesiva) + etiquetas del eje y
  for (const tv of ticks) {
    const yy = y(tv);
    el += `<line x1="${M.left}" y1="${yy}" x2="${W - M.right}" y2="${yy}" stroke="${gridColor}" stroke-width="1"/>`;
    el += `<text x="${M.left - 8}" y="${yy + 4}" text-anchor="end" font-size="12" fill="${mutedColor}" font-family="system-ui,sans-serif">${fmtNum(tv, 1)}</text>`;
  }
  // línea base
  el += `<line x1="${M.left}" y1="${M.top + ih}" x2="${W - M.right}" y2="${M.top + ih}" stroke="${baseColor}" stroke-width="1"/>`;

  // marcas del eje x: primera, media y última fecha (sin encimarse)
  const xTickIdx = points.length <= 2 ? points.map((_, i) => i)
    : [0, Math.floor((points.length - 1) / 2), points.length - 1];
  const seen = new Set();
  for (const i of [...new Set(xTickIdx)]) {
    const p = points[i];
    const label = fmtDateShort(p.date);
    if (seen.has(label)) continue;
    seen.add(label);
    const anchor = i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle';
    el += `<text x="${x(p.date.getTime())}" y="${H - 10}" text-anchor="${anchor}" font-size="12" fill="${mutedColor}" font-family="system-ui,sans-serif">${label}</text>`;
  }

  // línea de datos
  if (points.length > 1) {
    const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.date.getTime()).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
    el += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>`;
  }

  // puntos con anillo de superficie
  for (const p of points) {
    el += `<circle cx="${x(p.date.getTime()).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="6" fill="${color}" stroke="${surface}" stroke-width="2.5"/>`;
  }

  // etiqueta directa solo en el último punto
  const last = points[points.length - 1];
  const lx = x(last.date.getTime());
  const ly = y(last.value);
  const anchor = lx > W - M.right - 60 ? 'end' : 'middle';
  el += `<text x="${anchor === 'end' ? lx - 10 : lx}" y="${ly - 12}" text-anchor="${anchor}" font-size="13" font-weight="600" fill="${inkColor}" font-family="system-ui,sans-serif">${fmtNum(last.value, 2)} ${unit}</text>`;

  // capa de crosshair (se actualiza al tocar)
  el += `<line class="crosshair" x1="0" y1="${M.top}" x2="0" y2="${M.top + ih}" stroke="${baseColor}" stroke-width="1" stroke-dasharray="3 3" visibility="hidden"/>`;
  el += `</svg>`;

  svg.outerHTML = el.replace('<svg xmlns="http://www.w3.org/2000/svg"', `<svg id="${svg.id}" role="img" aria-label="${svg.getAttribute('aria-label') || ''}" xmlns="http://www.w3.org/2000/svg"`);

  attachTooltip(document.getElementById(svg.id), points, { x, y, unit, M, W, H });
}

function attachTooltip(svg, points, scale) {
  const tooltip = $('#chartTooltip');
  const kid = activeKid();
  const crosshair = svg.querySelector('.crosshair');

  function nearest(clientX) {
    const rect = svg.getBoundingClientRect();
    const vx = ((clientX - rect.left) / rect.width) * scale.W;
    let best = null, bestDist = Infinity;
    for (const p of points) {
      const px = scale.x(p.date.getTime());
      const d = Math.abs(px - vx);
      if (d < bestDist) { bestDist = d; best = p; }
    }
    return best;
  }

  function show(clientX) {
    const p = nearest(clientX);
    if (!p) return;
    const rect = svg.getBoundingClientRect();
    const sx = rect.left + (scale.x(p.date.getTime()) / scale.W) * rect.width;
    const sy = rect.top + (scale.y(p.value) / scale.H) * rect.height;
    crosshair.setAttribute('x1', scale.x(p.date.getTime()));
    crosshair.setAttribute('x2', scale.x(p.date.getTime()));
    crosshair.setAttribute('visibility', 'visible');
    tooltip.innerHTML = `<strong>${fmtNum(p.value, 2)} ${scale.unit}</strong><br>${fmtDate(p.iso)}${kid ? ` · ${ageAt(kid.birthdate, p.iso)}` : ''}`;
    tooltip.style.left = `${sx}px`;
    tooltip.style.top = `${sy}px`;
    tooltip.hidden = false;
  }

  function hide() {
    tooltip.hidden = true;
    crosshair.setAttribute('visibility', 'hidden');
  }

  svg.addEventListener('pointermove', ev => show(ev.clientX));
  svg.addEventListener('pointerdown', ev => show(ev.clientX));
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('pointerup', () => setTimeout(hide, 1600));
}

function renderDataTable() {
  const tbody = $('#dataTable tbody');
  tbody.innerHTML = '';
  const kid = activeKid();
  for (const e of [...entries].reverse()) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${fmtDate(e.date)}</td><td>${kid ? ageAt(kid.birthdate, e.date) : '—'}</td><td>${fmtNum(e.weight, 2)}</td><td>${fmtNum(e.height)}</td>`;
    tbody.appendChild(tr);
  }
}

/* ============================ Fotos ============================ */

function renderPhotos() {
  const grid = $('#photoGrid');
  grid.innerHTML = '';
  const kid = activeKid();
  const withPhotos = [...entries].reverse().filter(e => e.photo);
  $('#emptyFotos').hidden = withPhotos.length > 0;
  for (const e of withPhotos) {
    const cell = document.createElement('div');
    cell.className = 'photo-cell';
    const img = document.createElement('img');
    img.src = blobURL(e.photo);
    img.alt = fmtDate(e.date);
    img.loading = 'lazy';
    const cap = document.createElement('div');
    cap.className = 'photo-cap';
    const measures = [
      e.weight !== null ? `${fmtNum(e.weight, 2)} kg` : null,
      e.height !== null ? `${fmtNum(e.height)} cm` : null,
    ].filter(Boolean).join(' · ');
    cap.innerHTML = `<strong>${kid ? ageAt(kid.birthdate, e.date) : ''}</strong><br>${fmtDate(e.date)}${measures ? `<br>${measures}` : ''}`;
    cell.appendChild(img);
    cell.appendChild(cap);
    cell.onclick = () => {
      $('#photoViewerImg').src = img.src;
      $('#photoViewerCaption').textContent = `${fmtDate(e.date)}${kid ? ` · ${ageAt(kid.birthdate, e.date)}` : ''}${measures ? ` · ${measures}` : ''}`;
      $('#photoViewer').showModal();
    };
    grid.appendChild(cell);
  }
}

/* ============================ Ajustes ============================ */

function renderSettings() {
  const card = $('#kidProfileCard');
  const kid = activeKid();
  if (!kid) {
    card.innerHTML = `<p class="settings-note">${t('noProfile')}</p>`;
    return;
  }
  card.innerHTML = '';
  const line = document.createElement('div');
  line.className = 'profile-line';
  line.innerHTML = `<span class="big">${kid.emoji}</span><span><strong>${kid.name}</strong><br><span class="sub">${t('bornOn', fmtDate(kid.birthdate), ageAt(kid.birthdate, todayISO()))}</span></span>`;
  card.appendChild(line);
  const editBtn = document.createElement('button');
  editBtn.className = 'settings-btn';
  editBtn.textContent = t('editProfileBtn');
  editBtn.onclick = () => openKidDialog(kid.id);
  card.appendChild(editBtn);
  updateStorageInfo();
}

async function updateStorageInfo() {
  const el = $('#storageInfo');
  try {
    const est = await navigator.storage.estimate();
    const used = (est.usage / 1048576).toFixed(1);
    el.textContent = t('storageUsed', used);
  } catch {
    el.textContent = t('storageNA');
  }
}

/* ============================ Respaldo ============================ */

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function dataURLToBlob(url) {
  return (await fetch(url)).blob();
}

async function exportData() {
  toast(t('preparingBackup'));
  const allKids = await getAll('kids');
  const allEntries = await getAll('entries');
  const out = {
    app: 'crece',
    version: 1,
    exportedAt: new Date().toISOString(),
    kids: allKids,
    entries: await Promise.all(allEntries.map(async e => ({
      ...e,
      photo: e.photo ? await blobToDataURL(e.photo) : null,
    }))),
  };
  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `crece-respaldo-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

async function importData(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    toast(t('invalidBackup'));
    return;
  }
  if (data.app !== 'crece' || !Array.isArray(data.kids) || !Array.isArray(data.entries)) {
    toast(t('invalidBackup'));
    return;
  }
  if (!confirm(t('confirmImport', data.kids.length, data.entries.length))) return;
  for (const kid of data.kids) await putRecord('kids', kid);
  for (const e of data.entries) {
    await putRecord('entries', { ...e, photo: e.photo ? await dataURLToBlob(e.photo) : null });
  }
  await refresh();
  toast(t('backupImported'));
}

/* ============================ Navegación y refresco ============================ */

function switchView(name) {
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== `view-${name}`; });
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  const contentView = name === 'registros' || name === 'graficas' || name === 'fotos';
  $('#fabAdd').style.display = contentView ? '' : 'none';
  $('#fabTip').style.display = contentView ? '' : 'none';
  if (name === 'graficas') renderCharts();
}

async function refresh() {
  revokeURLs();
  await loadKids();
  await loadEntries();
  renderKidChips();
  renderEntryList();
  renderPhotos();
  renderSettings();
  if (!$('#view-graficas').hidden) renderCharts();
}

/* ============================ Demo ============================ */

async function seedDemo() {
  const kid = { id: 'demo-kid', name: 'Sofía', birthdate: '2024-03-10', emoji: '🌸' };
  await putRecord('kids', kid);
  const demo = [
    ['2024-03-10', 3.2, 50, 'nacimiento'],
    ['2024-04-12', 4.1, 54, ''],
    ['2024-06-15', 6.3, 61, 'control pediátrico'],
    ['2024-09-20', 7.9, 68, ''],
    ['2025-01-18', 9.4, 74, ''],
    ['2025-06-14', 10.6, 80, 'primer añito ya pasó'],
    ['2025-12-06', 11.8, 86, ''],
    ['2026-06-20', 13.1, 91, 'control de 2 años'],
  ];
  for (const [date, weight, height, note] of demo) {
    await putRecord('entries', { id: `demo-${date}`, kidId: kid.id, date, weight, height, note, photo: null });
  }
  activeKidId = kid.id;
}

/* ============================ Arranque ============================ */

async function main() {
  applyTheme();
  applyLang();
  db = await openDB();
  await refresh();

  // preferencias: tema e idioma
  document.querySelectorAll('#themeSeg button').forEach(b => {
    b.onclick = () => {
      theme = b.dataset.themeOpt;
      localStorage.setItem('crece-theme', theme);
      applyTheme();
      renderCharts(); // las gráficas llevan los colores incrustados en el SVG
    };
  });
  document.querySelectorAll('#langSeg button').forEach(b => {
    b.onclick = async () => {
      lang = b.dataset.langOpt;
      localStorage.setItem('crece-lang', lang);
      applyLang();
      await refresh(); // re-renderiza fechas, edades y textos dinámicos
    };
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    applyTheme();
    renderCharts();
  });

  // pestañas
  document.querySelectorAll('.tab').forEach(t => {
    t.onclick = () => switchView(t.dataset.view);
  });

  // FAB
  $('#fabAdd').onclick = () => openEntryDialog(null);

  // diálogo de niño
  $('#kidForm').addEventListener('submit', ev => {
    if (ev.submitter?.id === 'kidSaveBtn') saveKid(ev.target);
  });
  $('#kidDeleteBtn').onclick = deleteKid;

  // diálogo de registro
  $('#entryForm').addEventListener('submit', ev => {
    if (!ev.submitter?.hasAttribute('data-close')) saveEntry(ev.target);
  });
  $('#entryDeleteBtn').onclick = deleteEntry;
  $('#entryForm').photo.addEventListener('change', async ev => {
    const file = ev.target.files[0];
    if (!file) return;
    try {
      pendingPhotoBlob = await processPhoto(file);
      photoRemoved = false;
      updatePhotoPreview(pendingPhotoBlob);
    } catch {
      toast(t('invalidImage'));
    }
  });
  $('#photoRemoveBtn').onclick = () => {
    pendingPhotoBlob = null;
    photoRemoved = true;
    $('#entryForm').photo.value = '';
    updatePhotoPreview(null);
  };

  // cerrar diálogos
  document.querySelectorAll('[data-close]').forEach(b => {
    b.onclick = () => b.closest('dialog').close();
  });
  $('#photoViewerClose').onclick = () => $('#photoViewer').close();

  // propinas
  $('#btnTip').onclick = () => $('#tipDialog').showModal();
  $('#fabTip').onclick = () => $('#tipDialog').showModal();
  $('#tipCopyBtn').onclick = async () => {
    try {
      await navigator.clipboard.writeText('@NEQUIJOS86891');
      toast(t('tipCopied'));
    } catch {
      toast('@NEQUIJOS86891');
    }
  };

  // respaldo
  $('#btnExport').onclick = exportData;
  $('#btnImport').onclick = () => $('#importFile').click();
  $('#importFile').addEventListener('change', ev => {
    const f = ev.target.files[0];
    if (f) importData(f);
    ev.target.value = '';
  });

  // datos de demostración: abrir con #demo (o #demo/graficas, #demo/fotos)
  if (location.hash.startsWith('#demo')) {
    if (kids.length === 0) { await seedDemo(); await refresh(); }
    const demoView = location.hash.split('/')[1];
    if (demoView) switchView(demoView);
  }

  // pedir almacenamiento persistente (evita que iOS borre los datos)
  if (navigator.storage?.persist) {
    navigator.storage.persist();
  }

  // service worker para funcionar sin conexión
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

main();

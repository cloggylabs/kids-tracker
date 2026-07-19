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

/* ============================ Utilidades ============================ */

function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateShort(date) {
  return date.toLocaleDateString('es', { month: 'short', year: '2-digit' });
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
    return `${days} día${days === 1 ? '' : 's'}`;
  }
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m} mes${m === 1 ? '' : 'es'}`;
  if (m === 0) return `${y} año${y === 1 ? '' : 's'}`;
  return `${y} a ${m} m`;
}

function num(v) {
  return (v === null || v === undefined || v === '') ? null : Number(v);
}

function fmtNum(v, dec = 1) {
  return v === null ? '—' : v.toLocaleString('es', { minimumFractionDigits: 0, maximumFractionDigits: dec });
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
  add.textContent = '+ Agregar';
  add.onclick = () => openKidDialog(null);
  box.appendChild(add);
}

function openKidDialog(kidId) {
  editingKidId = kidId;
  const kid = kids.find(k => k.id === kidId);
  const form = $('#kidForm');
  form.reset();
  $('#kidDialogTitle').textContent = kid ? 'Editar perfil' : 'Nuevo peque';
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
  toast(editingKidId ? 'Perfil actualizado' : `¡${kid.name} agregado! 🎉`);
}

async function deleteKid() {
  const kid = kids.find(k => k.id === editingKidId);
  if (!kid) return;
  if (!confirm(`¿Eliminar el perfil de ${kid.name} y TODOS sus registros y fotos? Esta acción no se puede deshacer.`)) return;
  const kidEntries = await getEntriesByKid(kid.id);
  for (const e of kidEntries) await deleteRecord('entries', e.id);
  await deleteRecord('kids', kid.id);
  $('#kidDialog').close();
  activeKidId = null;
  await refresh();
  toast('Perfil eliminado');
}

/* ============================ Registros ============================ */

async function loadEntries() {
  entries = activeKidId ? (await getEntriesByKid(activeKidId)).sort((a, b) => a.date.localeCompare(b.date)) : [];
}

function renderEntryList() {
  const list = $('#entryList');
  list.innerHTML = '';
  $('#emptyRegistros').hidden = entries.length > 0 || !activeKidId;
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
  $('#entryDialogTitle').textContent = entry ? 'Editar registro' : 'Nuevo registro';
  $('#entryDeleteBtn').hidden = !entry;
  form.date.value = entry?.date ?? todayISO();
  form.weight.value = entry?.weight ?? '';
  form.height.value = entry?.height ?? '';
  form.note.value = entry?.note ?? '';
  updatePhotoPreview(entry?.photo ?? null);
  $('#entryDialog').showModal();
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
    toast('Agrega al menos un peso, talla o foto');
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
  toast('Registro guardado ✓');
}

async function deleteEntry() {
  if (!editingEntryId) return;
  if (!confirm('¿Eliminar este registro?')) return;
  await deleteRecord('entries', editingEntryId);
  $('#entryDialog').close();
  await refresh();
  toast('Registro eliminado');
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
    $('#weightLatest').textContent = `Último: ${fmtNum(wPoints[wPoints.length - 1].value, 2)} kg`;
    drawLineChart($('#weightChart'), wPoints, css.getPropertyValue('--series-weight').trim(), 'kg');
  }
  if (hPoints.length > 0) {
    $('#heightLatest').textContent = `Último: ${fmtNum(hPoints[hPoints.length - 1].value)} cm`;
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
    img.alt = `Foto del ${fmtDate(e.date)}`;
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
    card.innerHTML = '<p class="settings-note">No hay ningún perfil todavía.</p>';
    return;
  }
  card.innerHTML = '';
  const line = document.createElement('div');
  line.className = 'profile-line';
  line.innerHTML = `<span class="big">${kid.emoji}</span><span><strong>${kid.name}</strong><br><span class="sub">Nació el ${fmtDate(kid.birthdate)} · ${ageAt(kid.birthdate, todayISO())}</span></span>`;
  card.appendChild(line);
  const editBtn = document.createElement('button');
  editBtn.className = 'settings-btn';
  editBtn.textContent = '✏️ Editar perfil';
  editBtn.onclick = () => openKidDialog(kid.id);
  card.appendChild(editBtn);
  updateStorageInfo();
}

async function updateStorageInfo() {
  const el = $('#storageInfo');
  try {
    const est = await navigator.storage.estimate();
    const used = (est.usage / 1048576).toFixed(1);
    el.textContent = `Espacio usado: ${used} MB.`;
  } catch {
    el.textContent = 'Espacio usado: no disponible.';
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
  toast('Preparando respaldo…');
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
    toast('El archivo no es un respaldo válido');
    return;
  }
  if (data.app !== 'crece' || !Array.isArray(data.kids) || !Array.isArray(data.entries)) {
    toast('El archivo no es un respaldo válido');
    return;
  }
  if (!confirm(`Importar ${data.kids.length} perfil(es) y ${data.entries.length} registro(s). Los datos con el mismo identificador se sobrescriben. ¿Continuar?`)) return;
  for (const kid of data.kids) await putRecord('kids', kid);
  for (const e of data.entries) {
    await putRecord('entries', { ...e, photo: e.photo ? await dataURLToBlob(e.photo) : null });
  }
  await refresh();
  toast('Respaldo importado ✓');
}

/* ============================ Navegación y refresco ============================ */

function switchView(name) {
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== `view-${name}`; });
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  $('#fabAdd').style.display = (name === 'registros' || name === 'graficas' || name === 'fotos') ? '' : 'none';
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
  db = await openDB();
  await refresh();

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
      toast('No se pudo leer esa imagen');
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
  } else if (kids.length === 0) {
    // primer uso: pedir el primer perfil
    openKidDialog(null);
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

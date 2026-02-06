/* main.js — M2 + QoL + M3.1 (BÄTTRE NESTNING: MaxRects + multi-try)
   - Ladda flera DXF
   - Sidebar preview + qty + synlig + ta bort
   - Materialval + custom
   - Mätläge: ΔX/ΔY/L/θ
   - Soft snap med Shift + preview-ring + tydlig snäppzon
   - M3.1: MaxRects (free-rectangles) + testar flera sorteringar + flera heuristics,
           väljer bästa (minst antal ark, bäst utnyttjande).
   - Rotation: 0°/90° (valbar)
   - Gap (mm): används som “halv-gap” runt varje del i ritningen (symmetrisk spacing)
*/

const fileInput = document.getElementById('fileInput');
const fileListEl = document.getElementById('fileList');

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const materialSelect = document.getElementById('materialSelect');
const customMaterial = document.getElementById('customMaterial');
const customW = document.getElementById('customW');
const customH = document.getElementById('customH');
const materialInfo = document.getElementById('materialInfo');

const overlay = document.getElementById('overlay');
const measureBtn = document.getElementById('measureBtn');
const measureStatus = document.getElementById('measureStatus');
const measureReadout = document.getElementById('measureReadout');

const snapEnabledEl = document.getElementById('snapEnabled');
const snapTolEl = document.getElementById('snapTol');

// M3 UI (måste finnas i index.html)
const gapMmEl = document.getElementById('gapMm');
const allowRotateEl = document.getElementById('allowRotate');
const nestBtn = document.getElementById('nestBtn');

const nestNav = document.getElementById('nestNav');
const prevSheetBtn = document.getElementById('prevSheetBtn');
const nextSheetBtn = document.getElementById('nextSheetBtn');
const sheetInfoEl = document.getElementById('sheetInfo');
const nestStatsEl = document.getElementById('nestStats');

// State
let parts = [];
let material = { w: 1000, h: 1000 };

// View transform for mapping screen <-> mm on material
let view = { scale: 1, ox: 20, oy: 20, matWpx: 0, matHpx: 0 };

// Measure state
let measureOn = false;
let measureP1 = null; // {xMm,yMm}
let measureP2 = null;
let hoverSnap = null; // {xMm, yMm, note}
let shiftDown = false;

// Nest state
let nestSheets = null; // [{ placements: [...], usedArea: number }]
let currentSheet = 0;
let lastNestMeta = null; // {sheetCount,totalUsed,totalUtil,bestLabel,gap,allowRot,itemsCount,placedCount}

// ---------------- Canvas sizing ----------------
function resizeCanvas() {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  draw();
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ---------------- Material ----------------
function updateMaterialFromUI() {
  if (materialSelect.value === 'custom') {
    customMaterial.style.display = 'block';
    material.w = Number(customW.value || 0);
    material.h = Number(customH.value || 0);
  } else {
    customMaterial.style.display = 'none';
    const [w, h] = materialSelect.value.split('x').map(Number);
    material = { w, h };
  }
  updateMaterialInfo();

  // Nestning blir stale när material ändras
  nestSheets = null;
  currentSheet = 0;
  lastNestMeta = null;
  if (nestNav) nestNav.style.display = 'none';

  draw();
}
materialSelect.addEventListener('change', updateMaterialFromUI);
customW.addEventListener('input', updateMaterialFromUI);
customH.addEventListener('input', updateMaterialFromUI);

function updateMaterialInfo() {
  materialInfo.textContent = `Material: ${material.w} × ${material.h} mm`;
}

// ---------------- DXF Load ----------------
fileInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  for (const file of files) {
    const text = await file.text();
    const parser = new window.DxfParser();
    let dxf;

    try {
      dxf = parser.parseSync(text);
    } catch (err) {
      console.error('DXF parse error:', file.name, err);
      alert(`Kunde inte läsa DXF: ${file.name}`);
      continue;
    }

    const bounds = getBounds(dxf);

    parts.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
      name: file.name,
      dxf,
      bounds,
      qty: 1,
      visible: true
    });
  }

  nestSheets = null;
  currentSheet = 0;
  lastNestMeta = null;
  if (nestNav) nestNav.style.display = 'none';

  renderFileList();
  draw();
});

function renderFileList() {
  fileListEl.innerHTML = '';

  parts.forEach((p) => {
    const div = document.createElement('div');
    div.className = 'file-item';

    div.innerHTML = `
      <div class="file-header">
        <div class="file-title">${escapeHtml(p.name)}</div>
        <button class="file-remove" title="Ta bort" data-id="${p.id}">✕</button>
      </div>

      <canvas class="thumb-wide" width="240" height="140" data-id="${p.id}"></canvas>

      <div class="file-fields">
        <label>Antal:
          <input type="number" min="1" value="${p.qty}" data-id="${p.id}" class="qty-input" />
        </label>

        <label>
          <input type="checkbox" ${p.visible ? 'checked' : ''} data-id="${p.id}" class="vis-input" />
          Visa
        </label>

        <div style="margin-top:6px;font-size:12px;">Mått: ${boundsToText(p.bounds)}</div>
      </div>
    `;

    fileListEl.appendChild(div);
  });

  // bind qty
  fileListEl.querySelectorAll('.qty-input').forEach(input => {
    input.addEventListener('input', (e) => {
      const id = e.target.dataset.id;
      const p = parts.find(x => x.id === id);
      if (!p) return;
      p.qty = Math.max(1, Number(e.target.value || 1));

      nestSheets = null;
      currentSheet = 0;
      lastNestMeta = null;
      if (nestNav) nestNav.style.display = 'none';
      draw();
    });
  });

  // bind visible
  fileListEl.querySelectorAll('.vis-input').forEach(input => {
    input.addEventListener('change', (e) => {
      const id = e.target.dataset.id;
      const p = parts.find(x => x.id === id);
      if (!p) return;
      p.visible = e.target.checked;

      nestSheets = null;
      currentSheet = 0;
      lastNestMeta = null;
      if (nestNav) nestNav.style.display = 'none';
      draw();
    });
  });

  // bind remove
  fileListEl.querySelectorAll('.file-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      parts = parts.filter(x => x.id !== id);

      nestSheets = null;
      currentSheet = 0;
      lastNestMeta = null;
      if (nestNav) nestNav.style.display = 'none';

      renderFileList();
      draw();
    });
  });

  // draw thumbnails
  fileListEl.querySelectorAll('canvas[data-id]').forEach(c => {
    const id = c.dataset.id;
    const p = parts.find(x => x.id === id);
    if (!p) return;
    drawThumbnail(p, c);
  });

  overlay.textContent = parts.length
    ? 'M3.1: MaxRects nestning (bättre) + mätning + snäpp.'
    : 'Ladda DXF-filer för att börja';
}

// ---------------- Measure ----------------
measureBtn.addEventListener('click', () => {
  measureOn = !measureOn;
  if (!measureOn) {
    measureP1 = null;
    measureP2 = null;
    hoverSnap = null;
    measureReadout.textContent = '';
  }
  updateMeasureUI();
  draw();
});

function updateMeasureUI() {
  measureStatus.textContent = measureOn ? 'Mätläge på' : 'Mätläge av';
}

// Track Shift so draw() can show snap zone reliably
window.addEventListener('keydown', (e) => {
  if (e.key === 'Shift') {
    shiftDown = true;
    if (measureOn) draw();
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'Shift') {
    shiftDown = false;
    hoverSnap = null;
    if (measureOn) draw();
  }
});

canvas.addEventListener('click', (ev) => {
  if (!measureOn) return;

  const rect = canvas.getBoundingClientRect();
  const sx = ev.clientX - rect.left;
  const sy = ev.clientY - rect.top;

  let mm = screenToMm(sx, sy);
  if (!mm) return; // click outside material

  const snapped = applySnap(mm, ev.shiftKey);
  mm = snapped.pt;

  if (!measureP1 || (measureP1 && measureP2)) {
    measureP1 = mm;
    measureP2 = null;
    measureReadout.textContent = snapped.note ? `Snäpp: ${snapped.note}. Välj punkt 2...` : 'Välj punkt 2...';
  } else {
    measureP2 = mm;

    const dx = measureP2.xMm - measureP1.xMm;
    const dy = measureP2.yMm - measureP1.yMm;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // 0° = höger, 90° = ned (pga skärmkoordinater)
    let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (angleDeg < 0) angleDeg += 360;

    const base = `ΔX: ${dx.toFixed(1)} mm, ΔY: ${dy.toFixed(1)} mm, L: ${dist.toFixed(1)} mm, θ: ${angleDeg.toFixed(1)}°`;
    measureReadout.textContent = snapped.note ? `${base} (snäpp: ${snapped.note})` : base;
  }

  draw();
});

canvas.addEventListener('mousemove', (ev) => {
  if (!measureOn) {
    hoverSnap = null;
    draw();
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const sx = ev.clientX - rect.left;
  const sy = ev.clientY - rect.top;

  const mm = screenToMm(sx, sy);
  if (!mm) {
    hoverSnap = null;
    draw();
    return;
  }

  const snapped = applySnap(mm, ev.shiftKey);

  // Preview only when Shift and near edge/corner snap
  if (ev.shiftKey && snapped.note) {
    hoverSnap = { ...snapped.pt, note: snapped.note };
  } else {
    hoverSnap = null;
  }

  draw();
});

function screenToMm(sx, sy) {
  const x = (sx - view.ox) / view.scale;
  const y = (sy - view.oy) / view.scale;

  if (x < 0 || y < 0 || x > material.w || y > material.h) return null;
  return { xMm: x, yMm: y };
}

function mmToScreen(xMm, yMm) {
  return { sx: view.ox + xMm * view.scale, sy: view.oy + yMm * view.scale };
}

function applySnap(mmPt, shiftKey) {
  if (!shiftKey) return { pt: mmPt, note: '' };

  const enabled = !!snapEnabledEl?.checked;
  if (!enabled) return { pt: mmPt, note: '' };

  const tol = Math.max(0, Number(snapTolEl?.value ?? 0));
  if (tol <= 0) return { pt: mmPt, note: '' };

  let { xMm, yMm } = mmPt;

  const nearLeft = xMm <= tol;
  const nearRight = (material.w - xMm) <= tol;
  const nearTop = yMm <= tol;
  const nearBottom = (material.h - yMm) <= tol;

  let snappedX = false, snappedY = false;

  if (nearLeft) { xMm = 0; snappedX = true; }
  else if (nearRight) { xMm = material.w; snappedX = true; }

  if (nearTop) { yMm = 0; snappedY = true; }
  else if (nearBottom) { yMm = material.h; snappedY = true; }

  let note = '';
  if (snappedX && snappedY) note = 'hörn';
  else if (snappedX) note = (xMm === 0) ? 'vänsterkant' : 'högerkant';
  else if (snappedY) note = (yMm === 0) ? 'toppkant' : 'bottenkant';

  return { pt: { xMm, yMm }, note };
}

// ---------------- Nesting (M3.1 MaxRects + multi-try) ----------------
nestBtn.addEventListener('click', () => runNestingMultiTry());

prevSheetBtn?.addEventListener('click', () => {
  if (!nestSheets) return;
  currentSheet = Math.max(0, currentSheet - 1);
  updateNestUI();
  draw();
});

nextSheetBtn?.addEventListener('click', () => {
  if (!nestSheets) return;
  currentSheet = Math.min(nestSheets.length - 1, currentSheet + 1);
  updateNestUI();
  draw();
});

function runNestingMultiTry() {
  const gap = Math.max(0, Number(gapMmEl?.value ?? 0));
  const allowRot = !!allowRotateEl?.checked;

  const matW = Number(material.w || 0);
  const matH = Number(material.h || 0);

  if (matW <= 0 || matH <= 0) {
    overlay.textContent = 'Välj ett giltigt material först.';
    return;
  }

  const items = buildItemsFromParts();
  if (!items.length) {
    overlay.textContent = 'Inget att nesta (kontrollera synlighet/antal).';
    nestSheets = null;
    currentSheet = 0;
    lastNestMeta = null;
    nestNav.style.display = 'none';
    draw();
    return;
  }

  // säkerhetsgräns (undvik att webbläsaren dör om man råkar skriva 9999)
  const MAX_ITEMS = 800;
  if (items.length > MAX_ITEMS) {
    alert(`För många delar (${items.length}). Sänk antal eller filer. Max ${MAX_ITEMS} i nuläget.`);
    return;
  }

  // heuristics + sorteringsstrategier
  const heuristics = [
    { key: 'BSSF', name: 'Best Short Side Fit' },
    { key: 'BAF',  name: 'Best Area Fit' },
    { key: 'BL',   name: 'Bottom-Left' }
  ];

  const sorters = [
    { key: 'AREA', name: 'Area desc', fn: (a, b) => (b.area - a.area) || (b.maxSide - a.maxSide) },
    { key: 'MAX',  name: 'Max-side desc', fn: (a, b) => (b.maxSide - a.maxSide) || (b.area - a.area) },
    { key: 'AR',   name: 'Aspect (lång-smal) desc', fn: (a, b) => (b.aspect - a.aspect) || (b.area - a.area) }
  ];

  // Gör en "normaliserad" item representation för snabbare kopiering
  const baseItems = items.map((it, i) => ({
    idx: i,
    partId: it.partId,
    name: it.name,
    w: it.w,
    h: it.h,
    area: it.w * it.h,
    maxSide: Math.max(it.w, it.h),
    aspect: Math.max(it.w, it.h) / Math.max(1e-9, Math.min(it.w, it.h))
  }));

  let best = null;

  for (const s of sorters) {
    const sorted = [...baseItems].sort(s.fn);

    for (const h of heuristics) {
      const res = packAllSheets_MaxRects(sorted, matW, matH, gap, allowRot, h.key);

      // Om någon del inte får plats ens på tomt ark => abort direkt med tydlig info
      if (res.hardFailItem) {
        const it = res.hardFailItem;
        overlay.textContent = `Del "${it.name}" (${Math.round(it.w)}×${Math.round(it.h)} mm) får inte plats på materialet.`;
        nestSheets = null;
        currentSheet = 0;
        lastNestMeta = null;
        nestNav.style.display = 'none';
        draw();
        return;
      }

      const score = scoreResult(res, matW, matH);

      if (!best || isBetterScore(score, best.score)) {
        best = {
          score,
          sheets: res.sheets,
          meta: {
            sheetCount: res.sheets.length,
            totalUsed: res.totalUsedArea,
            totalUtil: score.totalUtil,
            bestLabel: `${h.name} + ${s.name}`,
            gap,
            allowRot,
            itemsCount: baseItems.length,
            placedCount: res.placedCount
          }
        };
      }
    }
  }

  if (!best) {
    overlay.textContent = 'Kunde inte skapa en nestning (okänt fel).';
    return;
  }

  nestSheets = best.sheets;
  currentSheet = 0;
  lastNestMeta = best.meta;
  nestNav.style.display = 'block';
  overlay.textContent = `M3.1: Nestning klar (${best.meta.bestLabel}) — Ark: ${best.meta.sheetCount}`;
  updateNestUI();
  draw();
}

function buildItemsFromParts() {
  const items = [];
  for (const p of parts) {
    if (!p.visible) continue;
    const b = p.bounds;
    if (!b || !Number.isFinite(b.w) || !Number.isFinite(b.h) || b.w <= 0 || b.h <= 0) continue;

    const w = b.w;
    const h = b.h;
    const qty = Math.max(1, Number(p.qty || 1));

    for (let i = 0; i < qty; i++) {
      items.push({
        partId: p.id,
        name: p.name,
        w,
        h
      });
    }
  }
  return items;
}

function scoreResult(res, matW, matH) {
  const sheetCount = Math.max(1, res.sheets.length);
  const totalArea = sheetCount * (matW * matH);
  const totalUtil = totalArea > 0 ? (res.totalUsedArea / totalArea) : 0;

  // Vi vill: färre ark först, sedan högre totalUtil
  return {
    sheetCount,
    totalUtil,
    // tie-break: högre util på första arket
    firstUtil: (matW * matH) > 0 ? (res.sheets[0].usedArea / (matW * matH)) : 0
  };
}

function isBetterScore(a, b) {
  if (a.sheetCount !== b.sheetCount) return a.sheetCount < b.sheetCount;
  if (a.totalUtil !== b.totalUtil) return a.totalUtil > b.totalUtil;
  return a.firstUtil > b.firstUtil;
}

/* ---------------- MaxRects Packing ----------------
   - Vi packar PADDADE rektanglar: pw = w + gap, ph = h + gap
   - När vi ritar: vi ritar den “riktiga” rektangeln inset med gap/2
*/
function packAllSheets_MaxRects(itemsSorted, matW, matH, gap, allowRot, heuristicKey) {
  const remaining = [...itemsSorted];
  const sheets = [];
  let totalUsedArea = 0;
  let placedCount = 0;

  // snabb “hard fail”-koll: om en rektangel aldrig får plats
  for (const it of remaining) {
    const fits0 = (it.w + gap) <= matW && (it.h + gap) <= matH;
    const fitsR = allowRot && (it.h + gap) <= matW && (it.w + gap) <= matH;
    if (!fits0 && !fitsR) {
      return { sheets: [], totalUsedArea: 0, placedCount: 0, hardFailItem: it };
    }
  }

  while (remaining.length) {
    const packed = packOneSheet_MaxRects(remaining, matW, matH, gap, allowRot, heuristicKey);
    sheets.push(packed.sheet);
    totalUsedArea += packed.sheet.usedArea;
    placedCount += packed.sheet.placements.length;

    if (packed.unplaced.length === remaining.length) {
      // borde inte hända pga hard-fail check, men safety:
      break;
    }
    remaining.length = 0;
    remaining.push(...packed.unplaced);
  }

  return { sheets, totalUsedArea, placedCount, hardFailItem: null };
}

function packOneSheet_MaxRects(items, matW, matH, gap, allowRot, heuristicKey) {
  const free = [{ x: 0, y: 0, w: matW, h: matH }];
  const placements = [];
  let usedArea = 0;

  const unplaced = [];

  for (const it of items) {
    const choice = findBestPlacement_MaxRects(it, free, matW, matH, gap, allowRot, heuristicKey);
    if (!choice) {
      unplaced.push(it);
      continue;
    }

    // Lägg
    const placedRect = { x: choice.x, y: choice.y, w: choice.pw, h: choice.ph };
    placements.push({
      partId: it.partId,
      name: it.name,
      // position för PAD (mm)
      x: choice.x,
      y: choice.y,
      // “riktiga” dimensioner (mm)
      w: choice.w,
      h: choice.h,
      // pad dimensioner (mm)
      pw: choice.pw,
      ph: choice.ph,
      rot: choice.rot,
      gap
    });

    usedArea += (choice.w * choice.h);

    // Uppdatera free rects
    splitFreeRects(free, placedRect);
    pruneFreeRects(free);
  }

  return { sheet: { placements, usedArea }, unplaced };
}

function findBestPlacement_MaxRects(it, free, matW, matH, gap, allowRot, heuristicKey) {
  // Return {x,y,w,h,pw,ph,rot} eller null
  let best = null;

  const candidates = [];
  // 0°
  candidates.push({ w: it.w, h: it.h, rot: 0 });
  // 90°
  if (allowRot && it.w !== it.h) candidates.push({ w: it.h, h: it.w, rot: 90 });

  for (const o of candidates) {
    const pw = o.w + gap;
    const ph = o.h + gap;

    for (const fr of free) {
      if (pw <= fr.w && ph <= fr.h) {
        const x = fr.x;
        const y = fr.y;

        const score = scorePlacement(fr, pw, ph, heuristicKey);
        const cand = { x, y, w: o.w, h: o.h, pw, ph, rot: o.rot, score };
        if (!best || isBetterPlacement(cand, best, heuristicKey)) best = cand;
      }
    }
  }

  return best;
}

function scorePlacement(freeRect, pw, ph, heuristicKey) {
  const leftoverW = freeRect.w - pw;
  const leftoverH = freeRect.h - ph;
  const shortSide = Math.min(leftoverW, leftoverH);
  const longSide = Math.max(leftoverW, leftoverH);
  const areaFit = freeRect.w * freeRect.h - pw * ph;

  if (heuristicKey === 'BSSF') {
    // Primär: min shortSide, sekundär: min longSide
    return { a: shortSide, b: longSide, c: areaFit, x: freeRect.x, y: freeRect.y };
  }
  if (heuristicKey === 'BAF') {
    // Primär: min areaFit, sekundär: min shortSide
    return { a: areaFit, b: shortSide, c: longSide, x: freeRect.x, y: freeRect.y };
  }
  // Bottom-left: min y, sedan min x, sedan min areaFit
  return { a: freeRect.y, b: freeRect.x, c: areaFit, x: freeRect.x, y: freeRect.y };
}

function isBetterPlacement(a, b, heuristicKey) {
  // jämför lexikografiskt på score a,b,c
  if (a.score.a !== b.score.a) return a.score.a < b.score.a;
  if (a.score.b !== b.score.b) return a.score.b < b.score.b;
  if (a.score.c !== b.score.c) return a.score.c < b.score.c;
  // tie-break: top-left-ish (stabilitet)
  if (a.y !== b.y) return a.y < b.y;
  return a.x < b.x;
}

function splitFreeRects(free, placed) {
  // Klassisk MaxRects split: för varje free rect som intersectar placed -> dela upp i upp till 4
  for (let i = 0; i < free.length; i++) {
    const fr = free[i];
    if (!rectsIntersect(fr, placed)) continue;

    const newRects = [];

    // ovan
    if (placed.y > fr.y) {
      newRects.push({ x: fr.x, y: fr.y, w: fr.w, h: placed.y - fr.y });
    }
    // under
    if (placed.y + placed.h < fr.y + fr.h) {
      newRects.push({
        x: fr.x,
        y: placed.y + placed.h,
        w: fr.w,
        h: (fr.y + fr.h) - (placed.y + placed.h)
      });
    }
    // vänster
    if (placed.x > fr.x) {
      newRects.push({ x: fr.x, y: fr.y, w: placed.x - fr.x, h: fr.h });
    }
    // höger
    if (placed.x + placed.w < fr.x + fr.w) {
      newRects.push({
        x: placed.x + placed.w,
        y: fr.y,
        w: (fr.x + fr.w) - (placed.x + placed.w),
        h: fr.h
      });
    }

    // ersätt fr med sista och pop, och lägg in newRects
    free.splice(i, 1);
    i--;

    for (const nr of newRects) {
      if (nr.w > 0.000001 && nr.h > 0.000001) free.push(nr);
    }
  }
}

function pruneFreeRects(free) {
  // ta bort rektanglar som är helt inuti en annan
  for (let i = 0; i < free.length; i++) {
    for (let j = i + 1; j < free.length; j++) {
      const a = free[i], b = free[j];
      if (rectContainedIn(a, b)) {
        free.splice(i, 1);
        i--;
        break;
      }
      if (rectContainedIn(b, a)) {
        free.splice(j, 1);
        j--;
      }
    }
  }
}

function rectsIntersect(a, b) {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

function rectContainedIn(a, b) {
  return a.x >= b.x &&
         a.y >= b.y &&
         a.x + a.w <= b.x + b.w &&
         a.y + a.h <= b.y + b.h;
}

function updateNestUI() {
  if (!nestSheets || !nestSheets.length) {
    if (nestNav) nestNav.style.display = 'none';
    return;
  }
  const total = nestSheets.length;
  const idx = currentSheet + 1;

  sheetInfoEl.textContent = `Ark: ${idx}/${total}`;

  const matArea = material.w * material.h;
  const used = nestSheets[currentSheet].usedArea;
  const pct = matArea > 0 ? (used / matArea) * 100 : 0;

  const meta = lastNestMeta;
  const extra = meta
    ? ` | Totalt: ${(meta.totalUtil * 100).toFixed(1)}% | ${meta.bestLabel}`
    : '';

  nestStatsEl.textContent = `Utnyttjande (ark): ${pct.toFixed(1)}% | Delar: ${nestSheets[currentSheet].placements.length}${extra}`;
}

// ---------------- Draw ----------------
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const safeW = Math.max(1, material.w);
  const safeH = Math.max(1, material.h);

  const scale = Math.min(canvas.width / safeW, canvas.height / safeH) * 0.92;
  const ox = 20;
  const oy = 20;

  view = { scale, ox, oy, matWpx: safeW * scale, matHpx: safeH * scale };

  // Material outline
  ctx.strokeStyle = '#0f0';
  ctx.lineWidth = 2;
  ctx.strokeRect(ox, oy, view.matWpx, view.matHpx);

  // Snap zone visibility: measureOn + Shift + snap enabled + tol > 0
  if (measureOn && shiftDown && snapEnabledEl?.checked) {
    const tolMm = Math.max(0, Number(snapTolEl?.value ?? 0));
    if (tolMm > 0) {
      const tolPx = Math.max(2, tolMm * view.scale);

      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, view.matWpx, view.matHpx);
      ctx.clip();

      ctx.strokeStyle = 'rgba(255, 220, 0, 0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);

      // left / right / top / bottom inner lines
      ctx.beginPath(); ctx.moveTo(ox + tolPx, oy); ctx.lineTo(ox + tolPx, oy + view.matHpx); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ox + view.matWpx - tolPx, oy); ctx.lineTo(ox + view.matWpx - tolPx, oy + view.matHpx); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ox, oy + tolPx); ctx.lineTo(ox + view.matWpx, oy + tolPx); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ox, oy + view.matHpx - tolPx); ctx.lineTo(ox + view.matWpx, oy + view.matHpx - tolPx); ctx.stroke();

      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(255, 220, 0, 0.05)';
      ctx.fillRect(ox, oy, tolPx, view.matHpx);
      ctx.fillRect(ox + view.matWpx - tolPx, oy, tolPx, view.matHpx);
      ctx.fillRect(ox, oy, view.matWpx, tolPx);
      ctx.fillRect(ox, oy + view.matHpx - tolPx, view.matWpx, tolPx);

      ctx.restore();
    }
  }

  // Snap preview ring
  if (hoverSnap) {
    const p = mmToScreen(hoverSnap.xMm, hoverSnap.yMm);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, 7, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Nestning (M3.1)
  if (nestSheets && nestSheets.length) {
    const sheet = nestSheets[currentSheet] || nestSheets[0];

    for (const pl of sheet.placements) {
      // Vi placerar PAD rektangel i algoritmen, men ritar “riktig” rektangel inset med gap/2
      const halfGap = (pl.gap || 0) * 0.5;
      const drawXmm = pl.x + halfGap;
      const drawYmm = pl.y + halfGap;

      const p0 = mmToScreen(drawXmm, drawYmm);
      const p1 = mmToScreen(drawXmm + pl.w, drawYmm + pl.h);

      const x = p0.sx;
      const y = p0.sy;
      const w = p1.sx - p0.sx;
      const h = p1.sy - p0.sy;

      const col = colorFromId(pl.partId);

      ctx.fillStyle = col.fill;
      ctx.strokeStyle = col.stroke;
      ctx.lineWidth = 2;

      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);

      // label
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = '12px Arial';
      const label = pl.name.length > 18 ? pl.name.slice(0, 18) + '…' : pl.name;
      ctx.fillText(label, x + 4, y + 14);
      if (pl.rot === 90) ctx.fillText('R90', x + 4, y + 28);
    }
  }

  // Measure points/line
  if (measureP1) {
    const p1 = mmToScreen(measureP1.xMm, measureP1.yMm);
    drawCross(p1.sx, p1.sy);

    if (measureP2) {
      const p2 = mmToScreen(measureP2.xMm, measureP2.yMm);
      drawCross(p2.sx, p2.sy);

      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p1.sx, p1.sy);
      ctx.lineTo(p2.sx, p2.sy);
      ctx.stroke();
    }
  }
}

function drawCross(x, y) {
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 6, y);
  ctx.lineTo(x + 6, y);
  ctx.moveTo(x, y - 6);
  ctx.lineTo(x, y + 6);
  ctx.stroke();
}

// ---------------- Thumbnail ----------------
function drawThumbnail(part, thumbCanvas) {
  const tctx = thumbCanvas.getContext('2d');
  const W = thumbCanvas.width;
  const H = thumbCanvas.height;

  tctx.clearRect(0, 0, W, H);

  const b = part.bounds;
  if (!b || !Number.isFinite(b.w) || !Number.isFinite(b.h) || b.w <= 0 || b.h <= 0) {
    tctx.strokeStyle = '#bbb';
    tctx.strokeRect(6, 6, W - 12, H - 12);
    return;
  }

  const pad = 10;
  const innerW = W - pad * 2;
  const innerH = H - pad * 2;

  const s = Math.min(innerW / b.w, innerH / b.h);
  const drawW = b.w * s;
  const drawH = b.h * s;
  const offsetX = pad + (innerW - drawW) / 2;
  const offsetY = pad + (innerH - drawH) / 2;

  const mapX = (x) => offsetX + (x - b.minX) * s;
  const mapY = (y) => offsetY + (b.maxY - y) * s;

  tctx.strokeStyle = '#e6e6e6';
  tctx.lineWidth = 1;
  tctx.strokeRect(pad, pad, innerW, innerH);

  tctx.strokeStyle = '#111';
  tctx.lineWidth = 1;

  const entities = part.dxf?.entities || [];
  for (const ent of entities) {
    if (Array.isArray(ent.vertices) && ent.vertices.length) {
      tctx.beginPath();
      ent.vertices.forEach((v, i) => {
        const x = mapX(v.x);
        const y = mapY(v.y);
        if (i === 0) tctx.moveTo(x, y);
        else tctx.lineTo(x, y);
      });
      tctx.stroke();
      continue;
    }

    if (ent.type === 'LINE' && ent.start && ent.end) {
      tctx.beginPath();
      tctx.moveTo(mapX(ent.start.x), mapY(ent.start.y));
      tctx.lineTo(mapX(ent.end.x), mapY(ent.end.y));
      tctx.stroke();
      continue;
    }

    if (ent.type === 'CIRCLE' && ent.center && Number.isFinite(ent.radius)) {
      const cx = mapX(ent.center.x);
      const cy = mapY(ent.center.y);
      const r = ent.radius * s;
      tctx.beginPath();
      tctx.arc(cx, cy, r, 0, Math.PI * 2);
      tctx.stroke();
      continue;
    }

    if (ent.type === 'ARC' && ent.center && Number.isFinite(ent.radius)) {
      const cx = ent.center.x, cy = ent.center.y, r = ent.radius;
      const a0 = degToRad(ent.startAngle ?? 0);
      const a1 = degToRad(ent.endAngle ?? 0);
      const pts = arcPoints(cx, cy, r, a0, a1, 32);
      if (pts.length) {
        tctx.beginPath();
        pts.forEach((pt, i) => {
          const x = mapX(pt.x);
          const y = mapY(pt.y);
          if (i === 0) tctx.moveTo(x, y);
          else tctx.lineTo(x, y);
        });
        tctx.stroke();
      }
      continue;
    }
  }
}

// ---------------- Bounds helpers ----------------
function boundsToText(b) {
  if (!b || !Number.isFinite(b.w) || !Number.isFinite(b.h) || b.w < 0 || b.h < 0) return 'Okänt';
  return `${Math.round(b.w)} × ${Math.round(b.h)} mm`;
}

function getBounds(dxf) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const ents = dxf?.entities || [];
  if (!ents.length) return invalidBounds();

  for (const ent of ents) {
    if (Array.isArray(ent.vertices) && ent.vertices.length) {
      for (const v of ent.vertices) {
        if (isFinitePoint(v)) {
          minX = Math.min(minX, v.x);
          minY = Math.min(minY, v.y);
          maxX = Math.max(maxX, v.x);
          maxY = Math.max(maxY, v.y);
        }
      }
      continue;
    }

    if (ent.type === 'LINE' && ent.start && ent.end) {
      if (isFinitePoint(ent.start)) {
        minX = Math.min(minX, ent.start.x); minY = Math.min(minY, ent.start.y);
        maxX = Math.max(maxX, ent.start.x); maxY = Math.max(maxY, ent.start.y);
      }
      if (isFinitePoint(ent.end)) {
        minX = Math.min(minX, ent.end.x); minY = Math.min(minY, ent.end.y);
        maxX = Math.max(maxX, ent.end.x); maxY = Math.max(maxY, ent.end.y);
      }
      continue;
    }

    if (ent.type === 'CIRCLE' && ent.center && Number.isFinite(ent.radius)) {
      const cx = ent.center.x, cy = ent.center.y, r = ent.radius;
      if (Number.isFinite(cx) && Number.isFinite(cy)) {
        minX = Math.min(minX, cx - r);
        minY = Math.min(minY, cy - r);
        maxX = Math.max(maxX, cx + r);
        maxY = Math.max(maxY, cy + r);
      }
      continue;
    }

    if (ent.type === 'ARC' && ent.center && Number.isFinite(ent.radius)) {
      const cx = ent.center.x, cy = ent.center.y, r = ent.radius;
      const a0 = degToRad(ent.startAngle ?? 0);
      const a1 = degToRad(ent.endAngle ?? 0);
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;

      const angles = arcSampleAngles(a0, a1);
      for (const a of angles) {
        const x = cx + r * Math.cos(a);
        const y = cy + r * Math.sin(a);
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
      continue;
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return invalidBounds();
  }
  const w = maxX - minX;
  const h = maxY - minY;
  if (!Number.isFinite(w) || !Number.isFinite(h)) return invalidBounds();

  return { minX, minY, maxX, maxY, w, h };
}

function invalidBounds() {
  return { minX: NaN, minY: NaN, maxX: NaN, maxY: NaN, w: NaN, h: NaN };
}

function isFinitePoint(p) {
  return p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function degToRad(d) { return (d * Math.PI) / 180; }

function arcSampleAngles(a0, a1) {
  const TWO_PI = Math.PI * 2;
  const norm = (a) => ((a % TWO_PI) + TWO_PI) % TWO_PI;

  let s = norm(a0);
  let e = norm(a1);
  if (e < s) e += TWO_PI;

  const angles = [s, e];
  const cardinals = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2, TWO_PI];

  for (const c of cardinals) {
    let cc = c;
    if (cc < s) cc += TWO_PI;
    if (cc >= s && cc <= e) angles.push(cc);
  }
  return angles;
}

function arcPoints(cx, cy, r, a0, a1, steps = 24) {
  const TWO_PI = Math.PI * 2;
  const norm = (a) => ((a % TWO_PI) + TWO_PI) % TWO_PI;

  let s = norm(a0);
  let e = norm(a1);
  if (e < s) e += TWO_PI;

  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = s + (e - s) * t;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function colorFromId(id) {
  let h = 0;
  for (let i = 0; i < String(id).length; i++) h = (h * 31 + String(id).charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return {
    fill: `hsla(${hue}, 70%, 50%, 0.20)`,
    stroke: `hsla(${hue}, 70%, 65%, 0.90)`
  };
}

// init
updateMaterialInfo();
updateMeasureUI();
renderFileList();
draw();

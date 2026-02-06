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
const measureHint = document.getElementById('measureHint');

const snapEnabledEl = document.getElementById('snapEnabled');
const snapTolEl = document.getElementById('snapTol');
const snapStatusEl = document.getElementById('snapStatus');

let parts = [];
let material = { w: 1000, h: 1000 };

let measureMode = false;
let measureStart = null;
let lastMeasure = null;

// Viktigt: Shift ska ALDRIG nollställa mätningen.
// Shift används enbart som "snäpp-aktiverare".
let isShiftDown = false;

window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Shift') {
    isShiftDown = true;
    updateSnapStatus();
    // INGEN reset av lastMeasure här
  }
});
window.addEventListener('keyup', (ev) => {
  if (ev.key === 'Shift') {
    isShiftDown = false;
    updateSnapStatus();
    // INGEN reset av lastMeasure här
  }
});

function updateSnapStatus() {
  const tol = Number(snapTolEl.value || 0);
  const enabled = !!snapEnabledEl.checked;
  const active = enabled && isShiftDown;
  snapStatusEl.textContent = active ? `Snäppzon: PÅ (±${tol} mm)` : `Snäppzon: AV`;
}

snapEnabledEl.addEventListener('change', updateSnapStatus);
snapTolEl.addEventListener('input', updateSnapStatus);

function resizeCanvas() {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  draw();
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

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
  draw();
}

materialSelect.addEventListener('change', updateMaterialFromUI);
customW.addEventListener('input', updateMaterialFromUI);
customH.addEventListener('input', updateMaterialFromUI);

function updateMaterialInfo() {
  materialInfo.textContent = `Material: ${material.w} × ${material.h} mm`;
}

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
  renderFileList();
  draw();
});

function renderFileList() {
  fileListEl.innerHTML = '';

  parts.forEach((p) => {
    const div = document.createElement('div');
    div.className = 'file-item';

    const dimText = boundsToText(p.bounds);

    div.innerHTML = `
      <div class="file-header">
        <div class="file-title">${escapeHtml(p.name)}</div>
        <button class="file-remove" title="Ta bort" data-id="${p.id}">✕</button>
      </div>

      <label>Antal:
        <input type="number" min="1" value="${p.qty}" data-id="${p.id}" class="qty-input" />
      </label>

      <label>
        <input type="checkbox" ${p.visible ? 'checked' : ''} data-id="${p.id}" class="vis-input" />
        Visa
      </label>

      <div>Mått: ${dimText}</div>
    `;

    fileListEl.appendChild(div);
  });

  fileListEl.querySelectorAll('.qty-input').forEach(input => {
    input.addEventListener('input', (e) => {
      const id = e.target.dataset.id;
      const p = parts.find(x => x.id === id);
      if (!p) return;
      p.qty = Math.max(1, Number(e.target.value || 1));
    });
  });

  fileListEl.querySelectorAll('.vis-input').forEach(input => {
    input.addEventListener('change', (e) => {
      const id = e.target.dataset.id;
      const p = parts.find(x => x.id === id);
      if (!p) return;
      p.visible = e.target.checked;
      draw();
    });
  });

  fileListEl.querySelectorAll('.file-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      parts = parts.filter(x => x.id !== id);
      renderFileList();
      draw();
    });
  });

  overlay.textContent = parts.length ? 'M2: Mät med knapp. Shift = snäpp (om aktiverat).' : 'Ladda DXF-filer för att börja';
}

function boundsToText(b) {
  if (!b || !Number.isFinite(b.w) || !Number.isFinite(b.h) || b.w < 0 || b.h < 0) return 'Okänt';
  return `${Math.round(b.w)} × ${Math.round(b.h)} mm`;
}

/**
 * Bounds för vanliga DXF entiteter
 */
function getBounds(dxf) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const ents = dxf?.entities || [];
  if (!ents.length) return invalidBounds();

  for (const ent of ents) {
    // Polyline-ish
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

    // LINE
    if (ent.type === 'LINE' && ent.start && ent.end) {
      if (isFinitePoint(ent.start)) {
        minX = Math.min(minX, ent.start.x);
        minY = Math.min(minY, ent.start.y);
        maxX = Math.max(maxX, ent.start.x);
        maxYn = Math.max(maxY, ent.start.y);
        maxY = maxY; // keep for safety
      }
      if (isFinitePoint(ent.end)) {
        minX = Math.min(minX, ent.end.x);
        minY = Math.min(minY, ent.end.y);
        maxX = Math.max(maxX, ent.end.x);
        maxY = Math.max(maxY, ent.end.y);
      }
      continue;
    }

    // CIRCLE
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

    // ARC
    if (ent.type === 'ARC' && ent.center && Number.isFinite(ent.radius)) {
      const cx = ent.center.x, cy = ent.center.y, r = ent.radius;
      const a0 = degToRad(ent.startAngle ?? 0);
      const a1 = degToRad(ent.endAngle ?? 0);

      if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;

      const angles = arcSampleAngles(a0, a1);
      for (const a of angles) {
        const x = cx + r * Math.cos(a);
        const y = cy + r * Math.sin(a);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
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
  const cardinals = [0, Math.PI/2, Math.PI, 3*Math.PI/2, TWO_PI];
  for (const c of cardinals) {
    let cc = c;
    if (cc < s) cc += TWO_PI;
    if (cc >= s && cc <= e) angles.push(cc);
  }
  return angles;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/**
 * Mätläge
 */
measureBtn.addEventListener('click', () => {
  measureMode = !measureMode;
  measureStart = null;
  // lastMeasure får ligga kvar om du vill, men här nollställer vi för tydlighet:
  lastMeasure = null;

  measureBtn.textContent = measureMode ? 'Avbryt mät' : 'Mät';
  measureHint.textContent = measureMode ? 'Mätläge på: klicka två punkter' : 'Mätläge av';
  draw();
});

canvas.addEventListener('click', (e) => {
  if (!measureMode) return;

  const rect = canvas.getBoundingClientRect();
  const raw = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  const p = maybeSnap(raw);

  if (!measureStart) {
    measureStart = p;
    draw(); // visa gärna startpunkt direkt
    return;
  }

  const dx = p.x - measureStart.x;
  const dy = p.y - measureStart.y;
  const pxDist = Math.sqrt(dx * dx + dy * dy);

  const scale = currentScale(); // px per mm
  const mmDist = pxDist / scale;

  lastMeasure = { x1: measureStart.x, y1: measureStart.y, x2: p.x, y2: p.y, mm: mmDist };
  measureStart = null;

  draw();
});

/**
 * Snäpp till närmaste punkt inom tolerans (bara när Shift hålls och snäpp är aktiverat)
 * Snäpp-punkter i denna version:
 * - Materialhörn
 * - Hörn på preview-rektanglarna
 */
function maybeSnap(pt) {
  const enabled = !!snapEnabledEl.checked;
  const snappingNow = enabled && isShiftDown;
  if (!snappingNow) return pt;

  const tolMm = Number(snapTolEl.value || 0);
  const tolPx = tolMm * currentScale();

  const snapPoints = getSnapPoints();
  let best = null;
  let bestD = Infinity;

  for (const sp of snapPoints) {
    const dx = sp.x - pt.x;
    const dy = sp.y - pt.y;
    const d = Math.sqrt(dx*dx + dy*dy);
    if (d < bestD) {
      bestD = d;
      best = sp;
    }
  }

  if (best && bestD <= tolPx) {
    return { x: best.x, y: best.y, snapped: true };
  }
  return pt;
}

function currentScale() {
  const safeW = Math.max(1, material.w);
  const safeH = Math.max(1, material.h);
  return Math.min(canvas.width / safeW, canvas.height / safeH) * 0.92; // px per mm
}

function getSnapPoints() {
  const pts = [];

  // Materialrektangel
  const scale = currentScale();
  const safeW = Math.max(1, material.w);
  const safeH = Math.max(1, material.h);
  const matW = safeW * scale;
  const matH = safeH * scale;

  const x0 = 20, y0 = 20;
  const x1 = x0 + matW, y1 = y0 + matH;

  pts.push({ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x0, y: y1 }, { x: x1, y: y1 });

  // Preview-rektanglar (samma positioner som i draw)
  let offsetY = 50;
  for (const p of parts) {
    if (!p.visible) continue;

    const bw = (Number.isFinite(p.bounds?.w) ? p.bounds.w : 0);
    const bh = (Number.isFinite(p.bounds?.h) ? p.bounds.h : 0);

    const w = Math.max(8, bw * scale * 0.08);
    const h = Math.max(8, bh * scale * 0.08);

    const rx0 = 40;
    const ry0 = offsetY;
    const rx1 = rx0 + w;
    const ry1 = ry0 + h;

    pts.push({ x: rx0, y: ry0 }, { x: rx1, y: ry0 }, { x: rx0, y: ry1 }, { x: rx1, y: ry1 });

    offsetY += h + 18;
  }

  // Även aktuell startpunkt om man vill snäppa tillbaka
  if (measureStart) pts.push({ x: measureStart.x, y: measureStart.y });

  return pts;
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Rita material
  const scale = currentScale();
  const safeW = Math.max(1, material.w);
  const safeH = Math.max(1, material.h);
  const matW = safeW * scale;
  const matH = safeH * scale;

  ctx.strokeStyle = '#0f0';
  ctx.lineWidth = 2;
  ctx.strokeRect(20, 20, matW, matH);

  // Rita delar som "preview-rektanglar"
  let offsetY = 50;
  ctx.lineWidth = 1;
  ctx.font = '12px Arial';

  for (const p of parts) {
    if (!p.visible) continue;

    const bw = (Number.isFinite(p.bounds?.w) ? p.bounds.w : 0);
    const bh = (Number.isFinite(p.bounds?.h) ? p.bounds.h : 0);

    const w = Math.max(8, bw * scale * 0.08);
    const h = Math.max(8, bh * scale * 0.08);

    ctx.strokeStyle = '#fff';
    ctx.strokeRect(40, offsetY, w, h);

    ctx.fillStyle = '#fff';
    ctx.fillText(`${p.name} (x${p.qty})`, 50 + w, offsetY + 12);

    offsetY += h + 18;
  }

  // Rita mätning (ska ALDRIG försvinna pga Shift)
  if (lastMeasure) {
    ctx.strokeStyle = '#ff0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lastMeasure.x1, lastMeasure.y1);
    ctx.lineTo(lastMeasure.x2, lastMeasure.y2);
    ctx.stroke();

    // endpoint markers
    ctx.strokeStyle = '#ff0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lastMeasure.x1 - 5, lastMeasure.y1);
    ctx.lineTo(lastMeasure.x1 + 5, lastMeasure.y1);
    ctx.moveTo(lastMeasure.x1, lastMeasure.y1 - 5);
    ctx.lineTo(lastMeasure.x1, lastMeasure.y1 + 5);
    ctx.moveTo(lastMeasure.x2 - 5, lastMeasure.y2);
    ctx.lineTo(lastMeasure.x2 + 5, lastMeasure.y2);
    ctx.moveTo(lastMeasure.x2, lastMeasure.y2 - 5);
    ctx.lineTo(lastMeasure.x2, lastMeasure.y2 + 5);
    ctx.stroke();

    const mx = (lastMeasure.x1 + lastMeasure.x2) / 2;
    const my = (lastMeasure.y1 + lastMeasure.y2) / 2;

    ctx.fillStyle = '#ff0';
    ctx.font = '12px Arial';
    ctx.fillText(`${lastMeasure.mm.toFixed(1)} mm`, mx + 6, my - 6);
  }

  // Rita startpunkt under pågående mätning
  if (measureMode && measureStart) {
    ctx.strokeStyle = '#ff0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(measureStart.x, measureStart.y, 4, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// init
updateMaterialInfo();
renderFileList();
updateSnapStatus();
draw();

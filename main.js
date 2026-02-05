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


let parts = [];
let material = { w: 1000, h: 1000 };

// View transform for mapping screen <-> mm on material
let view = { scale: 1, ox: 20, oy: 20, matWpx: 0, matHpx: 0 };

// Measure state
let measureOn = false;
let measureP1 = null; // {xMm,yMm}
let measureP2 = null;

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

div.innerHTML = `
  <div class="file-header">
    <div class="file-title">${escapeHtml(p.name)}</div>
    <button class="file-remove" title="Ta bort" data-id="${p.id}">✕</button>
  </div>

  <canvas class="thumb thumb-wide" width="240" height="140" data-id="${p.id}"></canvas>

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
    });
  });

  // bind visible
  fileListEl.querySelectorAll('.vis-input').forEach(input => {
    input.addEventListener('change', (e) => {
      const id = e.target.dataset.id;
      const p = parts.find(x => x.id === id);
      if (!p) return;
      p.visible = e.target.checked;
      draw();
    });
  });

  // bind remove
  fileListEl.querySelectorAll('.file-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      parts = parts.filter(x => x.id !== id);
      renderFileList();
      draw();
    });
  });

  // draw thumbnails
  fileListEl.querySelectorAll('.thumb').forEach(c => {
    const id = c.dataset.id;
    const p = parts.find(x => x.id === id);
    if (!p) return;
    drawThumbnail(p, c);
  });

  overlay.textContent = parts.length
    ? 'M2: material + mätning + previews i sidebar.'
    : 'Ladda DXF-filer för att börja';
}

measureBtn.addEventListener('click', () => {
  measureOn = !measureOn;
  if (!measureOn) {
    measureP1 = null;
    measureP2 = null;
    measureReadout.textContent = '';
  }
  updateMeasureUI();
  draw();
});

function updateMeasureUI() {
  measureStatus.textContent = measureOn ? 'Mätläge på' : 'Mätläge av';
}

canvas.addEventListener('click', (ev) => {
  if (!measureOn) return;

  const rect = canvas.getBoundingClientRect();
  const sx = ev.clientX - rect.left;
  const sy = ev.clientY - rect.top;

let mm = screenToMm(sx, sy);
if (!mm) return; // click outside material

const snapped = applySnap(mm);
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
measureReadout.textContent = snapped.note
  ? `Avstånd: ${dist.toFixed(1)} mm (snäpp: ${snapped.note})`
  : `Avstånd: ${dist.toFixed(1)} mm`;

  }

  draw();
});

function screenToMm(sx, sy) {
  // map to material local coords
  const x = (sx - view.ox) / view.scale;
  const y = (sy - view.oy) / view.scale;

  if (x < 0 || y < 0 || x > material.w || y > material.h) return null;
  return { xMm: x, yMm: y };
}

function mmToScreen(xMm, yMm) {
  return {
    sx: view.ox + xMm * view.scale,
    sy: view.oy + yMm * view.scale
  };
}

function applySnap(mmPt) {
  const enabled = snapEnabledEl?.checked;
  if (!enabled) return { pt: mmPt, note: '' };

  const tol = Math.max(0, Number(snapTolEl?.value ?? 0));
  if (tol <= 0) return { pt: mmPt, note: '' };

  let { xMm, yMm } = mmPt;
  let note = '';

  const nearLeft = xMm <= tol;
  const nearRight = (material.w - xMm) <= tol;
  const nearTop = yMm <= tol;
  const nearBottom = (material.h - yMm) <= tol;

  if (nearLeft) { xMm = 0; note = note || 'vänsterkant'; }
  else if (nearRight) { xMm = material.w; note = note || 'högerkant'; }

  if (nearTop) { yMm = 0; note = note ? `hörn (${note}+topp)` : 'toppkant'; }
  else if (nearBottom) { yMm = material.h; note = note ? `hörn (${note}+botten)` : 'bottenkant'; }

  // Om både X och Y snäpptes, skriv "hörn"
  if ((nearLeft || nearRight) && (nearTop || nearBottom)) {
    note = 'hörn';
  }

  return { pt: { xMm, yMm }, note };
}


function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const safeW = Math.max(1, material.w);
  const safeH = Math.max(1, material.h);

  const scale = Math.min(canvas.width / safeW, canvas.height / safeH) * 0.92;
  const ox = 20;
  const oy = 20;

  view = {
    scale,
    ox,
    oy,
    matWpx: safeW * scale,
    matHpx: safeH * scale
  };

  // material outline
  ctx.strokeStyle = '#0f0';
  ctx.lineWidth = 2;
  ctx.strokeRect(ox, oy, view.matWpx, view.matHpx);

  // draw measure
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

  // UNIFORM scaling (viktig!)
  const s = Math.min(innerW / b.w, innerH / b.h);

  // Centering offsets (så formen hamnar snyggt i mitten)
  const drawW = b.w * s;
  const drawH = b.h * s;
  const offsetX = pad + (innerW - drawW) / 2;
  const offsetY = pad + (innerH - drawH) / 2;

  // Map mm -> canvas px (flip Y)
  const mapX = (x) => offsetX + (x - b.minX) * s;
  const mapY = (y) => offsetY + (b.maxY - y) * s;

  // Ram
  tctx.strokeStyle = '#e6e6e6';
  tctx.lineWidth = 1;
  tctx.strokeRect(pad, pad, innerW, innerH);

  tctx.strokeStyle = '#111';
  tctx.lineWidth = 1;

  const entities = part.dxf?.entities || [];
  for (const ent of entities) {
    // POLYLINE/LWPOLYLINE via vertices
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

    // LINE
    if (ent.type === 'LINE' && ent.start && ent.end) {
      tctx.beginPath();
      tctx.moveTo(mapX(ent.start.x), mapY(ent.start.y));
      tctx.lineTo(mapX(ent.end.x), mapY(ent.end.y));
      tctx.stroke();
      continue;
    }

    // CIRCLE
    if (ent.type === 'CIRCLE' && ent.center && Number.isFinite(ent.radius)) {
      const cx = mapX(ent.center.x);
      const cy = mapY(ent.center.y);
      const r = ent.radius * s;
      tctx.beginPath();
      tctx.arc(cx, cy, r, 0, Math.PI * 2);
      tctx.stroke();
      continue;
    }

    // ARC (approx)
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


  const pad = 6;
  const w = thumbCanvas.width - pad * 2;
  const h = thumbCanvas.height - pad * 2;
  const s = Math.min(w / b.w, h / b.h);

  const entities = part.dxf?.entities || [];

  // helper map mm -> thumb px
  const mapX = (x) => pad + (x - b.minX) * s;
  const mapY = (y) => pad + (b.maxY - y) * s; // flip Y for screen

  // background frame
  tctx.strokeStyle = '#e0e0e0';
  tctx.strokeRect(pad, pad, w, h);

  tctx.strokeStyle = '#111';
  tctx.lineWidth = 1;

  for (const ent of entities) {
    // POLYLINE/LWPOLYLINE via vertices
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

    // LINE
    if (ent.type === 'LINE' && ent.start && ent.end) {
      tctx.beginPath();
      tctx.moveTo(mapX(ent.start.x), mapY(ent.start.y));
      tctx.lineTo(mapX(ent.end.x), mapY(ent.end.y));
      tctx.stroke();
      continue;
    }

    // CIRCLE (approx)
    if (ent.type === 'CIRCLE' && ent.center && Number.isFinite(ent.radius)) {
      const cx = mapX(ent.center.x);
      const cy = mapY(ent.center.y);
      const r = ent.radius * s;
      tctx.beginPath();
      tctx.arc(cx, cy, r, 0, Math.PI * 2);
      tctx.stroke();
      continue;
    }

    // ARC (approx)
    if (ent.type === 'ARC' && ent.center && Number.isFinite(ent.radius)) {
      const cx = ent.center.x, cy = ent.center.y, r = ent.radius;
      const a0 = degToRad(ent.startAngle ?? 0);
      const a1 = degToRad(ent.endAngle ?? 0);
      const pts = arcPoints(cx, cy, r, a0, a1, 24);
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

// Bounds helpers
function boundsToText(b) {
  if (!b || !Number.isFinite(b.w) || !Number.isFinite(b.h) || b.w < 0 || b.h < 0) return 'Okänt';
  return `${Math.round(b.w)} × ${Math.round(b.h)} mm`;
}

function getBounds(dxf) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const ents = dxf?.entities || [];
  if (!ents.length) return invalidBounds();

  for (const ent of ents) {
    // polyline-ish
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
        minX = Math.min(minX, ent.start.x); minY = Math.min(minY, ent.start.y);
        maxX = Math.max(maxX, ent.start.x); maxY = Math.max(maxY, ent.start.y);
      }
      if (isFinitePoint(ent.end)) {
        minX = Math.min(minX, ent.end.x); minY = Math.min(minY, ent.end.y);
        maxX = Math.max(maxX, ent.end.x); maxY = Math.max(maxY, ent.end.y);
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

// init
updateMaterialInfo();
updateMeasureUI();
renderFileList();
draw();

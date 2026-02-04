const fileInput = document.getElementById('fileInput');
const fileListEl = document.getElementById('fileList');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const materialSelect = document.getElementById('materialSelect');
const customMaterial = document.getElementById('customMaterial');
const customW = document.getElementById('customW');
const customH = document.getElementById('customH');
const materialInfo = document.getElementById('materialInfo');

let parts = [];
let material = { w: 1000, h: 1000 };

function resizeCanvas() {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  draw();
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

materialSelect.addEventListener('change', () => {
  if (materialSelect.value === 'custom') {
    customMaterial.style.display = 'block';
  } else {
    customMaterial.style.display = 'none';
    const [w, h] = materialSelect.value.split('x').map(Number);
    material = { w, h };
    updateMaterialInfo();
    draw();
  }
});

customW.addEventListener('input', () => {
  material.w = Number(customW.value || 0);
  updateMaterialInfo();
  draw();
});
customH.addEventListener('input', () => {
  material.h = Number(customH.value || 0);
  updateMaterialInfo();
  draw();
});

function updateMaterialInfo() {
  materialInfo.textContent = `Material: ${material.w} × ${material.h} mm`;
}

fileInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  for (const file of files) {
    const text = await file.text();
    const parser = new window.DxfParser();
    const dxf = parser.parseSync(text);

    const bounds = getBounds(dxf);
    parts.push({
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
  parts.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'file-item';

    div.innerHTML = `
      <strong>${p.name}</strong>
      <label>Antal:
        <input type="number" min="1" value="${p.qty}" data-index="${i}" class="qty-input" />
      </label>
      <label>
        <input type="checkbox" ${p.visible ? 'checked' : ''} data-index="${i}" class="vis-input" />
        Visa
      </label>
      <div>Mått: ${Math.round(p.bounds.w)} × ${Math.round(p.bounds.h)} mm</div>
    `;
    fileListEl.appendChild(div);
  });

  document.querySelectorAll('.qty-input').forEach(input => {
    input.addEventListener('input', e => {
      const i = Number(e.target.dataset.index);
      parts[i].qty = Number(e.target.value);
    });
  });

  document.querySelectorAll('.vis-input').forEach(input => {
    input.addEventListener('change', e => {
      const i = Number(e.target.dataset.index);
      parts[i].visible = e.target.checked;
      draw();
    });
  });
}

function getBounds(dxf) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  if (!dxf.entities) return { w: 0, h: 0 };

  dxf.entities.forEach(ent => {
    if (ent.vertices) {
      ent.vertices.forEach(v => {
        minX = Math.min(minX, v.x);
        minY = Math.min(minY, v.y);
        maxX = Math.max(maxX, v.x);
        maxY = Math.max(maxY, v.y);
      });
    }
  });

  const w = maxX - minX;
  const h = maxY - minY;

  return { minX, minY, maxX, maxY, w, h };
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Rita material
  const scale = Math.min(canvas.width / material.w, canvas.height / material.h) * 0.9;
  const matW = material.w * scale;
  const matH = material.h * scale;

  ctx.strokeStyle = '#0f0';
  ctx.strokeRect(20, 20, matW, matH);

  // Rita delar (enkel preview, ej nesting ännu)
  let offsetY = 40;
  parts.forEach(p => {
    if (!p.visible) return;
    const w = p.bounds.w * scale * 0.1;
    const h = p.bounds.h * scale * 0.1;

    ctx.strokeStyle = '#fff';
    ctx.strokeRect(40, offsetY, w, h);
    ctx.fillStyle = '#fff';
    ctx.fillText(p.name, 50 + w, offsetY + 12);

    offsetY += h + 20;
  });
}

updateMaterialInfo();

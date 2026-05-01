import './style.css';

type Cell = {
  clean: boolean;
  r: number;
  g: number;
  b: number;
  a: number;
};

const dropZone = document.getElementById('drop-zone') as HTMLDivElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const canvasContainer = document.getElementById('canvases') as HTMLDivElement;
const gridInput = document.getElementById('grid-size') as HTMLInputElement;
const thresholdInput = document.getElementById('threshold') as HTMLInputElement;
const showMapInput = document.getElementById('show-map') as HTMLInputElement;
const statusEl = document.getElementById('status') as HTMLDivElement;

let sourceImage: HTMLImageElement | null = null;
let sourceFileName = 'image';

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer?.files[0];
  if (file) loadFile(file);
});
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) loadFile(file);
});

[gridInput, thresholdInput, showMapInput].forEach((el) =>
  el.addEventListener('input', () => render()),
);

function loadFile(file: File) {
  sourceFileName = file.name.replace(/\.[^.]+$/, '') || 'image';
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      sourceImage = img;
      render();
    };
    img.src = e.target!.result as string;
  };
  reader.readAsDataURL(file);
}

function render() {
  if (!sourceImage) return;
  const gridSize = clampInt(gridInput.value, 2, 512, 16);
  const threshold = clampInt(thresholdInput.value, 0, 255, 24);
  const showMap = showMapInput.checked;

  const srcW = sourceImage.width;
  const srcH = sourceImage.height;

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = srcW;
  srcCanvas.height = srcH;
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true })!;
  srcCtx.drawImage(sourceImage, 0, 0);
  const srcData = srcCtx.getImageData(0, 0, srcW, srcH);

  const cellW = srcW / gridSize;
  const cellH = srcH / gridSize;

  const cells: Cell[][] = [];
  let cleanCount = 0;
  let dirtyCount = 0;
  for (let gy = 0; gy < gridSize; gy++) {
    cells[gy] = [];
    for (let gx = 0; gx < gridSize; gx++) {
      const cell = analyzeCell(srcData, gx, gy, cellW, cellH, threshold);
      cells[gy][gx] = cell;
      if (cell.clean) cleanCount++;
      else dirtyCount++;
    }
  }

  statusEl.textContent =
    `Source: ${srcW}×${srcH}px · Grid: ${gridSize}×${gridSize} · ` +
    `Clean cells: ${cleanCount} · Non-clean (preserved): ${dirtyCount}`;

  // Build a fixed set of output sizes: powers of 2 multiples of gridSize, capped at source.
  const sizes = new Set<number>();
  for (let mult = 1; mult <= 4096; mult *= 2) {
    const s = gridSize * mult;
    if (s > Math.max(srcW, srcH)) break;
    sizes.add(s);
  }
  // Also include the exact source size for a 1:1 reference.
  sizes.add(Math.max(srcW, srcH));
  const sortedSizes = [...sizes].sort((a, b) => b - a);

  canvasContainer.innerHTML = '';
  for (const size of sortedSizes) {
    const canvas = renderAt(size, size, cells, srcCanvas, gridSize, srcW, srcH, showMap);
    addCanvasItem(canvas, size);
  }
}

function clampInt(v: string, min: number, max: number, fallback: number): number {
  const n = parseInt(v, 10);
  if (isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function analyzeCell(
  srcData: ImageData,
  gx: number,
  gy: number,
  cellW: number,
  cellH: number,
  threshold: number,
): Cell {
  const x0 = Math.floor(gx * cellW);
  const y0 = Math.floor(gy * cellH);
  const x1 = Math.floor((gx + 1) * cellW);
  const y1 = Math.floor((gy + 1) * cellH);

  // Inset by ~15% on each side to ignore anti-aliased grid borders that exist
  // even in clean pixel regions due to original PNG compression.
  const insetX = Math.max(1, Math.floor((x1 - x0) * 0.15));
  const insetY = Math.max(1, Math.floor((y1 - y0) * 0.15));
  const ix0 = x0 + insetX;
  const iy0 = y0 + insetY;
  const ix1 = Math.max(ix0 + 1, x1 - insetX);
  const iy1 = Math.max(iy0 + 1, y1 - insetY);

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumA = 0;
  let count = 0;
  let minR = 255;
  let maxR = 0;
  let minG = 255;
  let maxG = 0;
  let minB = 255;
  let maxB = 0;

  const data = srcData.data;
  const stride = srcData.width * 4;

  for (let y = iy0; y < iy1; y++) {
    let i = y * stride + ix0 * 4;
    for (let x = ix0; x < ix1; x++) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      sumR += r;
      sumG += g;
      sumB += b;
      sumA += a;
      count++;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
      if (g < minG) minG = g;
      if (g > maxG) maxG = g;
      if (b < minB) minB = b;
      if (b > maxB) maxB = b;
      i += 4;
    }
  }

  const range = Math.max(maxR - minR, maxG - minG, maxB - minB);
  const clean = count > 0 && range <= threshold;

  return {
    clean,
    r: count ? Math.round(sumR / count) : 0,
    g: count ? Math.round(sumG / count) : 0,
    b: count ? Math.round(sumB / count) : 0,
    a: count ? Math.round(sumA / count) : 255,
  };
}

function renderAt(
  outW: number,
  outH: number,
  cells: Cell[][],
  srcCanvas: HTMLCanvasElement,
  gridSize: number,
  srcW: number,
  srcH: number,
  showMap: boolean,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d')!;

  const srcCellW = srcW / gridSize;
  const srcCellH = srcH / gridSize;
  const outCellW = outW / gridSize;
  const outCellH = outH / gridSize;

  // Smoothing on for downscaling the dirty (diagonal-bearing) cells.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const cell = cells[gy][gx];
      // Use floor + ceil of next boundary to avoid 1-pixel gaps from rounding.
      const dx = Math.floor(gx * outCellW);
      const dy = Math.floor(gy * outCellH);
      const dx2 = Math.floor((gx + 1) * outCellW);
      const dy2 = Math.floor((gy + 1) * outCellH);
      const dw = dx2 - dx;
      const dh = dy2 - dy;

      if (cell.clean) {
        ctx.fillStyle = `rgba(${cell.r},${cell.g},${cell.b},${cell.a / 255})`;
        ctx.fillRect(dx, dy, dw, dh);
      } else {
        const sx = Math.floor(gx * srcCellW);
        const sy = Math.floor(gy * srcCellH);
        const sx2 = Math.floor((gx + 1) * srcCellW);
        const sy2 = Math.floor((gy + 1) * srcCellH);
        ctx.drawImage(srcCanvas, sx, sy, sx2 - sx, sy2 - sy, dx, dy, dw, dh);
        if (showMap) {
          ctx.strokeStyle = 'rgba(255, 0, 200, 0.9)';
          ctx.lineWidth = 1;
          ctx.strokeRect(dx + 0.5, dy + 0.5, dw - 1, dh - 1);
        }
      }
    }
  }

  return canvas;
}

function addCanvasItem(canvas: HTMLCanvasElement, size: number) {
  const div = document.createElement('div');
  div.className = 'canvas-item';

  const meta = document.createElement('div');
  meta.className = 'meta';
  const sizeLabel = document.createElement('span');
  sizeLabel.className = 'size';
  sizeLabel.textContent = `${canvas.width}×${canvas.height}`;
  const bytesLabel = document.createElement('span');
  bytesLabel.className = 'bytes';
  bytesLabel.textContent = '…';
  meta.appendChild(sizeLabel);
  meta.appendChild(bytesLabel);

  const link = document.createElement('a');
  link.className = 'download';
  link.textContent = 'Download PNG';
  link.style.visibility = 'hidden';

  const upscaleBtn = document.createElement('button');
  upscaleBtn.className = 'download upscale';
  upscaleBtn.type = 'button';
  upscaleBtn.textContent = 'Download 2056×2056 (nearest-neighbor)';
  upscaleBtn.addEventListener('click', () => downloadUpscaled(canvas, 2056, size));

  div.appendChild(meta);
  div.appendChild(canvas);
  div.appendChild(link);
  div.appendChild(upscaleBtn);
  canvasContainer.appendChild(div);

  canvas.toBlob((blob) => {
    if (!blob) return;
    bytesLabel.textContent = formatBytes(blob.size);
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `${sourceFileName}-${size}.png`;
    link.style.visibility = 'visible';
  }, 'image/png');
}

function downloadUpscaled(source: HTMLCanvasElement, target: number, originalSize: number) {
  const out = document.createElement('canvas');
  out.width = target;
  out.height = target;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  // Some engines look at this prefixed property too.
  (ctx as unknown as { webkitImageSmoothingEnabled?: boolean }).webkitImageSmoothingEnabled = false;
  (ctx as unknown as { mozImageSmoothingEnabled?: boolean }).mozImageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, source.width, source.height, 0, 0, target, target);
  out.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sourceFileName}-${originalSize}-up${target}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

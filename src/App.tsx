import { useEffect, useRef, useState } from 'react'

type Cell = {
  clean: boolean
  r: number
  g: number
  b: number
  a: number
}

type RenderData = {
  cells: Cell[][]
  srcCanvas: HTMLCanvasElement
  srcW: number
  srcH: number
  sizes: number[]
}

const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

const clampInt = (v: number, min: number, max: number, fallback: number): number => {
  if (isNaN(v)) return fallback
  return Math.max(min, Math.min(max, v))
}

const analyzeCell = (
  srcData: ImageData,
  gx: number,
  gy: number,
  cellW: number,
  cellH: number,
  threshold: number,
): Cell => {
  const x0 = Math.floor(gx * cellW)
  const y0 = Math.floor(gy * cellH)
  const x1 = Math.floor((gx + 1) * cellW)
  const y1 = Math.floor((gy + 1) * cellH)

  // Inset by ~15% on each side to ignore anti-aliased grid borders that exist
  // even in clean pixel regions due to original PNG compression.
  const insetX = Math.floor((x1 - x0) * 0.15)
  const insetY = Math.floor((y1 - y0) * 0.15)
  const ix0 = x0 + insetX
  const iy0 = y0 + insetY
  const ix1 = Math.max(ix0 + 1, x1 - insetX)
  const iy1 = Math.max(iy0 + 1, y1 - insetY)

  let sumR = 0
  let sumG = 0
  let sumB = 0
  let sumA = 0
  let count = 0
  let minR = 255
  let maxR = 0
  let minG = 255
  let maxG = 0
  let minB = 255
  let maxB = 0
  let minA = 255
  let maxA = 0

  const data = srcData.data
  const stride = srcData.width * 4

  for (let y = iy0; y < iy1; y++) {
    let i = y * stride + ix0 * 4
    for (let x = ix0; x < ix1; x++) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const a = data[i + 3]
      sumR += r
      sumG += g
      sumB += b
      sumA += a
      count++
      if (r < minR) minR = r
      if (r > maxR) maxR = r
      if (g < minG) minG = g
      if (g > maxG) maxG = g
      if (b < minB) minB = b
      if (b > maxB) maxB = b
      if (a < minA) minA = a
      if (a > maxA) maxA = a
      i += 4
    }
  }

  const range = Math.max(maxR - minR, maxG - minG, maxB - minB, maxA - minA)
  const clean = count > 0 && range <= threshold

  return {
    clean,
    r: count ? Math.round(sumR / count) : 0,
    g: count ? Math.round(sumG / count) : 0,
    b: count ? Math.round(sumB / count) : 0,
    a: count ? Math.round(sumA / count) : 255,
  }
}

const drawTo = (
  canvas: HTMLCanvasElement,
  cells: Cell[][],
  srcCanvas: HTMLCanvasElement,
  gridSize: number,
  srcW: number,
  srcH: number,
  showMap: boolean,
) => {
  const outW = canvas.width
  const outH = canvas.height
  const ctx = canvas.getContext('2d')!

  const srcCellW = srcW / gridSize
  const srcCellH = srcH / gridSize
  const outCellW = outW / gridSize
  const outCellH = outH / gridSize

  // Smoothing on for downscaling the dirty (diagonal-bearing) cells.
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const cell = cells[gy][gx]
      // Use floor + ceil of next boundary to avoid 1-pixel gaps from rounding.
      const dx = Math.floor(gx * outCellW)
      const dy = Math.floor(gy * outCellH)
      const dx2 = Math.floor((gx + 1) * outCellW)
      const dy2 = Math.floor((gy + 1) * outCellH)
      const dw = dx2 - dx
      const dh = dy2 - dy

      if (cell.clean) {
        ctx.fillStyle = `rgba(${cell.r},${cell.g},${cell.b},${cell.a / 255})`
        ctx.fillRect(dx, dy, dw, dh)
      } else {
        const sx = Math.floor(gx * srcCellW)
        const sy = Math.floor(gy * srcCellH)
        const sx2 = Math.floor((gx + 1) * srcCellW)
        const sy2 = Math.floor((gy + 1) * srcCellH)
        ctx.drawImage(srcCanvas, sx, sy, sx2 - sx, sy2 - sy, dx, dy, dw, dh)
        if (showMap) {
          ctx.strokeStyle = 'rgba(255, 0, 200, 0.9)'
          ctx.lineWidth = 1
          ctx.strokeRect(dx + 0.5, dy + 0.5, dw - 1, dh - 1)
        }
      }
    }
  }
}

type CanvasItemProps = {
  size: number
  cells: Cell[][]
  srcCanvas: HTMLCanvasElement
  gridSize: number
  srcW: number
  srcH: number
  showMap: boolean
  fileName: string
}

const CanvasItem = ({ size, cells, srcCanvas, gridSize, srcW, srcH, showMap, fileName }: CanvasItemProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [bytes, setBytes] = useState('…')
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = size
    canvas.height = size
    drawTo(canvas, cells, srcCanvas, gridSize, srcW, srcH, showMap)
    let url: string | null = null
    canvas.toBlob(blob => {
      if (!blob) return
      setBytes(formatBytes(blob.size))
      url = URL.createObjectURL(blob)
      setDownloadUrl(url)
    }, 'image/png')
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [size, cells, srcCanvas, gridSize, srcW, srcH, showMap])

  const downloadUpscaled = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const out = document.createElement('canvas')
    out.width = 2048
    out.height = 2048
    const ctx = out.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    // Some engines look at this prefixed property too.
    ;(ctx as unknown as { webkitImageSmoothingEnabled?: boolean }).webkitImageSmoothingEnabled = false
    ;(ctx as unknown as { mozImageSmoothingEnabled?: boolean }).mozImageSmoothingEnabled = false
    ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, 2048, 2048)
    out.toBlob(blob => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${fileName}-${size}-up2048.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }, 'image/png')
  }

  return (
    <div className="bg-bg-1 flex flex-col gap-2 rounded-lg p-3">
      <div className="flex items-center justify-between text-[13px] text-[#ccc]">
        <span className="font-semibold">
          {size}×{size}
        </span>
        <span className="text-accent tabular-nums">{bytes}</span>
      </div>
      <canvas ref={canvasRef} className="canvas-pixelated block h-auto w-full" />
      {downloadUrl && (
        <a
          href={downloadUrl}
          download={`${fileName}-${size}.png`}
          className="border-line text-muted hover:border-line-strong rounded border px-2 py-1.5 text-center text-xs hover:text-white"
        >
          Download PNG
        </a>
      )}
      <button
        type="button"
        onClick={downloadUpscaled}
        className="border-accent text-accent rounded border px-2 py-1.5 text-center text-xs hover:bg-[rgba(26,188,156,0.1)] hover:text-white"
      >
        Download 2048×2048 (nearest-neighbor)
      </button>
    </div>
  )
}

export const App = () => {
  const [gridSize, setGridSize] = useState(32)
  const [threshold, setThreshold] = useState(24)
  const [showMap, setShowMap] = useState(false)
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null)
  const [sourceFileName, setSourceFileName] = useState('image')
  const [renderData, setRenderData] = useState<RenderData | null>(null)
  const [status, setStatus] = useState('')
  const [dragOver, setDragOver] = useState(false)

  const loadFile = (file: File) => {
    setSourceFileName(file.name.replace(/\.[^.]+$/, '') || 'image')
    const reader = new FileReader()
    reader.onload = e => {
      const img = new Image()
      img.onload = () => setSourceImage(img)
      img.src = e.target!.result as string
    }
    reader.readAsDataURL(file)
  }

  useEffect(() => {
    if (!sourceImage) return
    const srcW = sourceImage.width
    const srcH = sourceImage.height

    const srcCanvas = document.createElement('canvas')
    srcCanvas.width = srcW
    srcCanvas.height = srcH
    const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true })!
    srcCtx.drawImage(sourceImage, 0, 0)
    const srcData = srcCtx.getImageData(0, 0, srcW, srcH)

    const cellW = srcW / gridSize
    const cellH = srcH / gridSize

    const cells: Cell[][] = []
    let cleanCount = 0
    let dirtyCount = 0
    for (let gy = 0; gy < gridSize; gy++) {
      cells[gy] = []
      for (let gx = 0; gx < gridSize; gx++) {
        const cell = analyzeCell(srcData, gx, gy, cellW, cellH, threshold)
        cells[gy][gx] = cell
        if (cell.clean) cleanCount++
        else dirtyCount++
      }
    }

    setStatus(
      `Source: ${srcW}×${srcH}px · Grid: ${gridSize}×${gridSize} · ` +
        `Clean cells: ${cleanCount} · Non-clean (preserved): ${dirtyCount}`,
    )

    // Build a fixed set of output sizes: powers of 2 multiples of gridSize, capped at source.
    const sizes = new Set<number>()
    for (let mult = 1; mult <= 4096; mult *= 2) {
      const s = gridSize * mult
      if (s > Math.max(srcW, srcH)) break
      sizes.add(s)
    }
    sizes.add(Math.max(srcW, srcH))
    const sortedSizes = [...sizes].sort((a, b) => b - a)

    setRenderData({ cells, srcCanvas, srcW, srcH, sizes: sortedSizes })
  }, [sourceImage, gridSize, threshold])

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <h1 className="mt-0 mb-4 text-2xl font-semibold">Pixelize Cleaner</h1>
      <p className="text-muted max-w-[720px] leading-relaxed">
        Drop a pixel-art-style image. Each cell of the configured grid is replaced with a perfect solid square if its
        pixels are uniform; cells that are not uniform (e.g. crossed by an anti-aliased diagonal) keep their original
        pixels. Multiple output sizes are produced so you can pick the smallest PNG that still renders the diagonal
        cleanly.
      </p>
      <div className="my-4 flex flex-wrap items-center gap-6">
        <label className="flex items-center gap-2 text-sm">
          Grid:
          <input
            type="number"
            value={gridSize}
            min={2}
            max={512}
            step={1}
            onChange={e => setGridSize(clampInt(parseInt(e.target.value, 10), 2, 512, 32))}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          Threshold:
          <input
            type="number"
            value={threshold}
            min={0}
            max={255}
            step={1}
            onChange={e => setThreshold(clampInt(parseInt(e.target.value, 10), 0, 255, 24))}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showMap} onChange={e => setShowMap(e.target.checked)} />
          Highlight non-clean cells
        </label>
      </div>
      <div
        onDragOver={e => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault()
          setDragOver(false)
          const file = e.dataTransfer.files[0]
          if (file) loadFile(file)
        }}
        className={`mb-4 rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
          dragOver ? 'border-accent bg-[rgba(26,188,156,0.08)]' : 'border-line-strong'
        }`}
      >
        <p className="m-0 mb-3">Drop a PNG/JPG here</p>
        <input
          type="file"
          accept="image/*"
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) loadFile(file)
          }}
        />
      </div>
      <div className="text-muted-2 mb-4 min-h-[18px] text-[13px]">{status}</div>
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {renderData?.sizes.map(size => (
          <CanvasItem
            key={size}
            size={size}
            cells={renderData.cells}
            srcCanvas={renderData.srcCanvas}
            gridSize={gridSize}
            srcW={renderData.srcW}
            srcH={renderData.srcH}
            showMap={showMap}
            fileName={sourceFileName}
          />
        ))}
      </div>
    </div>
  )
}

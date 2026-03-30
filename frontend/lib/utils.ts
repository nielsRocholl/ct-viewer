import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function sanitizeFilename(s: string): string {
  return s.replace(/[/\\:*?"<>|]/g, "_")
}

const JPEG_QUALITY = 0.92

export function downloadCanvasAsJpeg(canvas: HTMLCanvasElement, filename: string): void {
  const safe = sanitizeFilename(filename)
  canvas.toBlob(
    (blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = safe
      a.click()
      URL.revokeObjectURL(url)
    },
    "image/jpeg",
    JPEG_QUALITY
  )
}

export function downloadTextFile(text: string, filename: string, mime: string): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = sanitizeFilename(filename)
  a.click()
  URL.revokeObjectURL(url)
}

/** Clone SVG with computed colors + text styles so blob rasterization matches on-screen rendering. */
function prepareSvgForPngExport(svg: SVGSVGElement, layoutW: number, layoutH: number): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement
  const origEls = [svg, ...Array.from(svg.querySelectorAll<SVGElement>("*"))]
  const cloneEls = [clone, ...Array.from(clone.querySelectorAll<SVGElement>("*"))]
  for (let i = 0; i < origEls.length; i++) {
    const o = origEls[i]!
    const c = cloneEls[i]
    if (!c) continue
    const cs = getComputedStyle(o)
    const tag = o.tagName.toLowerCase()
    const fillAttr = o.getAttribute("fill")
    if (fillAttr?.includes("var(") || fillAttr === "currentColor") {
      const v = cs.fill
      if (v && v !== "none") c.setAttribute("fill", v)
    }
    const strokeAttr = o.getAttribute("stroke")
    if (strokeAttr?.includes("var(")) {
      const v = cs.stroke
      if (v && v !== "none") c.setAttribute("stroke", v)
    }
    if (tag === "text" || tag === "tspan") {
      c.setAttribute("font-family", cs.fontFamily || "ui-sans-serif, system-ui, sans-serif")
      c.setAttribute("font-size", cs.fontSize)
      c.setAttribute("font-weight", cs.fontWeight)
      if (!c.getAttribute("fill") || c.getAttribute("fill") === "currentColor") {
        const f = cs.fill
        if (f && f !== "none") c.setAttribute("fill", f)
      }
    }
  }
  clone.removeAttribute("style")
  const vb = svg.getAttribute("viewBox")
  if (vb) {
    clone.setAttribute("viewBox", vb)
  } else {
    clone.setAttribute("viewBox", `0 0 ${layoutW} ${layoutH}`)
  }
  if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg")
  clone.setAttribute("text-rendering", "geometricPrecision")
  clone.setAttribute("shape-rendering", "geometricPrecision")
  return clone
}

/** Rasterize an in-DOM Recharts SVG (with CSS var fills) to PNG. */
export function downloadSvgAsPng(svg: SVGSVGElement, filename: string): Promise<void> {
  const rect = svg.getBoundingClientRect()
  const w = Math.max(1, Math.round(rect.width))
  const h = Math.max(1, Math.round(rect.height))
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1
  const exportScale = Math.max(3, Math.min(5, dpr * 2))
  const outW = Math.round(w * exportScale)
  const outH = Math.round(h * exportScale)
  const clone = prepareSvgForPngExport(svg, w, h)
  clone.setAttribute("width", String(outW))
  clone.setAttribute("height", String(outH))
  const source = new XMLSerializer().serializeToString(clone)
  const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement("canvas")
      canvas.width = outW
      canvas.height = outH
      const ctx = canvas.getContext("2d", { alpha: false })
      if (!ctx) {
        URL.revokeObjectURL(url)
        reject(new Error("no 2d context"))
        return
      }
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = "high"
      ctx.fillStyle = "#ffffff"
      ctx.fillRect(0, 0, outW, outH)
      ctx.drawImage(img, 0, 0, outW, outH)
      canvas.toBlob(
        (out) => {
          URL.revokeObjectURL(url)
          if (!out) {
            reject(new Error("toBlob failed"))
            return
          }
          const dl = URL.createObjectURL(out)
          const a = document.createElement("a")
          a.href = dl
          a.download = sanitizeFilename(filename)
          a.click()
          URL.revokeObjectURL(dl)
          resolve()
        },
        "image/png"
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("svg rasterize failed"))
    }
    img.src = url
  })
}

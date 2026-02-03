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

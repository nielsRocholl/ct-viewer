/** Distinct color per label; colorblind-friendly palette and defaults for segmentation overlay. */

/** Paul Tol–style colorblind-safe palette (deep red first, then orange, teal, etc.). */
export const COLORBLIND_SAFE_PALETTE = [
    '#8B0000', '#E69F00', '#009E73', '#F0E442', '#56B4E9',
    '#D55E00', '#CC79A7', '#999999', '#882255', '#44AA99',
] as const

export const DEFAULT_LABEL_COLOR = COLORBLIND_SAFE_PALETTE[0]
export const DEFAULT_PRED_COLOR = COLORBLIND_SAFE_PALETTE[1]

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
    let h = hex.replace(/^#/, '')
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    const n = parseInt(h, 16)
    if (Number.isNaN(n) || h.length !== 6) return { r: 0, g: 0, b: 0 }
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
    r /= 255
    g /= 255
    b /= 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const d = max - min
    let h = 0
    if (d !== 0) {
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
        else if (max === g) h = ((b - r) / d + 2) * 60
        else h = ((r - g) / d + 4) * 60
    }
    const s = max === 0 ? 0 : (d / max) * 100
    const v = max * 100
    return { h, s, v }
}

export function hsvToHex(h: number, s: number, v: number): string {
    s /= 100
    v /= 100
    const c = v * s
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
    const m = v - c
    let rp = 0
    let gp = 0
    let bp = 0
    if (h < 60) [rp, gp, bp] = [c, x, 0]
    else if (h < 120) [rp, gp, bp] = [x, c, 0]
    else if (h < 180) [rp, gp, bp] = [0, c, x]
    else if (h < 240) [rp, gp, bp] = [0, x, c]
    else if (h < 300) [rp, gp, bp] = [x, 0, c]
    else [rp, gp, bp] = [c, 0, x]
    const r = Math.round((rp + m) * 255)
    const g = Math.round((gp + m) * 255)
    const b = Math.round((bp + m) * 255)
    return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
}

export function hexToHsv(hex: string): { h: number; s: number; v: number } {
    const { r, g, b } = hexToRgb(hex)
    return rgbToHsv(r, g, b)
}

/** Single-mask overlay color: cycles `COLORBLIND_SAFE_PALETTE` by mask slot index (0..n). */
export function generateDistinctColor(
    maskSlotIndex: number,
    _totalMasks?: number,
    _saturation?: number,
    _lightness?: number
): string {
    return COLORBLIND_SAFE_PALETTE[maskSlotIndex % COLORBLIND_SAFE_PALETTE.length]
}

export function generateDefaultColorMap(labelValues: number[]): Map<number, string> {
    const colorMap = new Map<number, string>()
    const nonZeroLabels = labelValues.filter(label => label !== 0)

    nonZeroLabels.forEach((label) => {
        const color = generateDistinctColor(label - 1, nonZeroLabels.length)
        colorMap.set(label, color)
    })

    return colorMap
}

export function updateLabelColor(
    colorMap: Map<number, string>,
    labelValue: number,
    color: string
): Map<number, string> {
    const newColorMap = new Map(colorMap)
    newColorMap.set(labelValue, color)
    return newColorMap
}

export function applyMaskWideColor(
    colorMap: Map<number, string>,
    color: string
): Map<number, string> {
    const newColorMap = new Map<number, string>()

    for (const label of colorMap.keys()) {
        newColorMap.set(label, color)
    }

    return newColorMap
}

export function getLabelColor(
    colorMap: Map<number, string>,
    labelValue: number,
    defaultColor: string = DEFAULT_LABEL_COLOR
): string {
    return colorMap.get(labelValue) ?? defaultColor
}

export const COLOR_PALETTES = {
    colorblind: [...COLORBLIND_SAFE_PALETTE],
    vibrant: ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ff8800', '#88ff00', '#0088ff', '#ff0088', '#8800ff', '#00ff88'],
    pastel: ['#ffb3ba', '#baffc9', '#bae1ff', '#ffffba', '#ffdfba', '#e0bbff', '#ffc9de', '#c9fff0', '#fff4ba', '#d4f1f4', '#ffd6e8', '#e6f3ff'],
    highContrast: ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ffffff', '#ff8800', '#8800ff', '#00ff88'],
} as const

export function createColorMapFromPalette(
    labelValues: number[],
    paletteName: keyof typeof COLOR_PALETTES = 'colorblind',
    /** Shift palette index so multiple simultaneous masks do not share the same label→color mapping. */
    paletteSlotOffset = 0
): Map<number, string> {
    const colorMap = new Map<number, string>()
    const palette = COLOR_PALETTES[paletteName]
    const nonZeroLabels = labelValues.filter(label => label !== 0)
    nonZeroLabels.forEach((label, idx) => {
        const color = palette[(paletteSlotOffset + idx) % palette.length]
        colorMap.set(label, color)
    })
    return colorMap
}

export function colorMapToRecord(map: Map<number, string>): Record<string, string> {
    const out: Record<string, string> = {}
    map.forEach((color, label) => {
        out[String(label)] = color
    })
    return out
}

export function recordToColorMap(record: Record<string, string>): Map<number, string> {
    const map = new Map<number, string>()
    Object.entries(record).forEach(([k, v]) => map.set(Number(k), v))
    return map
}

export function extractLabelValues(imageData: ImageData): number[] {
    const labelSet = new Set<number>()
    const data = imageData.data
    for (let i = 0; i < data.length; i += 4) {
        const label = data[i]
        labelSet.add(label)
    }

    return Array.from(labelSet).sort((a, b) => a - b)
}

export function buildLookupArray(colorMap: Map<number, string>, opacity: number): Uint8ClampedArray {
    const alphaByte = Math.round(opacity * 255)
    const out = new Uint8ClampedArray(256 * 4)
    for (let label = 0; label <= 255; label++) {
        const idx = label * 4
        if (label === 0) {
            out[idx] = 0
            out[idx + 1] = 0
            out[idx + 2] = 0
            out[idx + 3] = 0
        } else {
            const hex = colorMap.get(label) ?? DEFAULT_LABEL_COLOR
            const { r, g, b } = hexToRgb(hex)
            out[idx] = r
            out[idx + 1] = g
            out[idx + 2] = b
            out[idx + 3] = alphaByte
        }
    }
    return out
}

/** Distinct color per label; colorblind-friendly palette and defaults for segmentation overlay. */

/** Paul Tol–style colorblind-safe palette (blue, orange, teal, yellow, etc.; avoids red–green only). */
export const COLORBLIND_SAFE_PALETTE = [
    '#0072B2', '#E69F00', '#009E73', '#F0E442', '#56B4E9',
    '#D55E00', '#CC79A7', '#999999', '#882255', '#44AA99',
] as const

export const DEFAULT_LABEL_COLOR = COLORBLIND_SAFE_PALETTE[0]
export const DEFAULT_PRED_COLOR = COLORBLIND_SAFE_PALETTE[1]

export function generateDistinctColor(
    labelIndex: number,
    _totalLabels?: number,
    _saturation?: number,
    _lightness?: number
): string {
    return COLORBLIND_SAFE_PALETTE[labelIndex % COLORBLIND_SAFE_PALETTE.length]
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
    paletteName: keyof typeof COLOR_PALETTES = 'vibrant'
): Map<number, string> {
    const colorMap = new Map<number, string>()
    const palette = COLOR_PALETTES[paletteName]
    const nonZeroLabels = labelValues.filter(label => label !== 0)
    nonZeroLabels.forEach((label) => {
        const color = palette[(label - 1) % palette.length]
        colorMap.set(label, color)
    })

    return colorMap
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
            const n = hex.replace(/^#/, '')
            let r: number, g: number, b: number
            if (n.length === 3) {
                r = parseInt(n[0] + n[0], 16)
                g = parseInt(n[1] + n[1], 16)
                b = parseInt(n[2] + n[2], 16)
            } else {
                r = parseInt(n.slice(0, 2), 16)
                g = parseInt(n.slice(2, 4), 16)
                b = parseInt(n.slice(4, 6), 16)
            }
            out[idx] = r
            out[idx + 1] = g
            out[idx + 2] = b
            out[idx + 3] = alphaByte
        }
    }
    return out
}

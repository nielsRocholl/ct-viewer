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

    nonZeroLabels.forEach((label, index) => {
        const color = generateDistinctColor(index, nonZeroLabels.length)
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
    nonZeroLabels.forEach((label, index) => {
        const color = palette[index % palette.length]
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

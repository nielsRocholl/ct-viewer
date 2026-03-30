import type { DatasetCaseState } from '@/lib/store'
import {
    generateDistinctColor,
    DEFAULT_PRED_COLOR,
    createColorMapFromPalette,
    colorMapToRecord,
    recordToColorMap,
} from '@/lib/color-utils'

export type DatasetSeg = DatasetCaseState['segVolumes'][number]

export function mergeSegDisplay(prev: DatasetSeg[] | null | undefined, next: DatasetSeg[]): DatasetSeg[] {
    return next.map((s, i) => {
        const prevSeg = prev?.[i]
        const labelValues = s.labelValues ?? []
        const multiLabel = labelValues.length > 1
        let colorMap: Record<string, string> | undefined
        if (multiLabel) {
            const baseMap = createColorMapFromPalette(labelValues, 'colorblind', i)
            const baseRecord = colorMapToRecord(baseMap)
            const prevRecord = prevSeg?.colorMap ?? {}
            colorMap = { ...baseRecord }
            labelValues.forEach((lv) => {
                const key = String(lv)
                if (prevRecord[key]) colorMap![key] = prevRecord[key]
            })
        }
        return {
            ...s,
            color:
                !multiLabel
                    ? (s.color ??
                        prevSeg?.color ??
                        (s.role === 'pred' ? DEFAULT_PRED_COLOR : generateDistinctColor(i, next.length)))
                    : undefined,
            colorMap: multiLabel ? colorMap : undefined,
            visible: s.visible ?? prevSeg?.visible ?? true,
            mode: s.mode ?? prevSeg?.mode ?? 'filled',
        }
    })
}

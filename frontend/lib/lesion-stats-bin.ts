/** Log-spaced histogram over component volumes (mm³) for dashboard charts. */

export interface LesionHistogramBin {
    binKey: string
    binMinMm3: number
    binMaxMm3: number
    count: number
}

function formatMm3(v: number): string {
    if (v >= 1e6) return `${(v / 1e6).toFixed(2)}×10⁶`
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`
    if (v >= 1) return v.toFixed(1)
    if (v >= 1e-3) return v.toFixed(4)
    return v.toExponential(1)
}

/** ~20 log bins from min to max positive volume; empty input → []. */
export function binLesionVolumesLogMm3(volumes: number[], numBins = 20): LesionHistogramBin[] {
    const positive = volumes.filter((v) => v > 0 && Number.isFinite(v))
    if (positive.length === 0) return []
    const lo = Math.min(...positive)
    const hi = Math.max(...positive)
    if (lo === hi) {
        return [
            {
                binKey: `${formatMm3(lo)} mm³`,
                binMinMm3: lo,
                binMaxMm3: hi,
                count: positive.length,
            },
        ]
    }
    const logLo = Math.log10(lo)
    const logHi = Math.log10(hi)
    const span = logHi - logLo || 1e-15
    const bins: LesionHistogramBin[] = []
    for (let i = 0; i < numBins; i++) {
        const a = logLo + (span * i) / numBins
        const b = logLo + (span * (i + 1)) / numBins
        const binMinMm3 = 10 ** a
        const binMaxMm3 = 10 ** b
        bins.push({
            binKey: `${formatMm3(binMinMm3)}–${formatMm3(binMaxMm3)}`,
            binMinMm3,
            binMaxMm3,
            count: 0,
        })
    }
    for (const v of positive) {
        let t = (Math.log10(v) - logLo) / span
        if (t < 0) t = 0
        if (t >= 1) t = 1 - 1e-15
        const idx = Math.min(numBins - 1, Math.floor(t * numBins))
        bins[idx].count++
    }
    return bins.filter((b) => b.count > 0)
}

export function medianSorted(sorted: number[]): number | null {
    if (sorted.length === 0) return null
    const m = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[m]! : (sorted[m - 1]! + sorted[m]!) / 2
}

export function buildDatasetLesionStatsPayload(input: {
    allVolumesMm3: number[]
    datasetId: string
    segIndex: number
    segName: string | null
    caseCount: number
    casesWithForeground: number
}): DatasetLesionStatsComputed {
    const sorted = [...input.allVolumesMm3].filter((v) => v > 0 && Number.isFinite(v)).sort((a, b) => a - b)
    const n = sorted.length
    return {
        datasetId: input.datasetId,
        segIndex: input.segIndex,
        segName: input.segName,
        caseCount: input.caseCount,
        totalComponents: n,
        casesWithForeground: input.casesWithForeground,
        volumeMinMm3: n ? sorted[0]! : null,
        volumeMaxMm3: n ? sorted[n - 1]! : null,
        volumeMedianMm3: medianSorted(sorted),
        histogram: binLesionVolumesLogMm3(input.allVolumesMm3),
    }
}

export interface DatasetLesionStatsComputed {
    datasetId: string
    segIndex: number
    segName: string | null
    caseCount: number
    totalComponents: number
    casesWithForeground: number
    volumeMinMm3: number | null
    volumeMaxMm3: number | null
    volumeMedianMm3: number | null
    histogram: LesionHistogramBin[]
}

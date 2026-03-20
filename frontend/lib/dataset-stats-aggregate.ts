import type { CaseStatisticsResponse } from '@/lib/api-types'
import { buildDatasetLesionStatsPayload, type DatasetLesionStatsComputed } from '@/lib/lesion-stats-bin'

const EPS = 1e-5
const META_COVERAGE = 0.8

/** Flags sent to the statistics API (label stats implied if per-label CT is on). */
export interface StatisticsInclusion {
    include_global_ct_intensity: boolean
    include_lesion_connected_components: boolean
    include_label_segmentation_stats: boolean
    include_per_label_ct_intensity: boolean
    include_file_metadata: boolean
}

export interface DatasetCaseTableRow {
    case_id: string
    skipped: boolean
    geometry_match: boolean
    dimensions: [number, number, number]
    spacing: [number, number, number]
    ct_mean: number | null
    max_component_mm3: number | null
    multi_label: boolean
}

export interface DatasetStatisticsComputed extends DatasetLesionStatsComputed {
    inclusion: StatisticsInclusion
    geometryMismatchCaseCount: number
    dimensionHistogram: { key: string; count: number }[]
    spacingHistogram: { key: string; spacing: [number, number, number]; count: number }[]
    originsAllEqual: boolean
    directionsAllEqual: boolean
    spacingsAllEqual: boolean
    ctMeanOutliers: { case_id: string; mean: number; z: number }[]
    labelRollup: { label: number; cases_present: number; avg_volume_mm3: number }[]
    sharedCtMeta: { key: string; value: string; coverage: number }[]
    sharedSegMeta: { key: string; value: string; coverage: number }[]
    varyingMetaKeys: { domain: 'ct' | 'seg'; key: string }[]
    caseRows: DatasetCaseTableRow[]
}

function dimKey(d: readonly [number, number, number]) {
    return `${d[0]}×${d[1]}×${d[2]}`
}

function dirEq(a: readonly number[], b: readonly number[]) {
    if (a.length !== b.length) return false
    return a.every((x, i) => Math.abs(x - b[i]!) < EPS)
}

function originEq(a: readonly [number, number, number], b: readonly [number, number, number]) {
    return (
        Math.abs(a[0] - b[0]) < EPS &&
        Math.abs(a[1] - b[1]) < EPS &&
        Math.abs(a[2] - b[2]) < EPS
    )
}

function spacingEq(a: readonly [number, number, number], b: readonly [number, number, number]) {
    return originEq(a, b)
}

function meanStd(xs: number[]): { mean: number; std: number } {
    if (xs.length === 0) return { mean: 0, std: 0 }
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length
    if (xs.length === 1) return { mean, std: 0 }
    const v = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1)
    return { mean, std: Math.sqrt(Math.max(0, v)) }
}

function aggregateFileMeta(
    responses: CaseStatisticsResponse[],
    pick: 'ct_file_meta' | 'seg_file_meta',
    domain: 'ct' | 'seg'
): { shared: DatasetStatisticsComputed['sharedCtMeta']; varying: DatasetStatisticsComputed['varyingMetaKeys'] } {
    const n = responses.length
    if (n === 0) return { shared: [], varying: [] }
    const keyCount = new Map<string, number>()
    for (const r of responses) {
        const m = r[pick]
        for (const k of Object.keys(m)) {
            keyCount.set(k, (keyCount.get(k) ?? 0) + 1)
        }
    }
    const shared: DatasetStatisticsComputed['sharedCtMeta'] = []
    const varying: DatasetStatisticsComputed['varyingMetaKeys'] = []
    const threshold = Math.ceil(META_COVERAGE * n)
    for (const [key, cnt] of keyCount) {
        if (cnt < threshold) continue
        const vals = new Set<string>()
        for (const r of responses) {
            const v = r[pick][key]
            if (v !== undefined && v !== '') vals.add(v)
        }
        const coverage = cnt / n
        if (vals.size <= 1) {
            const value = vals.size === 1 ? [...vals][0]! : ''
            shared.push({ key, value, coverage })
        } else {
            varying.push({ domain, key })
        }
    }
    return { shared, varying }
}

export function buildDatasetStatisticsPayload(input: {
    responses: CaseStatisticsResponse[]
    datasetId: string
    segIndex: number
    segName: string | null
    inclusion: StatisticsInclusion
}): DatasetStatisticsComputed {
    const { responses, inclusion: inc } = input
    const labelSeg = inc.include_label_segmentation_stats || inc.include_per_label_ct_intensity
    const allVol: number[] = []
    let casesWithFg = 0
    let geometryMismatchCaseCount = 0
    const dimHist = new Map<string, number>()
    const spHist = new Map<string, { spacing: [number, number, number]; count: number }>()

    const caseRows: DatasetCaseTableRow[] = []

    for (const r of responses) {
        if (inc.include_lesion_connected_components) allVol.push(...r.volumes_mm3)
        if (inc.include_lesion_connected_components) {
            if (!r.skipped && r.volumes_mm3.length > 0) casesWithFg++
        } else if (labelSeg) {
            if (!r.skipped && r.per_label.length > 0) casesWithFg++
        }
        if (!r.geometry_match) geometryMismatchCaseCount++

        const dk = dimKey(r.ct.dimensions)
        dimHist.set(dk, (dimHist.get(dk) ?? 0) + 1)
        const spk = r.ct.spacing.join(',')
        const ex = spHist.get(spk)
        if (ex) ex.count++
        else spHist.set(spk, { spacing: [...r.ct.spacing] as [number, number, number], count: 1 })

        caseRows.push({
            case_id: r.case_id,
            skipped: r.skipped,
            geometry_match: r.geometry_match,
            dimensions: r.ct.dimensions,
            spacing: r.ct.spacing,
            ct_mean: r.global_intensity?.mean ?? null,
            max_component_mm3: inc.include_lesion_connected_components ? (r.max_component_mm3 ?? null) : null,
            multi_label: r.multi_label,
        })
    }

    const first = responses[0]
    let originsAllEqual = true
    let directionsAllEqual = true
    let spacingsAllEqual = true
    if (first) {
        const o0 = first.ct.origin
        const d0 = first.ct.direction
        const s0 = first.ct.spacing
        for (const r of responses) {
            if (!originEq(r.ct.origin, o0)) originsAllEqual = false
            if (!dirEq(r.ct.direction, d0)) directionsAllEqual = false
            if (!spacingEq(r.ct.spacing, s0)) spacingsAllEqual = false
        }
    }

    const activeMeans = inc.include_global_ct_intensity
        ? responses.filter((r) => r.global_intensity).map((r) => r.global_intensity!.mean)
        : []
    const { mean: cohortMean, std: cohortStd } = meanStd(activeMeans)
    const ctMeanOutliers: DatasetStatisticsComputed['ctMeanOutliers'] = []
    if (inc.include_global_ct_intensity) {
        for (const r of responses) {
            const gi = r.global_intensity
            if (!gi) continue
            const m = gi.mean
            const z = cohortStd > 1e-9 ? (m - cohortMean) / cohortStd : 0
            if (Math.abs(z) > 3) ctMeanOutliers.push({ case_id: r.case_id, mean: m, z })
        }
    }

    const labelVolMap = new Map<number, number[]>()
    if (labelSeg) {
        for (const r of responses) {
            for (const pl of r.per_label) {
                const arr = labelVolMap.get(pl.label) ?? []
                arr.push(pl.volume_mm3)
                labelVolMap.set(pl.label, arr)
            }
        }
    }
    const labelRollup: DatasetStatisticsComputed['labelRollup'] = [...labelVolMap.entries()]
        .map(([label, vols]) => ({
            label,
            cases_present: vols.length,
            avg_volume_mm3: vols.reduce((a, b) => a + b, 0) / vols.length,
        }))
        .sort((a, b) => a.label - b.label)

    const ctAgg = inc.include_file_metadata
        ? aggregateFileMeta(responses, 'ct_file_meta', 'ct')
        : { shared: [], varying: [] }
    const segAgg = inc.include_file_metadata
        ? aggregateFileMeta(responses, 'seg_file_meta', 'seg')
        : { shared: [], varying: [] }
    const varyingMetaKeys = [...ctAgg.varying, ...segAgg.varying]

    const base = buildDatasetLesionStatsPayload({
        allVolumesMm3: allVol,
        datasetId: input.datasetId,
        segIndex: input.segIndex,
        segName: input.segName,
        caseCount: responses.length,
        casesWithForeground: casesWithFg,
    })

    const dimensionHistogram = [...dimHist.entries()]
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count)
    const spacingHistogram = [...spHist.entries()]
        .map(([key, v]) => ({ key, spacing: v.spacing, count: v.count }))
        .sort((a, b) => b.count - a.count)

    return {
        ...base,
        inclusion: inc,
        geometryMismatchCaseCount,
        dimensionHistogram,
        spacingHistogram,
        originsAllEqual,
        directionsAllEqual,
        spacingsAllEqual,
        ctMeanOutliers,
        labelRollup,
        sharedCtMeta: ctAgg.shared.sort((a, b) => a.key.localeCompare(b.key)),
        sharedSegMeta: segAgg.shared.sort((a, b) => a.key.localeCompare(b.key)),
        varyingMetaKeys,
        caseRows,
    }
}

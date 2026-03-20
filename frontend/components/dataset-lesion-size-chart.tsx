'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import type { DatasetStatisticsComputed } from '@/lib/dataset-stats-aggregate'
import { cn } from '@/lib/utils'
import {
    Bar,
    BarChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts'

const chartConfig: ChartConfig = {
    count: { label: 'Lesions', color: 'hsl(var(--chart-1))' },
}

const geometryDimChartConfig: ChartConfig = {
    count: { label: 'Cases', color: 'hsl(var(--chart-1))' },
}

const geometrySpacingChartConfig: ChartConfig = {
    count: { label: 'Cases', color: 'hsl(var(--chart-2))' },
}

function formatMm3(v: number) {
    if (!Number.isFinite(v)) return '—'
    if (v >= 1e6) return `${(v / 1e6).toFixed(2)}×10⁶ mm³`
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k mm³`
    return `${v.toFixed(1)} mm³`
}

/** Pixel width for Y-axis so full category labels fit (10px ticks, monospace). */
function geometryYAxisWidth(rows: { label: string }[]) {
    const longest = rows.reduce((n, r) => Math.max(n, r.label.length), 0)
    return Math.max(108, Math.ceil(longest * 6.2) + 28)
}

function GeometryHistogramChart({
    title,
    config,
    rows,
    emptyMessage,
}: {
    title: string
    config: ChartConfig
    rows: { label: string; count: number }[]
    emptyMessage: string
}) {
    if (rows.length === 0) {
        return (
            <div className="space-y-1 min-w-0">
                <p className="text-xs font-medium text-muted-foreground">{title}</p>
                <p className="text-sm text-muted-foreground py-6 text-center rounded-md border border-border/60 bg-muted/10">
                    {emptyMessage}
                </p>
            </div>
        )
    }
    const yW = geometryYAxisWidth(rows)
    const h = Math.min(400, Math.max(160, rows.length * 32 + 64))
    return (
        <div className="space-y-1 min-w-0 flex min-h-0 flex-col overflow-hidden">
            <p className="text-xs font-medium text-muted-foreground">{title}</p>
            <div className="min-h-0 min-w-0 flex-1 overflow-x-auto">
                <ChartContainer
                    config={config}
                    className="w-full min-w-0 !min-h-0"
                    style={{ height: h, minWidth: yW + 100 }}
                >
                    <ResponsiveContainer width="100%" height={h}>
                        <BarChart
                            accessibilityLayer
                            layout="vertical"
                            data={rows}
                            margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
                        >
                            <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                            <XAxis
                                type="number"
                                tickLine={false}
                                axisLine={false}
                                allowDecimals={false}
                                fontSize={10}
                            />
                            <YAxis
                                type="category"
                                dataKey="label"
                                width={yW}
                                tickLine={false}
                                axisLine={false}
                                interval={0}
                                tick={{ fontSize: 10, fontFamily: 'ui-monospace, monospace' }}
                            />
                            <Tooltip
                                cursor={false}
                                content={({ active, payload }) => {
                                    if (!active || !payload?.length) return null
                                    const p = payload[0]?.payload as { label: string; count: number }
                                    return (
                                        <div className="rounded-md border bg-background px-2 py-1.5 text-xs shadow-md">
                                            <div className="font-medium tabular-nums">{p.count} cases</div>
                                            <div className="mt-0.5 font-mono text-[11px] text-muted-foreground break-all">
                                                {p.label}
                                            </div>
                                        </div>
                                    )
                                }}
                            />
                            <Bar
                                dataKey="count"
                                fill="var(--color-count)"
                                radius={[0, 3, 3, 0]}
                                isAnimationActive={false}
                            />
                        </BarChart>
                    </ResponsiveContainer>
                </ChartContainer>
            </div>
        </div>
    )
}

export function DatasetLesionStatsSection({ stats }: { stats: DatasetStatisticsComputed }) {
    const inc = stats.inclusion
    const data = stats.histogram.map((b) => ({
        bin: b.binKey,
        count: b.count,
        min: b.binMinMm3,
        max: b.binMaxMm3,
    }))
    const ariaLabel = inc.include_lesion_connected_components
        ? `Dataset statistics: ${stats.totalComponents} connected components across ${stats.caseCount} cases.`
        : `Dataset statistics for ${stats.caseCount} cases.`
    const segLabel = stats.segName ?? `Segmentation ${stats.segIndex + 1}`
    const showCc = inc.include_lesion_connected_components
    const showGlobalCt = inc.include_global_ct_intensity
    const showLabelRollup = inc.include_label_segmentation_stats
    const showFileMeta = inc.include_file_metadata

    const dimBarRows = stats.dimensionHistogram.map((row) => ({ label: row.key, count: row.count }))
    const spacingBarRows = stats.spacingHistogram.map((row) => ({
        label: row.spacing.map((x) => x.toFixed(3)).join(' × '),
        count: row.count,
    }))

    return (
        <div className="space-y-4" role="region" aria-label={ariaLabel}>
            {showCc ? (
            <div className="grid gap-4 md:grid-cols-2">
                <Card className="flex min-h-0 flex-col overflow-hidden">
                    <CardHeader className="shrink-0 pb-2">
                        <CardTitle className="text-base">Lesion volume distribution</CardTitle>
                        <CardDescription>
                            Log-spaced bins (mm³). Foreground (label &gt; 0), 26-connected components. {segLabel}.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex min-h-0 flex-1 flex-col pb-4 pt-0">
                        {data.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-8 text-center">
                                No foreground components in this segmentation across the dataset.
                            </p>
                        ) : (
                            <ChartContainer config={chartConfig} className="min-h-[280px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart
                                        data={data}
                                        margin={{ top: 8, right: 8, left: 0, bottom: 48 }}
                                    >
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                        <XAxis
                                            dataKey="bin"
                                            tickLine={false}
                                            axisLine={false}
                                            interval={0}
                                            angle={-35}
                                            textAnchor="end"
                                            height={56}
                                            fontSize={10}
                                        />
                                        <YAxis
                                            tickLine={false}
                                            axisLine={false}
                                            allowDecimals={false}
                                            width={40}
                                        />
                                        <Tooltip
                                            content={({ active, payload }) => {
                                                if (!active || !payload?.length) return null
                                                const p = payload[0]?.payload as {
                                                    bin: string
                                                    count: number
                                                    min: number
                                                    max: number
                                                }
                                                return (
                                                    <div className="rounded-md border bg-background px-2 py-1.5 text-xs shadow-md">
                                                        <div className="font-medium">{p.count} lesions</div>
                                                        <div className="text-muted-foreground">
                                                            {formatMm3(p.min)} – {formatMm3(p.max)}
                                                        </div>
                                                    </div>
                                                )
                                            }}
                                        />
                                        <Bar
                                            dataKey="count"
                                            fill="var(--color-count)"
                                            radius={[3, 3, 0, 0]}
                                            isAnimationActive={false}
                                        />
                                    </BarChart>
                                </ResponsiveContainer>
                            </ChartContainer>
                        )}
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base">Lesion summary</CardTitle>
                        <CardDescription>Connected components across cases</CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-3 text-sm">
                        <div className="flex justify-between gap-4 border-b border-border pb-2">
                            <span className="text-muted-foreground">Cases</span>
                            <span className="font-medium tabular-nums">{stats.caseCount}</span>
                        </div>
                        <div className="flex justify-between gap-4 border-b border-border pb-2">
                            <span className="text-muted-foreground">Cases with foreground</span>
                            <span className="font-medium tabular-nums">{stats.casesWithForeground}</span>
                        </div>
                        <div className="flex justify-between gap-4 border-b border-border pb-2">
                            <span className="text-muted-foreground">Total components</span>
                            <span className="font-medium tabular-nums">{stats.totalComponents}</span>
                        </div>
                        <div className="flex justify-between gap-4 border-b border-border pb-2">
                            <span className="text-muted-foreground">Volume min / median / max</span>
                            <span className="font-medium tabular-nums text-right text-xs">
                                {stats.volumeMinMm3 != null ? formatMm3(stats.volumeMinMm3) : '—'} /{' '}
                                {stats.volumeMedianMm3 != null ? formatMm3(stats.volumeMedianMm3) : '—'} /{' '}
                                {stats.volumeMaxMm3 != null ? formatMm3(stats.volumeMaxMm3) : '—'}
                            </span>
                        </div>
                    </CardContent>
                </Card>
            </div>
            ) : null}

            <div
                className={cn(
                    'grid gap-4',
                    showGlobalCt ? 'md:grid-cols-2' : 'md:grid-cols-1'
                )}
            >
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base">Geometry & alignment (CT)</CardTitle>
                        <CardDescription>After LPS reorientation on load</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 text-sm">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <div className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
                                <p className="text-[11px] text-muted-foreground leading-tight">Spacings match</p>
                                <p
                                    className={cn(
                                        'text-sm font-semibold tabular-nums mt-1',
                                        stats.spacingsAllEqual ? 'text-positive' : 'text-warning'
                                    )}
                                >
                                    {stats.spacingsAllEqual ? 'Yes' : 'No'}
                                </p>
                            </div>
                            <div className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
                                <p className="text-[11px] text-muted-foreground leading-tight">Origins match</p>
                                <p
                                    className={cn(
                                        'text-sm font-semibold tabular-nums mt-1',
                                        stats.originsAllEqual ? 'text-positive' : 'text-warning'
                                    )}
                                >
                                    {stats.originsAllEqual ? 'Yes' : 'No'}
                                </p>
                            </div>
                            <div className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
                                <p className="text-[11px] text-muted-foreground leading-tight">Directions match</p>
                                <p
                                    className={cn(
                                        'text-sm font-semibold tabular-nums mt-1',
                                        stats.directionsAllEqual ? 'text-positive' : 'text-warning'
                                    )}
                                >
                                    {stats.directionsAllEqual ? 'Yes' : 'No'}
                                </p>
                            </div>
                            <div className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
                                <p className="text-[11px] text-muted-foreground leading-tight">CT/seg mismatch</p>
                                <p className="text-sm font-semibold tabular-nums mt-1 text-foreground">
                                    {stats.geometryMismatchCaseCount}
                                </p>
                            </div>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                            <GeometryHistogramChart
                                title="Dimension counts (voxels W×H×D)"
                                config={geometryDimChartConfig}
                                rows={dimBarRows}
                                emptyMessage="No dimension data."
                            />
                            <GeometryHistogramChart
                                title="Spacing (mm) counts"
                                config={geometrySpacingChartConfig}
                                rows={spacingBarRows}
                                emptyMessage="No spacing data."
                            />
                        </div>
                    </CardContent>
                </Card>
                {showGlobalCt ? (
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-base">CT intensity outliers</CardTitle>
                            <CardDescription>
                                Case-level |z| &gt; 3 vs cohort mean of full-volume CT mean (HU-scale units).
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {stats.ctMeanOutliers.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No cases flagged.</p>
                            ) : (
                                <ul className="text-sm space-y-1 max-h-48 overflow-y-auto">
                                    {stats.ctMeanOutliers.map((o) => (
                                        <li
                                            key={o.case_id}
                                            className="flex justify-between gap-2 border-b border-border/50 pb-1"
                                        >
                                            <span className="font-mono truncate" title={o.case_id}>
                                                {o.case_id}
                                            </span>
                                            <span className="shrink-0 tabular-nums text-warning">
                                                z={o.z.toFixed(2)} (μ={o.mean.toFixed(1)})
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </CardContent>
                    </Card>
                ) : null}
            </div>

            {showLabelRollup ? (
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base">Label statistics</CardTitle>
                        <CardDescription>
                            Per label ID: cases containing it and mean lesion volume (mm³)
                            {inc.include_per_label_ct_intensity ? '; per-label CT stats computed on the server.' : ''}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                        {stats.labelRollup.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No foreground labels.</p>
                        ) : (
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-border text-left text-muted-foreground">
                                        <th className="py-2 pr-4">Label</th>
                                        <th className="py-2 pr-4">Cases</th>
                                        <th className="py-2">Avg volume (mm³)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {stats.labelRollup.map((r) => (
                                        <tr key={r.label} className="border-b border-border/60">
                                            <td className="py-1.5 pr-4 tabular-nums">{r.label}</td>
                                            <td className="py-1.5 pr-4 tabular-nums">{r.cases_present}</td>
                                            <td className="py-1.5 tabular-nums">{formatMm3(r.avg_volume_mm3)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </CardContent>
                </Card>
            ) : null}

            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base">Per-case overview</CardTitle>
                    <CardDescription>
                        {showCc ? 'Max CC volume. ' : ''}
                        {showGlobalCt ? 'Global CT mean. ' : ''}
                        Geometry match
                    </CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto max-h-64 overflow-y-auto">
                    <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-card">
                            <tr className="border-b border-border text-left text-muted-foreground">
                                <th className="py-2 pr-2">Case</th>
                                <th className="py-2 pr-2">Dims</th>
                                {showCc ? <th className="py-2 pr-2">Max CC</th> : null}
                                {showGlobalCt ? <th className="py-2 pr-2">CT mean</th> : null}
                                <th className="py-2">Geom</th>
                            </tr>
                        </thead>
                        <tbody>
                            {stats.caseRows.map((row) => (
                                <tr key={row.case_id} className="border-b border-border/50">
                                    <td className="py-1 pr-2 font-mono truncate max-w-[10rem]" title={row.case_id}>
                                        {row.case_id}
                                    </td>
                                    <td className="py-1 pr-2 font-mono whitespace-nowrap">
                                        {row.dimensions.join('×')}
                                    </td>
                                    {showCc ? (
                                        <td className="py-1 pr-2 tabular-nums">
                                            {row.max_component_mm3 != null ? formatMm3(row.max_component_mm3) : '—'}
                                        </td>
                                    ) : null}
                                    {showGlobalCt ? (
                                        <td className="py-1 pr-2 tabular-nums">
                                            {row.ct_mean != null ? row.ct_mean.toFixed(1) : '—'}
                                        </td>
                                    ) : null}
                                    <td className="py-1">{row.geometry_match ? '✓' : '✗'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </CardContent>
            </Card>

            {showFileMeta ? (
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base">File metadata (≥80% coverage)</CardTitle>
                    <CardDescription>Keys shared by most samples with identical value; MHA richer than NIfTI</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                    <details className="group">
                        <summary className="cursor-pointer text-sm font-medium">CT headers</summary>
                        <ul className="mt-2 space-y-1 text-xs max-h-40 overflow-y-auto font-mono break-all">
                            {stats.sharedCtMeta.length === 0 ? (
                                <li className="text-muted-foreground">None uniform</li>
                            ) : (
                                stats.sharedCtMeta.map((m) => (
                                    <li key={m.key}>
                                        <span className="text-muted-foreground">{m.key}</span>={m.value}{' '}
                                        <span className="text-muted-foreground">
                                            ({Math.round(m.coverage * 100)}%)
                                        </span>
                                    </li>
                                ))
                            )}
                        </ul>
                    </details>
                    <details className="group">
                        <summary className="cursor-pointer text-sm font-medium">Segmentation headers</summary>
                        <ul className="mt-2 space-y-1 text-xs max-h-40 overflow-y-auto font-mono break-all">
                            {stats.sharedSegMeta.length === 0 ? (
                                <li className="text-muted-foreground">None uniform</li>
                            ) : (
                                stats.sharedSegMeta.map((m) => (
                                    <li key={m.key}>
                                        <span className="text-muted-foreground">{m.key}</span>={m.value}{' '}
                                        <span className="text-muted-foreground">
                                            ({Math.round(m.coverage * 100)}%)
                                        </span>
                                    </li>
                                ))
                            )}
                        </ul>
                    </details>
                    {stats.varyingMetaKeys.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                            Varies across cohort:{' '}
                            {stats.varyingMetaKeys.map((v) => `${v.domain}:${v.key}`).join(', ')}
                        </p>
                    )}
                </CardContent>
            </Card>
            ) : null}
        </div>
    )
}

'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import type { DatasetStatisticsComputed } from '@/lib/dataset-stats-aggregate'
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

function formatMm3(v: number) {
    if (!Number.isFinite(v)) return '—'
    if (v >= 1e6) return `${(v / 1e6).toFixed(2)}×10⁶ mm³`
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k mm³`
    return `${v.toFixed(1)} mm³`
}

function BoolRow({ label, ok }: { label: string; ok: boolean }) {
    return (
        <div className="flex justify-between gap-4 border-b border-border pb-2 text-sm">
            <span className="text-muted-foreground">{label}</span>
            <span className={ok ? 'text-positive font-medium' : 'text-warning font-medium'}>
                {ok ? 'Yes' : 'No'}
            </span>
        </div>
    )
}

export function DatasetLesionStatsSection({ stats }: { stats: DatasetStatisticsComputed }) {
    const data = stats.histogram.map((b) => ({
        bin: b.binKey,
        count: b.count,
        min: b.binMinMm3,
        max: b.binMaxMm3,
    }))
    const ariaLabel = `Dataset statistics: ${stats.totalComponents} connected components across ${stats.caseCount} cases.`
    const segLabel = stats.segName ?? `Segmentation ${stats.segIndex + 1}`

    return (
        <div className="space-y-4" role="region" aria-label={ariaLabel}>
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

            <div className="grid gap-4 md:grid-cols-2">
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base">Geometry & alignment (CT)</CardTitle>
                        <CardDescription>After LPS reorientation on load</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                        <BoolRow label="All spacings identical" ok={stats.spacingsAllEqual} />
                        <BoolRow label="All origins identical" ok={stats.originsAllEqual} />
                        <BoolRow label="All directions identical" ok={stats.directionsAllEqual} />
                        <div className="flex justify-between gap-4 border-b border-border pb-2">
                            <span className="text-muted-foreground">CT/seg size &amp; spacing mismatch</span>
                            <span className="font-medium tabular-nums">{stats.geometryMismatchCaseCount}</span>
                        </div>
                        <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">Dimension counts (voxels W×H×D)</p>
                            <div className="max-h-32 overflow-y-auto rounded border border-border">
                                <table className="w-full text-xs">
                                    <tbody>
                                        {stats.dimensionHistogram.map((row) => (
                                            <tr key={row.key} className="border-b border-border/60">
                                                <td className="px-2 py-1 font-mono">{row.key}</td>
                                                <td className="px-2 py-1 text-right tabular-nums">{row.count}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">Spacing (mm) counts</p>
                            <div className="max-h-32 overflow-y-auto rounded border border-border">
                                <table className="w-full text-xs">
                                    <tbody>
                                        {stats.spacingHistogram.map((row) => (
                                            <tr key={row.key} className="border-b border-border/60">
                                                <td className="px-2 py-1 font-mono">
                                                    {row.spacing.map((x) => x.toFixed(3)).join(' × ')}
                                                </td>
                                                <td className="px-2 py-1 text-right tabular-nums">{row.count}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </CardContent>
                </Card>
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
                                    <li key={o.case_id} className="flex justify-between gap-2 border-b border-border/50 pb-1">
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
            </div>

            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base">Label statistics</CardTitle>
                    <CardDescription>Per label ID: cases containing it and mean lesion volume (mm³)</CardDescription>
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

            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base">Per-case overview</CardTitle>
                    <CardDescription>Max CC volume, global CT mean, geometry match</CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto max-h-64 overflow-y-auto">
                    <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-card">
                            <tr className="border-b border-border text-left text-muted-foreground">
                                <th className="py-2 pr-2">Case</th>
                                <th className="py-2 pr-2">Dims</th>
                                <th className="py-2 pr-2">Max CC</th>
                                <th className="py-2 pr-2">CT mean</th>
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
                                    <td className="py-1 pr-2 tabular-nums">
                                        {row.max_component_mm3 != null ? formatMm3(row.max_component_mm3) : '—'}
                                    </td>
                                    <td className="py-1 pr-2 tabular-nums">{row.ct_mean.toFixed(1)}</td>
                                    <td className="py-1">{row.geometry_match ? '✓' : '✗'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </CardContent>
            </Card>

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
        </div>
    )
}

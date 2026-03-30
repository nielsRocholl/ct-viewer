'use client'

import { useRef, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip'
import type { DatasetStatisticsComputed } from '@/lib/dataset-stats-aggregate'
import { cn, downloadSvgAsPng, downloadTextFile } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'
import {
    BarChart3,
    Boxes,
    Compass,
    Crosshair,
    Download,
    HelpCircle,
    Layers,
    Ruler,
    Tags,
    Users,
} from 'lucide-react'
import { toast } from 'sonner'
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    LabelList,
    ResponsiveContainer,
    Scatter,
    ScatterChart,
    Tooltip as RechartsTooltip,
    XAxis,
    YAxis,
    ZAxis,
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

function geometryExportStamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

function csvCell(v: string | number): string {
    const s = String(v)
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
}

function buildGeometryExportJson(stats: DatasetStatisticsComputed) {
    return {
        export_kind: 'geometry_alignment_ct' as const,
        generated_at: new Date().toISOString(),
        dataset_id: stats.datasetId,
        seg_index: stats.segIndex,
        seg_name: stats.segName,
        case_count: stats.caseCount,
        spacings_all_equal: stats.spacingsAllEqual,
        origins_all_equal: stats.originsAllEqual,
        directions_all_equal: stats.directionsAllEqual,
        geometry_mismatch_case_count: stats.geometryMismatchCaseCount,
        dimension_histogram: stats.dimensionHistogram.map((r) => ({ grid_label: r.key, count: r.count })),
        spacing_histogram: stats.spacingHistogram.map((r) => ({
            spacing_mm: [...r.spacing] as [number, number, number],
            label: r.spacing.map((x) => x.toFixed(3)).join(' × '),
            count: r.count,
        })),
    }
}

function geometryGridCsv(stats: DatasetStatisticsComputed): string {
    const lines = ['grid_w_h_d,cases_n']
    for (const r of stats.dimensionHistogram) {
        lines.push(`${csvCell(r.key)},${csvCell(r.count)}`)
    }
    return lines.join('\n')
}

function geometrySpacingCsv(stats: DatasetStatisticsComputed): string {
    const lines = ['dx_mm,dy_mm,dz_mm,label,cases_n']
    for (const r of stats.spacingHistogram) {
        const [dx, dy, dz] = r.spacing
        const label = r.spacing.map((x) => x.toFixed(3)).join(' × ')
        lines.push(
            `${csvCell(dx)},${csvCell(dy)},${csvCell(dz)},${csvCell(label)},${csvCell(r.count)}`
        )
    }
    return lines.join('\n')
}

function perCaseOverviewCsv(
    stats: DatasetStatisticsComputed,
    showCc: boolean,
    showGlobalCt: boolean
): string {
    const h = ['case_id', 'dims_w_h_d']
    if (showCc) h.push('max_cc_mm3')
    if (showGlobalCt) h.push('ct_mean')
    h.push('geometry_match')
    const lines = [h.join(',')]
    for (const row of stats.caseRows) {
        const cells = [csvCell(row.case_id), csvCell(row.dimensions.join('×'))]
        if (showCc) {
            cells.push(row.max_component_mm3 != null ? csvCell(row.max_component_mm3) : '')
        }
        if (showGlobalCt) {
            cells.push(row.ct_mean != null ? csvCell(row.ct_mean) : '')
        }
        cells.push(row.geometry_match ? 'true' : 'false')
        lines.push(cells.join(','))
    }
    return lines.join('\n')
}

function buildLesionVolumeExportJson(stats: DatasetStatisticsComputed) {
    return {
        export_kind: 'lesion_volume_distribution' as const,
        generated_at: new Date().toISOString(),
        dataset_id: stats.datasetId,
        seg_index: stats.segIndex,
        seg_name: stats.segName,
        case_count: stats.caseCount,
        cases_with_foreground: stats.casesWithForeground,
        total_components: stats.totalComponents,
        volume_min_mm3: stats.volumeMinMm3,
        volume_median_mm3: stats.volumeMedianMm3,
        volume_max_mm3: stats.volumeMaxMm3,
        connectivity: '26-connected',
        foreground_rule: 'label > 0',
        binning: 'log-spaced mm³',
        histogram: stats.histogram.map((b) => ({
            bin_label: b.binKey,
            volume_min_mm3: b.binMinMm3,
            volume_max_mm3: b.binMaxMm3,
            lesions_n: b.count,
        })),
    }
}

function lesionVolumeHistogramCsv(stats: DatasetStatisticsComputed): string {
    const lines = ['bin_label,volume_min_mm3,volume_max_mm3,lesions_n']
    for (const b of stats.histogram) {
        lines.push(
            `${csvCell(b.binKey)},${csvCell(b.binMinMm3)},${csvCell(b.binMaxMm3)},${csvCell(b.count)}`
        )
    }
    return lines.join('\n')
}

function labelRollupCsv(stats: DatasetStatisticsComputed): string {
    const lines = ['label,cases_present,avg_volume_mm3']
    for (const r of stats.labelRollup) {
        lines.push(`${csvCell(r.label)},${csvCell(r.cases_present)},${csvCell(r.avg_volume_mm3)}`)
    }
    return lines.join('\n')
}

function buildLesionLabelCohortExportJson(
    stats: DatasetStatisticsComputed,
    showCc: boolean,
    showLabelRollup: boolean
) {
    return {
        export_kind: 'lesion_label_cohort' as const,
        generated_at: new Date().toISOString(),
        dataset_id: stats.datasetId,
        seg_index: stats.segIndex,
        seg_name: stats.segName,
        case_count: stats.caseCount,
        ...(showCc
            ? {
                  cases_with_foreground: stats.casesWithForeground,
                  total_components: stats.totalComponents,
                  volume_min_mm3: stats.volumeMinMm3,
                  volume_median_mm3: stats.volumeMedianMm3,
                  volume_max_mm3: stats.volumeMaxMm3,
                  connectivity: '26-connected',
                  foreground_rule: 'label > 0',
              }
            : {}),
        ...(showLabelRollup
            ? {
                  label_rollup: stats.labelRollup.map((r) => ({
                      label: r.label,
                      cases_present: r.cases_present,
                      avg_volume_mm3: r.avg_volume_mm3,
                  })),
              }
            : {}),
    }
}

function findRechartsSvg(panel: HTMLDivElement | null): SVGSVGElement | null {
    if (!panel) return null
    const byClass = panel.querySelector('svg.recharts-surface')
    if (byClass instanceof SVGSVGElement) return byClass
    const wrap = panel.querySelector('.recharts-wrapper svg')
    return wrap instanceof SVGSVGElement ? wrap : null
}

function formatMm3(v: number) {
    if (!Number.isFinite(v)) return '—'
    if (v >= 1e6) return `${(v / 1e6).toFixed(2)}×10⁶ mm³`
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k mm³`
    return `${v.toFixed(1)} mm³`
}

/** Single-line tick: normalize `×` separators to ` × ` (no line break). */
function normalizeGeometryTickLabel(raw: string): string {
    return raw
        .replace(/\s*×\s*/gu, ' × ')
        .replace(/\s+/g, ' ')
        .trim()
}

/** Pixel width for Y-axis so full monospace label fits on one line. */
function geometryYAxisWidth(rows: { label: string }[]) {
    const longest = rows.reduce(
        (n, r) => Math.max(n, normalizeGeometryTickLabel(r.label).length),
        0
    )
    return Math.max(120, Math.ceil(longest * 6.9) + 44)
}

function GeometryYAxisTick({
    x,
    y,
    payload,
}: {
    x: number
    y: number
    payload: { value?: string }
}) {
    const fill = 'hsl(var(--muted-foreground))'
    const text = normalizeGeometryTickLabel(String(payload?.value ?? ''))
    return (
        <text
            x={x}
            y={y}
            dy={3}
            textAnchor="end"
            fill={fill}
            fontSize={10}
            fontFamily="ui-monospace, monospace"
        >
            {text}
        </text>
    )
}

function GeometryAffineTile({
    icon: Icon,
    label,
    hint,
    value,
    detail,
    tone,
}: {
    icon: LucideIcon
    label: string
    hint: string
    value: ReactNode
    detail: string
    tone: 'positive' | 'warning'
}) {
    return (
        <div className="flex min-h-[5.25rem] min-w-0 flex-col rounded-xl border border-border/60 bg-muted/10 px-3.5 py-3">
            <div className="grid min-w-0 grid-cols-[1fr_auto] items-start gap-x-2 gap-y-1">
                <span className="flex min-w-0 items-start gap-2">
                    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground/90" aria-hidden />
                    <span className="min-w-0 break-words text-[11px] font-medium uppercase leading-snug tracking-[0.14em] text-muted-foreground">
                        {label}
                    </span>
                </span>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <button
                            type="button"
                            aria-label={`Explain ${label}`}
                            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                            <HelpCircle className="size-3.5" aria-hidden />
                        </button>
                    </TooltipTrigger>
                    <TooltipContent
                        side="top"
                        className="max-w-[280px] border bg-popover px-3 py-2.5 text-left text-xs font-normal leading-snug text-popover-foreground shadow-md"
                    >
                        {hint}
                    </TooltipContent>
                </Tooltip>
            </div>
            <span
                className={cn(
                    'mt-3 text-[15px] font-semibold tabular-nums tracking-tight',
                    tone === 'positive' ? 'text-positive' : 'text-warning'
                )}
            >
                {value}
            </span>
            <span className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</span>
        </div>
    )
}

type GeometryHistogramRow = {
    label: string
    count: number
    /** Tooltip second line; defaults to `label` (e.g. exact mm³ range for lesion bins). */
    mm3RangeLine?: string
}

/** Above this many distinct configurations, show a bubble scatter chart instead of per-config bars. */
const GEOMETRY_CATEGORICAL_BAR_CAP = 14

function parseGridTriplet(key: string): [number, number, number] | null {
    const parts = key.split(/\s*[×x]\s*/i).map((s) => s.trim()).filter(Boolean)
    if (parts.length !== 3) return null
    const w = parseInt(parts[0]!, 10)
    const h = parseInt(parts[1]!, 10)
    const d = parseInt(parts[2]!, 10)
    if (![w, h, d].every((n) => Number.isInteger(n) && n >= 1)) return null
    return [w, h, d]
}

type GeomScatterPt = { x: number; y: number; label: string; count: number }

function GeometryScatterChart({
    title,
    subtitle,
    points,
    xAxisLabel,
    yAxisLabel,
    cohortSize,
    emptyMessage,
    xFormatter = (v) => String(Math.round(v)),
    yFormatter = (v) => String(Math.round(v)),
}: {
    title: string
    subtitle?: string
    points: GeomScatterPt[]
    xAxisLabel: string
    yAxisLabel: string
    cohortSize: number
    emptyMessage: string
    xFormatter?: (v: number) => string
    yFormatter?: (v: number) => string
}) {
    const tickFill = 'hsl(var(--muted-foreground))'
    const axisStroke = 'hsl(var(--border))'
    const maxCount = Math.max(1, ...points.map((p) => p.count))
    // Scale bubble area: single-case configs stay visible; dominant configs are prominent
    const zRange: [number, number] = [30, Math.max(300, Math.round(30 + 570 / Math.max(1, points.length)))]
    const H = 272
    return (
        <figure className="flex min-w-0 flex-col gap-3">
            <figcaption>
                <p className="text-sm font-medium leading-none tracking-tight text-foreground">{title}</p>
                {subtitle ? <p className="mt-1 text-xs leading-snug text-muted-foreground">{subtitle}</p> : null}
            </figcaption>
            {points.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>
            ) : (
                // Use an explicit-height div as the sizing root so ResponsiveContainer can resolve height="100%"
                // without fighting ChartContainer's flex-1 + min-h rules.
                <div
                    className="w-full min-w-0 [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line]:stroke-border/35"
                    style={{ height: H }}
                >
                    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                        <ScatterChart margin={{ top: 10, right: 16, bottom: 44, left: 8 }}>
                            <CartesianGrid strokeDasharray="4 4" stroke={axisStroke} strokeOpacity={0.35} />
                            <XAxis
                                type="number"
                                dataKey="x"
                                tickLine={false}
                                axisLine={{ stroke: axisStroke, strokeOpacity: 0.65 }}
                                tick={{ fontSize: 10, fill: tickFill }}
                                tickFormatter={xFormatter}
                                domain={['auto', 'auto']}
                                label={{
                                    value: xAxisLabel,
                                    position: 'insideBottom' as const,
                                    offset: -22,
                                    style: { fontSize: 10, fill: tickFill, fontWeight: 500 },
                                }}
                            />
                            <YAxis
                                type="number"
                                dataKey="y"
                                width={48}
                                tickLine={false}
                                axisLine={{ stroke: axisStroke, strokeOpacity: 0.65 }}
                                tick={{ fontSize: 10, fill: tickFill }}
                                tickFormatter={yFormatter}
                                domain={['auto', 'auto']}
                                label={{
                                    value: yAxisLabel,
                                    angle: -90 as const,
                                    position: 'insideLeft' as const,
                                    offset: 14,
                                    style: { fontSize: 10, fill: tickFill, fontWeight: 500 },
                                }}
                            />
                            <ZAxis type="number" dataKey="count" range={zRange} domain={[0, maxCount]} />
                            <RechartsTooltip
                                cursor={{ strokeDasharray: '4 4', stroke: axisStroke }}
                                content={({ active, payload }) => {
                                    if (!active || !payload?.length) return null
                                    const pt = payload[0]?.payload as GeomScatterPt
                                    const pct =
                                        cohortSize > 0 ? Math.round((pt.count / cohortSize) * 100) : null
                                    return (
                                        <div className="rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                                            <p className="font-mono font-semibold tabular-nums">{pt.label}</p>
                                            <p className="mt-1 text-muted-foreground">
                                                {pt.count} case{pt.count === 1 ? '' : 's'}
                                                {pct != null ? ` · ${pct}% of cohort` : ''}
                                            </p>
                                        </div>
                                    )
                                }}
                            />
                            <Scatter
                                data={points}
                                fill="hsl(var(--chart-1))"
                                fillOpacity={0.65}
                                isAnimationActive={false}
                            />
                        </ScatterChart>
                    </ResponsiveContainer>
                </div>
            )}
        </figure>
    )
}

function GeometryHistogramChart({
    title,
    subtitle,
    config,
    rows,
    emptyMessage,
    plainEmpty,
    cohortSize,
    xAxisLabel = 'Cases (n)',
    showXAxisLabel = true,
    tooltipEntity = { singular: 'case', plural: 'cases' },
    shareOfTotal,
    shareOfTotalCaption,
    showCaption = true,
    showBarLabels = true,
    tooltipMinimal = false,
}: {
    title: string
    subtitle?: string
    config: ChartConfig
    rows: GeometryHistogramRow[]
    emptyMessage: string
    plainEmpty?: boolean
    cohortSize?: number
    xAxisLabel?: string
    showXAxisLabel?: boolean
    tooltipEntity?: { singular: string; plural: string }
    shareOfTotal?: number
    shareOfTotalCaption?: string
    showCaption?: boolean
    showBarLabels?: boolean
    /** Count only in tooltip; no % lines or second mm³ line (Y-axis carries bin label). */
    tooltipMinimal?: boolean
}) {
    if (rows.length === 0) {
        return (
            <figure className="min-w-0 space-y-1.5">
                {showCaption ? (
                    <figcaption>
                        <p className="text-sm font-medium leading-none text-foreground">{title}</p>
                        {subtitle ? (
                            <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
                        ) : null}
                    </figcaption>
                ) : null}
                <p
                    className={cn(
                        'py-6 text-center text-sm text-muted-foreground',
                        !plainEmpty && 'rounded-md border border-border/60 bg-muted/10'
                    )}
                >
                    {emptyMessage}
                </p>
            </figure>
        )
    }

    const yW = geometryYAxisWidth(rows)
    const h = Math.min(480, Math.max(176, rows.length * 40 + 88))
    const maxC = rows.reduce((m, r) => Math.max(m, r.count), 0)
    const xMax = Math.max(1, maxC)
    const integerTicks = xMax <= 12 ? Array.from({ length: xMax + 1 }, (_, i) => i) : undefined
    const tickFill = 'hsl(var(--muted-foreground))'
    const axisStroke = 'hsl(var(--border))'
    // Right: X tick labels + LabelList past bar ends (worst when bar fills domain to xMax).
    const digitW = String(maxC).length * 9
    const mr = Math.max(64, 48 + digitW + 22)
    const ml = 6
    const mb = showXAxisLabel ? 36 : 12
    const minChartWidth = Math.max(440, yW + mr + 190)
    return (
        <figure className={cn('flex min-w-0 flex-col', showCaption && 'gap-3')}>
            {showCaption ? (
                <figcaption>
                    <p className="text-sm font-medium leading-none tracking-tight text-foreground">{title}</p>
                    {subtitle ? (
                        <p className="mt-1 text-xs leading-snug text-muted-foreground">{subtitle}</p>
                    ) : null}
                </figcaption>
            ) : null}
            <div className="w-full min-w-0 max-w-full overflow-x-auto">
                <ChartContainer
                    config={config}
                    className="w-full"
                    style={{ height: h, minHeight: h, minWidth: minChartWidth }}
                >
                    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                        <BarChart
                            accessibilityLayer
                            layout="vertical"
                            data={rows}
                            margin={{ top: 8, right: mr, left: ml, bottom: mb }}
                            barCategoryGap="20%"
                        >
                            <CartesianGrid
                                horizontal={false}
                                stroke={axisStroke}
                                strokeOpacity={0.4}
                                strokeDasharray="4 4"
                            />
                            <XAxis
                                type="number"
                                domain={[0, xMax]}
                                ticks={integerTicks}
                                tickLine={false}
                                axisLine={{ stroke: axisStroke, strokeOpacity: 0.65 }}
                                allowDecimals={false}
                                tickMargin={8}
                                tick={{ fontSize: 10, fill: tickFill }}
                                {...(showXAxisLabel
                                    ? {
                                        label: {
                                            value: xAxisLabel,
                                            position: 'insideBottom' as const,
                                            offset: -14,
                                            style: {
                                                fontSize: 10,
                                                fill: tickFill,
                                                fontWeight: 500,
                                            },
                                        },
                                    }
                                    : {})}
                            />
                            <YAxis
                                type="category"
                                dataKey="label"
                                width={yW}
                                tickLine={false}
                                axisLine={false}
                                interval={0}
                                tickMargin={10}
                                tick={GeometryYAxisTick}
                            />
                            <RechartsTooltip
                                cursor={{ fill: 'hsl(var(--muted))', fillOpacity: 0.22 }}
                                content={({ active, payload }) => {
                                    if (!active || !payload?.length) return null
                                    const p = payload[0]?.payload as GeometryHistogramRow
                                    const pctCohort =
                                        !tooltipMinimal &&
                                            cohortSize &&
                                            cohortSize > 0
                                            ? Math.round((p.count / cohortSize) * 100)
                                            : null
                                    const pctShare =
                                        !tooltipMinimal &&
                                            shareOfTotal != null &&
                                            shareOfTotal > 0
                                            ? Math.round((p.count / shareOfTotal) * 100)
                                            : null
                                    const entity =
                                        p.count === 1 ? tooltipEntity.singular : tooltipEntity.plural
                                    const secondLine = p.mm3RangeLine ?? p.label
                                    return (
                                        <div className="rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                                            <div className="font-semibold tabular-nums">
                                                n = {p.count}
                                                <span className="font-normal text-muted-foreground">
                                                    {' '}
                                                    {entity}
                                                </span>
                                                {pctCohort != null ? (
                                                    <span className="block pt-0.5 text-[11px] font-normal text-muted-foreground">
                                                        {pctCohort}% of cohort ({cohortSize} loaded)
                                                    </span>
                                                ) : pctShare != null && shareOfTotalCaption ? (
                                                    <span className="block pt-0.5 text-[11px] font-normal text-muted-foreground">
                                                        {pctShare}% of {shareOfTotalCaption} ({shareOfTotal}{' '}
                                                        total)
                                                    </span>
                                                ) : null}
                                            </div>
                                            {!tooltipMinimal ? (
                                                <div className="mt-1.5 border-t border-border/60 pt-1.5 font-mono text-[11px] leading-snug text-muted-foreground break-all">
                                                    {secondLine}
                                                </div>
                                            ) : null}
                                        </div>
                                    )
                                }}
                            />
                            <Bar
                                dataKey="count"
                                fill="var(--color-count)"
                                radius={[0, 5, 5, 0]}
                                maxBarSize={26}
                                isAnimationActive={false}
                            >
                                {showBarLabels ? (
                                    <LabelList
                                        dataKey="count"
                                        position="right"
                                        fill="hsl(var(--muted-foreground))"
                                        fontSize={11}
                                        fontWeight={600}
                                        offset={8}
                                        formatter={(v: number) => (v > 0 ? String(v) : '')}
                                    />
                                ) : null}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </ChartContainer>
            </div>
        </figure>
    )
}

function LesionLabelCohortCard({
    stats,
    showCc,
    showLabelRollup,
    segLabel,
}: {
    stats: DatasetStatisticsComputed
    showCc: boolean
    showLabelRollup: boolean
    segLabel: string
}) {
    const lesionVolPanelRef = useRef<HTMLDivElement>(null)
    const lesionHistogramRows: GeometryHistogramRow[] = stats.histogram.map((b) => ({
        label: b.binKey,
        count: b.count,
    }))

    const merged = showCc && showLabelRollup
    const title = merged ? 'Lesions & labels' : showCc ? 'Lesion summary' : 'Label statistics'
    const description = merged
        ? `26-connected components and per-label mask volumes · ${segLabel}`
        : showCc
          ? `Connected components across cases · ${segLabel}`
          : `Per label ID: cases where it appears and mean mask volume (mm³) · ${segLabel}`

    const nCases = stats.caseCount
    const nLabels = stats.labelRollup.length
    const multiLabelCases = stats.caseRows.filter((r) => r.multi_label && !r.skipped).length
    const maxCasesPerLabel = nLabels > 0 ? Math.max(...stats.labelRollup.map((r) => r.cases_present)) : 0

    const volRangeHint =
        stats.volumeMinMm3 != null && stats.volumeMaxMm3 != null
            ? `Min ${formatMm3(stats.volumeMinMm3)} · max ${formatMm3(stats.volumeMaxMm3)} across components.`
            : 'No positive component volumes in this cohort.'

    return (
        <Card
            className="border-border/70 shadow-sm ring-1 ring-border/40"
            aria-labelledby="lesion-label-cohort-title"
            aria-describedby="lesion-label-cohort-desc"
        >
            <CardHeader className="shrink-0 gap-4 pb-4 pt-6">
                <div className="flex flex-col gap-3">
                    <div className="flex flex-row items-start justify-between gap-3">
                        <CardTitle
                            id="lesion-label-cohort-title"
                            className="min-w-0 text-lg font-semibold leading-tight tracking-tight"
                        >
                            {title}
                        </CardTitle>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="shrink-0"
                                    aria-label="Download"
                                >
                                    <Download className="h-4 w-4 shrink-0" aria-hidden />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-[14rem]">
                                {showCc ? (
                                    <>
                                        <DropdownMenuLabel>Lesion volume distribution</DropdownMenuLabel>
                                        <DropdownMenuItem
                                            onClick={() => {
                                                const json = JSON.stringify(
                                                    buildLesionVolumeExportJson(stats),
                                                    null,
                                                    2
                                                )
                                                downloadTextFile(
                                                    json,
                                                    `lesion-volume-distribution-${geometryExportStamp()}.json`,
                                                    'application/json'
                                                )
                                            }}
                                        >
                                            Cohort data (JSON)
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            onClick={() => {
                                                downloadTextFile(
                                                    lesionVolumeHistogramCsv(stats),
                                                    `lesion-volume-bins-${geometryExportStamp()}.csv`,
                                                    'text/csv;charset=utf-8'
                                                )
                                            }}
                                        >
                                            Histogram (CSV)
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuLabel>Images</DropdownMenuLabel>
                                        <DropdownMenuItem
                                            onClick={() => {
                                                const svg = findRechartsSvg(lesionVolPanelRef.current)
                                                if (!svg) {
                                                    toast.error('No chart to export')
                                                    return
                                                }
                                                void downloadSvgAsPng(
                                                    svg,
                                                    `lesion-volume-chart-${geometryExportStamp()}.png`
                                                )
                                                    .then(() => toast.success('Chart saved'))
                                                    .catch(() => toast.error('PNG export failed'))
                                            }}
                                        >
                                            Lesion volume chart (PNG)
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                    </>
                                ) : null}
                                <DropdownMenuLabel>Whole card</DropdownMenuLabel>
                                <DropdownMenuItem
                                    onClick={() => {
                                        const json = JSON.stringify(
                                            buildLesionLabelCohortExportJson(stats, showCc, showLabelRollup),
                                            null,
                                            2
                                        )
                                        downloadTextFile(
                                            json,
                                            `lesion-label-cohort-${geometryExportStamp()}.json`,
                                            'application/json'
                                        )
                                    }}
                                >
                                    Cohort snapshot (JSON)
                                </DropdownMenuItem>
                                {showLabelRollup ? (
                                    <DropdownMenuItem
                                        onClick={() => {
                                            downloadTextFile(
                                                labelRollupCsv(stats),
                                                `label-rollup-${geometryExportStamp()}.csv`,
                                                'text/csv;charset=utf-8'
                                            )
                                        }}
                                    >
                                        Label rollup (CSV)
                                    </DropdownMenuItem>
                                ) : null}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                    <CardDescription id="lesion-label-cohort-desc">{description}</CardDescription>
                </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-6 pb-6 pt-0 text-sm">
                <TooltipProvider delayDuration={250} skipDelayDuration={120}>
                    <div
                        className="grid grid-cols-2 gap-3 sm:grid-cols-4"
                        role="group"
                        aria-label={showCc ? 'Lesion metrics' : 'Label metrics'}
                    >
                        {showCc ? (
                            <>
                                <GeometryAffineTile
                                    icon={Users}
                                    label="Cases"
                                    hint="Number of cases included in this statistics response (loaded cohort)."
                                    value={nCases}
                                    detail="Statistics run scope."
                                    tone="positive"
                                />
                                <GeometryAffineTile
                                    icon={Boxes}
                                    label="Foreground"
                                    hint="Cases with at least one 26-connected foreground component (label > 0)."
                                    value={stats.casesWithForeground}
                                    detail={
                                        stats.casesWithForeground === nCases && nCases > 0
                                            ? 'All loaded cases have mask foreground.'
                                            : `${nCases - stats.casesWithForeground} case${nCases - stats.casesWithForeground === 1 ? '' : 's'} without CC hits.`
                                    }
                                    tone={
                                        stats.casesWithForeground === nCases && nCases > 0 ? 'positive' : 'warning'
                                    }
                                />
                                <GeometryAffineTile
                                    icon={Tags}
                                    label="Components"
                                    hint="Total count of 26-connected components (label > 0) summed over all loaded cases."
                                    value={stats.totalComponents}
                                    detail="Each case can contribute multiple components."
                                    tone={stats.totalComponents > 0 ? 'positive' : 'warning'}
                                />
                                <GeometryAffineTile
                                    icon={BarChart3}
                                    label="Median vol."
                                    hint={volRangeHint}
                                    value={
                                        stats.volumeMedianMm3 != null ? formatMm3(stats.volumeMedianMm3) : '—'
                                    }
                                    detail="Component volume (mm³), cohort-wide."
                                    tone={stats.volumeMedianMm3 != null ? 'positive' : 'warning'}
                                />
                            </>
                        ) : (
                            <>
                                <GeometryAffineTile
                                    icon={Tags}
                                    label="Labels"
                                    hint="Distinct label IDs appearing in per-case mask statistics."
                                    value={nLabels}
                                    detail={nLabels > 0 ? 'IDs present in rollup.' : 'No label rows.'}
                                    tone={nLabels > 0 ? 'positive' : 'warning'}
                                />
                                <GeometryAffineTile
                                    icon={Users}
                                    label="Cases"
                                    hint="Cases in this statistics response."
                                    value={nCases}
                                    detail="Loaded cohort size."
                                    tone="positive"
                                />
                                <GeometryAffineTile
                                    icon={Layers}
                                    label="Multi-label"
                                    hint="Cases flagged as containing more than one distinct label ID in the mask."
                                    value={multiLabelCases}
                                    detail={
                                        multiLabelCases > 0
                                            ? `Case${multiLabelCases === 1 ? '' : 's'} with >1 label ID.`
                                            : 'No multi-label cases flagged.'
                                    }
                                    tone={multiLabelCases > 0 ? 'warning' : 'positive'}
                                />
                                <GeometryAffineTile
                                    icon={BarChart3}
                                    label="Max / label"
                                    hint="Maximum number of cases in which any single label ID appears (presence, not voxel count)."
                                    value={maxCasesPerLabel}
                                    detail="Largest case coverage for one ID."
                                    tone={nLabels > 0 ? 'positive' : 'warning'}
                                />
                            </>
                        )}
                    </div>
                    {showCc || showLabelRollup ? (
                        <>
                            <Separator />
                            {showCc && showLabelRollup ? (
                                <div className="grid gap-4 md:grid-cols-2 md:items-stretch md:gap-5">
                                    <section
                                        className="flex min-h-0 min-w-0 flex-col gap-3"
                                        aria-label="Lesion volume distribution"
                                    >
                                        <div>
                                            <h4 className="text-sm font-medium tracking-tight text-foreground">
                                                Lesion volume distribution
                                            </h4>
                                            <p className="mt-1 text-xs text-muted-foreground">
                                                Log-spaced mm³ bins · 26-connected foreground CCs · {segLabel}
                                            </p>
                                        </div>
                                        <div
                                            ref={lesionVolPanelRef}
                                            className="flex min-h-72 min-w-0 flex-1 flex-col rounded-xl border border-border/60 bg-muted/15 p-4"
                                        >
                                            <GeometryHistogramChart
                                                title="Lesion volume"
                                                config={chartConfig}
                                                rows={lesionHistogramRows}
                                                emptyMessage="No foreground 26-connected components for this segmentation across the loaded cohort."
                                                plainEmpty
                                                showCaption={false}
                                                showBarLabels={false}
                                                showXAxisLabel={false}
                                                tooltipMinimal
                                                tooltipEntity={{ singular: 'lesion', plural: 'lesions' }}
                                            />
                                        </div>
                                    </section>
                                    <section
                                        className="flex min-h-0 min-w-0 flex-col gap-3"
                                        aria-label="Per label statistics"
                                    >
                                        <div>
                                            <h4 className="text-sm font-medium tracking-tight text-foreground">
                                                Per label
                                            </h4>
                                            <p className="mt-1 text-xs text-muted-foreground">
                                                Mean mask volume (mm³) averaged over cases where that label appears.
                                            </p>
                                        </div>
                                        {stats.labelRollup.length === 0 ? (
                                            <div className="flex min-h-72 flex-1 items-center rounded-xl border border-border/60 px-4">
                                                <p className="text-sm text-muted-foreground">
                                                    No foreground labels.
                                                </p>
                                            </div>
                                        ) : (
                                            <div className="min-h-72 min-w-0 flex-1 overflow-hidden rounded-xl border border-border/60">
                                                <ScrollArea className="h-72">
                                                    <Table className="min-w-[20rem]">
                                                        <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
                                                            <TableRow className="border-b border-border hover:bg-transparent">
                                                                <TableHead className="pr-4">Label</TableHead>
                                                                <TableHead className="pr-4">Cases</TableHead>
                                                                <TableHead>Avg volume (mm³)</TableHead>
                                                            </TableRow>
                                                        </TableHeader>
                                                        <TableBody>
                                                            {stats.labelRollup.map((r) => (
                                                                <TableRow key={r.label}>
                                                                    <TableCell className="pr-4 tabular-nums">
                                                                        <Tooltip>
                                                                            <TooltipTrigger asChild>
                                                                                <span className="cursor-default">
                                                                                    {r.label}
                                                                                </span>
                                                                            </TooltipTrigger>
                                                                            <TooltipContent
                                                                                side="top"
                                                                                className="max-w-xs border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
                                                                            >
                                                                                Numeric label ID from the segmentation
                                                                                mask.
                                                                            </TooltipContent>
                                                                        </Tooltip>
                                                                    </TableCell>
                                                                    <TableCell className="pr-4 tabular-nums">
                                                                        {r.cases_present}
                                                                    </TableCell>
                                                                    <TableCell className="font-mono text-xs tabular-nums">
                                                                        {formatMm3(r.avg_volume_mm3)}
                                                                    </TableCell>
                                                                </TableRow>
                                                            ))}
                                                        </TableBody>
                                                    </Table>
                                                </ScrollArea>
                                            </div>
                                        )}
                                    </section>
                                </div>
                            ) : showCc ? (
                                <div className="flex flex-col gap-3">
                                    <div>
                                        <h4 className="text-sm font-medium tracking-tight text-foreground">
                                            Lesion volume distribution
                                        </h4>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            Log-spaced mm³ bins · 26-connected foreground CCs · {segLabel}
                                        </p>
                                    </div>
                                    <div
                                        ref={lesionVolPanelRef}
                                        className="min-w-0 rounded-xl border border-border/60 bg-muted/15 p-4"
                                    >
                                        <GeometryHistogramChart
                                            title="Lesion volume"
                                            config={chartConfig}
                                            rows={lesionHistogramRows}
                                            emptyMessage="No foreground 26-connected components for this segmentation across the loaded cohort."
                                            plainEmpty
                                            showCaption={false}
                                            showBarLabels={false}
                                            showXAxisLabel={false}
                                            tooltipMinimal
                                            tooltipEntity={{ singular: 'lesion', plural: 'lesions' }}
                                        />
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-3">
                                    <div>
                                        <h4 className="text-sm font-medium tracking-tight text-foreground">
                                            Per label
                                        </h4>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            Mean mask volume (mm³) averaged over cases where that label appears.
                                        </p>
                                    </div>
                                    {stats.labelRollup.length === 0 ? (
                                        <p className="text-sm text-muted-foreground">No foreground labels.</p>
                                    ) : (
                                        <div className="min-w-0 overflow-x-auto rounded-xl border border-border/60">
                                            <ScrollArea className="h-64">
                                                <Table className="min-w-[20rem]">
                                                    <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
                                                        <TableRow className="border-b border-border hover:bg-transparent">
                                                            <TableHead className="pr-4">Label</TableHead>
                                                            <TableHead className="pr-4">Cases</TableHead>
                                                            <TableHead>Avg volume (mm³)</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {stats.labelRollup.map((r) => (
                                                            <TableRow key={r.label}>
                                                                <TableCell className="pr-4 tabular-nums">
                                                                    <Tooltip>
                                                                        <TooltipTrigger asChild>
                                                                            <span className="cursor-default">
                                                                                {r.label}
                                                                            </span>
                                                                        </TooltipTrigger>
                                                                        <TooltipContent
                                                                            side="top"
                                                                            className="max-w-xs border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
                                                                        >
                                                                            Numeric label ID from the segmentation
                                                                            mask.
                                                                        </TooltipContent>
                                                                    </Tooltip>
                                                                </TableCell>
                                                                <TableCell className="pr-4 tabular-nums">
                                                                    {r.cases_present}
                                                                </TableCell>
                                                                <TableCell className="font-mono text-xs tabular-nums">
                                                                    {formatMm3(r.avg_volume_mm3)}
                                                                </TableCell>
                                                            </TableRow>
                                                        ))}
                                                    </TableBody>
                                                </Table>
                                            </ScrollArea>
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    ) : null}
                </TooltipProvider>
            </CardContent>
        </Card>
    )
}

export function DatasetLesionStatsSection({ stats }: { stats: DatasetStatisticsComputed }) {
    const inc = stats.inclusion
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

    const dimUseScatter = dimBarRows.length > GEOMETRY_CATEGORICAL_BAR_CAP
    const spacingUseScatter = spacingBarRows.length > GEOMETRY_CATEGORICAL_BAR_CAP

    // For grid scatter: X = W (in-plane), Y = D (depth); W≈H for CT so X captures FOV
    const dimScatterPts: GeomScatterPt[] = dimUseScatter
        ? stats.dimensionHistogram
              .map((r) => {
                  const t = parseGridTriplet(r.key)
                  if (!t) return null
                  return { x: t[0], y: t[2], count: r.count, label: r.key }
              })
              .filter(Boolean) as GeomScatterPt[]
        : []

    // For spacing scatter: X = mean in-plane spacing, Y = Δz (slice thickness)
    const spacingScatterPts: GeomScatterPt[] = spacingUseScatter
        ? stats.spacingHistogram.map((r) => ({
              x: (r.spacing[0] + r.spacing[1]) / 2,
              y: r.spacing[2],
              count: r.count,
              label: r.spacing.map((v) => v.toFixed(3)).join(' × '),
          }))
        : []

    const geometryDimPanelRef = useRef<HTMLDivElement>(null)
    const geometrySpacingPanelRef = useRef<HTMLDivElement>(null)

    const nCases = stats.caseCount
    const affineUniform =
        stats.spacingsAllEqual && stats.originsAllEqual && stats.directionsAllEqual
    const noGeomMismatch = stats.geometryMismatchCaseCount === 0
    const geometryAligned = affineUniform && noGeomMismatch
    const skippedCaseCount = stats.caseRows.filter((r) => r.skipped).length
    const perCaseGeomAligned = stats.geometryMismatchCaseCount === 0
    const hasCaseRows = stats.caseRows.length > 0

    return (
        <div className="space-y-4" role="region" aria-label={ariaLabel}>
            <div className="space-y-4">
                <Card
                    className="border-border/70 shadow-sm ring-1 ring-border/40"
                    aria-labelledby="geometry-ct-title"
                    aria-describedby="geometry-ct-desc"
                >
                    <CardHeader className="gap-4 pb-4 pt-6">
                        <div className="flex flex-row flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                                <CardTitle
                                    id="geometry-ct-title"
                                    className="text-lg font-semibold leading-tight tracking-tight"
                                >
                                    Geometry & alignment (CT)
                                </CardTitle>
                                <CardDescription id="geometry-ct-desc" className="mt-1">
                                    Cohort affine consistency for CT volumes and CT-to-mask alignment.
                                </CardDescription>
                            </div>
                            <div className="flex shrink-0 flex-wrap items-center gap-2">
                                <Badge
                                    variant="outline"
                                    className={cn(
                                        'tabular-nums font-medium',
                                        geometryAligned
                                            ? 'border-positive/50 text-positive'
                                            : 'border-warning/50 text-warning'
                                    )}
                                >
                                    {geometryAligned ? 'Aligned' : 'Needs review'}
                                </Badge>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon"
                                            className="shrink-0"
                                            aria-label="Download"
                                        >
                                            <Download className="h-4 w-4 shrink-0" aria-hidden />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="min-w-[14rem]">
                                        <DropdownMenuLabel>Data</DropdownMenuLabel>
                                        <DropdownMenuItem
                                            onClick={() => {
                                                const json = JSON.stringify(
                                                    buildGeometryExportJson(stats),
                                                    null,
                                                    2
                                                )
                                                downloadTextFile(
                                                    json,
                                                    `geometry-alignment-${geometryExportStamp()}.json`,
                                                    'application/json'
                                                )
                                            }}
                                        >
                                            Cohort data (JSON)
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            onClick={() => {
                                                downloadTextFile(
                                                    geometryGridCsv(stats),
                                                    `geometry-grid-sizes-${geometryExportStamp()}.csv`,
                                                    'text/csv;charset=utf-8'
                                                )
                                            }}
                                        >
                                            Grid sizes (CSV)
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            onClick={() => {
                                                downloadTextFile(
                                                    geometrySpacingCsv(stats),
                                                    `geometry-spacing-${geometryExportStamp()}.csv`,
                                                    'text/csv;charset=utf-8'
                                                )
                                            }}
                                        >
                                            Spacing triplets (CSV)
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuLabel>Images</DropdownMenuLabel>
                                        <DropdownMenuItem
                                            onClick={() => {
                                                const svg = findRechartsSvg(geometryDimPanelRef.current)
                                                if (!svg) {
                                                    toast.error('No grid chart to export')
                                                    return
                                                }
                                                void downloadSvgAsPng(
                                                    svg,
                                                    `geometry-voxel-grid-${geometryExportStamp()}.png`
                                                )
                                                    .then(() => toast.success('Chart saved'))
                                                    .catch(() => toast.error('PNG export failed'))
                                            }}
                                        >
                                            Voxel grid chart (PNG)
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            onClick={() => {
                                                const svg = findRechartsSvg(geometrySpacingPanelRef.current)
                                                if (!svg) {
                                                    toast.error('No spacing chart to export')
                                                    return
                                                }
                                                void downloadSvgAsPng(
                                                    svg,
                                                    `geometry-voxel-spacing-${geometryExportStamp()}.png`
                                                )
                                                    .then(() => toast.success('Chart saved'))
                                                    .catch(() => toast.error('PNG export failed'))
                                            }}
                                        >
                                            Voxel spacing chart (PNG)
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-6 pb-6 pt-0 text-sm">
                        <TooltipProvider delayDuration={250} skipDelayDuration={120}>
                            <div
                                className="grid grid-cols-2 gap-3 sm:grid-cols-4"
                                role="group"
                                aria-label="Affine metrics"
                            >
                                <GeometryAffineTile
                                    icon={Ruler}
                                    label="Spacing"
                                    hint="Voxel spacing (mm) is identical for every CT volume in this cohort, within floating-point tolerance."
                                    value={stats.spacingsAllEqual ? 'Uniform' : 'Varies'}
                                    detail={
                                        stats.spacingsAllEqual
                                            ? 'One spacing triplet across all CT volumes.'
                                            : `${spacingBarRows.length} spacing triplets are present.`
                                    }
                                    tone={stats.spacingsAllEqual ? 'positive' : 'warning'}
                                />
                                <GeometryAffineTile
                                    icon={Crosshair}
                                    label="Origin"
                                    hint="Physical origin (LPS, mm) matches across all CT volumes—same world coordinate frame."
                                    value={stats.originsAllEqual ? 'Uniform' : 'Varies'}
                                    detail={
                                        stats.originsAllEqual
                                            ? 'One shared LPS origin across the cohort.'
                                            : 'Volumes do not share a single world-space origin.'
                                    }
                                    tone={stats.originsAllEqual ? 'positive' : 'warning'}
                                />
                                <GeometryAffineTile
                                    icon={Compass}
                                    label="Orientation"
                                    hint="3×3 direction cosine matrix matches across volumes (same image orientation)."
                                    value={stats.directionsAllEqual ? 'Uniform' : 'Varies'}
                                    detail={
                                        stats.directionsAllEqual
                                            ? 'One direction matrix across all CT volumes.'
                                            : 'Orientation differs across at least one CT volume.'
                                    }
                                    tone={stats.directionsAllEqual ? 'positive' : 'warning'}
                                />
                                <GeometryAffineTile
                                    icon={Layers}
                                    label="CT / mask"
                                    hint="Count of cases where CT and segmentation affine grids differ. Use Per-case overview, Geom column."
                                    value={
                                        noGeomMismatch
                                            ? 'Match'
                                            : `${stats.geometryMismatchCaseCount} mismatch${stats.geometryMismatchCaseCount === 1 ? '' : 'es'}`
                                    }
                                    detail={
                                        noGeomMismatch
                                            ? 'Every CT and segmentation pair shares the same grid.'
                                            : `${stats.geometryMismatchCaseCount} case${stats.geometryMismatchCaseCount === 1 ? '' : 's'} differ in the loaded cohort.`
                                    }
                                    tone={noGeomMismatch ? 'positive' : 'warning'}
                                />
                            </div>
                            <div className="space-y-3">
                                <Separator />
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <h4 className="text-sm font-medium tracking-tight text-foreground">
                                            Cohort distributions
                                        </h4>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            Few distinct configurations: bar chart with exact counts. Many
                                            configurations: bubble scatter — each bubble is one unique size, area
                                            encodes case count.
                                        </p>
                                    </div>
                                </div>
                            </div>
                            <div className="grid gap-4 xl:grid-cols-2 xl:gap-5">
                                <div
                                    ref={geometryDimPanelRef}
                                    className="min-w-0 rounded-xl border border-border/60 bg-muted/15 p-4"
                                >
                                    {dimUseScatter ? (
                                        <GeometryScatterChart
                                            title="Voxel grid (W×H×D)"
                                            subtitle={`W vs D · bubble = case count · ${nCases} loaded`}
                                            points={dimScatterPts}
                                            xAxisLabel="W (voxels)"
                                            yAxisLabel="D (slices)"
                                            cohortSize={nCases}
                                            emptyMessage="No dimension data."
                                        />
                                    ) : (
                                        <GeometryHistogramChart
                                            title="Voxel grid (W×H×D)"
                                            subtitle={`Cases per size · ${nCases} loaded`}
                                            config={geometryDimChartConfig}
                                            rows={dimBarRows}
                                            emptyMessage="No dimension data."
                                            plainEmpty
                                            cohortSize={nCases}
                                        />
                                    )}
                                </div>
                                <div
                                    ref={geometrySpacingPanelRef}
                                    className="min-w-0 rounded-xl border border-border/60 bg-muted/15 p-4"
                                >
                                    {spacingUseScatter ? (
                                        <GeometryScatterChart
                                            title="Voxel spacing (mm)"
                                            subtitle={`In-plane vs Δz · bubble = case count · ${nCases} loaded`}
                                            points={spacingScatterPts}
                                            xAxisLabel="Δxy (mm)"
                                            yAxisLabel="Δz (mm)"
                                            cohortSize={nCases}
                                            emptyMessage="No spacing data."
                                            xFormatter={(v) => (v >= 10 ? v.toFixed(1) : v.toFixed(2))}
                                            yFormatter={(v) => (v >= 10 ? v.toFixed(1) : v.toFixed(2))}
                                        />
                                    ) : (
                                        <GeometryHistogramChart
                                            title="Voxel spacing (mm)"
                                            subtitle={`Cases per (Δx, Δy, Δz) · ${nCases} loaded`}
                                            config={geometrySpacingChartConfig}
                                            rows={spacingBarRows}
                                            emptyMessage="No spacing data."
                                            plainEmpty
                                            cohortSize={nCases}
                                        />
                                    )}
                                </div>
                            </div>
                            {showFileMeta ? (
                                <>
                                    <Separator />
                                    <div className="flex flex-col gap-3">
                                        <div>
                                            <h4 className="text-sm font-medium tracking-tight text-foreground">
                                                File metadata (≥80% coverage)
                                            </h4>
                                            <p className="mt-1 text-xs text-muted-foreground">
                                                Keys shared by most samples with identical value; MHA richer than
                                                NIfTI.
                                            </p>
                                        </div>
                                        <div className="flex flex-col gap-4 text-sm">
                                            <details className="group">
                                                <summary className="cursor-pointer text-sm font-medium">
                                                    CT headers
                                                </summary>
                                                <ul className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto font-mono text-xs break-all">
                                                    {stats.sharedCtMeta.length === 0 ? (
                                                        <li className="text-muted-foreground">None uniform</li>
                                                    ) : (
                                                        stats.sharedCtMeta.map((m) => (
                                                            <li key={m.key}>
                                                                <span className="text-muted-foreground">{m.key}</span>
                                                                ={m.value}{' '}
                                                                <span className="text-muted-foreground">
                                                                    ({Math.round(m.coverage * 100)}%)
                                                                </span>
                                                            </li>
                                                        ))
                                                    )}
                                                </ul>
                                            </details>
                                            <details className="group">
                                                <summary className="cursor-pointer text-sm font-medium">
                                                    Segmentation headers
                                                </summary>
                                                <ul className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto font-mono text-xs break-all">
                                                    {stats.sharedSegMeta.length === 0 ? (
                                                        <li className="text-muted-foreground">None uniform</li>
                                                    ) : (
                                                        stats.sharedSegMeta.map((m) => (
                                                            <li key={m.key}>
                                                                <span className="text-muted-foreground">{m.key}</span>
                                                                ={m.value}{' '}
                                                                <span className="text-muted-foreground">
                                                                    ({Math.round(m.coverage * 100)}%)
                                                                </span>
                                                            </li>
                                                        ))
                                                    )}
                                                </ul>
                                            </details>
                                            {stats.varyingMetaKeys.length > 0 ? (
                                                <p className="text-xs text-muted-foreground">
                                                    Varies across cohort:{' '}
                                                    {stats.varyingMetaKeys.map((v) => `${v.domain}:${v.key}`).join(', ')}
                                                </p>
                                            ) : null}
                                        </div>
                                    </div>
                                </>
                            ) : null}
                        </TooltipProvider>
                    </CardContent>
                </Card>
                {showCc ? (
                    <LesionLabelCohortCard
                        stats={stats}
                        showCc
                        showLabelRollup={showLabelRollup}
                        segLabel={segLabel}
                    />
                ) : null}
            </div>

            {showLabelRollup && !showCc ? (
                <LesionLabelCohortCard
                    stats={stats}
                    showCc={false}
                    showLabelRollup
                    segLabel={segLabel}
                />
            ) : null}

            <Card
                className="border-border/70 shadow-sm ring-1 ring-border/40"
                aria-labelledby="per-case-overview-title"
                aria-describedby="per-case-overview-desc"
            >
                <CardHeader className="gap-4 pb-4 pt-6">
                    <div className="flex flex-row flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                            <CardTitle
                                id="per-case-overview-title"
                                className="text-lg font-semibold leading-tight tracking-tight"
                            >
                                Per-case overview
                            </CardTitle>
                            <CardDescription id="per-case-overview-desc" className="mt-1">
                                Voxel grid size
                                {showCc ? ', largest 26-connected component (mm³)' : ''}
                                {showGlobalCt ? ', global CT mean (HU), cohort outlier scan' : ''}, and CT/mask grid
                                alignment per case.
                            </CardDescription>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                            {!hasCaseRows ? (
                                <Badge variant="secondary" className="font-medium tabular-nums">
                                    No rows
                                </Badge>
                            ) : (
                                <Badge
                                    variant="outline"
                                    className={cn(
                                        'tabular-nums font-medium',
                                        perCaseGeomAligned
                                            ? 'border-positive/50 text-positive'
                                            : 'border-warning/50 text-warning'
                                    )}
                                >
                                    {perCaseGeomAligned ? 'Aligned' : 'Needs review'}
                                </Badge>
                            )}
                            <Badge
                                variant="outline"
                                className="border-border font-medium tabular-nums text-muted-foreground"
                            >
                                {nCases} loaded
                            </Badge>
                            {skippedCaseCount > 0 ? (
                                <Badge variant="secondary" className="font-medium tabular-nums">
                                    {skippedCaseCount} skipped
                                </Badge>
                            ) : null}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="icon"
                                        className="shrink-0"
                                        aria-label="Download per-case table"
                                    >
                                        <Download className="h-4 w-4 shrink-0" aria-hidden />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="min-w-[14rem]">
                                    <DropdownMenuLabel>Data</DropdownMenuLabel>
                                    <DropdownMenuItem
                                        onClick={() => {
                                            downloadTextFile(
                                                perCaseOverviewCsv(stats, showCc, showGlobalCt),
                                                `per-case-overview-${geometryExportStamp()}.csv`,
                                                'text/csv;charset=utf-8'
                                            )
                                        }}
                                    >
                                        Per-case table (CSV)
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-6 pb-6 pt-0 text-sm">
                    <TooltipProvider delayDuration={250} skipDelayDuration={120}>
                        {!hasCaseRows ? (
                            <p className="text-sm text-muted-foreground">No cases loaded.</p>
                        ) : (
                            <>
                                <div className="min-w-0 overflow-x-auto rounded-xl border border-border/60">
                                    <ScrollArea className="h-64">
                                        <Table className="min-w-[32rem]">
                                            <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
                                                <TableRow className="border-b border-border hover:bg-transparent">
                                                    <TableHead className="pr-2">Case</TableHead>
                                                    <TableHead className="pr-2">Dims</TableHead>
                                                    {showCc ? (
                                                        <TableHead className="pr-2">Max CC</TableHead>
                                                    ) : null}
                                                    {showGlobalCt ? (
                                                        <TableHead className="pr-2">CT mean</TableHead>
                                                    ) : null}
                                                    <TableHead>Geom</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {stats.caseRows.map((row) => (
                                                    <TableRow key={row.case_id}>
                                                        <TableCell className="max-w-[10rem] pr-2 font-mono">
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <span className="block truncate tabular-nums">
                                                                        {row.case_id}
                                                                    </span>
                                                                </TooltipTrigger>
                                                                <TooltipContent
                                                                    side="top"
                                                                    className="max-w-sm border bg-popover px-3 py-2.5 text-left font-mono text-xs leading-snug text-popover-foreground shadow-md break-all"
                                                                >
                                                                    {row.case_id}
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        </TableCell>
                                                        <TableCell className="pr-2 font-mono whitespace-nowrap">
                                                            {row.dimensions.join('×')}
                                                        </TableCell>
                                                        {showCc ? (
                                                            <TableCell className="pr-2 tabular-nums">
                                                                {row.max_component_mm3 != null
                                                                    ? formatMm3(row.max_component_mm3)
                                                                    : '—'}
                                                            </TableCell>
                                                        ) : null}
                                                        {showGlobalCt ? (
                                                            <TableCell className="pr-2 tabular-nums">
                                                                {row.ct_mean != null
                                                                    ? row.ct_mean.toFixed(1)
                                                                    : '—'}
                                                            </TableCell>
                                                        ) : null}
                                                        <TableCell>
                                                            <Badge
                                                                variant="outline"
                                                                className={cn(
                                                                    'font-medium tabular-nums',
                                                                    row.geometry_match
                                                                        ? 'border-positive/50 text-positive'
                                                                        : 'border-warning/50 text-warning'
                                                                )}
                                                            >
                                                                {row.geometry_match ? 'Match' : 'Mismatch'}
                                                            </Badge>
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </ScrollArea>
                                </div>
                                {showGlobalCt ? (
                                    <>
                                        <Separator />
                                        <div className="flex flex-col gap-3">
                                            <div>
                                                <h4 className="text-sm font-medium tracking-tight text-foreground">
                                                    CT intensity outliers
                                                </h4>
                                                <p className="mt-1 text-xs text-muted-foreground">
                                                    Case-level |z| &gt; 3 vs cohort mean of full-volume CT mean
                                                    (HU-scale units), same field as the CT mean column above.
                                                </p>
                                            </div>
                                            {stats.ctMeanOutliers.length === 0 ? (
                                                <p className="text-sm text-muted-foreground">No cases flagged.</p>
                                            ) : (
                                                <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto text-sm">
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
                                        </div>
                                    </>
                                ) : null}
                            </>
                        )}
                    </TooltipProvider>
                </CardContent>
            </Card>
        </div>
    )
}

'use client'

import type { VolumeMetadata } from '@/lib/api-types'
import { Button } from './ui/button'

export interface VolumeEntry {
    title: string
    meta: VolumeMetadata
}

function formatLoadedAt(loadedAt: string): string {
    try {
        const d = new Date(loadedAt)
        return Number.isNaN(d.getTime()) ? loadedAt : d.toLocaleString()
    } catch {
        return loadedAt
    }
}

function middleEllipsis(value: string, head: number, tail: number): string {
    if (value.length <= head + tail + 1) return value
    return `${value.slice(0, head)}…${value.slice(-tail)}`
}

function StatRow({
    label,
    value,
    displayValue,
    hint,
}: {
    label: string
    value: string
    displayValue?: string
    hint?: boolean
}) {
    return (
        <div className="flex justify-between gap-4 py-1 text-xs">
            <span className="shrink-0 text-muted-foreground">{label}</span>
            <span
                className={`min-w-0 truncate text-right font-mono ${
                    hint ? 'cursor-help underline decoration-dotted underline-offset-2' : ''
                }`}
                title={value}
            >
                {displayValue ?? value}
            </span>
        </div>
    )
}

function VolumeSection({ title, meta }: VolumeEntry) {
    const dimensions = meta.dimensions.join(' × ')
    const spacing = meta.spacing.map((s) => s.toFixed(2)).join(', ')
    const origin = meta.origin.map((o) => o.toFixed(1)).join(', ')
    const sizeKb = (meta.size_bytes / 1024).toFixed(1)

    return (
        <section className="border-b border-border/60 pb-3 last:border-0 last:pb-0">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground/90">
                {title}
            </h4>
            <div className="space-y-0">
                <StatRow label="Dimensions" value={dimensions} />
                <StatRow label="Spacing (mm)" value={spacing} />
                <StatRow label="Origin (mm)" value={origin} />
                <StatRow
                    label="File"
                    value={meta.file_name}
                    displayValue={middleEllipsis(meta.file_name, 18, 14)}
                    hint
                />
                <StatRow label="Volume ID" value={meta.volume_id} />
                <StatRow label="Pixel type" value={meta.pixel_type} />
                <StatRow label="Size" value={`${sizeKb} KB`} />
                <StatRow label="Loaded" value={formatLoadedAt(meta.loaded_at)} />
            </div>
        </section>
    )
}

export interface VolumeInfoCardProps {
    volumes: VolumeEntry[]
    onClose?: () => void
}

export function VolumeInfoCard({ volumes, onClose }: VolumeInfoCardProps) {
    return (
        <div className="flex flex-col gap-3">
            <div className="rounded-xl border border-border/80 bg-card p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Volume info</h3>
                    {onClose && (
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClose}>
                            Close
                        </Button>
                    )}
                </div>
                <div className="space-y-3">
                    {volumes.map(({ title, meta }) => (
                        <VolumeSection key={meta.volume_id} title={title} meta={meta} />
                    ))}
                </div>
            </div>
        </div>
    )
}

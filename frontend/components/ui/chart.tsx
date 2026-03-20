'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

export type ChartConfig = Record<
    string,
    {
        label?: React.ReactNode
        color?: string
    }
>

function varsFromConfig(config: ChartConfig): React.CSSProperties {
    const out: Record<string, string> = {}
    let i = 0
    for (const [key, item] of Object.entries(config)) {
        const c = item.color ?? `hsl(var(--chart-${(i % 5) + 1}))`
        out[`--color-${key}`] = c
        i++
    }
    return out as React.CSSProperties
}

export function ChartContainer({
    className,
    style,
    children,
    config,
    ...props
}: React.ComponentProps<'div'> & { config: ChartConfig; children: React.ReactNode }) {
    return (
        <div
            className={cn(
                'min-h-[240px] w-full min-w-0 flex-1 [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line]:stroke-border/35 [&_.recharts-layer]:outline-none',
                className
            )}
            style={{ ...varsFromConfig(config), ...style }}
            {...props}
        >
            {children}
        </div>
    )
}

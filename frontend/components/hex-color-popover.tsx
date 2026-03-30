'use client'

import * as SliderPrimitive from '@radix-ui/react-slider'
import { PipetteIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { hexToHsv, hsvToHex } from '@/lib/color-utils'
import { cn } from '@/lib/utils'

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> }

function eyeDropperAvailable(): boolean {
    return (
        'EyeDropper' in window &&
        typeof (window as Window & { EyeDropper?: EyeDropperCtor }).EyeDropper === 'function'
    )
}

type HexColorPopoverProps = {
    value: string
    onChange: (hex: string) => void
    disabled?: boolean
    className?: string
    /** @default "Choose segmentation color" */
    ariaLabel?: string
    title?: string
}

export function HexColorPopover({
    value,
    onChange,
    disabled,
    className,
    ariaLabel,
    title,
}: HexColorPopoverProps) {
    const [open, setOpen] = useState(false)
    const [hue, setHue] = useState(0)
    const [sat, setSat] = useState(100)
    const [val, setVal] = useState(100)
    const [padDragging, setPadDragging] = useState(false)
    const [eyeDropperOk, setEyeDropperOk] = useState(false)
    const padRef = useRef<HTMLDivElement>(null)
    const hueRef = useRef(0)
    const satRef = useRef(100)
    const valRef = useRef(100)
    hueRef.current = hue
    satRef.current = sat
    valRef.current = val

    useEffect(() => setEyeDropperOk(eyeDropperAvailable()), [])

    useEffect(() => {
        if (!open) return
        const { h, s, v } = hexToHsv(value)
        setHue(h)
        setSat(s)
        setVal(v)
    }, [open, value])

    const svBg = useMemo(
        () =>
            `linear-gradient(0deg, #000, transparent), linear-gradient(90deg, #fff, hsl(${hue} 100% 50%))`,
        [hue]
    )

    const applyPad = useCallback(
        (clientX: number, clientY: number) => {
            const el = padRef.current
            if (!el) return
            const rect = el.getBoundingClientRect()
            const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
            const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
            const ns = x * 100
            const nv = (1 - y) * 100
            setSat(ns)
            setVal(nv)
            onChange(hsvToHex(hueRef.current, ns, nv))
        },
        [onChange]
    )

    useEffect(() => {
        if (!padDragging) return
        const onMove = (e: PointerEvent) => applyPad(e.clientX, e.clientY)
        const onUp = () => setPadDragging(false)
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        return () => {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
        }
    }, [padDragging, applyPad])

    const eyeDropper = async () => {
        const Ed = (window as Window & { EyeDropper?: EyeDropperCtor }).EyeDropper
        if (!Ed) return
        try {
            const { sRGBHex } = await new Ed().open()
            const { h, s, v } = hexToHsv(sRGBHex)
            setHue(h)
            setSat(s)
            setVal(v)
            onChange(hsvToHex(h, s, v))
        } catch {
            /* user cancel */
        }
    }

    const px = sat / 100
    const py = 1 - val / 100

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    disabled={disabled}
                    className={cn(
                        'h-8 w-10 shrink-0 rounded-md border border-border shadow-sm transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        disabled && 'pointer-events-none opacity-50',
                        className
                    )}
                    style={{ backgroundColor: value }}
                    aria-label={ariaLabel ?? 'Choose segmentation color'}
                    title={title}
                />
            </PopoverTrigger>
            <PopoverContent className="w-64 p-3" align="start">
                <div className="flex flex-col gap-3">
                    <div
                        ref={padRef}
                        role="presentation"
                        className="relative h-36 w-full cursor-crosshair rounded-md"
                        style={{ background: svBg }}
                        onPointerDown={(e) => {
                            e.preventDefault()
                            setPadDragging(true)
                            applyPad(e.clientX, e.clientY)
                        }}
                    >
                        <div
                            className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
                            style={{
                                left: `${px * 100}%`,
                                top: `${py * 100}%`,
                                boxShadow: '0 0 0 1px rgba(0,0,0,0.45)',
                            }}
                        />
                    </div>
                    <SliderPrimitive.Root
                        className="relative flex h-4 w-full touch-none select-none items-center"
                        min={0}
                        max={360}
                        step={1}
                        value={[hue]}
                        onValueChange={([h]) => {
                            setHue(h)
                            onChange(hsvToHex(h, satRef.current, valRef.current))
                        }}
                    >
                        <SliderPrimitive.Track className="relative my-0.5 h-3 w-full grow overflow-hidden rounded-full bg-[length:100%_100%] bg-[linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)]">
                            <SliderPrimitive.Range className="absolute h-full bg-transparent" />
                        </SliderPrimitive.Track>
                        <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border border-primary/50 bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" />
                    </SliderPrimitive.Root>
                    <div className="flex items-center gap-2">
                        {eyeDropperOk ? (
                            <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-8 w-8 shrink-0 text-muted-foreground"
                                onClick={eyeDropper}
                            >
                                <PipetteIcon className="h-4 w-4" />
                            </Button>
                        ) : null}
                        <code className="min-w-0 flex-1 truncate rounded border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
                            {value}
                        </code>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    )
}

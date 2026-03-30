'use client'

import { useViewerStore, getPairSegVolumes } from '@/lib/store'
import { shallow } from 'zustand/shallow'
import { usePairMetadata, useVolumeMetadatas } from '@/lib/api-hooks'
import { Button } from './ui/button'
import { Slider } from './ui/slider'
import { Switch } from './ui/switch'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { RotateCcw, Link, Unlink, FolderOpen, Info, ChevronDown, FileUp, BarChart3, LogOut, X } from 'lucide-react'
import { AXIS_MAP } from '@/lib/synchronization'
import { fetchFirstSliceWithMask } from '@/lib/api-client'
import type { ViewOrientation } from '@/lib/store'
import { FileUploadDialog } from './file-upload-dialog'
import { DatasetLoadDialog } from './dataset-load-dialog'
import { useState, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { VolumeMetadata } from '@/lib/api-types'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from './ui/dialog'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { useSidebar } from './ui/sidebar'

const SLIDER_DEBOUNCE_MS = 32

type PhysicalRange = { min: number; max: number }
function physicalRangeFromMetadata(meta: VolumeMetadata, orientation: ViewOrientation): PhysicalRange {
    const axis = AXIS_MAP[orientation]
    const a = meta.origin[axis]
    const b = meta.origin[axis] + meta.spacing[axis] * (meta.dimensions[axis] - 1)
    return { min: Math.min(a, b), max: Math.max(a, b) }
}

function physicalAtIndex(meta: VolumeMetadata, sliceIndex: number, orientation: ViewOrientation): number {
    const axis = AXIS_MAP[orientation]
    return meta.origin[axis] + meta.spacing[axis] * sliceIndex
}

function clamp(x: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(x, hi))
}

export function GlobalControls() {
    const pairArray = useViewerStore((state) => Array.from(state.pairs.values()), shallow)
    const synchronized = useViewerStore((state) => state.synchronized)
    const syncMode = useViewerStore((state) => state.syncMode)
    const syncRefPairId = useViewerStore((state) => state.syncRefPairId)
    const snapToMask = useViewerStore((state) => state.snapToMask)
    const setSynchronized = useViewerStore((state) => state.setSynchronized)
    const setSnapToMask = useViewerStore((state) => state.setSnapToMask)
    const setGlobalSlicePhysical = useViewerStore((state) => state.setGlobalSlicePhysical)
    const setGlobalSliceNormalized = useViewerStore((state) => state.setGlobalSliceNormalized)
    const globalSliceNormalized = useViewerStore((state) => state.globalSliceNormalized)
    const setSyncMode = useViewerStore((state) => state.setSyncMode)
    const setSyncRefPairId = useViewerStore((state) => state.setSyncRefPairId)
    const updatePairSlice = useViewerStore((state) => state.updatePairSlice)
    const updatePairOrientation = useViewerStore((state) => state.updatePairOrientation)
    const resetPairView = useViewerStore((state) => state.resetPairView)
    const datasetCase = useViewerStore((state) => state.datasetCase)
    const cleanDatasetMode = useViewerStore((state) => state.cleanDatasetMode)
    const setCleanDatasetMode = useViewerStore((state) => state.setCleanDatasetMode)
    const gridColumns = useViewerStore((state) => state.gridColumns)
    const setGridColumns = useViewerStore((state) => state.setGridColumns)
    const viewMode = useViewerStore((state) => state.viewMode)
    const setViewMode = useViewerStore((state) => state.setViewMode)
    const setDatasetCase = useViewerStore((state) => state.setDatasetCase)
    const setDatasetLesionStats = useViewerStore((state) => state.setDatasetLesionStats)
    const pairControlsExpanded = useViewerStore((state) => state.pairControlsExpanded)
    const setAllPairsControlsExpanded = useViewerStore((state) => state.setAllPairsControlsExpanded)
    const globalSlicePhysical = useViewerStore((state) => state.globalSlicePhysical)

    const [sliderValue, setSliderValue] = useState(0)
    const [syncDirectionDialogOpen, setSyncDirectionDialogOpen] = useState(false)
    const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
    const [datasetDialogOpen, setDatasetDialogOpen] = useState(false)
    const [datasetDialogMode, setDatasetDialogMode] = useState<'load' | 'stats'>('load')
    const [openDataHelpOpen, setOpenDataHelpOpen] = useState(false)
    const [cleanInfoOpen, setCleanInfoOpen] = useState(false)
    const [syncInfoOpen, setSyncInfoOpen] = useState(false)
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const rangeCacheRef = useRef<{ key: string; range: PhysicalRange } | null>(null)
    const { state, isMobile } = useSidebar()
    const sidebarCollapsed = state === 'collapsed' && !isMobile

    const hasPairs = pairArray.length > 0
    const firstPair = pairArray[0] ?? null
    const orientation = firstPair?.orientation ?? 'axial'
    const { data: firstPairMetadata } = usePairMetadata(firstPair?.pairId ?? null)
    const ctVolumeIds = pairArray.map((p) => p.ctVolumeId)
    const ctMetaQueries = useVolumeMetadatas(ctVolumeIds)
    const ctMetas = ctMetaQueries.map((q) => q.data ?? null)

    const allSameOrientation = hasPairs && new Set(pairArray.map((p) => p.orientation ?? 'axial')).size === 1

    useEffect(() => {
        rangeCacheRef.current = null
    }, [orientation, hasPairs, pairArray.length, syncMode, syncRefPairId])

    useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

    const ranges = (() => {
        if (!hasPairs) return null
        const out: { pairId: string; meta: VolumeMetadata; range: PhysicalRange }[] = []
        for (let i = 0; i < pairArray.length; i++) {
            const meta = ctMetas[i]
            if (!meta) return null
            out.push({ pairId: pairArray[i].pairId, meta, range: physicalRangeFromMetadata(meta, orientation) })
        }
        return out
    })()

    const overlapRange = (() => {
        if (!ranges || ranges.length === 0) return null
        let min = -Infinity
        let max = Infinity
        for (const r of ranges) {
            if (r.range.min > min) min = r.range.min
            if (r.range.max < max) max = r.range.max
        }
        if (!(max > min)) return null
        return { min, max }
    })()

    const unionRange = (() => {
        if (!ranges || ranges.length === 0) return null
        let min = Infinity
        let max = -Infinity
        for (const r of ranges) {
            if (r.range.min < min) min = r.range.min
            if (r.range.max > max) max = r.range.max
        }
        if (!(max > min)) return null
        return { min, max }
    })()

    const refRange = (() => {
        if (!ranges || ranges.length === 0) return null
        const refId = syncRefPairId ?? ranges[0].pairId
        const hit = ranges.find((r) => r.pairId === refId) ?? ranges[0]
        return hit.range
    })()

    const currentRange = (() => {
        if (syncMode === 'overlap') return overlapRange
        if (syncMode === 'reference') return refRange
        return null
    })()
    const rangeMin = currentRange?.min ?? null
    const rangeMax = currentRange?.max ?? null

    const rangeKey = `${syncMode}:${syncRefPairId ?? ''}:${orientation}:${pairArray.map((p) => p.pairId).sort().join('|')}`

    const outOfRangeCount = (() => {
        if (!synchronized || globalSlicePhysical === null || !ranges) return 0
        if (syncMode !== 'reference') return 0
        let n = 0
        for (const r of ranges) {
            if (globalSlicePhysical < r.range.min || globalSlicePhysical > r.range.max) n += 1
        }
        return n
    })()

    useEffect(() => {
        if (!synchronized || syncMode !== 'overlap' && syncMode !== 'reference') return
        if (rangeMin === null || rangeMax === null || globalSlicePhysical === null) return
        const range = { min: rangeMin, max: rangeMax }
        rangeCacheRef.current = { key: rangeKey, range }
        const r = range.max - range.min
        const phys = clamp(globalSlicePhysical, range.min, range.max)
        if (phys !== globalSlicePhysical) setGlobalSlicePhysical(phys)
        setSliderValue(r !== 0 ? Math.round(((phys - range.min) / r) * 100) : 0)
    }, [synchronized, syncMode, rangeMin, rangeMax, rangeKey, globalSlicePhysical, setGlobalSlicePhysical])

    useEffect(() => {
        if (!synchronized || syncMode !== 'union' || globalSliceNormalized === null) return
        setSliderValue(Math.round(globalSliceNormalized * 100))
    }, [synchronized, syncMode, globalSliceNormalized])

    const applyPhysicalFromSliderValue = (percent: number) => {
        if (rangeMin === null || rangeMax === null) return
        const phys = rangeMin + (percent / 100) * (rangeMax - rangeMin)
        setGlobalSlicePhysical(phys)
    }

    const runSyncOnInit = (fp: (typeof pairArray)[0], ori: ViewOrientation) => {
        try {
            const meta =
                ctMetas[pairArray.findIndex((p) => p.pairId === fp.pairId)] ??
                firstPairMetadata?.ct_metadata ??
                null
            if (!meta) {
                toast.error('Synchronization failed', { description: 'Volume metadata not available yet' })
                return
            }
            if (syncMode === 'union') {
                const axis = AXIS_MAP[ori]
                const maxIdx = meta.dimensions[axis] - 1
                const frac = maxIdx > 0 ? fp.currentSliceIndex / maxIdx : 0
                setGlobalSlicePhysical(null)
                setGlobalSliceNormalized(frac)
                setSliderValue(Math.round(frac * 100))
                return
            }
            const range = currentRange
            if (!range) {
                toast.error('Synchronization failed', { description: 'Could not compute a shared slice range' })
                return
            }
            rangeCacheRef.current = { key: rangeKey, range }
            const physicalPosition = clamp(physicalAtIndex(meta, fp.currentSliceIndex, ori), range.min, range.max)
            setGlobalSlicePhysical(physicalPosition)
            const r = range.max - range.min
            setSliderValue(r !== 0 ? Math.round(((physicalPosition - range.min) / r) * 100) : 0)
            toast.success('Synchronization enabled', { description: 'All panels are now synchronized' })
        } catch (e) {
            console.error('Failed to initialize synchronization:', e)
            toast.error('Synchronization failed', { description: 'Could not enable synchronization' })
        }
    }

    const handleSyncToggle = async (checked: boolean) => {
        if (!checked) {
            setSynchronized(false)
            setGlobalSlicePhysical(null)
            setGlobalSliceNormalized(null)
            toast.info('Synchronization disabled', { description: 'Panels can now be controlled independently' })
            return
        }
        if (!hasPairs) return
        if (!allSameOrientation) {
            setSyncDirectionDialogOpen(true)
            return
        }
        if (syncMode === 'union') {
            const axis = AXIS_MAP[orientation]
            const counts = ctMetas.map((m) => m?.dimensions?.[axis]).filter((n): n is number => typeof n === 'number')
            if (counts.length === pairArray.length && new Set(counts).size > 1) {
                toast.info('Different slice counts', { description: 'Panels will scrub at different speeds.' })
            }
        } else if (syncMode === 'overlap') {
            if (!overlapRange && unionRange) {
                setSyncMode('reference')
                setSyncRefPairId(firstPair?.pairId ?? null)
                toast.info('No shared overlap', { description: 'Volumes do not overlap in physical space. Using reference range instead.' })
            } else if (overlapRange && unionRange) {
                const ov = overlapRange.max - overlapRange.min
                const un = unionRange.max - unionRange.min
                if (un > 0 && ov < un - 1e-6) {
                    toast.info('Using shared overlap', { description: 'Volumes have different origins. Global slider is limited to the region all panels share.' })
                }
            }
        } else {
            toast.info('Sync range may clamp', { description: 'Some panels may hit their start/end when volumes have different origins.' })
        }
        setSynchronized(true)
        const ref =
            syncMode === 'reference'
                ? (pairArray.find((p) => p.pairId === (syncRefPairId ?? pairArray[0]?.pairId)) ?? firstPair!)
                : firstPair!
        runSyncOnInit(ref, orientation)
    }

    const handleSetAllAxialAndSync = async () => {
        setSyncDirectionDialogOpen(false)
        pairArray.forEach((p) => updatePairOrientation(p.pairId, 'axial'))
        setSynchronized(true)
        if (syncMode === 'overlap') {
            if (!overlapRange && unionRange) {
                setSyncMode('union')
                toast.info('No shared overlap', { description: 'Volumes do not overlap in physical space. Using union range instead.' })
            } else if (overlapRange && unionRange) {
                const ov = overlapRange.max - overlapRange.min
                const un = unionRange.max - unionRange.min
                if (un > 0 && ov < un - 1e-6) {
                    toast.info('Using shared overlap', { description: 'Volumes have different origins. Global slider is limited to the region all panels share.' })
                }
            }
        } else {
            toast.info('Sync range may clamp', { description: 'Some panels may hit their start/end when volumes have different origins.' })
        }
        const fp = firstPair!
        const ori = 'axial' as ViewOrientation
        runSyncOnInit(fp, ori)
    }

    const handleSliderChange = (value: number[]) => {
        const v = value[0]
        setSliderValue(v)
        if (!synchronized || !firstPair) return
        if (syncMode === 'union') {
            setGlobalSliceNormalized(v / 100)
            return
        }
        const cached = rangeCacheRef.current
        const hit = cached?.key === rangeKey
        const range = hit ? cached!.range : currentRange
        if (range) {
            setGlobalSlicePhysical(range.min + (v / 100) * (range.max - range.min))
        }
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => {
            debounceRef.current = null
            if (!range) applyPhysicalFromSliderValue(v)
        }, SLIDER_DEBOUNCE_MS)
    }

    const handleSliderCommit = (value: number[]) => {
        if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null }
        if (!synchronized || !hasPairs || !firstPair) return
        if (syncMode === 'union') {
            setGlobalSliceNormalized(value[0] / 100)
            return
        }
        applyPhysicalFromSliderValue(value[0])
    }

    const handleGlobalReset = async () => {
        pairArray.forEach((p) => resetPairView(p.pairId))
        if (synchronized && firstPair) {
            if (syncMode === 'union') {
                setGlobalSliceNormalized(0)
                setSliderValue(0)
            } else {
                const range = currentRange ?? rangeCacheRef.current?.range ?? null
                if (range) setGlobalSlicePhysical(range.min)
                setSliderValue(0)
            }
        }
        toast.success('All views reset', { description: `Reset ${pairArray.length} panel${pairArray.length !== 1 ? 's' : ''}` })
    }

    const handleLeaveDataset = () => {
        setViewMode('pairs')
        setDatasetCase(null)
        toast.info('Left dataset mode')
    }

    const handleCloseStatistics = () => {
        setDatasetLesionStats(null)
        setViewMode('pairs')
        toast.info('Statistics closed')
    }

    const handleSnapToMaskToggle = async (checked: boolean) => {
        setSnapToMask(checked)
        if (checked && viewMode === 'pairs' && hasPairs) {
            try {
                const ori = orientation
                const results = await Promise.all(
                    pairArray.map(async (p) => {
                        const segs = getPairSegVolumes(p)
                        const firstSeg = segs[0]
                        const data = firstSeg
                            ? await fetchFirstSliceWithMask(firstSeg.volumeId, p.orientation ?? 'axial', true)
                            : { slice_index: 0 }
                        return { pairId: p.pairId, slice_index: data.slice_index }
                    })
                )
                results.forEach(({ pairId, slice_index }) => updatePairSlice(pairId, slice_index))
                if (synchronized && firstPair) {
                    const first = results.find((r) => r.pairId === firstPair.pairId)
                    if (first) {
                        const meta =
                            ctMetas[pairArray.findIndex((p) => p.pairId === firstPair.pairId)] ??
                            firstPairMetadata?.ct_metadata ??
                            null
                        const range = currentRange ?? rangeCacheRef.current?.range ?? null
                        if (!meta || !range) return
                        const physicalPosition = clamp(physicalAtIndex(meta, first.slice_index, ori), range.min, range.max)
                        setGlobalSlicePhysical(physicalPosition)
                        rangeCacheRef.current = { key: rangeKey, range }
                        const r = range.max - range.min
                        setSliderValue(r !== 0 ? Math.round(((physicalPosition - range.min) / r) * 100) : 0)
                    }
                }
                toast.success('Snap to mask on', { description: 'All panels moved to middle of first mask' })
            } catch (e) {
                console.error('Failed to snap to mask:', e)
                toast.error('Could not snap to mask', { description: e instanceof Error ? e.message : 'Unknown error' })
            }
        }
    }

    return (
        <div
            className={cn(
                'space-y-6',
                sidebarCollapsed && 'flex flex-col items-center space-y-0 gap-3'
            )}
        >
            {viewMode === 'dataset' ? (
                sidebarCollapsed ? (
                    <div className="flex flex-col items-center gap-2">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    onClick={handleLeaveDataset}
                                    aria-label="Leave dataset mode"
                                >
                                    <LogOut className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="right">Leave dataset mode</TooltipContent>
                        </Tooltip>
                    </div>
                ) : (
                <div className="space-y-3">
                    <Button
                        className="w-full gap-2"
                        variant="outline"
                        onClick={handleLeaveDataset}
                    >
                        Leave dataset mode
                    </Button>
                    <div className="flex min-h-9 items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Label htmlFor="clean-dataset" className="cursor-pointer text-sm">
                                Clean dataset mode
                            </Label>
                            <Dialog open={cleanInfoOpen} onOpenChange={setCleanInfoOpen}>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    onClick={() => setCleanInfoOpen(true)}
                                    aria-label="Clean dataset mode info"
                                >
                                    <Info className="h-4 w-4" />
                                </Button>
                                <DialogContent className="sm:max-w-[520px]">
                                    <DialogHeader>
                                        <DialogTitle>Clean dataset mode</DialogTitle>
                                    </DialogHeader>
                                    <div className="space-y-3 text-sm text-muted-foreground">
                                        <div>
                                            <div className="font-medium text-foreground">Goal</div>
                                            <div>Review each case and keep only the clean set without duplicating data.</div>
                                        </div>
                                        <div>
                                            <div className="font-medium text-foreground">What happens</div>
                                            <ul className="list-disc pl-5 space-y-1">
                                                <li>Accepted cases stay in the original dataset folders.</li>
                                                <li>
                                                    Rejected cases are moved to sibling folders:
                                                    <div className="mt-1 font-mono text-xs">
                                                        images_rejected/<br />
                                                        segmentations_rejected/
                                                    </div>
                                                </li>
                                            </ul>
                                        </div>
                                        <div>
                                            <div className="font-medium text-foreground">Why this works</div>
                                            <ul className="list-disc pl-5 space-y-1">
                                                <li>No duplicate data is created.</li>
                                                <li>Rejected samples remain safely stored and recoverable.</li>
                                            </ul>
                                        </div>
                                    </div>
                                </DialogContent>
                            </Dialog>
                        </div>
                        <Switch
                            id="clean-dataset"
                            checked={cleanDatasetMode}
                            onCheckedChange={setCleanDatasetMode}
                        />
                    </div>
                    {datasetCase && datasetCase.segVolumes.length > 0 && (
                        <div className="flex min-h-9 items-center justify-between">
                            <Label htmlFor="snap-dataset" className="cursor-pointer text-sm">
                                Snap to mask
                            </Label>
                            <Switch
                                id="snap-dataset"
                                checked={snapToMask}
                                onCheckedChange={setSnapToMask}
                            />
                        </div>
                    )}
                </div>
                )
            ) : (
                <>
                    <FileUploadDialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen} />
                    <DatasetLoadDialog
                        open={datasetDialogOpen}
                        onOpenChange={(o) => {
                            setDatasetDialogOpen(o)
                            if (!o) setDatasetDialogMode('load')
                        }}
                        mode={datasetDialogMode}
                    />
                    {sidebarCollapsed ? (
                        <div className="flex flex-col items-center gap-2">
                            <DropdownMenu>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <DropdownMenuTrigger asChild>
                                            <Button
                                                type="button"
                                                size="icon"
                                                variant="outline"
                                                aria-label="Open data menu"
                                            >
                                                <FolderOpen className="h-4 w-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                    </TooltipTrigger>
                                    <TooltipContent side="right">Open data</TooltipContent>
                                </Tooltip>
                                <DropdownMenuContent align="start" side="right" className="min-w-[14rem]">
                                    <DropdownMenuItem
                                        className="cursor-pointer flex-col items-start gap-0.5 py-2"
                                        onSelect={() => setUploadDialogOpen(true)}
                                    >
                                        <span className="flex items-center gap-2 font-medium">
                                            <FileUp className="h-4 w-4 shrink-0" />
                                            Open single scan
                                        </span>
                                        <span className="pl-6 text-xs font-normal text-muted-foreground">
                                            One CT volume; optional label maps
                                        </span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        className="cursor-pointer flex-col items-start gap-0.5 py-2"
                                        onSelect={() => {
                                            setDatasetDialogMode('load')
                                            setDatasetDialogOpen(true)
                                        }}
                                    >
                                        <span className="flex items-center gap-2 font-medium">
                                            <FolderOpen className="h-4 w-4 shrink-0" />
                                            Open dataset
                                        </span>
                                        <span className="pl-6 text-xs font-normal text-muted-foreground">
                                            Folders of cases on disk
                                        </span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        className="cursor-pointer flex-col items-start gap-0.5 py-2"
                                        onSelect={() => {
                                            setDatasetDialogMode('stats')
                                            setDatasetDialogOpen(true)
                                        }}
                                    >
                                        <span className="flex items-center gap-2 font-medium">
                                            <BarChart3 className="h-4 w-4 shrink-0" />
                                            Calculate dataset statistics
                                        </span>
                                        <span className="pl-6 text-xs font-normal text-muted-foreground">
                                            Lesion size distribution (connected components)
                                        </span>
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                            {viewMode === 'datasetStats' && (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon"
                                            onClick={handleCloseStatistics}
                                            aria-label="Close statistics"
                                        >
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="right">Close statistics</TooltipContent>
                                </Tooltip>
                            )}
                        </div>
                    ) : (
                        <>
                            <div className="flex min-h-9 w-full items-center">
                                <div className="flex w-full items-center gap-2">
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button type="button" className="w-full gap-2" variant="outline">
                                                <FolderOpen className="h-4 w-4 shrink-0" />
                                                Open
                                                <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="start" className="min-w-[var(--radix-dropdown-menu-trigger-width)]">
                                            <DropdownMenuItem
                                                className="cursor-pointer flex-col items-start gap-0.5 py-2"
                                                onSelect={() => setUploadDialogOpen(true)}
                                            >
                                                <span className="flex items-center gap-2 font-medium">
                                                    <FileUp className="h-4 w-4 shrink-0" />
                                                    Open single scan
                                                </span>
                                                <span className="pl-6 text-xs font-normal text-muted-foreground">
                                                    One CT volume; optional label maps
                                                </span>
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                className="cursor-pointer flex-col items-start gap-0.5 py-2"
                                                onSelect={() => {
                                                    setDatasetDialogMode('load')
                                                    setDatasetDialogOpen(true)
                                                }}
                                            >
                                                <span className="flex items-center gap-2 font-medium">
                                                    <FolderOpen className="h-4 w-4 shrink-0" />
                                                    Open dataset
                                                </span>
                                                <span className="pl-6 text-xs font-normal text-muted-foreground">
                                                    Folders of cases on disk
                                                </span>
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                className="cursor-pointer flex-col items-start gap-0.5 py-2"
                                                onSelect={() => {
                                                    setDatasetDialogMode('stats')
                                                    setDatasetDialogOpen(true)
                                                }}
                                            >
                                                <span className="flex items-center gap-2 font-medium">
                                                    <BarChart3 className="h-4 w-4 shrink-0" />
                                                    Calculate dataset statistics
                                                </span>
                                                <span className="pl-6 text-xs font-normal text-muted-foreground">
                                                    Lesion size distribution (connected components)
                                                </span>
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-9 w-9 shrink-0"
                                        onClick={() => setOpenDataHelpOpen(true)}
                                        aria-label="How opening data works"
                                    >
                                        <Info className="h-4 w-4" />
                                    </Button>
                                    <Dialog open={openDataHelpOpen} onOpenChange={setOpenDataHelpOpen}>
                                        <DialogContent className="sm:max-w-[520px] max-h-[85vh] overflow-y-auto">
                                            <DialogHeader>
                                                <DialogTitle>Opening data</DialogTitle>
                                            </DialogHeader>
                                            <div className="space-y-6 text-sm text-muted-foreground">
                                                <div className="space-y-2">
                                                    <div className="font-medium text-foreground">Open single scan</div>
                                                    <div>Pick one CT volume for a quick look; add up to 20 segmentations if you want.</div>
                                                    <div className="font-medium text-foreground">Formats</div>
                                                    <div className="font-mono text-xs">.nii, .nii.gz, .mha, .mhd</div>
                                                </div>
                                                <div className="space-y-2">
                                                    <div className="font-medium text-foreground">Open dataset</div>
                                                    <div>Browse many cases from folders; inspect CT, labels, and predictions case by case.</div>
                                                    <ul className="list-disc pl-5 space-y-1">
                                                        <li>Images folder is required.</li>
                                                        <li>Labels and predictions are optional.</li>
                                                        <li>Cases are matched by base name (nnUNet naming supported).</li>
                                                    </ul>
                                                </div>
                                            </div>
                                        </DialogContent>
                                    </Dialog>
                                </div>
                            </div>
                            {viewMode === 'datasetStats' && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="w-full"
                                    onClick={handleCloseStatistics}
                                >
                                    Close statistics
                                </Button>
                            )}
                        </>
                    )}
                </>
            )}

            {/* Columns per row (pairs + data loaded) */}
            {viewMode === 'pairs' && hasPairs && !sidebarCollapsed && (
                <div className="min-h-9 space-y-2">
                    <Label htmlFor="grid-columns" className="text-sm">
                        Columns per row
                    </Label>
                    <Slider
                        id="grid-columns"
                        min={1}
                        max={4}
                        step={1}
                        value={[gridColumns]}
                        onValueChange={(v) => setGridColumns(v[0])}
                        className="w-full"
                    />
                    <p className="text-xs text-muted-foreground">{gridColumns} column{gridColumns !== 1 ? 's' : ''}</p>
                </div>
            )}

            {viewMode === 'pairs' && hasPairs && !sidebarCollapsed && (
                <>
                    <div className="flex min-h-9 items-center justify-between">
                        <div className="flex items-center gap-2">
                            {synchronized ? (
                                <Link className="h-4 w-4 text-primary" />
                            ) : (
                                <Unlink className="h-4 w-4 text-muted-foreground" />
                            )}
                            <Label htmlFor="global-sync" className="cursor-pointer">
                                Synchronize Panels
                            </Label>
                            <Dialog open={syncInfoOpen} onOpenChange={setSyncInfoOpen}>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    onClick={() => setSyncInfoOpen(true)}
                                    aria-label="Synchronization info"
                                >
                                    <Info className="h-4 w-4" />
                                </Button>
                                <DialogContent className="sm:max-w-[520px]">
                                    <DialogHeader>
                                        <DialogTitle>Synchronization</DialogTitle>
                                    </DialogHeader>
                                    <div className="space-y-3 text-sm text-muted-foreground">
                                        <div>
                                            <div className="font-medium text-foreground">What it does</div>
                                            <div>
                                                The global slider controls slice position in physical space (mm), not “slice number”.
                                            </div>
                                        </div>
                                        <div>
                                            <div className="font-medium text-foreground">Range modes</div>
                                            <ul className="list-disc pl-5 space-y-1">
                                                <li><span className="text-foreground">Shared overlap</span>: physical-mm sync over the region all panels share (best default).</li>
                                                <li><span className="text-foreground">All slices</span>: sync by normalized slice position (0–100%). Panels with fewer slices scrub faster.</li>
                                                <li><span className="text-foreground">Reference</span>: physical-mm sync over one panel’s full range; other panels clamp when out of range.</li>
                                            </ul>
                                        </div>
                                        <div>
                                            <div className="font-medium text-foreground">Shared range</div>
                                            <div>
                                                When volumes have different origins, not every physical position exists in every volume.
                                                While synced, the slider uses only the overlapping physical range so every panel updates.
                                            </div>
                                        </div>
                                        <div>
                                            <div className="font-medium text-foreground">Tip</div>
                                            <div>
                                                If a volume is cropped or shifted, syncing still works, but you will only scrub through the region all volumes share.
                                            </div>
                                        </div>
                                    </div>
                                </DialogContent>
                            </Dialog>
                        </div>
                        <Switch
                            id="global-sync"
                            checked={synchronized}
                            onCheckedChange={handleSyncToggle}
                        />
                    </div>

                    <div className="space-y-2">
                            <Label className="text-sm">Sync range</Label>
                            <div className="flex items-center gap-2">
                                <Select
                                    value={syncMode}
                                    onValueChange={(v) => setSyncMode(v as 'overlap' | 'union' | 'reference')}
                                >
                                    <SelectTrigger className="h-9">
                                        <SelectValue />
                                    </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="overlap">Shared overlap</SelectItem>
                                    <SelectItem value="union">All slices</SelectItem>
                                    <SelectItem value="reference">Reference</SelectItem>
                                </SelectContent>
                            </Select>
                                {syncMode === 'reference' && (
                                    <Select
                                        value={syncRefPairId ?? (pairArray[0]?.pairId ?? '')}
                                        onValueChange={(v) => setSyncRefPairId(v)}
                                    >
                                        <SelectTrigger className="h-9 w-[180px]">
                                            <SelectValue placeholder="Reference panel" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {pairArray.map((p) => (
                                                <SelectItem key={p.pairId} value={p.pairId}>
                                                    Pair {p.pairId.slice(0, 8)}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                            </div>
                            {synchronized && syncMode !== 'overlap' && outOfRangeCount > 0 && (
                                <p className="text-xs text-muted-foreground">
                                    {outOfRangeCount} panel{outOfRangeCount !== 1 ? 's' : ''} out of range (clamped)
                                </p>
                            )}
                    </div>

                    <div className="flex min-h-9 items-center justify-between">
                            <Label htmlFor="snap-pairs" className="cursor-pointer text-sm">
                                Snap to mask
                            </Label>
                            <Switch
                                id="snap-pairs"
                                checked={snapToMask}
                                onCheckedChange={handleSnapToMaskToggle}
                            />
                    </div>

                    <div className="flex min-h-9 items-center justify-between">
                            <Label htmlFor="show-pair-controls" className="cursor-pointer text-sm">
                                Show controls
                            </Label>
                            <Switch
                                id="show-pair-controls"
                                checked={pairArray.every((p) => pairControlsExpanded.get(p.pairId) !== false)}
                                onCheckedChange={setAllPairsControlsExpanded}
                            />
                    </div>

                    <div className="min-h-9 space-y-2">
                        <Label htmlFor="global-slice" className="text-sm">
                            Global Slice Position
                        </Label>
                        <Slider
                            id="global-slice"
                            min={0}
                            max={100}
                            step={1}
                            value={[sliderValue]}
                            onValueChange={handleSliderChange}
                            onValueCommit={handleSliderCommit}
                            disabled={!synchronized}
                            className="w-full"
                        />
                        <p className="text-xs text-muted-foreground">
                            {synchronized
                                ? `Position: ${sliderValue}%`
                                : 'Enable synchronization to use global slice control'}
                        </p>
                    </div>

                    <div className="flex min-h-9 items-center justify-between">
                        <Label className="text-sm">Reset All Views</Label>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleGlobalReset}
                            className="gap-2"
                        >
                            <RotateCcw className="h-4 w-4" />
                            Reset All
                        </Button>
                    </div>
                </>
            )}

            {/* Status Info */}
            {viewMode === 'pairs' && !hasPairs && !sidebarCollapsed && (
                <p className="text-xs text-muted-foreground text-center pt-2 border-t">
                    Load pairs, a dataset, or run statistics from Open
                </p>
            )}
            {viewMode === 'pairs' && hasPairs && !sidebarCollapsed && (
                <p className="text-xs text-muted-foreground text-center pt-2 border-t">
                    Controlling {pairArray.length} panel{pairArray.length !== 1 ? 's' : ''}
                </p>
            )}
            {viewMode === 'dataset' && !sidebarCollapsed && (
                <p className="text-xs text-muted-foreground text-center pt-2 border-t">
                    Dataset inspection mode — use arrows in main view to navigate
                </p>
            )}
            {viewMode === 'datasetStats' && !sidebarCollapsed && (
                <p className="text-xs text-muted-foreground text-center pt-2 border-t">
                    Statistics only — open a dataset separately to browse cases
                </p>
            )}

            <Dialog open={syncDirectionDialogOpen} onOpenChange={setSyncDirectionDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Different viewing directions</DialogTitle>
                        <DialogDescription>
                            Synchronization requires all panels to use the same viewing direction. Set all panels to Axial and enable sync?
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button variant="outline" onClick={() => setSyncDirectionDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleSetAllAxialAndSync}>
                            Set all to Axial and sync
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

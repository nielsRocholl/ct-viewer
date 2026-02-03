'use client'

import { useViewerStore, getPairSegVolumes } from '@/lib/store'
import { usePairMetadata } from '@/lib/api-hooks'
import { Button } from './ui/button'
import { Slider } from './ui/slider'
import { Switch } from './ui/switch'
import { Label } from './ui/label'
import { RotateCcw, Link, Unlink, Upload, FolderOpen } from 'lucide-react'
import { AXIS_MAP, convertIndexToPhysical } from '@/lib/synchronization'
import { fetchFirstSliceWithMask } from '@/lib/api-client'
import type { ViewOrientation } from '@/lib/store'
import { FileUploadDialog } from './file-upload-dialog'
import { DatasetLoadDialog } from './dataset-load-dialog'
import { useState, useRef, useEffect } from 'react'
import { toast } from 'sonner'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from './ui/dialog'

const SLIDER_DEBOUNCE_MS = 32

type PhysicalRange = { min: number; max: number }

async function getPhysicalRange(
    pairId: string,
    maxSliceIndex: number,
    orientation: ViewOrientation = 'axial'
): Promise<PhysicalRange> {
    const [min, max] = await Promise.all([
        convertIndexToPhysical(pairId, 0, orientation),
        convertIndexToPhysical(pairId, maxSliceIndex, orientation),
    ])
    return { min, max }
}

export function GlobalControls() {
    const pairs = useViewerStore((state) => state.pairs)
    const synchronized = useViewerStore((state) => state.synchronized)
    const snapToMask = useViewerStore((state) => state.snapToMask)
    const setSynchronized = useViewerStore((state) => state.setSynchronized)
    const setSnapToMask = useViewerStore((state) => state.setSnapToMask)
    const setGlobalSlicePhysical = useViewerStore((state) => state.setGlobalSlicePhysical)
    const updatePairSlice = useViewerStore((state) => state.updatePairSlice)
    const updatePairOrientation = useViewerStore((state) => state.updatePairOrientation)
    const resetPairView = useViewerStore((state) => state.resetPairView)
    const datasetCase = useViewerStore((state) => state.datasetCase)
    const gridColumns = useViewerStore((state) => state.gridColumns)
    const setGridColumns = useViewerStore((state) => state.setGridColumns)
    const viewMode = useViewerStore((state) => state.viewMode)
    const setViewMode = useViewerStore((state) => state.setViewMode)
    const setDatasetCase = useViewerStore((state) => state.setDatasetCase)

    const [sliderValue, setSliderValue] = useState(0)
    const [syncDirectionDialogOpen, setSyncDirectionDialogOpen] = useState(false)
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const rangeCacheRef = useRef<{ pairId: string; maxIdx: number; ori: ViewOrientation; range: PhysicalRange } | null>(null)

    const pairArray = Array.from(pairs.values())
    const hasPairs = pairArray.length > 0
    const firstPair = pairArray[0] ?? null
    const orientation = firstPair?.orientation ?? 'axial'
    const { data: firstPairMetadata } = usePairMetadata(firstPair?.pairId ?? null)
    const maxSliceIndex =
        firstPairMetadata?.ct_metadata.dimensions[AXIS_MAP[orientation]] != null
            ? firstPairMetadata.ct_metadata.dimensions[AXIS_MAP[orientation]] - 1
            : 99

    const allSameOrientation = hasPairs && new Set(pairArray.map((p) => p.orientation ?? 'axial')).size === 1

    useEffect(() => {
        rangeCacheRef.current = null
    }, [firstPair?.pairId, maxSliceIndex, orientation])

    useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

    const applyPhysicalFromSliderValue = async (percent: number) => {
        if (!firstPair) return
        const key = { pairId: firstPair.pairId, maxIdx: maxSliceIndex, ori: orientation }
        const cached = rangeCacheRef.current
        const hit = cached?.pairId === key.pairId && cached?.maxIdx === key.maxIdx && cached?.ori === key.ori
        let range = hit ? cached!.range : null
        if (!range) {
            try {
                range = await getPhysicalRange(firstPair.pairId, maxSliceIndex, orientation)
                rangeCacheRef.current = { pairId: firstPair.pairId, maxIdx: maxSliceIndex, ori: orientation, range }
            } catch (e) {
                console.error('Failed to update global slice:', e)
                toast.error('Slice update failed', { description: 'Could not update global slice position' })
                return
            }
        }
        setGlobalSlicePhysical(range.min + (percent / 100) * (range.max - range.min))
    }

    const runSyncOnInit = async (fp: (typeof pairArray)[0], ori: ViewOrientation, maxIdx: number) => {
        try {
            const [physicalPosition, range] = await Promise.all([
                convertIndexToPhysical(fp.pairId, fp.currentSliceIndex, ori),
                getPhysicalRange(fp.pairId, maxIdx, ori),
            ])
            rangeCacheRef.current = { pairId: fp.pairId, maxIdx, ori, range }
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
            toast.info('Synchronization disabled', { description: 'Panels can now be controlled independently' })
            return
        }
        if (!hasPairs) return
        if (!allSameOrientation) {
            setSyncDirectionDialogOpen(true)
            return
        }
        setSynchronized(true)
        await runSyncOnInit(firstPair!, orientation, maxSliceIndex)
    }

    const handleSetAllAxialAndSync = async () => {
        setSyncDirectionDialogOpen(false)
        pairArray.forEach((p) => updatePairOrientation(p.pairId, 'axial'))
        setSynchronized(true)
        const fp = firstPair!
        const ori = 'axial' as ViewOrientation
        const size = firstPairMetadata?.ct_metadata?.dimensions?.[AXIS_MAP.axial] ?? 100
        const maxIdx = size - 1
        await runSyncOnInit(fp, ori, maxIdx)
    }

    const handleSliderChange = (value: number[]) => {
        const v = value[0]
        setSliderValue(v)
        if (!synchronized || !firstPair) return
        const cached = rangeCacheRef.current
        const hit = cached?.pairId === firstPair.pairId && cached?.maxIdx === maxSliceIndex && cached?.ori === orientation
        const range = hit ? cached!.range : null
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
        if (synchronized && hasPairs && firstPair) applyPhysicalFromSliderValue(value[0])
    }

    const handleGlobalReset = async () => {
        pairArray.forEach((p) => resetPairView(p.pairId))
        if (synchronized && firstPair) {
            const cached = rangeCacheRef.current
            const hit = cached?.pairId === firstPair.pairId && cached?.ori === orientation
            if (hit && cached) {
                setGlobalSlicePhysical(cached.range.min)
                setSliderValue(0)
            } else {
                try {
                    const range = await getPhysicalRange(firstPair.pairId, maxSliceIndex, orientation)
                    rangeCacheRef.current = { pairId: firstPair.pairId, maxIdx: maxSliceIndex, ori: orientation, range }
                    setGlobalSlicePhysical(range.min)
                    setSliderValue(0)
                } catch {
                    setSliderValue(0)
                }
            }
        }
        toast.success('All views reset', { description: `Reset ${pairArray.length} panel${pairArray.length !== 1 ? 's' : ''}` })
    }

    const handleLeaveDataset = () => {
        setViewMode('pairs')
        setDatasetCase(null)
        toast.info('Left dataset mode')
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
                            ? await fetchFirstSliceWithMask(firstSeg.volumeId, p.orientation ?? 'axial')
                            : { slice_index: 0 }
                        return { pairId: p.pairId, slice_index: data.slice_index }
                    })
                )
                results.forEach(({ pairId, slice_index }) => updatePairSlice(pairId, slice_index))
                if (synchronized && firstPair) {
                    const first = results.find((r) => r.pairId === firstPair.pairId)
                    if (first) {
                        const physicalPosition = await convertIndexToPhysical(
                            firstPair.pairId,
                            first.slice_index,
                            ori
                        )
                        setGlobalSlicePhysical(physicalPosition)
                        const cached = rangeCacheRef.current
                        const hit = cached?.pairId === firstPair.pairId && cached?.ori === ori
                        const range = hit ? cached!.range : await getPhysicalRange(firstPair.pairId, maxSliceIndex, ori)
                        if (!hit) {
                            rangeCacheRef.current = { pairId: firstPair.pairId, maxIdx: maxSliceIndex, ori, range }
                        }
                        const r = range.max - range.min
                        setSliderValue(r !== 0 ? Math.round(((physicalPosition - range.min) / r) * 100) : 0)
                    }
                }
                toast.success('Snap to mask on', { description: 'All panels moved to first slice with segmentation' })
            } catch (e) {
                console.error('Failed to snap to mask:', e)
                toast.error('Could not snap to mask', { description: e instanceof Error ? e.message : 'Unknown error' })
            }
        }
    }

    return (
        <div className="space-y-6">
            {viewMode === 'dataset' ? (
                <div className="space-y-3">
                    <Button
                        className="w-full gap-2"
                        variant="outline"
                        onClick={handleLeaveDataset}
                    >
                        Leave dataset mode
                    </Button>
                    {datasetCase && (datasetCase.labelVolumeId ?? datasetCase.predVolumeId) && (
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
            ) : (
                <>
                    <div className="flex min-h-9 w-full items-center">
                        <FileUploadDialog
                            trigger={
                                <Button className="w-full gap-2" variant="outline">
                                    <Upload className="h-4 w-4" />
                                    Upload Pair
                                </Button>
                            }
                        />
                    </div>
                    <div className="flex min-h-9 w-full items-center">
                        <DatasetLoadDialog
                            trigger={
                                <Button className="w-full gap-2" variant="outline">
                                    <FolderOpen className="h-4 w-4" />
                                    Load Dataset
                                </Button>
                            }
                        />
                    </div>
                </>
            )}

            {/* Columns per row (pairs mode only) */}
            {viewMode === 'pairs' && (
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

            {viewMode === 'pairs' && (
                <>
                    <div className="flex min-h-9 items-center justify-between">
                        <div className="flex items-center gap-2">
                            {synchronized ? (
                                <Link className="h-4 w-4 text-primary" />
                            ) : (
                                <Unlink className="h-4 w-4 text-muted-foreground" />
                            )}
                            <Label htmlFor="global-sync" className="cursor-pointer">
                                Synchronize All Panels
                            </Label>
                        </div>
                        <Switch
                            id="global-sync"
                            checked={synchronized}
                            onCheckedChange={handleSyncToggle}
                            disabled={!hasPairs}
                        />
                    </div>

                    {hasPairs && (
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
                    )}

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
                            disabled={!synchronized || !hasPairs}
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
                            disabled={!hasPairs}
                            className="gap-2"
                        >
                            <RotateCcw className="h-4 w-4" />
                            Reset All
                        </Button>
                    </div>
                </>
            )}

            {/* Status Info */}
            {viewMode === 'pairs' && !hasPairs && (
                <p className="text-xs text-muted-foreground text-center pt-2 border-t">
                    Load pairs or a dataset to get started
                </p>
            )}
            {viewMode === 'pairs' && hasPairs && (
                <p className="text-xs text-muted-foreground text-center pt-2 border-t">
                    Controlling {pairArray.length} panel{pairArray.length !== 1 ? 's' : ''}
                </p>
            )}
            {viewMode === 'dataset' && (
                <p className="text-xs text-muted-foreground text-center pt-2 border-t">
                    Dataset inspection mode — use arrows in main view to navigate
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

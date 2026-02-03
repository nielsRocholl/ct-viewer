'use client'

import { useCallback, useState, useEffect, useRef, useMemo } from 'react'

const CLICK_THRESHOLD_PX = 6
import { useViewerStore, getPairSegVolumes } from '@/lib/store'
import { useCTSlice, useSegmentationSlice, usePairMetadata, useAddSegmentToPair, useUploadVolume } from '@/lib/api-hooks'
import { CanvasRenderer, type CanvasRendererHandle } from './canvas-renderer'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Slider } from './ui/slider'
import { Switch } from './ui/switch'
import { Label } from './ui/label'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { ZoomIn, ZoomOut, RotateCcw, Palette, Download, Plus, Trash2 } from 'lucide-react'
import {
    AXIS_MAP,
    convertIndexToPhysical,
    convertPhysicalToIndex,
    physicalToIndexFromMetadata,
    synchronizeAllPairs,
} from '@/lib/synchronization'
import { fetchWindowFromRoi } from '@/lib/api-client'
import { downloadCanvasAsJpeg } from '@/lib/utils'
import { VolumeInfoCard } from './volume-info-card'
import { toast } from 'sonner'
import { generateDefaultColorMap, DEFAULT_LABEL_COLOR } from '@/lib/color-utils'
import type { OverlayLayerSpec } from './canvas-renderer'

const WINDOW_ROI_RADIUS_MM = 20
const WINDOW_SMOOTH_NEW = 0.7

export interface ViewerPanelProps {
    pairId: string
}

export function ViewerPanel({ pairId }: ViewerPanelProps) {
    const pair = useViewerStore((state) => state.pairs.get(pairId))
    const synchronized = useViewerStore((state) => state.synchronized)
    const globalSlicePhysical = useViewerStore((state) => state.globalSlicePhysical)
    const updatePairSlice = useViewerStore((state) => state.updatePairSlice)
    const updatePairOrientation = useViewerStore((state) => state.updatePairOrientation)
    const updatePairWindowLevel = useViewerStore((state) => state.updatePairWindowLevel)
    const updatePairZoom = useViewerStore((state) => state.updatePairZoom)
    const updatePairPan = useViewerStore((state) => state.updatePairPan)
    const updatePairOverlay = useViewerStore((state) => state.updatePairOverlay)
    const updatePairColorMap = useViewerStore((state) => state.updatePairColorMap)
    const addSegToPair = useViewerStore((state) => state.addSegToPair)
    const removeSegFromPair = useViewerStore((state) => state.removeSegFromPair)
    const updateSegVisible = useViewerStore((state) => state.updateSegVisible)
    const updateSegColorMap = useViewerStore((state) => state.updateSegColorMap)
    const resetPairView = useViewerStore((state) => state.resetPairView)
    const setGlobalSlicePhysical = useViewerStore((state) => state.setGlobalSlicePhysical)
    const updateAllPairsSlice = useViewerStore((state) => state.updateAllPairsSlice)

    const [isDragging, setIsDragging] = useState(false)
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
    const [mouseDownClient, setMouseDownClient] = useState<{ x: number; y: number } | null>(null)
    const [selectedColor, setSelectedColor] = useState<string>(DEFAULT_LABEL_COLOR)
    const [clickedXyz, setClickedXyz] = useState<{ x: number; y: number; z: number } | null>(null)
    const [clickedVoxel, setClickedVoxel] = useState<{ x: number; y: number; z: number } | null>(null)
    const canvasRendererRef = useRef<CanvasRendererHandle>(null)
    const canvasContainerRef = useRef<HTMLDivElement>(null)
    const lastSizeRef = useRef({ width: 512, height: 512 })
    const [canvasSize, setCanvasSize] = useState({ width: 512, height: 512 })
    const [isUpdatingFromSync, setIsUpdatingFromSync] = useState(false)
    const [volumeInfoOpen, setVolumeInfoOpen] = useState(false)
    const addMaskInputRef = useRef<HTMLInputElement>(null)
    const uploadVolumeMutation = useUploadVolume()
    const addSegmentMutation = useAddSegmentToPair()

    useEffect(() => {
        const el = canvasContainerRef.current
        if (!el) return
        let rafId = 0
        const MIN_DELTA = 8
        const ro = new ResizeObserver(() => {
            if (rafId) cancelAnimationFrame(rafId)
            rafId = requestAnimationFrame(() => {
                rafId = 0
                const w = Math.max(1, (el.clientWidth >> 1) << 1)
                const h = Math.max(1, (el.clientHeight >> 1) << 1)
                const last = lastSizeRef.current
                if (Math.abs(w - last.width) >= MIN_DELTA || Math.abs(h - last.height) >= MIN_DELTA) {
                    lastSizeRef.current = { width: w, height: h }
                    setCanvasSize({ width: w, height: h })
                }
            })
        })
        ro.observe(el)
        const w = Math.max(1, (el.clientWidth >> 1) << 1)
        const h = Math.max(1, (el.clientHeight >> 1) << 1)
        if (w !== 512 || h !== 512) {
            lastSizeRef.current = { width: w, height: h }
            setCanvasSize({ width: w, height: h })
        }
        return () => {
            if (rafId) cancelAnimationFrame(rafId)
            ro.disconnect()
        }
    }, [])

    const { data: pairMetadata } = usePairMetadata(pairId)
    const syncingRef = useRef(false)

    useEffect(() => {
        setClickedXyz(null)
        setClickedVoxel(null)
    }, [pair?.currentSliceIndex])

    useEffect(() => {
        if (!synchronized || globalSlicePhysical === null || syncingRef.current) return
        const currentPair = useViewerStore.getState().pairs.get(pairId)
        if (!currentPair) return
        if (pairMetadata?.ct_metadata) {
            const ori = currentPair.orientation ?? 'axial'
            const sliceIndex = physicalToIndexFromMetadata(
                globalSlicePhysical,
                pairMetadata.ct_metadata,
                ori
            )
            if (sliceIndex !== currentPair.currentSliceIndex) {
                syncingRef.current = true
                updatePairSlice(pairId, sliceIndex)
                syncingRef.current = false
            }
            return
        }
        syncingRef.current = true
        const updateSliceFromPhysical = async () => {
            try {
                setIsUpdatingFromSync(true)
                const ori = currentPair.orientation ?? 'axial'
                const sliceIndex = await convertPhysicalToIndex(
                    pairId,
                    globalSlicePhysical,
                    ori
                )
                const latestPair = useViewerStore.getState().pairs.get(pairId)
                if (latestPair && sliceIndex !== latestPair.currentSliceIndex) {
                    updatePairSlice(pairId, sliceIndex)
                }
            } catch (error) {
                console.error(`Failed to sync pair ${pairId}:`, error)
                toast.error('Synchronization failed', {
                    description: `Could not sync pair ${pairId.slice(0, 8)}`,
                })
            } finally {
                setIsUpdatingFromSync(false)
                syncingRef.current = false
            }
        }
        updateSliceFromPhysical()
    }, [synchronized, globalSlicePhysical, pairId, updatePairSlice, pairMetadata?.ct_metadata, pair?.orientation])

    const orientation = pair?.orientation ?? 'axial'
    const segVolumes = useMemo(() => (pair ? getPairSegVolumes(pair) : []), [pair])
    const baseSegParams = pair
        ? {
            slice_index: pair.currentSliceIndex,
            orientation,
            mode: pair.overlayMode,
            format: 'png' as const,
        }
        : null
    const segParams0 = baseSegParams && segVolumes[0] ? { ...baseSegParams, volume_id: segVolumes[0].volumeId } : null
    const segParams1 = baseSegParams && segVolumes[1] ? { ...baseSegParams, volume_id: segVolumes[1].volumeId } : null
    const segParams2 = baseSegParams && segVolumes[2] ? { ...baseSegParams, volume_id: segVolumes[2].volumeId } : null
    const segParams3 = baseSegParams && segVolumes[3] ? { ...baseSegParams, volume_id: segVolumes[3].volumeId } : null
    const segParams4 = baseSegParams && segVolumes[4] ? { ...baseSegParams, volume_id: segVolumes[4].volumeId } : null
    const segParams5 = baseSegParams && segVolumes[5] ? { ...baseSegParams, volume_id: segVolumes[5].volumeId } : null
    const segParams6 = baseSegParams && segVolumes[6] ? { ...baseSegParams, volume_id: segVolumes[6].volumeId } : null
    const segParams7 = baseSegParams && segVolumes[7] ? { ...baseSegParams, volume_id: segVolumes[7].volumeId } : null
    const segParams8 = baseSegParams && segVolumes[8] ? { ...baseSegParams, volume_id: segVolumes[8].volumeId } : null
    const segParams9 = baseSegParams && segVolumes[9] ? { ...baseSegParams, volume_id: segVolumes[9].volumeId } : null

    const { data: ctSliceUrl, error: ctSliceError } = useCTSlice(
        pair
            ? {
                volume_id: pair.ctVolumeId,
                slice_index: pair.currentSliceIndex,
                orientation,
                window_level: pair.windowLevel,
                window_width: pair.windowWidth,
                format: 'png',
            }
            : null
    )
    const { data: segUrl0 } = useSegmentationSlice(segParams0)
    const { data: segUrl1 } = useSegmentationSlice(segParams1)
    const { data: segUrl2 } = useSegmentationSlice(segParams2)
    const { data: segUrl3 } = useSegmentationSlice(segParams3)
    const { data: segUrl4 } = useSegmentationSlice(segParams4)
    const { data: segUrl5 } = useSegmentationSlice(segParams5)
    const { data: segUrl6 } = useSegmentationSlice(segParams6)
    const { data: segUrl7 } = useSegmentationSlice(segParams7)
    const { data: segUrl8 } = useSegmentationSlice(segParams8)
    const { data: segUrl9 } = useSegmentationSlice(segParams9)

    const segSliceUrls = [segUrl0, segUrl1, segUrl2, segUrl3, segUrl4, segUrl5, segUrl6, segUrl7, segUrl8, segUrl9]
    const overlayLayers: OverlayLayerSpec[] =
        pair && segVolumes.length > 0
            ? segVolumes.map((seg, i) => ({
                url: segSliceUrls[i] ?? null,
                colorMap: seg.colorMap,
                opacity: pair.overlayOpacity,
                visible: seg.visible !== false,
            }))
            : []

    useEffect(() => {
        if (ctSliceError) {
            toast.error('Failed to load CT slice', {
                description: ctSliceError.message,
                duration: 3000,
            })
        }
    }, [ctSliceError])


    const handleSliceChange = useCallback(
        async (value: number[]) => {
            if (!pair) return

            const newSliceIndex = value[0]
            updatePairSlice(pairId, newSliceIndex)

            if (synchronized && !isUpdatingFromSync) {
                try {
                    const ori = pair.orientation ?? 'axial'
                    const physicalPosition = await convertIndexToPhysical(
                        pairId,
                        newSliceIndex,
                        ori
                    )

                    setGlobalSlicePhysical(physicalPosition)

                    const pairs = useViewerStore.getState().pairs
                    const otherPairIds = Array.from(pairs.keys()).filter(
                        (id) => id !== pairId
                    )
                    if (otherPairIds.length > 0) {
                        const sliceIndices = await synchronizeAllPairs(
                            otherPairIds,
                            physicalPosition,
                            ori
                        )
                        updateAllPairsSlice(sliceIndices)
                    }
                } catch (error) {
                    console.error('Failed to synchronize slice change:', error)
                    toast.error('Synchronization failed', {
                        description: 'Could not synchronize slice across panels',
                    })
                }
            }
        },
        [
            pairId,
            pair,
            synchronized,
            isUpdatingFromSync,
            updatePairSlice,
            setGlobalSlicePhysical,
            updateAllPairsSlice,
        ]
    )

    const handleWindowLevelChange = useCallback(
        (value: number[]) => {
            if (pair) {
                updatePairWindowLevel(pairId, value[0], pair.windowWidth)
            }
        },
        [pairId, pair, updatePairWindowLevel]
    )

    const handleWindowWidthChange = useCallback(
        (value: number[]) => {
            if (pair) {
                updatePairWindowLevel(pairId, pair.windowLevel, value[0])
            }
        },
        [pairId, pair, updatePairWindowLevel]
    )

    const handleZoomIn = useCallback(() => {
        if (pair) {
            updatePairZoom(pairId, Math.min(pair.zoom * 1.2, 10))
        }
    }, [pairId, pair, updatePairZoom])

    const handleZoomOut = useCallback(() => {
        if (pair) {
            updatePairZoom(pairId, Math.max(pair.zoom / 1.2, 0.1))
        }
    }, [pairId, pair, updatePairZoom])

    const handleMouseDown = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            if (pair && e.button === 0) {
                setIsDragging(true)
                setDragStart({ x: e.clientX - pair.pan.x, y: e.clientY - pair.pan.y })
                setMouseDownClient({ x: e.clientX, y: e.clientY })
            }
        },
        [pair]
    )

    const handleMouseMove = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            if (isDragging && pair) {
                const newPan = {
                    x: e.clientX - dragStart.x,
                    y: e.clientY - dragStart.y,
                }
                updatePairPan(pairId, newPan)
            }
        },
        [isDragging, dragStart, pairId, pair, updatePairPan]
    )

    const handleMouseUp = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            const wasClick =
                mouseDownClient &&
                Math.hypot(e.clientX - mouseDownClient.x, e.clientY - mouseDownClient.y) < CLICK_THRESHOLD_PX
            setMouseDownClient(null)
            setIsDragging(false)
            if (wasClick && pair && canvasRendererRef.current?.canvas) {
                const rect = canvasRendererRef.current.canvas.getBoundingClientRect()
                const scaleX = canvasRendererRef.current.canvas.width / rect.width
                const scaleY = canvasRendererRef.current.canvas.height / rect.height
                const canvasX = (e.clientX - rect.left) * scaleX
                const canvasY = (e.clientY - rect.top) * scaleY
                const point = canvasRendererRef.current.getImagePoint(canvasX, canvasY)
                if (!point) return
                const meta = pairMetadata?.ct_metadata
                if (meta) {
                    const [ox, oy, oz] = meta.origin
                    const [sx, sy, sz] = meta.spacing
                    setClickedXyz({
                        x: ox + point.x * sx,
                        y: oy + point.y * sy,
                        z: oz + pair.currentSliceIndex * sz,
                    })
                    setClickedVoxel({
                        x: Math.round(point.x),
                        y: Math.round(point.y),
                        z: pair.currentSliceIndex,
                    })
                }
                fetchWindowFromRoi({
                    volume_id: pair.ctVolumeId,
                    slice_index: pair.currentSliceIndex,
                    orientation: pair.orientation ?? 'axial',
                    center_x: point.x,
                    center_y: point.y,
                    radius_mm: WINDOW_ROI_RADIUS_MM,
                })
                    .then(({ level, width }) => {
                        const newLevel =
                            WINDOW_SMOOTH_NEW * level + (1 - WINDOW_SMOOTH_NEW) * pair.windowLevel
                        const newWidth =
                            WINDOW_SMOOTH_NEW * width + (1 - WINDOW_SMOOTH_NEW) * pair.windowWidth
                        updatePairWindowLevel(pairId, newLevel, newWidth)
                    })
                    .catch(() => {
                        toast.error('Could not set window from region', { duration: 3000 })
                    })
            }
        },
        [mouseDownClient, pair, pairId, pairMetadata?.ct_metadata, updatePairWindowLevel]
    )

    const handleOverlayOpacityChange = useCallback(
        (value: number[]) => {
            updatePairOverlay(pairId, { overlayOpacity: value[0] })
        },
        [pairId, updatePairOverlay]
    )

    const handleOverlayModeChange = useCallback(
        (mode: 'filled' | 'boundary') => {
            updatePairOverlay(pairId, { overlayMode: mode })
        },
        [pairId, updatePairOverlay]
    )

    const handleColorChange = useCallback(
        (color: string, segIndex: number) => {
            if (pair && segVolumes[segIndex]) {
                setSelectedColor(color)
                const newColorMap = new Map(segVolumes[segIndex].colorMap)
                newColorMap.set(1, color)
                updateSegColorMap(pairId, segIndex, newColorMap)
            }
        },
        [pairId, pair, segVolumes, updateSegColorMap]
    )

    const handleAddMask = useCallback(
        async (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file || !pair || segVolumes.length >= 10) return
            try {
                const vol = await uploadVolumeMutation.mutateAsync(file)
                const updated = await addSegmentMutation.mutateAsync({
                    pairId,
                    request: { seg_volume_id: vol.volume_id, auto_resample: true },
                })
                const last = updated.seg_metadatas?.length
                    ? updated.seg_metadatas[updated.seg_metadatas.length - 1]
                    : vol
                addSegToPair(pairId, last.volume_id)
                toast.success('Mask added')
            } catch (err) {
                toast.error('Failed to add mask', { description: err instanceof Error ? err.message : undefined })
            }
        },
        [pairId, pair, segVolumes.length, uploadVolumeMutation, addSegmentMutation, addSegToPair]
    )

    const handleReset = useCallback(() => {
        resetPairView(pairId)
        toast.success('View reset', {
            description: 'Zoom, pan, and window settings restored to defaults',
        })
    }, [pairId, resetPairView])

    const handleDownloadSlice = useCallback(() => {
        const canvas = canvasRendererRef.current?.canvas
        if (!canvas || !pair) {
            if (!canvas) toast.error('Canvas not ready')
            return
        }
        downloadCanvasAsJpeg(canvas, `slice-${pair.pairId.slice(0, 8)}-${pair.currentSliceIndex}.jpg`)
        toast.success('Slice downloaded')
    }, [pair])

    const axis = AXIS_MAP[pair?.orientation ?? 'axial']
    const maxSliceIndex = pairMetadata?.ct_metadata?.dimensions?.[axis] ?? 100

    useEffect(() => {
        if (!pair || !pairMetadata) return
        const maxIdx = maxSliceIndex - 1
        if (pair.currentSliceIndex > maxIdx && maxIdx >= 0) {
            updatePairSlice(pairId, maxIdx)
        }
    }, [pair, pairMetadata, pairId, updatePairSlice, maxSliceIndex])

    if (!pair) {
        return (
            <Card>
                <CardContent className="p-6">
                    <p className="text-muted-foreground">Pair not found</p>
                </CardContent>
            </Card>
        )
    }

    const orientationLabel = { axial: 'Axial (Z)', sagittal: 'Sagittal (X)', coronal: 'Coronal (Y)' } as const

    return (
        <Card className="w-full">
            <CardHeader>
                <CardTitle className="text-sm font-medium">
                    Pair {pairId.slice(0, 8)}
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="mx-auto w-full max-w-[512px] space-y-4">
                    {pairMetadata && (
                        <Popover open={volumeInfoOpen} onOpenChange={setVolumeInfoOpen}>
                            <PopoverTrigger asChild>
                                <Button variant="outline" size="sm" className="w-full text-xs">
                                    Volume info
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent
                                className="w-auto max-w-[90vw] min-w-[320px]"
                                align="start"
                                onInteractOutside={(e) => e.preventDefault()}
                            >
                                <VolumeInfoCard
                                    volumes={[
                                        { title: 'Image', meta: pairMetadata.ct_metadata },
                                        { title: 'Label', meta: pairMetadata.seg_metadata },
                                    ]}
                                    onClose={() => setVolumeInfoOpen(false)}
                                />
                            </PopoverContent>
                        </Popover>
                    )}
                    {/* Canvas Renderer */}
                    <div
                        ref={canvasContainerRef}
                        className="relative w-full aspect-square min-h-0"
                    >
                        <div
                            className="absolute inset-0 cursor-move"
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            onMouseLeave={handleMouseUp}
                        >
                            <CanvasRenderer
                                ref={canvasRendererRef}
                                ctSliceUrl={ctSliceUrl ?? null}
                                segmentationSliceUrl={null}
                                overlayMode={pair.overlayMode}
                                overlayOpacity={pair.overlayOpacity}
                                overlayVisible={pair.overlayVisible}
                                colorMap={pair.colorMap ?? new Map()}
                                overlayLayers={overlayLayers}
                                zoom={pair.zoom}
                                pan={pair.pan}
                                windowLevel={pair.windowLevel}
                                windowWidth={pair.windowWidth}
                                width={canvasSize.width}
                                height={canvasSize.height}
                            />
                            {clickedXyz && clickedVoxel && (
                                <div className="absolute top-2 right-2 text-xs font-mono bg-black/70 text-white px-2 py-1 rounded pointer-events-none space-y-0.5">
                                    <div>physical: x {clickedXyz.x.toFixed(1)}  y {clickedXyz.y.toFixed(1)}  z {clickedXyz.z.toFixed(1)} mm</div>
                                    <div>voxel: x {clickedVoxel.x}  y {clickedVoxel.y}  z {clickedVoxel.z}</div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Viewing direction toggle */}
                <div className="flex min-h-9 items-center justify-center">
                    <div className="inline-flex min-w-[14rem] rounded-xl border border-input bg-muted/30 p-0.5" role="group" aria-label="View orientation">
                        {(['axial', 'sagittal', 'coronal'] as const).map((ori) => (
                            <Button
                                key={ori}
                                variant={pair.orientation === ori ? 'default' : 'ghost'}
                                size="sm"
                                className="h-7 flex-1 rounded-lg px-3 text-xs"
                                onClick={() => updatePairOrientation(pairId, ori)}
                            >
                                {orientationLabel[ori]}
                            </Button>
                        ))}
                    </div>
                </div>

                {/* Slice Navigation */}
                <div className="space-y-2">
                    <div className="flex min-h-9 items-center gap-2">
                        <Label className="text-xs shrink-0">
                            Slice: {pair.currentSliceIndex} / {maxSliceIndex - 1}
                        </Label>
                        <Slider
                            value={[pair.currentSliceIndex]}
                            onValueChange={handleSliceChange}
                            min={0}
                            max={maxSliceIndex - 1}
                            step={1}
                            className="flex-1"
                        />
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleDownloadSlice}
                            className="shrink-0 gap-1.5"
                            aria-label="Download slice as JPEG"
                        >
                            <Download className="h-4 w-4" />
                            Download
                        </Button>
                    </div>
                </div>

                {/* Window/Level Controls */}
                <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">Click on image to set level and width from that area.</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label className="text-xs">Window Level: {pair.windowLevel}</Label>
                        <Slider
                            value={[pair.windowLevel]}
                            onValueChange={handleWindowLevelChange}
                            min={-1000}
                            max={1000}
                            step={1}
                            className="w-full"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label className="text-xs">Window Width: {pair.windowWidth}</Label>
                        <Slider
                            value={[pair.windowWidth]}
                            onValueChange={handleWindowWidthChange}
                            min={1}
                            max={2000}
                            step={1}
                            className="w-full"
                        />
                    </div>
                </div>

                {/* Zoom Controls */}
                <div className="flex items-center gap-2">
                    <Label className="text-xs">Zoom: {pair.zoom.toFixed(2)}x</Label>
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={handleZoomOut}
                        className="h-8 w-8"
                    >
                        <ZoomOut className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={handleZoomIn}
                        className="h-8 w-8"
                    >
                        <ZoomIn className="h-4 w-4" />
                    </Button>
                </div>

                {/* Masks / Overlay */}
                <div className="space-y-3 border-t pt-3">
                    {segVolumes.length > 1 && (
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                            {segVolumes.map((seg, i) => (
                                <span key={i} className="flex items-center gap-1.5">
                                    <span
                                        className="h-2.5 w-2.5 rounded-sm border border-border shrink-0"
                                        style={{ backgroundColor: seg.colorMap.get(1) ?? DEFAULT_LABEL_COLOR }}
                                        aria-hidden
                                    />
                                    Mask {i + 1}
                                </span>
                            ))}
                        </div>
                    )}
                    {segVolumes.map((seg, i) => (
                        <div key={i} className="flex items-center gap-2">
                            <span
                                className="h-3 w-3 rounded border border-border shrink-0"
                                style={{ backgroundColor: seg.colorMap.get(1) ?? DEFAULT_LABEL_COLOR }}
                                aria-hidden
                            />
                            <Label className="text-xs shrink-0 w-14">Mask {i + 1}</Label>
                            <Switch
                                checked={seg.visible !== false}
                                onCheckedChange={(v) => updateSegVisible(pairId, i, v)}
                            />
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 shrink-0"
                                        onClick={() => setSelectedColor(seg.colorMap.get(1) ?? DEFAULT_LABEL_COLOR)}
                                    >
                                        <Palette className="h-4 w-4" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-48">
                                    <input
                                        type="color"
                                        value={selectedColor}
                                        onChange={(e) => handleColorChange(e.target.value, i)}
                                        className="w-full h-8 cursor-pointer rounded"
                                    />
                                </PopoverContent>
                            </Popover>
                            {segVolumes.length > 1 && (
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                                    onClick={() => removeSegFromPair(pairId, i)}
                                    aria-label={`Remove mask ${i + 1}`}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            )}
                        </div>
                    ))}
                    {segVolumes.length > 0 && (
                        <>
                            <div className="space-y-2">
                                <Label className="text-xs">Opacity: {(pair.overlayOpacity * 100).toFixed(0)}%</Label>
                                <Slider
                                    value={[pair.overlayOpacity]}
                                    onValueChange={handleOverlayOpacityChange}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    className="w-full"
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <Label className="text-xs">Mode:</Label>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="outline" size="sm">
                                            {pair.overlayMode === 'filled' ? 'Filled' : 'Boundary'}
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent>
                                        <DropdownMenuItem onClick={() => handleOverlayModeChange('filled')}>Filled</DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => handleOverlayModeChange('boundary')}>Boundary</DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                        </>
                    )}
                    {segVolumes.length < 10 && (
                        <>
                            <input
                                ref={addMaskInputRef}
                                type="file"
                                accept=".nii,.gz,.mha,.mhd"
                                className="hidden"
                                onChange={handleAddMask}
                            />
                            <Button
                                variant="outline"
                                size="sm"
                                className="w-full gap-2"
                                onClick={() => addMaskInputRef.current?.click()}
                            >
                                <Plus className="h-4 w-4" />
                                Add mask
                            </Button>
                        </>
                    )}
                </div>

                {/* Reset Button */}
                <Button variant="outline" onClick={handleReset} className="w-full">
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Reset View
                </Button>
            </CardContent>
        </Card>
    )
}

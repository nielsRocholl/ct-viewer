'use client'

import { useCallback, useState, useEffect, useRef } from 'react'
import { useViewerStore } from '@/lib/store'
import { useCTSlice, useSegmentationSlice, useVolumeMetadata } from '@/lib/api-hooks'
import { CanvasRenderer, type CanvasRendererHandle } from './canvas-renderer'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Slider } from './ui/slider'
import { Switch } from './ui/switch'
import { Label } from './ui/label'
import { ZoomIn, ZoomOut, RotateCcw, Download } from 'lucide-react'
import { AXIS_MAP } from '@/lib/synchronization'
import { openDatasetCase, fetchWindowFromRoi, fetchFirstSliceWithMask } from '@/lib/api-client'
import { toast } from 'sonner'
import { generateDefaultColorMap, DEFAULT_LABEL_COLOR, DEFAULT_PRED_COLOR } from '@/lib/color-utils'
import { downloadCanvasAsJpeg } from '@/lib/utils'
import { VolumeInfoCard } from './volume-info-card'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

const CLICK_THRESHOLD_PX = 6
const WINDOW_ROI_RADIUS_MM = 20
const WINDOW_SMOOTH_NEW = 0.7
const DEFAULT_WINDOW_LEVEL = 40
const DEFAULT_WINDOW_WIDTH = 400
const DEFAULT_ZOOM = 1
const DEFAULT_PAN = { x: 0, y: 0 }
const DEFAULT_OVERLAY_OPACITY = 0.5

export function DatasetViewerPanel() {
    const datasetCase = useViewerStore((s) => s.datasetCase)
    const setDatasetCase = useViewerStore((s) => s.setDatasetCase)
    const snapToMask = useViewerStore((s) => s.snapToMask)

    const [sliceIndex, setSliceIndex] = useState(0)
    const [orientation, setOrientation] = useState<'axial' | 'sagittal' | 'coronal'>('axial')
    const [volumeInfoOpen, setVolumeInfoOpen] = useState(false)
    const [windowLevel, setWindowLevel] = useState(DEFAULT_WINDOW_LEVEL)
    const [windowWidth, setWindowWidth] = useState(DEFAULT_WINDOW_WIDTH)
    const [zoom, setZoom] = useState(DEFAULT_ZOOM)
    const [pan, setPan] = useState(DEFAULT_PAN)
    const [overlayVisible, setOverlayVisible] = useState(true)
    const [predictionVisible, setPredictionVisible] = useState(true)
    const [overlayOpacity, setOverlayOpacity] = useState(DEFAULT_OVERLAY_OPACITY)
    const [isDragging, setIsDragging] = useState(false)
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
    const [mouseDownClient, setMouseDownClient] = useState<{ x: number; y: number } | null>(null)
    const [clickedXyz, setClickedXyz] = useState<{ x: number; y: number; z: number } | null>(null)
    const [clickedVoxel, setClickedVoxel] = useState<{ x: number; y: number; z: number } | null>(null)
    const canvasContainerRef = useRef<HTMLDivElement>(null)
    const lastSizeRef = useRef({ width: 512, height: 512 })
    const [canvasSize, setCanvasSize] = useState({ width: 512, height: 512 })
    const canvasRendererRef = useRef<CanvasRendererHandle>(null)
    const colorMap = useRef(generateDefaultColorMap([1, 2, 3, 4, 5])).current

    useEffect(() => {
        setSliceIndex(0)
        setOrientation('axial')
        setClickedXyz(null)
        setClickedVoxel(null)
    }, [datasetCase?.caseIndex, datasetCase?.imageVolumeId])

    const volumeId = datasetCase?.labelVolumeId ?? datasetCase?.predVolumeId ?? null
    useEffect(() => {
        if (!snapToMask || !volumeId || !datasetCase) return
        fetchFirstSliceWithMask(volumeId, orientation)
            .then((data) => setSliceIndex(data.slice_index))
            .catch(() => { })
    }, [snapToMask, datasetCase, volumeId, orientation])

    useEffect(() => {
        setClickedXyz(null)
        setClickedVoxel(null)
    }, [sliceIndex])

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

    const { data: imageMeta } = useVolumeMetadata(datasetCase?.imageVolumeId ?? null)
    const { data: labelMeta } = useVolumeMetadata(datasetCase?.labelVolumeId ?? null)
    const { data: predMeta } = useVolumeMetadata(datasetCase?.predVolumeId ?? null)
    const axis = AXIS_MAP[orientation]
    const maxSliceIndex = imageMeta?.dimensions?.[axis] != null ? imageMeta.dimensions[axis] - 1 : 0

    useEffect(() => {
        if (sliceIndex > maxSliceIndex && maxSliceIndex >= 0) setSliceIndex(maxSliceIndex)
    }, [orientation, imageMeta?.dimensions, sliceIndex, maxSliceIndex])

    const { data: ctSliceUrl } = useCTSlice(
        datasetCase
            ? {
                volume_id: datasetCase.imageVolumeId,
                slice_index: sliceIndex,
                orientation,
                window_level: windowLevel,
                window_width: windowWidth,
                format: 'png',
            }
            : null
    )
    const { data: labelSliceUrl } = useSegmentationSlice(
        datasetCase?.labelVolumeId
            ? {
                volume_id: datasetCase.labelVolumeId,
                slice_index: sliceIndex,
                orientation,
                mode: 'filled',
                format: 'png',
            }
            : null
    )
    const { data: predSliceUrl } = useSegmentationSlice(
        datasetCase?.predVolumeId
            ? {
                volume_id: datasetCase.predVolumeId,
                slice_index: sliceIndex,
                orientation,
                mode: 'filled',
                format: 'png',
            }
            : null
    )

    const handleSliceChange = useCallback((value: number[]) => {
        setSliceIndex(value[0])
    }, [])

    const handleWindowLevelChange = useCallback((value: number[]) => {
        setWindowLevel(value[0])
    }, [])
    const handleWindowWidthChange = useCallback((value: number[]) => {
        setWindowWidth(value[0])
    }, [])

    const handleZoomIn = useCallback(() => setZoom((z) => Math.min(z * 1.2, 10)), [])
    const handleZoomOut = useCallback(() => setZoom((z) => Math.max(z / 1.2, 0.1)), [])

    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (e.button === 0) {
            setIsDragging(true)
            setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
            setMouseDownClient({ x: e.clientX, y: e.clientY })
        }
    }, [pan])
    const handleMouseMove = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            if (isDragging) {
                setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y })
            }
        },
        [isDragging, dragStart]
    )
    const handleMouseUp = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            const wasClick =
                mouseDownClient &&
                Math.hypot(e.clientX - mouseDownClient.x, e.clientY - mouseDownClient.y) < CLICK_THRESHOLD_PX
            setMouseDownClient(null)
            setIsDragging(false)
            if (wasClick && datasetCase && canvasRendererRef.current?.canvas) {
                const rect = canvasRendererRef.current.canvas.getBoundingClientRect()
                const scaleX = canvasRendererRef.current.canvas.width / rect.width
                const scaleY = canvasRendererRef.current.canvas.height / rect.height
                const canvasX = (e.clientX - rect.left) * scaleX
                const canvasY = (e.clientY - rect.top) * scaleY
                const point = canvasRendererRef.current.getImagePoint(canvasX, canvasY)
                if (!point) return
                if (imageMeta) {
                    const [ox, oy, oz] = imageMeta.origin
                    const [sx, sy, sz] = imageMeta.spacing
                    setClickedXyz({
                        x: ox + point.x * sx,
                        y: oy + point.y * sy,
                        z: oz + sliceIndex * sz,
                    })
                    setClickedVoxel({
                        x: Math.round(point.x),
                        y: Math.round(point.y),
                        z: sliceIndex,
                    })
                }
                fetchWindowFromRoi({
                    volume_id: datasetCase.imageVolumeId,
                    slice_index: sliceIndex,
                    orientation,
                    center_x: point.x,
                    center_y: point.y,
                    radius_mm: WINDOW_ROI_RADIUS_MM,
                })
                    .then(({ level, width }) => {
                        setWindowLevel((prev) => WINDOW_SMOOTH_NEW * level + (1 - WINDOW_SMOOTH_NEW) * prev)
                        setWindowWidth((prev) => WINDOW_SMOOTH_NEW * width + (1 - WINDOW_SMOOTH_NEW) * prev)
                    })
                    .catch(() => {
                        toast.error('Could not set window from region', { duration: 3000 })
                    })
            }
        },
        [mouseDownClient, datasetCase, imageMeta, sliceIndex, orientation]
    )

    const handleReset = useCallback(() => {
        setSliceIndex(0)
        setWindowLevel(DEFAULT_WINDOW_LEVEL)
        setWindowWidth(DEFAULT_WINDOW_WIDTH)
        setZoom(DEFAULT_ZOOM)
        setPan(DEFAULT_PAN)
        setOverlayOpacity(DEFAULT_OVERLAY_OPACITY)
        toast.success('View reset')
    }, [])

    const handleDownloadSlice = useCallback(() => {
        const canvas = canvasRendererRef.current?.canvas
        if (!canvas) {
            toast.error('Canvas not ready')
            return
        }
        const base = datasetCase ? `slice-${datasetCase.caseId}-${sliceIndex}.jpg` : `slice-${sliceIndex}.jpg`
        downloadCanvasAsJpeg(canvas, base)
        toast.success('Slice downloaded')
    }, [datasetCase, sliceIndex])

    if (!datasetCase) return null

    return (
        <Card className="w-full">
            <CardHeader>
                <CardTitle className="text-sm font-medium">
                    {datasetCase.caseId} ({datasetCase.caseIndex + 1} / {datasetCase.caseCount})
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="mx-auto w-full max-w-[512px] space-y-4">
                    {(imageMeta || labelMeta || predMeta) && (
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
                                        ...(imageMeta ? [{ title: 'Image', meta: imageMeta }] : []),
                                        ...(labelMeta && datasetCase.labelVolumeId
                                            ? [{ title: 'Label', meta: labelMeta }]
                                            : []),
                                        ...(predMeta && datasetCase.predVolumeId
                                            ? [{ title: 'Prediction', meta: predMeta }]
                                            : []),
                                    ]}
                                    onClose={() => setVolumeInfoOpen(false)}
                                />
                            </PopoverContent>
                        </Popover>
                    )}
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
                                segmentationSliceUrl={labelSliceUrl ?? null}
                                overlayMode="filled"
                                overlayOpacity={overlayOpacity}
                                overlayVisible={overlayVisible}
                                colorMap={colorMap}
                                predictionSliceUrl={predSliceUrl ?? null}
                                predictionOpacity={overlayOpacity}
                                predictionVisible={predictionVisible}
                                predictionColor={DEFAULT_PRED_COLOR}
                                zoom={zoom}
                                pan={pan}
                                windowLevel={windowLevel}
                                windowWidth={windowWidth}
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

                <div className="flex min-h-9 items-center justify-center">
                    <div className="inline-flex min-w-[14rem] rounded-xl border border-input bg-muted/30 p-0.5" role="group" aria-label="View orientation">
                        {(['axial', 'sagittal', 'coronal'] as const).map((ori) => (
                            <Button
                                key={ori}
                                variant={orientation === ori ? 'default' : 'ghost'}
                                size="sm"
                                className="h-7 flex-1 rounded-lg px-3 text-xs"
                                onClick={() => setOrientation(ori)}
                            >
                                {ori === 'axial' ? 'Axial (Z)' : ori === 'sagittal' ? 'Sagittal (X)' : 'Coronal (Y)'}
                            </Button>
                        ))}
                    </div>
                </div>

                <div className="space-y-2">
                    <div className="flex min-h-9 items-center gap-2">
                        <Label className="text-xs shrink-0">
                            Slice: {sliceIndex} / {maxSliceIndex}
                        </Label>
                        <Slider
                            value={[sliceIndex]}
                            onValueChange={handleSliceChange}
                            min={0}
                            max={maxSliceIndex}
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

                <p className="text-xs text-muted-foreground">Click on image to set level and width from that area.</p>
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label className="text-xs">Window Level: {windowLevel}</Label>
                        <Slider
                            value={[windowLevel]}
                            onValueChange={handleWindowLevelChange}
                            min={-1000}
                            max={1000}
                            step={1}
                            className="w-full"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label className="text-xs">Window Width: {windowWidth}</Label>
                        <Slider
                            value={[windowWidth]}
                            onValueChange={handleWindowWidthChange}
                            min={1}
                            max={2000}
                            step={1}
                            className="w-full"
                        />
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <Label className="text-xs">Zoom: {zoom.toFixed(2)}x</Label>
                    <Button variant="outline" size="icon" onClick={handleZoomOut} className="h-8 w-8">
                        <ZoomOut className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon" onClick={handleZoomIn} className="h-8 w-8">
                        <ZoomIn className="h-4 w-4" />
                    </Button>
                </div>

                <div className="space-y-3 border-t pt-3">
                    {datasetCase.labelVolumeId && datasetCase.predVolumeId && (
                        <div className="flex flex-wrap items-center gap-3 text-xs">
                            <span className="flex items-center gap-1.5">
                                <span className="h-2.5 w-2.5 rounded-sm shrink-0 border border-border" style={{ backgroundColor: colorMap.get(1) ?? DEFAULT_LABEL_COLOR }} aria-hidden />
                                Label
                            </span>
                            <span className="flex items-center gap-1.5">
                                <span className="h-2.5 w-2.5 rounded-sm shrink-0 border border-border" style={{ backgroundColor: DEFAULT_PRED_COLOR }} aria-hidden />
                                Prediction
                            </span>
                        </div>
                    )}
                    {datasetCase.labelVolumeId && (
                        <div className="flex items-center justify-between">
                            <Label className="text-xs">Show Label</Label>
                            <Switch
                                checked={overlayVisible}
                                onCheckedChange={setOverlayVisible}
                            />
                        </div>
                    )}
                    {datasetCase.predVolumeId && (
                        <div className="flex items-center justify-between">
                            <Label className="text-xs">Show Prediction</Label>
                            <Switch
                                checked={predictionVisible}
                                onCheckedChange={setPredictionVisible}
                            />
                        </div>
                    )}
                    {(datasetCase.labelVolumeId || datasetCase.predVolumeId) && (
                        <div className="space-y-2">
                            <Label className="text-xs">Overlay opacity: {(overlayOpacity * 100).toFixed(0)}%</Label>
                            <Slider
                                value={[overlayOpacity]}
                                onValueChange={(v) => setOverlayOpacity(v[0])}
                                min={0}
                                max={1}
                                step={0.01}
                                className="w-full"
                            />
                        </div>
                    )}
                </div>

                <Button variant="outline" onClick={handleReset} className="w-full">
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Reset View
                </Button>
            </CardContent>
        </Card>
    )
}

export function DatasetNav() {
    const datasetCase = useViewerStore((s) => s.datasetCase)
    const setDatasetCase = useViewerStore((s) => s.setDatasetCase)
    const [loading, setLoading] = useState(false)

    const go = useCallback(
        async (delta: number) => {
            if (!datasetCase || loading) return
            const nextIndex = datasetCase.caseIndex + delta
            if (nextIndex < 0 || nextIndex >= datasetCase.caseCount) return
            setLoading(true)
            try {
                const res = await openDatasetCase(datasetCase.datasetId, {
                    case_index: nextIndex,
                })
                setDatasetCase({
                    datasetId: datasetCase.datasetId,
                    caseIndex: res.case_index,
                    caseCount: datasetCase.caseCount,
                    caseId: res.case_id,
                    imageVolumeId: res.image_volume_id,
                    labelVolumeId: res.label_volume_id ?? null,
                    predVolumeId: res.pred_volume_id ?? null,
                })
                if (res.label_all_background) {
                    toast.info('Label is all background', {
                        description: `Case "${res.case_id}" has no segmentation foreground.`,
                    })
                }
            } catch (e) {
                toast.error('Failed to open case', {
                    description: e instanceof Error ? e.message : 'Unknown error',
                })
            } finally {
                setLoading(false)
            }
        },
        [datasetCase, loading, setDatasetCase]
    )

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!datasetCase) return
            if (e.key === 'ArrowLeft') {
                e.preventDefault()
                go(-1)
            } else if (e.key === 'ArrowRight') {
                e.preventDefault()
                go(1)
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [datasetCase, go])

    if (!datasetCase) return null

    const canPrev = datasetCase.caseIndex > 0
    const canNext = datasetCase.caseIndex < datasetCase.caseCount - 1

    return (
        <div className="flex items-center justify-center gap-4 py-2">
            <Button
                variant="outline"
                size="icon"
                onClick={() => go(-1)}
                disabled={!canPrev || loading}
                aria-label="Previous case"
            >
                <span className="text-lg font-bold">←</span>
            </Button>
            <span className="text-sm font-medium min-w-[8rem] text-center">
                Case {datasetCase.caseIndex + 1} / {datasetCase.caseCount}
            </span>
            <Button
                variant="outline"
                size="icon"
                onClick={() => go(1)}
                disabled={!canNext || loading}
                aria-label="Next case"
            >
                <span className="text-lg font-bold">→</span>
            </Button>
        </div>
    )
}

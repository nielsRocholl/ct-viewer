'use client'

import { useCallback, useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useViewerStore } from '@/lib/store'
import { queryKeys, useCTSlice, useSegmentationSlices, useVolumeMetadata, useVolumeMetadatas } from '@/lib/api-hooks'
import { CanvasRenderer, type CanvasRendererHandle } from './canvas-renderer'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Slider } from './ui/slider'
import { Switch } from './ui/switch'
import { Label } from './ui/label'
import { ZoomIn, ZoomOut, RotateCcw, Download } from 'lucide-react'
import { AXIS_MAP } from '@/lib/synchronization'
import {
    fetchCTSlice,
    openDatasetCase,
    fetchWindowFromRoi,
    fetchFirstSliceWithMask,
    submitDatasetDecision,
} from '@/lib/api-client'
import { toast } from 'sonner'
import { generateDistinctColor, DEFAULT_PRED_COLOR } from '@/lib/color-utils'
import { downloadCanvasAsJpeg } from '@/lib/utils'
import { VolumeInfoCard } from './volume-info-card'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { computePairHealth } from '@/lib/health'

const CLICK_THRESHOLD_PX = 6
const WINDOW_ROI_RADIUS_MM = 20
const WINDOW_SMOOTH_NEW = 0.7
const DEFAULT_WINDOW_LEVEL = 40
const DEFAULT_WINDOW_WIDTH = 400
const DEFAULT_ZOOM = 1
const DEFAULT_PAN = { x: 0, y: 0 }
const DEFAULT_OVERLAY_OPACITY = 0.5

export function DatasetViewerPanel() {
    const queryClient = useQueryClient()
    const datasetCase = useViewerStore((s) => s.datasetCase)
    const setDatasetCase = useViewerStore((s) => s.setDatasetCase)
    const snapToMask = useViewerStore((s) => s.snapToMask)
    const cleanDatasetMode = useViewerStore((s) => s.cleanDatasetMode)

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
    const [sliceImageDims, setSliceImageDims] = useState<{ width: number; height: number } | null>(null)
    const canvasRendererRef = useRef<CanvasRendererHandle>(null)
    const segList = datasetCase?.segVolumes ?? []
    const hasPred = segList.some((s) => s.role === 'pred')
    const hasLabel = segList.some((s) => s.role !== 'pred')

    useEffect(() => {
        setSliceIndex(0)
        setOrientation('axial')
        setClickedXyz(null)
        setClickedVoxel(null)
    }, [datasetCase?.caseIndex, datasetCase?.imageVolumeId])

    const volumeId = segList.find((s) => s.role === 'gt')?.volumeId ?? segList[0]?.volumeId ?? null
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
                const cw = el.clientWidth
                const ch = el.clientHeight
                const w = Math.max(1, (cw >> 1) << 1)
                const h = Math.max(1, (ch >> 1) << 1)
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
    const segIds = segList.map((s) => s.volumeId)
    const segMetaQueries = useVolumeMetadatas(segIds)
    const segMetas = segMetaQueries.map((q) => q.data ?? null)
    const axis = AXIS_MAP[orientation]
    const dims = imageMeta?.dimensions
    const maxSliceIndex = dims?.[axis] != null ? dims[axis] - 1 : 0
    useEffect(() => {
        if (sliceIndex > maxSliceIndex && maxSliceIndex >= 0) setSliceIndex(maxSliceIndex)
    }, [orientation, imageMeta?.dimensions, sliceIndex, maxSliceIndex])

    const { data: ctSliceUrl, error: ctSliceError } = useCTSlice(
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
    useEffect(() => {
        setSliceImageDims(null)
    }, [ctSliceUrl])
    const segParams = segList.map((s) => ({
        volume_id: s.volumeId,
        slice_index: sliceIndex,
        orientation,
        mode: 'filled' as const,
        format: 'png' as const,
    }))
    const segQueries = useSegmentationSlices(segParams)
    const segSliceUrls = segQueries.map((q) => q.data ?? null)
    const segErrors = segQueries.map((q) => (q.error instanceof Error ? q.error : null))

    useEffect(() => {
        if (!datasetCase) return
        const maxIdx = maxSliceIndex
        if (maxIdx < 0) return
        const base = {
            volume_id: datasetCase.imageVolumeId,
            orientation,
            window_level: windowLevel,
            window_width: windowWidth,
            format: 'png' as const,
        }
        const idxs = [sliceIndex - 1, sliceIndex + 1]
        idxs.forEach((idx) => {
            if (idx < 0 || idx > maxIdx) return
            const params = { ...base, slice_index: idx }
            queryClient.prefetchQuery({
                queryKey: queryKeys.ctSlice(params),
                queryFn: () => fetchCTSlice(params),
                staleTime: 5 * 60 * 1000,
                gcTime: 10 * 60 * 1000,
            })
        })
    }, [datasetCase, sliceIndex, orientation, windowLevel, windowWidth, maxSliceIndex, queryClient])

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

    const handleDecision = useCallback(
        async (decision: 'accept' | 'reject') => {
            if (!datasetCase) return
            try {
                const res = await submitDatasetDecision(datasetCase.datasetId, {
                    case_id: datasetCase.caseId,
                    decision,
                })
                if (res.next_case_id && res.next_case_index !== null) {
                    const next = await openDatasetCase(datasetCase.datasetId, {
                        case_id: res.next_case_id,
                    })
                    const segVolumes =
                        next.seg_volume_ids?.map((s) => ({
                            volumeId: s.volume_id,
                            role: s.role,
                            name: s.name,
                            allBackground: s.all_background ?? null,
                        })) ??
                        [
                            ...(next.label_volume_id
                                ? [{ volumeId: next.label_volume_id, role: 'gt' as const, name: 'Label', allBackground: next.label_all_background ?? null }]
                                : []),
                            ...(next.pred_volume_id
                                ? [{ volumeId: next.pred_volume_id, role: 'pred' as const, name: 'Prediction', allBackground: null }]
                                : []),
                        ]
                    setDatasetCase({
                        datasetId: datasetCase.datasetId,
                        caseIndex: next.case_index,
                        caseCount: res.case_count,
                        caseId: next.case_id,
                        imageVolumeId: next.image_volume_id,
                        segVolumes,
                        warnings: next.warnings ?? [],
                    })
                } else {
                    setDatasetCase(null)
                    toast.success('All cases reviewed')
                }
            } catch (e) {
                toast.error('Decision failed', {
                    description: e instanceof Error ? e.message : 'Unknown error',
                })
            }
        },
        [datasetCase, setDatasetCase]
    )

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

    const health = computePairHealth(
        imageMeta,
        segMetas.filter((m): m is NonNullable<typeof m> => Boolean(m)),
        ctSliceError ?? null,
        segErrors,
        segList.some((s) => s.role === 'gt' && s.allBackground)
    )
    const healthBadgeClass =
        health.status === 'red'
            ? 'bg-red-500 text-white hover:bg-red-500'
            : health.status === 'orange'
                ? 'bg-amber-400 text-black hover:bg-amber-400'
                : 'bg-emerald-500 text-white hover:bg-emerald-500'
    const healthCounts = health.details.reduce(
        (acc, d) => {
            if (d.status === 'red') acc.fail += 1
            else if (d.status === 'orange') acc.warn += 1
            else acc.pass += 1
            return acc
        },
        { pass: 0, warn: 0, fail: 0 }
    )
    return (
        <div className="space-y-4">
            <div className="flex gap-4 items-stretch min-h-[75vh]">
                <Card className="flex-1 min-w-0 flex flex-col overflow-hidden">
                    <CardHeader className="shrink-0">
                        <CardTitle
                            className="text-base font-semibold tracking-tight truncate"
                            title={`${datasetCase.caseId} (${datasetCase.caseIndex + 1} / ${datasetCase.caseCount})`}
                        >
                            {datasetCase.caseId} ({datasetCase.caseIndex + 1} / {datasetCase.caseCount})
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {datasetCase.warnings && datasetCase.warnings.length > 0 && (
                            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
                                <div className="font-medium mb-1">Warnings</div>
                                <ul className="list-disc pl-4 space-y-1">
                                    {datasetCase.warnings.map((w, i) => (
                                        <li key={`${w}-${i}`}>{w}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {cleanDatasetMode && (
                            <div className="flex items-center justify-end gap-2 border-t pt-3">
                                <Button variant="outline" onClick={() => handleDecision('reject')}>
                                    Reject
                                </Button>
                                <Button onClick={() => handleDecision('accept')}>Accept</Button>
                            </div>
                        )}
                        <div className="w-full space-y-4">
                    {(imageMeta || segMetas.some((m) => m)) && (
                        <div className="flex items-center gap-2">
                                    <Popover open={volumeInfoOpen} onOpenChange={setVolumeInfoOpen}>
                                        <PopoverTrigger asChild>
                                            <Button variant="outline" size="sm" className="flex-1 text-xs">
                                                Volume info
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent
                                            className="w-[var(--radix-popover-trigger-width)] max-w-[90vw] min-w-[320px]"
                                            align="start"
                                            onInteractOutside={(e) => e.preventDefault()}
                                        >
                                    <VolumeInfoCard
                                        volumes={[
                                            ...(imageMeta ? [{ title: 'Image', meta: imageMeta }] : []),
                                            ...segMetas.flatMap((m, i) => {
                                                if (!m) return []
                                                const role = segList[i]?.role
                                                const name = segList[i]?.name
                                                const title = name || (role === 'pred' ? 'Prediction' : 'Label')
                                                return [{ title, meta: m }]
                                            }),
                                        ]}
                                        onClose={() => setVolumeInfoOpen(false)}
                                    />
                                        </PopoverContent>
                                    </Popover>
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <button type="button" aria-label="Health status">
                                                <Badge
                                                    className={`h-8 min-w-7 rounded-sm p-0 flex items-center justify-center text-xs font-semibold ${healthBadgeClass}`}
                                                >
                                                    {health.status === 'red' ? 'F' : health.status === 'orange' ? 'W' : 'P'}
                                                </Badge>
                                            </button>
                                        </PopoverTrigger>
                                        <PopoverContent
                                            className="w-[var(--radix-popover-trigger-width)] max-w-[90vw] min-w-[260px]"
                                            align="end"
                                        >
                                            <div className="space-y-3 text-xs">
                                                <div className="space-y-2">
                                                    <div className="text-sm font-medium text-foreground">Health checks</div>
                                                    <div className="flex flex-wrap gap-2">
                                                        <Badge className="h-5 rounded-sm bg-emerald-500 px-2 py-0 text-[10px] text-white hover:bg-emerald-500">
                                                            Pass {healthCounts.pass}
                                                        </Badge>
                                                        <Badge className="h-5 rounded-sm bg-amber-400 px-2 py-0 text-[10px] text-black hover:bg-amber-400">
                                                            Warn {healthCounts.warn}
                                                        </Badge>
                                                        <Badge className="h-5 rounded-sm bg-red-500 px-2 py-0 text-[10px] text-white hover:bg-red-500">
                                                            Fail {healthCounts.fail}
                                                        </Badge>
                                                    </div>
                                                </div>
                                                <div className="space-y-2 rounded-md border bg-muted/30 p-2">
                                                    {health.details.map((d, i) => (
                                                        <div key={`${d.label}-${i}`} className="flex items-start justify-between gap-3">
                                                            <div className="space-y-0.5">
                                                                <div className="text-foreground">{d.label}</div>
                                                                <div className="text-muted-foreground">{d.message}</div>
                                                            </div>
                                                            <Badge
                                                                className={`h-4 w-4 rounded-full p-0 ${d.status === 'red'
                                                                    ? 'bg-red-500 text-white'
                                                                    : d.status === 'orange'
                                                                        ? 'bg-amber-500 text-black'
                                                                        : 'bg-emerald-500 text-white'
                                                                    }`}
                                                            />
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </PopoverContent>
                                    </Popover>
                                </div>
                            )}
                            <div
                                className="mx-auto w-full"
                                style={sliceImageDims ? { maxWidth: `min(100%, calc(70vh * ${sliceImageDims.width} / ${sliceImageDims.height}))` } : undefined}
                            >
                                <div
                                    ref={canvasContainerRef}
                                    className="relative w-full min-h-0"
                                    style={{ aspectRatio: sliceImageDims ? `${sliceImageDims.width} / ${sliceImageDims.height}` : '1' }}
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
                                        overlayMode="filled"
                                        overlayOpacity={overlayOpacity}
                                        overlayVisible={overlayVisible}
                                        colorMap={new Map()}
                                        overlayLayers={segList.map((s, i) => {
                                            const color =
                                                s.role === 'pred'
                                                    ? DEFAULT_PRED_COLOR
                                                    : generateDistinctColor(i, segList.length)
                                            return {
                                                url: segSliceUrls[i] ?? null,
                                                colorMap: new Map([[1, color]]),
                                                opacity: overlayOpacity,
                                                visible: s.role === 'pred' ? predictionVisible : overlayVisible,
                                            }
                                        })}
                                        zoom={zoom}
                                        pan={pan}
                                        windowLevel={windowLevel}
                                        windowWidth={windowWidth}
                                        width={canvasSize.width}
                                            height={canvasSize.height}
                                            onSliceDimensions={setSliceImageDims}
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
                        </div>
                    </CardContent>
                </Card>
                <Card className="flex-[0_0_42%] min-w-0 flex flex-col overflow-hidden">
                    <CardHeader className="shrink-0">
                        <CardTitle className="text-base font-semibold tracking-tight">Controls</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-5 flex-1 min-h-0 overflow-y-auto">
                        <div className="flex min-h-9 items-center justify-center">
                            <div className="inline-flex min-w-0 rounded-xl border border-input bg-muted/30 p-0.5" role="group" aria-label="View orientation">
                                {(['axial', 'sagittal', 'coronal'] as const).map((ori) => (
                                    <Button
                                        key={ori}
                                        variant={orientation === ori ? 'default' : 'ghost'}
                                        size="sm"
                                        className="h-7 flex-1 rounded-lg px-2 text-xs"
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
                            </div>
                        </div>
                        <p className="text-xs text-muted-foreground">Click on image to set level and width from that area.</p>
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
                            {segList.length > 0 && (
                                <div className="flex flex-wrap items-center gap-3 text-xs">
                                    {segList.map((s, i) => {
                                        const color =
                                            s.role === 'pred'
                                                ? DEFAULT_PRED_COLOR
                                                : generateDistinctColor(i, segList.length)
                                        return (
                                            <span key={`${s.volumeId}-${i}`} className="flex items-center gap-1.5">
                                                <span className="h-2.5 w-2.5 rounded-sm shrink-0 border border-border" style={{ backgroundColor: color }} aria-hidden />
                                                {s.name || (s.role === 'pred' ? 'Prediction' : 'Label')}
                                            </span>
                                        )
                                    })}
                                </div>
                            )}
                            {hasLabel && (
                                <div className="flex items-center justify-between">
                                    <Label className="text-xs">Show Labels</Label>
                                    <Switch checked={overlayVisible} onCheckedChange={setOverlayVisible} />
                                </div>
                            )}
                            {hasPred && (
                                <div className="flex items-center justify-between">
                                    <Label className="text-xs">Show Predictions</Label>
                                    <Switch checked={predictionVisible} onCheckedChange={setPredictionVisible} />
                                </div>
                            )}
                            {(hasLabel || hasPred) && (
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
                        <Button
                            variant="outline"
                            onClick={handleDownloadSlice}
                            className="w-full gap-1.5"
                            aria-label="Download slice as JPEG"
                        >
                            <Download className="h-4 w-4" />
                            Download
                        </Button>
                    </CardContent>
                </Card>
            </div>
        </div>
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
                const segVolumes =
                    res.seg_volume_ids?.map((s) => ({
                        volumeId: s.volume_id,
                        role: s.role,
                        name: s.name,
                        allBackground: s.all_background ?? null,
                    })) ??
                    [
                        ...(res.label_volume_id
                            ? [{ volumeId: res.label_volume_id, role: 'gt' as const, name: 'Label', allBackground: res.label_all_background ?? null }]
                            : []),
                        ...(res.pred_volume_id
                            ? [{ volumeId: res.pred_volume_id, role: 'pred' as const, name: 'Prediction', allBackground: null }]
                            : []),
                    ]
                setDatasetCase({
                    datasetId: datasetCase.datasetId,
                    caseIndex: res.case_index,
                    caseCount: datasetCase.caseCount,
                    caseId: res.case_id,
                    imageVolumeId: res.image_volume_id,
                    segVolumes,
                    warnings: res.warnings ?? [],
                })
                if (segVolumes.some((s) => s.allBackground)) {
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

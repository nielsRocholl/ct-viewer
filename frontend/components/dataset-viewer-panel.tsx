'use client'

import { useCallback, useState, useEffect, useRef, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useViewerStore, type DatasetCaseState } from '@/lib/store'
import { queryKeys, useCTSlice, useSegmentationSlices, useVolumeMetadata, useVolumeMetadatas } from '@/lib/api-hooks'
import { CanvasRenderer, type CanvasRendererHandle } from './canvas-renderer'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Slider } from './ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Switch } from './ui/switch'
import { Label } from './ui/label'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu'
import { ZoomIn, ZoomOut, RotateCcw, Download, Palette } from 'lucide-react'
import { AXIS_MAP } from '@/lib/synchronization'
import {
    fetchCTSlice,
    fetchSegmentationSlice,
    openDatasetCase,
    fetchWindowFromRoi,
    fetchFirstSliceWithMask,
    submitDatasetDecision,
} from '@/lib/api-client'
import { toast } from 'sonner'
import { generateDistinctColor, DEFAULT_PRED_COLOR, createColorMapFromPalette } from '@/lib/color-utils'
import { downloadCanvasAsJpeg } from '@/lib/utils'
import { VolumeInfoCard } from './volume-info-card'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { computePairHealth } from '@/lib/health'
import { WINDOW_PRESETS } from '@/lib/window-presets'

const CLICK_THRESHOLD_PX = 6
const WINDOW_ROI_RADIUS_MM = 20
const WINDOW_SMOOTH_NEW = 0.7
const DEFAULT_WINDOW_LEVEL = 40
const DEFAULT_WINDOW_WIDTH = 400
const DEFAULT_ZOOM = 1
const DEFAULT_PAN = { x: 0, y: 0 }
const DEFAULT_OVERLAY_OPACITY = 0.5

const healthExplain = (label: string): string => {
    if (label.startsWith('Mask ')) return 'Mask metadata loaded and geometry matches CT.'
    if (label === 'Mask content') return 'Mask has foreground voxels.'
    if (label === 'CT slice') return 'CT slices are accessible.'
    if (label === 'CT dimensions') return 'All CT dimensions are positive.'
    if (label === 'CT spacing') return 'All spacing values are positive.'
    if (label === 'CT anisotropy') return 'Max spacing / min spacing ratio is within range.'
    if (label === 'CT orientation') return 'Direction matrix is orthonormal.'
    return 'Check status.'
}

type DatasetSeg = DatasetCaseState['segVolumes'][number]

function mergeSegDisplay(prev: DatasetSeg[] | null | undefined, next: DatasetSeg[]): DatasetSeg[] {
    return next.map((s, i) => ({
        ...s,
        color:
            s.color ??
            prev?.[i]?.color ??
            (s.role === 'pred' ? DEFAULT_PRED_COLOR : generateDistinctColor(i, next.length)),
        visible: s.visible ?? prev?.[i]?.visible ?? true,
        mode: s.mode ?? prev?.[i]?.mode ?? 'filled',
    }))
}

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
    const [localWindowLevel, setLocalWindowLevel] = useState(DEFAULT_WINDOW_LEVEL)
    const [localWindowWidth, setLocalWindowWidth] = useState(DEFAULT_WINDOW_WIDTH)
    const [presetId, setPresetId] = useState<string | null>(null)
    const windowPendingRef = useRef<{ level: number; width: number } | null>(null)
    const windowThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const windowDraggingRef = useRef(false)
    const WINDOW_THROTTLE_MS = 80
    const [zoom, setZoom] = useState(DEFAULT_ZOOM)
    const [pan, setPan] = useState(DEFAULT_PAN)
    const [overlayOpacity, setOverlayOpacity] = useState(DEFAULT_OVERLAY_OPACITY)
    const [isDragging, setIsDragging] = useState(false)
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
    const [mouseDownClient, setMouseDownClient] = useState<{ x: number; y: number } | null>(null)
    const [clickedXyz, setClickedXyz] = useState<{ x: number; y: number; z: number } | null>(null)
    const [clickedVoxel, setClickedVoxel] = useState<{ x: number; y: number; z: number } | null>(null)
    const frameRef = useRef<HTMLDivElement>(null)
    const canvasContainerRef = useRef<HTMLDivElement>(null)
    const [frameSize, setFrameSize] = useState({ width: 512, height: 512 })
    const lastSizeRef = useRef({ width: 512, height: 512 })
    const [canvasSize, setCanvasSize] = useState({ width: 512, height: 512 })
    const canvasRendererRef = useRef<CanvasRendererHandle>(null)
    const snapRequestRef = useRef(0)
    const prefetchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const prefetchRequestIdRef = useRef(0)
    const segList = useMemo(() => datasetCase?.segVolumes ?? [], [datasetCase?.segVolumes])
    const segColorMaps = useMemo(() => {
        const maps = new Map<string, Map<number, string>>()
        segList.forEach((seg) => {
            if (seg.multiLabel && seg.labelValues && seg.labelValues.length > 1) {
                const colorMap = createColorMapFromPalette(seg.labelValues, 'colorblind')
                maps.set(seg.volumeId, colorMap)
            }
        })
        return maps
    }, [segList])
    const getSegColor = (seg: DatasetSeg, index: number) =>
        seg.color ?? (seg.role === 'pred' ? DEFAULT_PRED_COLOR : generateDistinctColor(index, segList.length))

    const updateSegVisible = useCallback(
        (index: number, visible: boolean) => {
            if (!datasetCase) return
            const nextSegs = datasetCase.segVolumes.map((s, i) => (i === index ? { ...s, visible } : s))
            setDatasetCase({ ...datasetCase, segVolumes: nextSegs })
        },
        [datasetCase, setDatasetCase]
    )

    const updateSegColor = useCallback(
        (index: number, color: string) => {
            if (!datasetCase) return
            const nextSegs = datasetCase.segVolumes.map((s, i) => (i === index ? { ...s, color } : s))
            setDatasetCase({ ...datasetCase, segVolumes: nextSegs })
        },
        [datasetCase, setDatasetCase]
    )

    const updateSegMode = useCallback(
        (index: number, mode: 'filled' | 'boundary') => {
            if (!datasetCase) return
            const nextSegs = datasetCase.segVolumes.map((s, i) => (i === index ? { ...s, mode } : s))
            setDatasetCase({ ...datasetCase, segVolumes: nextSegs })
        },
        [datasetCase, setDatasetCase]
    )

    const volumeId = useMemo(() => {
        if (segList.length === 0) return null
        const hasForeground = (s: DatasetSeg) =>
            (s.nonzeroLabelCount ?? 0) > 0 || (s.labelValues?.length ?? 0) > 0 || s.allBackground === false
        const candidates = segList.filter(hasForeground)
        const preferred =
            candidates.find((s) => s.role === 'gt') ??
            candidates[0] ??
            segList.find((s) => s.role === 'gt') ??
            segList[0]
        return preferred?.volumeId ?? null
    }, [segList])
    
    useEffect(() => {
        const requestId = ++snapRequestRef.current
        let retryTimer: ReturnType<typeof setTimeout> | null = null
        setOrientation('axial')
        setClickedXyz(null)
        setClickedVoxel(null)
        
        const trySnap = (attempt: number) => {
            if (!volumeId) return
            fetchFirstSliceWithMask(volumeId, 'axial', true)
                .then((data) => {
                    if (requestId !== snapRequestRef.current) return
                    setSliceIndex(data.slice_index)
                })
                .catch(() => {
                    if (requestId !== snapRequestRef.current) return
                    if (attempt < 2) {
                        retryTimer = setTimeout(() => trySnap(attempt + 1), 200 * (attempt + 1))
                    }
                })
        }

        if (snapToMask && volumeId && datasetCase) {
            trySnap(0)
        } else {
            setSliceIndex(0)
        }
        return () => {
            if (retryTimer) clearTimeout(retryTimer)
        }
    }, [datasetCase?.caseIndex, datasetCase?.imageVolumeId, datasetCase?.segVolumes, snapToMask, volumeId, datasetCase])

    useEffect(() => {
        if (!snapToMask || !volumeId || !datasetCase) {
            return
        }
        if (orientation === 'axial') {
            return
        }
        fetchFirstSliceWithMask(volumeId, orientation, true)
            .then((data) => setSliceIndex(data.slice_index))
            .catch(() => {})
    }, [snapToMask, volumeId, orientation, datasetCase])

    useEffect(() => {
        setClickedXyz(null)
        setClickedVoxel(null)
    }, [sliceIndex])

    useEffect(() => {
        const el = canvasContainerRef.current
        if (!el) return
        let rafId = 0
        let debounceTimer: ReturnType<typeof setTimeout> | null = null
        const MIN_DELTA = 16
        const ro = new ResizeObserver(() => {
            if (debounceTimer) clearTimeout(debounceTimer)
            debounceTimer = setTimeout(() => {
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
            }, 100)
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
            if (debounceTimer) clearTimeout(debounceTimer)
            ro.disconnect()
        }
    }, [])

    const { data: imageMeta } = useVolumeMetadata(datasetCase?.imageVolumeId ?? null)
    const segIds = segList.map((s) => s.volumeId)
    const segMetaQueries = useVolumeMetadatas(segIds)
    const segMetas = segMetaQueries.map((q) => q.data ?? null)
    const axis = AXIS_MAP[orientation]
    const dims = imageMeta?.dimensions
    const sp = imageMeta?.spacing
    const maxSliceIndex = dims?.[axis] != null ? dims[axis] - 1 : 0
    const axialAspect = (() => {
        if (!dims) return 1
        const sx = (sp?.[0] ?? 1) * dims[0]
        const sy = (sp?.[1] ?? 1) * dims[1]
        return sx / sy
    })()
    const sliceAspect = (() => {
        if (!dims) return 1
        const sx = (sp?.[0] ?? 1) * dims[0]
        const sy = (sp?.[1] ?? 1) * dims[1]
        const sz = (sp?.[2] ?? 1) * dims[2]
        if (orientation === 'axial') return sx / sy
        if (orientation === 'sagittal') return sy / sz
        return sx / sz
    })()
    const updateFrameSize = useCallback(() => {
        const el = frameRef.current
        if (!el) return
        const availW = Math.max(1, el.clientWidth)
        const maxH = Math.round(window.innerHeight * 0.7)
        const baseH = Math.min(maxH, availW / axialAspect)
        const h = Math.min(baseH, availW / sliceAspect)
        const w = Math.max(1, Math.round(h * sliceAspect))
        setFrameSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }))
    }, [axialAspect, sliceAspect])

    useEffect(() => {
        updateFrameSize()
    }, [updateFrameSize])

    useEffect(() => {
        const el = frameRef.current
        if (!el) return
        let rafId = 0
        const ro = new ResizeObserver(() => {
            if (rafId) cancelAnimationFrame(rafId)
            rafId = requestAnimationFrame(() => {
                rafId = 0
                updateFrameSize()
            })
        })
        ro.observe(el)
        return () => {
            if (rafId) cancelAnimationFrame(rafId)
            ro.disconnect()
        }
    }, [updateFrameSize])
    useEffect(() => {
        if (sliceIndex > maxSliceIndex && maxSliceIndex > 0) {
            setSliceIndex(maxSliceIndex)
        }
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
    const segParams = segList.map((s) => ({
        volume_id: s.volumeId,
        slice_index: sliceIndex,
        orientation,
        mode: (s.mode ?? 'filled') as 'filled' | 'boundary',
        format: 'png' as const,
    }))
    const segQueries = useSegmentationSlices(segParams)
    const segSliceUrls = segQueries.map((q) => q.data ?? null)
    const segErrors = segQueries.map((q) => (q.error instanceof Error ? q.error : null))

    useEffect(() => {
        if (prefetchDebounceRef.current) {
            clearTimeout(prefetchDebounceRef.current)
            prefetchDebounceRef.current = null
        }
        prefetchRequestIdRef.current += 1
        const requestId = prefetchRequestIdRef.current

        prefetchDebounceRef.current = setTimeout(() => {
            prefetchDebounceRef.current = null
            if (requestId !== prefetchRequestIdRef.current) return

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
            let prefetchCount = 0
            const MAX_CONCURRENT_PREFETCH = 3
            idxs.forEach((idx) => {
                if (idx < 0 || idx > maxIdx || prefetchCount >= MAX_CONCURRENT_PREFETCH) return
                prefetchCount++
                const params = { ...base, slice_index: idx }
                queryClient.prefetchQuery({
                    queryKey: queryKeys.ctSlice(params),
                    queryFn: () => fetchCTSlice(params),
                    staleTime: 5 * 60 * 1000,
                    gcTime: 10 * 60 * 1000,
                })
            })

            if (!datasetCase || segList.length === 0) return
            prefetchCount = 0
            idxs.forEach((slice_index) => {
                if (slice_index < 0 || slice_index > maxIdx || prefetchCount >= MAX_CONCURRENT_PREFETCH) return
                segList.forEach((s) => {
                    if (prefetchCount >= MAX_CONCURRENT_PREFETCH) return
                    prefetchCount++
                    const params = {
                        volume_id: s.volumeId,
                        slice_index,
                        orientation,
                        mode: (s.mode ?? 'filled') as 'filled' | 'boundary',
                        format: 'png' as const,
                    }
                    queryClient.prefetchQuery({
                        queryKey: queryKeys.segSlice(params),
                        queryFn: () => fetchSegmentationSlice(params),
                        staleTime: 5 * 60 * 1000,
                        gcTime: 10 * 60 * 1000,
                    })
                })
            })
        }, 500)

        return () => {
            if (prefetchDebounceRef.current) {
                clearTimeout(prefetchDebounceRef.current)
                prefetchDebounceRef.current = null
            }
        }
    }, [datasetCase, segList, sliceIndex, orientation, windowLevel, windowWidth, maxSliceIndex, queryClient])

    useEffect(() => {
        if (!windowDraggingRef.current) {
            setLocalWindowLevel(windowLevel)
            setLocalWindowWidth(windowWidth)
        }
    }, [windowLevel, windowWidth])

    useEffect(() => {
        return () => {
            if (windowThrottleRef.current) {
                clearTimeout(windowThrottleRef.current)
                windowThrottleRef.current = null
            }
        }
    }, [])

    const handleSliceChange = useCallback((value: number[]) => {
        setSliceIndex(value[0])
    }, [])

    const flushWindowToStore = useCallback(() => {
        const p = windowPendingRef.current
        if (p) {
            setWindowLevel(p.level)
            setWindowWidth(p.width)
        }
        windowThrottleRef.current = null
    }, [])

    const scheduleWindowFlush = useCallback(() => {
        if (windowThrottleRef.current) return
        windowThrottleRef.current = setTimeout(flushWindowToStore, WINDOW_THROTTLE_MS)
    }, [flushWindowToStore])

    const handleWindowLevelChange = useCallback(
        (value: number[]) => {
            const level = value[0]
            setPresetId(null)
            setLocalWindowLevel(level)
            windowDraggingRef.current = true
            windowPendingRef.current = {
                ...(windowPendingRef.current ?? { level: windowLevel, width: windowWidth }),
                level,
            }
            scheduleWindowFlush()
        },
        [windowLevel, windowWidth, scheduleWindowFlush]
    )

    const handleWindowWidthChange = useCallback(
        (value: number[]) => {
            const width = value[0]
            setPresetId(null)
            setLocalWindowWidth(width)
            windowDraggingRef.current = true
            windowPendingRef.current = {
                ...(windowPendingRef.current ?? { level: windowLevel, width: windowWidth }),
                width,
            }
            scheduleWindowFlush()
        },
        [windowLevel, windowWidth, scheduleWindowFlush]
    )

    const handleWindowLevelCommit = useCallback(() => {
        if (windowThrottleRef.current) {
            clearTimeout(windowThrottleRef.current)
            windowThrottleRef.current = null
        }
        setWindowLevel(localWindowLevel)
        setWindowWidth(localWindowWidth)
        windowPendingRef.current = null
        windowDraggingRef.current = false
    }, [localWindowLevel, localWindowWidth])

    const handleWindowWidthCommit = useCallback(() => {
        if (windowThrottleRef.current) {
            clearTimeout(windowThrottleRef.current)
            windowThrottleRef.current = null
        }
        setWindowLevel(localWindowLevel)
        setWindowWidth(localWindowWidth)
        windowPendingRef.current = null
        windowDraggingRef.current = false
    }, [localWindowLevel, localWindowWidth])

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
                    const segVolumesRaw =
                        next.seg_volume_ids?.map((s) => ({
                            volumeId: s.volume_id,
                            role: s.role,
                            name: s.name,
                            allBackground: s.all_background ?? null,
                            componentCount: s.component_count ?? null,
                            multiLabel: s.multi_label ?? null,
                            nonzeroLabelCount: s.nonzero_label_count ?? null,
                            labelValues: s.label_values ?? null,
                        })) ??
                        [
                            ...(next.label_volume_id
                                ? [{
                                    volumeId: next.label_volume_id,
                                    role: 'gt' as const,
                                    name: 'Label',
                                    allBackground: next.label_all_background ?? null,
                                    componentCount: null,
                                    multiLabel: null,
                                    nonzeroLabelCount: null,
                                    labelValues: null,
                                }]
                                : []),
                            ...(next.pred_volume_id
                                ? [{
                                    volumeId: next.pred_volume_id,
                                    role: 'pred' as const,
                                    name: 'Prediction',
                                    allBackground: null,
                                    componentCount: null,
                                    multiLabel: null,
                                    nonzeroLabelCount: null,
                                    labelValues: null,
                                }]
                                : []),
                        ]
                    const segVolumes = mergeSegDisplay(datasetCase.segVolumes, segVolumesRaw)
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

    const labelStats = useMemo(
        () =>
            segList.map((seg, i) => {
                const name = seg.name ?? (seg.role === 'pred' ? 'Prediction' : seg.role === 'gt' ? 'Label' : `Segmentation ${i + 1}`)
                return {
                    name,
                    stats: {
                        all_background: seg.allBackground ?? null,
                        component_count: seg.componentCount ?? null,
                        multi_label: seg.multiLabel ?? null,
                        nonzero_label_count: seg.nonzeroLabelCount ?? null,
                    },
                }
            }),
        [segList]
    )

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
                                            <Button variant="outline" size="sm" className="text-xs">
                                                Segmentation Info
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent
                                            className="w-[var(--radix-popover-trigger-width)] max-w-[90vw] min-w-[260px]"
                                            align="end"
                                        >
                                            <div className="space-y-3 text-xs">
                                                <div className="text-sm font-medium text-foreground">Segmentation Info</div>
                                                <div className="space-y-2 rounded-md border bg-muted/30 p-2">
                                                    {labelStats.map((s, i) => (
                                                        <div key={`${s.name}-${i}`} className="space-y-1">
                                                            <div className="text-foreground">{s.name}</div>
                                                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
                                                                <div>Foreground: {s.stats.all_background === null ? 'Unknown' : s.stats.all_background ? 'No' : 'Yes'}</div>
                                                                <div>Components: {s.stats.component_count ?? '—'}</div>
                                                                <div>Multi‑label: {s.stats.multi_label === null ? '—' : s.stats.multi_label ? 'Yes' : 'No'}</div>
                                                                <div>Labels: {s.stats.nonzero_label_count ?? '—'}</div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
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
                                                            <Popover>
                                                                <PopoverTrigger asChild>
                                                                    <button type="button" aria-label={`${d.label} explanation`}>
                                                                        <Badge
                                                                            className={`h-4 w-4 rounded-full p-0 ${d.status === 'red'
                                                                                ? 'bg-red-500 text-white'
                                                                                : d.status === 'orange'
                                                                                    ? 'bg-amber-500 text-black'
                                                                                    : 'bg-emerald-500 text-white'
                                                                                }`}
                                                                        />
                                                                    </button>
                                                                </PopoverTrigger>
                                                                <PopoverContent className="max-w-[220px]" align="end">
                                                                    <div className="text-xs text-foreground">{healthExplain(d.label)}</div>
                                                                </PopoverContent>
                                                            </Popover>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </PopoverContent>
                                    </Popover>
                                </div>
                            )}
                            <div
                                ref={frameRef}
                                className="mx-auto w-full flex items-center justify-center"
                                style={{ minHeight: frameSize.height }}
                            >
                                <div
                                    ref={canvasContainerRef}
                                    className="relative min-h-0"
                                    style={{ width: frameSize.width, height: frameSize.height }}
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
                                            overlayVisible={segList.some((s) => s.visible !== false)}
                                            colorMap={new Map()}
                                            overlayLayers={segList.map((s, i) => {
                                                const multiLabelColorMap = segColorMaps.get(s.volumeId)
                                                const colorMap = multiLabelColorMap ?? new Map([[1, getSegColor(s, i)]])
                                                return {
                                                    url: segSliceUrls[i] ?? null,
                                                    colorMap,
                                                    opacity: overlayOpacity,
                                                    visible: s.visible !== false,
                                                }
                                            })}
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
                            <Select
                                value={presetId ?? ''}
                                onValueChange={(val) => {
                                    const preset = WINDOW_PRESETS.find((p) => p.id === val)
                                    if (!preset) return
                                    setPresetId(preset.id)
                                    setLocalWindowLevel(preset.wl)
                                    setLocalWindowWidth(preset.ww)
                                    setWindowLevel(preset.wl)
                                    setWindowWidth(preset.ww)
                                }}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Window preset" />
                                </SelectTrigger>
                                <SelectContent>
                                    {WINDOW_PRESETS.map((p) => (
                                        <SelectItem key={p.id} value={p.id}>
                                            {p.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-xs">Window Level: {localWindowLevel}</Label>
                            <Slider
                                value={[localWindowLevel]}
                                onValueChange={handleWindowLevelChange}
                                onValueCommit={handleWindowLevelCommit}
                                min={-1000}
                                max={1000}
                                step={1}
                                className="w-full"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-xs">Window Width: {localWindowWidth}</Label>
                            <Slider
                                value={[localWindowWidth]}
                                onValueChange={handleWindowWidthChange}
                                onValueCommit={handleWindowWidthCommit}
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
                            {segList.map((s, i) => {
                                const multiLabelColorMap = segColorMaps.get(s.volumeId)
                                const colors = multiLabelColorMap
                                    ? Array.from(multiLabelColorMap.values())
                                    : [getSegColor(s, i)]
                                return (
                                    <div key={`${s.volumeId}-${i}`} className="flex items-center gap-2 min-w-0">
                                        <div className="flex gap-0.5 shrink-0">
                                            {colors.map((color, idx) => (
                                                <span
                                                    key={idx}
                                                    className="h-3 w-3 rounded border border-border"
                                                    style={{ backgroundColor: color }}
                                                    aria-hidden
                                                />
                                            ))}
                                        </div>
                                        <Label className="text-xs min-w-0 flex-1 truncate">
                                            {s.name || (s.role === 'pred' ? 'Prediction' : s.role === 'gt' ? 'Label' : `Mask ${i + 1}`)}
                                        </Label>
                                    {s.role && (
                                        <Badge
                                            variant={s.role === 'pred' ? 'secondary' : 'default'}
                                            className="h-5 rounded-sm px-1.5 text-[10px] shrink-0"
                                        >
                                            {s.role === 'pred' ? 'Pred' : 'GT'}
                                        </Badge>
                                    )}
                                    <Switch
                                        checked={s.visible !== false}
                                        onCheckedChange={(v) => updateSegVisible(i, v)}
                                    />
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="outline" size="sm">
                                                {(s.mode ?? 'filled') === 'filled' ? 'Filled' : 'Boundary'}
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent>
                                            <DropdownMenuItem onClick={() => updateSegMode(i, 'filled')}>Filled</DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => updateSegMode(i, 'boundary')}>Boundary</DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 shrink-0"
                                            >
                                                <Palette className="h-4 w-4" />
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-48">
                                            <input
                                                type="color"
                                                value={getSegColor(s, i)}
                                                onChange={(e) => updateSegColor(i, e.target.value)}
                                                className="w-full h-8 cursor-pointer rounded"
                                            />
                                        </PopoverContent>
                                    </Popover>
                                    </div>
                                )
                            })}
                            {segList.length > 0 && (
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
                const segVolumesRaw =
                    res.seg_volume_ids?.map((s) => ({
                        volumeId: s.volume_id,
                        role: s.role,
                        name: s.name,
                        allBackground: s.all_background ?? null,
                        componentCount: s.component_count ?? null,
                        multiLabel: s.multi_label ?? null,
                        nonzeroLabelCount: s.nonzero_label_count ?? null,
                        labelValues: s.label_values ?? null,
                    })) ??
                    [
                        ...(res.label_volume_id
                            ? [{
                                volumeId: res.label_volume_id,
                                role: 'gt' as const,
                                name: 'Label',
                                allBackground: res.label_all_background ?? null,
                                componentCount: null,
                                multiLabel: null,
                                nonzeroLabelCount: null,
                                labelValues: null,
                            }]
                            : []),
                        ...(res.pred_volume_id
                            ? [{
                                volumeId: res.pred_volume_id,
                                role: 'pred' as const,
                                name: 'Prediction',
                                allBackground: null,
                                componentCount: null,
                                multiLabel: null,
                                nonzeroLabelCount: null,
                                labelValues: null,
                            }]
                            : []),
                    ]
                const segVolumes = mergeSegDisplay(datasetCase.segVolumes, segVolumesRaw)
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

'use client'

import { useCallback, useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useViewerStore } from '@/lib/store'
import { mergeSegDisplay, type DatasetSeg } from '@/lib/dataset-seg-merge'
import { queryKeys, useCTSlice, useSegmentationSlices, useVolumeMetadata, useVolumeMetadatas, useDice } from '@/lib/api-hooks'
import { CanvasRenderer, type CanvasRendererHandle } from './canvas-renderer'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Slider } from './ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Switch } from './ui/switch'
import { Label } from './ui/label'
import { Input } from './ui/input'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'
import {
    ZoomIn,
    ZoomOut,
    RotateCcw,
    Download,
    ChevronLeft,
    ChevronRight,
    ChevronDown,
    ChevronUp,
} from 'lucide-react'
import { AXIS_MAP } from '@/lib/synchronization'
import {
    fetchCTSlice,
    fetchSegmentationSlice,
    openDatasetCase,
    fetchWindowFromRoi,
    fetchFirstSliceWithMask,
    fetchSliceForComponent,
    submitDatasetDecision,
} from '@/lib/api-client'
import { toast } from 'sonner'
import {
    generateDistinctColor,
    DEFAULT_PRED_COLOR,
    createColorMapFromPalette,
    recordToColorMap,
} from '@/lib/color-utils'
import { cn, downloadCanvasAsJpeg } from '@/lib/utils'
import { VolumeInfoCard } from './volume-info-card'
import { DatasetCaseNav } from './dataset-case-nav'
import { HexColorPopover } from './hex-color-popover'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { computePairHealth } from '@/lib/health'
import { WINDOW_PRESETS } from '@/lib/window-presets'
import { useViewerCanvasWheel } from '@/lib/use-viewer-canvas-wheel'

const CLICK_THRESHOLD_PX = 6
const WINDOW_ROI_RADIUS_MM = 20
const WINDOW_SMOOTH_NEW = 0.7
const DEFAULT_WINDOW_LEVEL = 40
const DEFAULT_WINDOW_WIDTH = 400
const DEFAULT_ZOOM = 1
const DEFAULT_PAN = { x: 0, y: 0 }
const DEFAULT_OVERLAY_OPACITY = 0.5
/** When segmentation count ≥ this, list is behind a collapse toggle by default. */
const SEG_LIST_COLLAPSE_AT = 4

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
    const viewerRowRef = useRef<HTMLDivElement>(null)
    const controlsCardRef = useRef<HTMLDivElement>(null)
    const canvasBudgetRef = useRef<HTMLDivElement>(null)
    const frameRef = useRef<HTMLDivElement>(null)
    const canvasContainerRef = useRef<HTMLDivElement>(null)
    const sliceWheelRef = useRef<HTMLDivElement>(null)
    const [frameSize, setFrameSize] = useState({ width: 512, height: 512 })
    const [canvasSize, setCanvasSize] = useState({ width: 512, height: 512 })
    const canvasRendererRef = useRef<CanvasRendererHandle>(null)
    const snapRequestRef = useRef(0)
    const [componentIndexByVolumeId, setComponentIndexByVolumeId] = useState<Record<string, number>>({})
    const prefetchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const prefetchRequestIdRef = useRef(0)
    const segList = useMemo(() => datasetCase?.segVolumes ?? [], [datasetCase?.segVolumes])
    const manySegs = segList.length >= SEG_LIST_COLLAPSE_AT
    const [maskPanelOpen, setMaskPanelOpen] = useState(!manySegs)
    useEffect(() => {
        setMaskPanelOpen(!manySegs)
    }, [manySegs, datasetCase?.caseId])
    const segColorMaps = useMemo(() => {
        const maps = new Map<string, Map<number, string>>()
        segList.forEach((seg, i) => {
            const labelValues = seg.labelValues ?? []
            if (labelValues.length > 1) {
                const colorMap =
                    seg.colorMap && Object.keys(seg.colorMap).length > 0
                        ? recordToColorMap(seg.colorMap)
                        : createColorMapFromPalette(labelValues, 'colorblind', i)
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

    const updateSegLabelColor = useCallback(
        (index: number, labelValue: number, color: string) => {
            if (!datasetCase) return
            const seg = datasetCase.segVolumes[index]
            if (!seg) return
            const prevMap = seg.colorMap ?? {}
            const nextMap = { ...prevMap, [String(labelValue)]: color }
            const nextSegs = datasetCase.segVolumes.map((s, i) =>
                i === index ? { ...s, colorMap: nextMap } : s
            )
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

    const updateSegName = useCallback(
        (index: number, name: string) => {
            if (!datasetCase) return
            const nextSegs = datasetCase.segVolumes.map((s, i) =>
                i === index ? { ...s, name: name || undefined } : s
            )
            setDatasetCase({ ...datasetCase, segVolumes: nextSegs })
        },
        [datasetCase, setDatasetCase]
    )

    const updateSegRole = useCallback(
        (index: number, role: 'gt' | 'pred' | undefined) => {
            if (!datasetCase) return
            const nextSegs = datasetCase.segVolumes.map((s, i) =>
                i === index ? { ...s, role } : s
            )
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

    const segVolumeIdsKey = (datasetCase?.segVolumes ?? []).map((s) => s.volumeId).join('\0')
    const snapMaskComponentCount =
        volumeId == null
            ? 0
            : (datasetCase?.segVolumes ?? []).find((s) => s.volumeId === volumeId)?.componentCount ?? 0

    const gtVolumeId = segList.find((s) => s.role === 'gt')?.volumeId ?? null
    const predVolumeId = segList.find((s) => s.role === 'pred')?.volumeId ?? null
    const { data: diceData } = useDice(gtVolumeId, predVolumeId)
    
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
                    setComponentIndexByVolumeId((prev) => ({ ...prev, [volumeId]: 1 }))
                })
                .catch(() => {
                    if (requestId !== snapRequestRef.current) return
                    if (attempt < 2) {
                        retryTimer = setTimeout(() => trySnap(attempt + 1), 200 * (attempt + 1))
                    }
                })
        }

        if (snapToMask && volumeId) {
            trySnap(0)
        } else {
            setSliceIndex(0)
        }
        return () => {
            if (retryTimer) clearTimeout(retryTimer)
        }
    }, [datasetCase?.caseIndex, datasetCase?.imageVolumeId, segVolumeIdsKey, snapToMask, volumeId])

    useEffect(() => {
        setComponentIndexByVolumeId({})
    }, [datasetCase?.caseIndex, datasetCase?.caseId])

    useEffect(() => {
        if (!snapToMask || !volumeId) {
            return
        }
        if (orientation === 'axial') {
            return
        }
        const compIdx = componentIndexByVolumeId[volumeId]
        const total = snapMaskComponentCount
        if (compIdx != null && total > 1 && compIdx >= 1 && compIdx <= total) {
            fetchSliceForComponent(volumeId, orientation, compIdx)
                .then((data) => setSliceIndex(data.slice_index))
                .catch(() => {})
        } else {
            fetchFirstSliceWithMask(volumeId, orientation, true)
                .then((data) => setSliceIndex(data.slice_index))
                .catch(() => {})
        }
    }, [snapToMask, volumeId, orientation, componentIndexByVolumeId, snapMaskComponentCount])

    useEffect(() => {
        setClickedXyz(null)
        setClickedVoxel(null)
    }, [sliceIndex])

    const { data: imageMeta } = useVolumeMetadata(datasetCase?.imageVolumeId ?? null)
    const segIds = segList.map((s) => s.volumeId)
    const segMetaQueries = useVolumeMetadatas(segIds)
    const segMetas = segMetaQueries.map((q) => q.data ?? null)
    const axis = AXIS_MAP[orientation]
    const dims = imageMeta?.dimensions
    const sp = imageMeta?.spacing
    const maxSliceIndex = dims?.[axis] != null ? dims[axis] - 1 : 0
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
        const row = viewerRowRef.current
        const budget = canvasBudgetRef.current
        if (!row || !budget) return
        const chRaw = budget.clientHeight
        if (chRaw < 2) return
        const ctrlW = controlsCardRef.current?.offsetWidth ?? 0
        const gapPx = 16
        const maxW = Math.max(1, row.clientWidth - ctrlW - 3 * gapPx)
        const ch = Math.max(1, chRaw)
        const ar = sliceAspect
        let w = Math.min(maxW, Math.floor(ch * ar))
        let h = Math.max(1, Math.floor(w / ar))
        if (h > ch) {
            h = ch
            w = Math.max(1, Math.floor(h * ar))
        }
        w = Math.max(1, (w >> 1) << 1)
        h = Math.max(1, (h >> 1) << 1)
        setFrameSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }))
        setCanvasSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }))
    }, [sliceAspect])

    useEffect(() => {
        updateFrameSize()
    }, [updateFrameSize])

    useLayoutEffect(() => {
        let rafId = 0
        const schedule = () => {
            if (rafId) cancelAnimationFrame(rafId)
            rafId = requestAnimationFrame(() => {
                rafId = 0
                updateFrameSize()
            })
        }
        const ro = new ResizeObserver(schedule)
        const row = viewerRowRef.current
        const budget = canvasBudgetRef.current
        if (row) ro.observe(row)
        if (budget) ro.observe(budget)
        schedule()
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

            if (!datasetCase || segList.length === 0) return
            idxs.forEach((slice_index) => {
                if (slice_index < 0 || slice_index > maxIdx) return
                segList.forEach((s) => {
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
        }, 220)

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

    useViewerCanvasWheel(
        sliceWheelRef,
        Boolean(datasetCase),
        maxSliceIndex,
        () => sliceIndex,
        (n) => handleSliceChange([n]),
        () => zoom,
        (z) => setZoom(z)
    )

    const handleSnapToComponent = useCallback(
        async (volumeId: string, delta: number) => {
            const seg = segList.find((s) => s.volumeId === volumeId)
            const total = seg?.componentCount ?? 0
            if (total < 2) return
            const current = componentIndexByVolumeId[volumeId] ?? 1
            const next = Math.max(1, Math.min(total, current + delta))
            if (next === current) return
            setComponentIndexByVolumeId((prev) => ({ ...prev, [volumeId]: next }))
            try {
                const data = await fetchSliceForComponent(volumeId, orientation, next)
                setSliceIndex(data.slice_index)
            } catch {
                toast.error('Could not snap to component')
            }
        },
        [segList, componentIndexByVolumeId, orientation]
    )

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
                        label_values: seg.labelValues ?? null,
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
        <div className="flex min-h-0 flex-1 flex-col">
            <div ref={viewerRowRef} className="flex min-h-0 min-w-0 flex-1 gap-4">
                <div className="min-h-0 min-w-0 flex-1 shrink" aria-hidden />
                <Card className="flex h-full w-fit max-w-full shrink-0 flex-col overflow-hidden">
                    <CardHeader className="shrink-0">
                        <div className="min-w-0" style={{ width: frameSize.width }}>
                            <CardTitle
                                className="truncate text-base font-semibold tracking-tight"
                                title={`${datasetCase.caseId} (${datasetCase.caseIndex + 1} / ${datasetCase.caseCount})`}
                            >
                                {datasetCase.caseId}
                            </CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
                        {cleanDatasetMode && (
                            <div className="flex shrink-0 items-center justify-end gap-2 border-t pt-3">
                                <Button variant="outline" onClick={() => handleDecision('reject')}>
                                    Reject
                                </Button>
                                <Button onClick={() => handleDecision('accept')}>Accept</Button>
                            </div>
                        )}
                        <div
                            className="flex min-h-0 min-w-0 flex-1 flex-col gap-4"
                            style={{ width: frameSize.width }}
                        >
                            {(imageMeta || segMetas.some((m) => m)) && (
                                <div className="flex shrink-0 flex-wrap items-center gap-2">
                                    <Popover open={volumeInfoOpen} onOpenChange={setVolumeInfoOpen}>
                                        <PopoverTrigger asChild>
                                            <Button variant="outline" size="sm" className="min-w-0 shrink text-xs">
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
                                                                {s.stats.label_values && s.stats.label_values.length > 0 && (
                                                                    <div className="col-span-2">
                                                                        Values: {s.stats.label_values.join(', ')}
                                                                    </div>
                                                                )}
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
                                ref={canvasBudgetRef}
                                className="flex min-h-0 min-w-0 flex-1 flex-col"
                            >
                                <div
                                    ref={frameRef}
                                    className="flex min-h-0 min-w-0 w-full flex-1 items-center justify-center"
                                >
                                    <div
                                        ref={canvasContainerRef}
                                        className="relative min-h-0 shrink-0"
                                        style={{ width: frameSize.width, height: frameSize.height }}
                                    >
                                        <div
                                            ref={sliceWheelRef}
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
                                                <div className="absolute top-2 right-2 space-y-0.5 rounded bg-black/70 px-2 py-1 font-mono text-xs text-white pointer-events-none">
                                                    <div>physical: x {clickedXyz.x.toFixed(1)}  y {clickedXyz.y.toFixed(1)}  z {clickedXyz.z.toFixed(1)} mm</div>
                                                    <div>voxel: x {clickedVoxel.x}  y {clickedVoxel.y}  z {clickedVoxel.z}</div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card
                    ref={controlsCardRef}
                    className="flex w-full max-w-[28rem] shrink-0 flex-col overflow-hidden"
                >
                    <CardHeader className="flex shrink-0 flex-col gap-3 space-y-0">
                        <CardTitle className="text-base font-semibold tracking-tight">Controls</CardTitle>
                        <DatasetCaseNav className="w-full justify-center" />
                    </CardHeader>
                    <CardContent className="min-w-0 space-y-5 flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
                        {datasetCase.warnings && datasetCase.warnings.length > 0 && (
                            <div className="shrink-0 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
                                <div className="mb-1 font-medium">Warnings</div>
                                <ul className="list-disc space-y-1 pl-4">
                                    {datasetCase.warnings.map((w, i) => (
                                        <li key={`${w}-${i}`}>{w}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
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
                        {segList.some((s) => (s.componentCount ?? 0) > 1) && (
                            <div className="space-y-2">
                                <Label className="text-xs">Component navigation</Label>
                                <div className="space-y-1.5">
                                    {segList
                                        .filter((s) => (s.componentCount ?? 0) > 1)
                                        .map((s, i) => {
                                            const total = s.componentCount ?? 0
                                            const current = componentIndexByVolumeId[s.volumeId] ?? 1
                                            const name = s.name ?? (s.role === 'pred' ? 'Prediction' : s.role === 'gt' ? 'Label' : `Segmentation ${i + 1}`)
                                            return (
                                                <div key={s.volumeId} className="flex items-center gap-2 text-xs">
                                                    <span className="min-w-0 truncate flex-1">{name}</span>
                                                    <div className="flex items-center gap-0.5 shrink-0">
                                                        <Button
                                                            variant="outline"
                                                            size="icon"
                                                            className="h-6 w-6"
                                                            onClick={() => handleSnapToComponent(s.volumeId, -1)}
                                                            disabled={current <= 1}
                                                        >
                                                            <ChevronLeft className="h-3 w-3" />
                                                        </Button>
                                                        <span className="min-w-[3ch] text-center tabular-nums">
                                                            {current}/{total}
                                                        </span>
                                                        <Button
                                                            variant="outline"
                                                            size="icon"
                                                            className="h-6 w-6"
                                                            onClick={() => handleSnapToComponent(s.volumeId, 1)}
                                                            disabled={current >= total}
                                                        >
                                                            <ChevronRight className="h-3 w-3" />
                                                        </Button>
                                                    </div>
                                                </div>
                                            )
                                        })}
                                </div>
                            </div>
                        )}
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
                        <div className="min-w-0 space-y-3 border-t pt-3">
                            {gtVolumeId && predVolumeId && diceData && (
                                <div className="flex items-center gap-2 text-xs">
                                    <span className="text-muted-foreground">DICE:</span>
                                    <Badge variant="outline" className="font-mono">
                                        {diceData.dice.toFixed(4)}
                                    </Badge>
                                </div>
                            )}
                            {manySegs && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-8 w-full justify-between gap-2 px-2"
                                    onClick={() => setMaskPanelOpen((o) => !o)}
                                    aria-expanded={maskPanelOpen}
                                >
                                    <span className="truncate text-xs">
                                        Masks ({segList.length})
                                    </span>
                                    {maskPanelOpen ? (
                                        <ChevronUp className="h-4 w-4 shrink-0" />
                                    ) : (
                                        <ChevronDown className="h-4 w-4 shrink-0" />
                                    )}
                                </Button>
                            )}
                            <div
                                className={cn(
                                    'min-w-0 space-y-3',
                                    manySegs && !maskPanelOpen && 'hidden'
                                )}
                            >
                            {segList.map((s, i) => {
                                const multiLabelColorMap = segColorMaps.get(s.volumeId)
                                return (
                                    <div
                                        key={`${s.volumeId}-${i}`}
                                        className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-2"
                                    >
                                        <div className="flex min-w-0 flex-1 items-center gap-2">
                                            {multiLabelColorMap ? (
                                                <div
                                                    className="flex max-w-[5.5rem] shrink-0 gap-0.5 overflow-x-auto py-0.5 [scrollbar-width:thin]"
                                                    title={
                                                        multiLabelColorMap.size > 5
                                                            ? `${multiLabelColorMap.size} labels`
                                                            : undefined
                                                    }
                                                >
                                                    {Array.from(multiLabelColorMap.entries())
                                                        .sort(([a], [b]) => a - b)
                                                        .map(([labelVal, color]) => (
                                                            <HexColorPopover
                                                                key={labelVal}
                                                                value={color}
                                                                onChange={(hex) =>
                                                                    updateSegLabelColor(i, labelVal, hex)
                                                                }
                                                                className="h-6 w-6 shrink-0"
                                                                ariaLabel={`Color for label ${labelVal}`}
                                                                title={`Label ${labelVal}`}
                                                            />
                                                        ))}
                                                </div>
                                            ) : (
                                                <HexColorPopover
                                                    value={getSegColor(s, i)}
                                                    onChange={(hex) => updateSegColor(i, hex)}
                                                    className="h-7 w-7 shrink-0"
                                                />
                                            )}
                                            <Input
                                                value={s.name ?? ''}
                                                onChange={(e) => updateSegName(i, e.target.value)}
                                                placeholder={
                                                    s.role === 'pred'
                                                        ? 'Prediction'
                                                        : s.role === 'gt'
                                                          ? 'Label'
                                                          : `Mask ${i + 1}`
                                                }
                                                className="h-7 min-w-0 flex-1 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-1"
                                            />
                                        </div>
                                        <div className="flex min-w-0 flex-wrap items-center gap-1 sm:shrink-0">
                                            <div className="flex items-center gap-1 shrink-0">
                                                <Button
                                                    type="button"
                                                    variant={s.role === 'gt' ? 'default' : 'outline'}
                                                    size="sm"
                                                    className="h-5 px-1.5 text-[10px]"
                                                    onClick={() => updateSegRole(i, s.role === 'gt' ? undefined : 'gt')}
                                                >
                                                    GT
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant={s.role === 'pred' ? 'default' : 'outline'}
                                                    size="sm"
                                                    className="h-5 px-1.5 text-[10px]"
                                                    onClick={() => updateSegRole(i, s.role === 'pred' ? undefined : 'pred')}
                                                >
                                                    Pred
                                                </Button>
                                            </div>
                                            <Switch
                                                checked={s.visible !== false}
                                                onCheckedChange={(v) => updateSegVisible(i, v)}
                                            />
                                            <ToggleGroup
                                                type="single"
                                                value={s.mode ?? 'filled'}
                                                onValueChange={(v) => {
                                                    if (v === 'filled' || v === 'boundary') updateSegMode(i, v)
                                                }}
                                                className="inline-flex h-5 shrink-0 gap-0 overflow-hidden rounded-md border border-input bg-background p-0 shadow-sm"
                                                aria-label="Mask display: solid fill or boundary outline"
                                            >
                                                <ToggleGroupItem
                                                    value="filled"
                                                    title="Solid fill inside the segmentation"
                                                    className="h-5 min-w-0 shrink-0 rounded-none border-0 px-1.5 text-[10px] font-medium text-muted-foreground shadow-none data-[state=on]:bg-accent data-[state=on]:text-accent-foreground"
                                                >
                                                    Fill
                                                </ToggleGroupItem>
                                                <ToggleGroupItem
                                                    value="boundary"
                                                    title="Draw only the mask boundary (contour)"
                                                    className="h-5 min-w-0 shrink-0 rounded-none border-0 border-l border-input px-1.5 text-[10px] font-medium text-muted-foreground shadow-none data-[state=on]:bg-accent data-[state=on]:text-accent-foreground"
                                                >
                                                    Outline
                                                </ToggleGroupItem>
                                            </ToggleGroup>
                                        </div>
                                    </div>
                                )
                            })}
                            </div>
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
                <div className="min-h-0 min-w-0 flex-1 shrink" aria-hidden />
            </div>
        </div>
    )
}

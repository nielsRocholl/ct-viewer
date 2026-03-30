'use client'

import { useCallback, useState, useEffect, useRef, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useViewerStore, getPairSegVolumes } from '@/lib/store'
import {
    queryKeys,
    useCTSlice,
    useSegmentationSlices,
    usePairMetadata,
    useAddSegmentToPair,
    useUploadVolume,
    useDice,
} from '@/lib/api-hooks'
import { CanvasRenderer, type CanvasRendererHandle } from './canvas-renderer'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Slider } from './ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Switch } from './ui/switch'
import { Label } from './ui/label'
import { Input } from './ui/input'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'
import { ZoomIn, ZoomOut, RotateCcw, Download, Plus, Trash2, ChevronDown, ChevronUp, Crosshair } from 'lucide-react'
import {
    AXIS_MAP,
    convertIndexToPhysical,
    convertPhysicalToIndex,
    physicalToIndexFromMetadata,
} from '@/lib/synchronization'
import { fetchCTSlice, fetchSegmentationSlice, fetchWindowFromRoi } from '@/lib/api-client'
import { cn, downloadCanvasAsJpeg } from '@/lib/utils'
import { VolumeInfoCard } from './volume-info-card'
import { HexColorPopover } from './hex-color-popover'
import { toast } from 'sonner'
import {
    createColorMapFromPalette,
    generateDistinctColor,
    DEFAULT_LABEL_COLOR,
} from '@/lib/color-utils'
import type { OverlayLayerSpec } from './canvas-renderer'
import { computePairHealth } from '@/lib/health'
import { WINDOW_PRESETS } from '@/lib/window-presets'
import { useViewerCanvasWheel } from '@/lib/use-viewer-canvas-wheel'

const CLICK_THRESHOLD_PX = 6
const SEG_LIST_COLLAPSE_AT = 4
const WINDOW_ROI_RADIUS_MM = 20
const WINDOW_SMOOTH_NEW = 0.7

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

export interface ViewerPanelProps {
    pairId: string
}

export function ViewerPanel({ pairId }: ViewerPanelProps) {
    const queryClient = useQueryClient()
    const pair = useViewerStore((state) => state.pairs.get(pairId))
    const synchronized = useViewerStore((state) => state.synchronized)
    const globalSlicePhysical = useViewerStore((state) => state.globalSlicePhysical)
    const globalSliceNormalized = useViewerStore((state) => state.globalSliceNormalized)
    const syncMode = useViewerStore((state) => state.syncMode)
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
    const updateSegMode = useViewerStore((state) => state.updateSegMode)
    const updateSegColorMap = useViewerStore((state) => state.updateSegColorMap)
    const updateSegName = useViewerStore((state) => state.updateSegName)
    const updateSegRole = useViewerStore((state) => state.updateSegRole)
    const resetPairView = useViewerStore((state) => state.resetPairView)
    const setGlobalSlicePhysical = useViewerStore((state) => state.setGlobalSlicePhysical)
    const setGlobalSliceNormalized = useViewerStore((state) => state.setGlobalSliceNormalized)
    const controlsExpanded = useViewerStore((state) => state.pairControlsExpanded.get(pairId) ?? true)
    const setPairControlsExpanded = useViewerStore((state) => state.setPairControlsExpanded)

    const [isDragging, setIsDragging] = useState(false)
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
    const [mouseDownClient, setMouseDownClient] = useState<{ x: number; y: number } | null>(null)
    const [presetId, setPresetId] = useState<string | null>(null)
    const [clickedXyz, setClickedXyz] = useState<{ x: number; y: number; z: number } | null>(null)
    const [clickedVoxel, setClickedVoxel] = useState<{ x: number; y: number; z: number } | null>(null)
    const [goToBarOpen, setGoToBarOpen] = useState(false)
    const [goToX, setGoToX] = useState('')
    const [goToY, setGoToY] = useState('')
    const [goToZ, setGoToZ] = useState('')
    const [goToMode, setGoToMode] = useState<'voxel' | 'physical'>('voxel')
    const [markerPosition, setMarkerPosition] = useState<{ x: number; y: number } | null>(null)
    const canvasRendererRef = useRef<CanvasRendererHandle>(null)
    const frameRef = useRef<HTMLDivElement>(null)
    const canvasContainerRef = useRef<HTMLDivElement>(null)
    const sliceWheelRef = useRef<HTMLDivElement>(null)
    const [frameSize, setFrameSize] = useState({ width: 512, height: 512 })
    const lastSizeRef = useRef({ width: 512, height: 512 })
    const [canvasSize, setCanvasSize] = useState({ width: 512, height: 512 })
    const [isUpdatingFromSync, setIsUpdatingFromSync] = useState(false)
    const [volumeInfoOpen, setVolumeInfoOpen] = useState(false)
    const addMaskInputRef = useRef<HTMLInputElement>(null)
    const markerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const slicePrefetchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const slicePrefetchGenRef = useRef(0)

    const [localWindowLevel, setLocalWindowLevel] = useState(pair?.windowLevel ?? 40)
    const [localWindowWidth, setLocalWindowWidth] = useState(pair?.windowWidth ?? 400)
    const windowPendingRef = useRef<{ level: number; width: number } | null>(null)
    const windowThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const windowDraggingRef = useRef(false)
    const WINDOW_THROTTLE_MS = 80
    const uploadVolumeMutation = useUploadVolume()
    const addSegmentMutation = useAddSegmentToPair()

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
                    const w = Math.max(1, (el.clientWidth >> 1) << 1)
                    const h = Math.max(1, (el.clientHeight >> 1) << 1)
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

    const { data: pairMetadata } = usePairMetadata(pairId)
    const syncingRef = useRef(false)

    useEffect(() => {
        setClickedXyz(null)
        setClickedVoxel(null)
    }, [pair?.currentSliceIndex])

    useEffect(() => {
        if (!synchronized || (syncMode !== 'overlap' && syncMode !== 'reference')) return
        if (globalSlicePhysical === null || syncingRef.current) return
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
    }, [synchronized, syncMode, globalSlicePhysical, pairId, updatePairSlice, pairMetadata?.ct_metadata, pair?.orientation])

    useEffect(() => {
        if (!synchronized || syncMode !== 'union' || globalSliceNormalized === null || syncingRef.current) return
        const currentPair = useViewerStore.getState().pairs.get(pairId)
        if (!currentPair) return
        const meta = pairMetadata?.ct_metadata ?? null
        if (!meta) return
        const ori = currentPair.orientation ?? 'axial'
        const axis = AXIS_MAP[ori]
        const maxIdx = meta.dimensions[axis] - 1
        if (maxIdx <= 0) return
        const sliceIndex = Math.round(globalSliceNormalized * maxIdx)
        if (sliceIndex !== currentPair.currentSliceIndex) {
            syncingRef.current = true
            updatePairSlice(pairId, sliceIndex)
            syncingRef.current = false
        }
    }, [synchronized, syncMode, globalSliceNormalized, pairId, updatePairSlice, pairMetadata?.ct_metadata])

    const orientation = pair?.orientation ?? 'axial'
    const segVolumes = useMemo(() => (pair ? getPairSegVolumes(pair) : []), [pair])
    const manySegs = segVolumes.length >= SEG_LIST_COLLAPSE_AT
    const [maskPanelOpen, setMaskPanelOpen] = useState(!manySegs)
    useEffect(() => {
        setMaskPanelOpen(!manySegs)
    }, [manySegs, pairId])
    const baseSegParams = pair
        ? {
            slice_index: pair.currentSliceIndex,
            orientation,
            mode: pair.overlayMode,
            format: 'png' as const,
        }
        : null
    const segParams = baseSegParams
        ? segVolumes.map((seg) => ({
            ...baseSegParams,
            volume_id: seg.volumeId,
            mode: seg.mode ?? 'filled',
        }))
        : []

    const gtVolumeId = segVolumes.find((s) => s.role === 'gt')?.volumeId ?? null
    const predVolumeId = segVolumes.find((s) => s.role === 'pred')?.volumeId ?? null
    const { data: diceData } = useDice(gtVolumeId, predVolumeId)

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
    const segQueries = useSegmentationSlices(segParams)
    const segSliceUrls = segQueries.map((q) => q.data ?? null)
    const segErrors = segQueries.map((q) => (q.error instanceof Error ? q.error : null))
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

    useEffect(() => {
        if (!pair || windowDraggingRef.current) return
        setLocalWindowLevel(pair.windowLevel)
        setLocalWindowWidth(pair.windowWidth)
    }, [pair])

    useEffect(() => {
        return () => {
            if (windowThrottleRef.current) {
                clearTimeout(windowThrottleRef.current)
                windowThrottleRef.current = null
            }
        }
    }, [])


    const handleSliceChange = useCallback(
        async (value: number[]) => {
            if (!pair) return

            const newSliceIndex = value[0]
            updatePairSlice(pairId, newSliceIndex)

            if (synchronized && !isUpdatingFromSync) {
                try {
                    const ori = pair.orientation ?? 'axial'
                    if (syncMode === 'union' && pairMetadata?.ct_metadata) {
                        const axis = AXIS_MAP[ori]
                        const maxIdx = pairMetadata.ct_metadata.dimensions[axis] - 1
                        const frac = maxIdx > 0 ? newSliceIndex / maxIdx : 0
                        setGlobalSliceNormalized(frac)
                    } else {
                        const meta = pairMetadata?.ct_metadata ?? null
                        if (meta) {
                            const axis = AXIS_MAP[ori]
                            setGlobalSlicePhysical(meta.origin[axis] + meta.spacing[axis] * newSliceIndex)
                        } else {
                            setGlobalSlicePhysical(await convertIndexToPhysical(pairId, newSliceIndex, ori))
                        }
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
            syncMode,
            updatePairSlice,
            setGlobalSlicePhysical,
            setGlobalSliceNormalized,
            pairMetadata?.ct_metadata,
        ]
    )

    const flushWindowToStore = useCallback(() => {
        const p = windowPendingRef.current
        if (pair && p) {
            updatePairWindowLevel(pairId, p.level, p.width)
        }
        windowThrottleRef.current = null
    }, [pairId, pair, updatePairWindowLevel])

    const scheduleWindowFlush = useCallback(() => {
        if (windowThrottleRef.current) return
        windowThrottleRef.current = setTimeout(flushWindowToStore, WINDOW_THROTTLE_MS)
    }, [flushWindowToStore])

    const handleWindowLevelChange = useCallback(
        (value: number[]) => {
            if (!pair) return
            const level = value[0]
            setPresetId(null)
            setLocalWindowLevel(level)
            windowDraggingRef.current = true
            windowPendingRef.current = {
                ...(windowPendingRef.current ?? { level: pair.windowLevel, width: pair.windowWidth }),
                level,
            }
            scheduleWindowFlush()
        },
        [pair, scheduleWindowFlush]
    )

    const handleWindowWidthChange = useCallback(
        (value: number[]) => {
            if (!pair) return
            const width = value[0]
            setPresetId(null)
            setLocalWindowWidth(width)
            windowDraggingRef.current = true
            windowPendingRef.current = {
                ...(windowPendingRef.current ?? { level: pair.windowLevel, width: pair.windowWidth }),
                width,
            }
            scheduleWindowFlush()
        },
        [pair, scheduleWindowFlush]
    )

    const handleWindowLevelCommit = useCallback(() => {
        if (windowThrottleRef.current) {
            clearTimeout(windowThrottleRef.current)
            windowThrottleRef.current = null
        }
        if (pair) {
            updatePairWindowLevel(pairId, localWindowLevel, localWindowWidth)
            windowPendingRef.current = null
        }
        windowDraggingRef.current = false
    }, [pairId, pair, localWindowLevel, localWindowWidth, updatePairWindowLevel])

    const handleWindowWidthCommit = useCallback(() => {
        if (windowThrottleRef.current) {
            clearTimeout(windowThrottleRef.current)
            windowThrottleRef.current = null
        }
        if (pair) {
            updatePairWindowLevel(pairId, localWindowLevel, localWindowWidth)
            windowPendingRef.current = null
        }
        windowDraggingRef.current = false
    }, [pairId, pair, localWindowLevel, localWindowWidth, updatePairWindowLevel])

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

    const handleMaskModeChange = useCallback(
        (index: number, mode: 'filled' | 'boundary') => {
            updateSegMode(pairId, index, mode)
        },
        [pairId, updateSegMode]
    )

    const handleColorChange = useCallback(
        (color: string, segIndex: number) => {
            if (pair && segVolumes[segIndex]) {
                const newColorMap = new Map(segVolumes[segIndex].colorMap)
                newColorMap.set(1, color)
                updateSegColorMap(pairId, segIndex, newColorMap)
            }
        },
        [pairId, pair, segVolumes, updateSegColorMap]
    )

    const handleSegLabelColorChange = useCallback(
        (segIndex: number, labelValue: number, color: string) => {
            if (pair && segVolumes[segIndex]) {
                const newColorMap = new Map(segVolumes[segIndex].colorMap)
                newColorMap.set(labelValue, color)
                updateSegColorMap(pairId, segIndex, newColorMap)
            }
        },
        [pairId, pair, segVolumes, updateSegColorMap]
    )

    const handleGoToSearch = useCallback(async () => {
        if (!pair || !pairMetadata?.ct_metadata) return
        const meta = pairMetadata.ct_metadata
        const ori = pair.orientation ?? 'axial'
        const dims = meta.dimensions
        const [ox, oy, oz] = meta.origin
        const [sx, sy, sz] = meta.spacing

        let i: number, j: number, k: number
        if (goToMode === 'voxel') {
            i = Math.round(parseFloat(goToX) || 0)
            j = Math.round(parseFloat(goToY) || 0)
            k = Math.round(parseFloat(goToZ) || 0)
        } else {
            const px = parseFloat(goToX) || 0
            const py = parseFloat(goToY) || 0
            const pz = parseFloat(goToZ) || 0
            i = Math.round((px - ox) / sx)
            j = Math.round((py - oy) / sy)
            k = Math.round((pz - oz) / sz)
        }

        const inBounds =
            i >= 0 && i < dims[0] && j >= 0 && j < dims[1] && k >= 0 && k < dims[2]
        if (!inBounds) {
            toast.error('Coordinates out of bounds', {
                description: `Valid range: X [0, ${dims[0] - 1}], Y [0, ${dims[1] - 1}], Z [0, ${dims[2] - 1}]`,
            })
            return
        }

        let sliceIndex: number
        let markerImgX: number
        let markerImgY: number
        if (ori === 'axial') {
            sliceIndex = Math.max(0, Math.min(k, dims[2] - 1))
            markerImgX = Math.max(0, Math.min(i, dims[0] - 1))
            markerImgY = Math.max(0, Math.min(j, dims[1] - 1))
        } else if (ori === 'sagittal') {
            sliceIndex = Math.max(0, Math.min(i, dims[0] - 1))
            markerImgX = Math.max(0, Math.min(j, dims[1] - 1))
            markerImgY = Math.max(0, Math.min(k, dims[2] - 1))
        } else {
            sliceIndex = Math.max(0, Math.min(j, dims[1] - 1))
            markerImgX = Math.max(0, Math.min(i, dims[0] - 1))
            markerImgY = Math.max(0, Math.min(k, dims[2] - 1))
        }

        handleSliceChange([sliceIndex])
        if (markerTimeoutRef.current) clearTimeout(markerTimeoutRef.current)
        setMarkerPosition({ x: markerImgX, y: markerImgY })
        markerTimeoutRef.current = setTimeout(() => {
            setMarkerPosition(null)
            markerTimeoutRef.current = null
        }, 3000)
    }, [pair, pairMetadata?.ct_metadata, pairId, goToMode, goToX, goToY, goToZ, handleSliceChange])

    const handleAddMask = useCallback(
        async (e: React.ChangeEvent<HTMLInputElement>) => {
            const files = Array.from(e.target.files ?? [])
            e.target.value = ''
            if (files.length === 0 || !pair) return
            const toAdd = Math.min(files.length, 20 - segVolumes.length)
            if (toAdd <= 0) return
            try {
                for (let i = 0; i < toAdd; i++) {
                    const file = files[i]
                    const vol = await uploadVolumeMutation.mutateAsync(file)
                    const updated = await addSegmentMutation.mutateAsync({
                        pairId,
                        request: { seg_volume_id: vol.volume_id, auto_resample: true },
                    })
                    const lastMeta = updated.seg_metadatas?.length
                        ? updated.seg_metadatas[updated.seg_metadatas.length - 1]
                        : null
                    const volumeId = lastMeta?.volume_id ?? vol.volume_id
                    const lastStats = updated.seg_stats?.[updated.seg_stats.length - 1]
                    const labelValues = lastStats?.label_values ?? []
                    const colorMap =
                        labelValues.length > 1
                            ? createColorMapFromPalette(labelValues, 'colorblind', segVolumes.length + i)
                            : new Map([[1, generateDistinctColor(segVolumes.length + i)]])
                    addSegToPair(pairId, volumeId, colorMap)
                }
                toast.success(toAdd === 1 ? 'Mask added' : `${toAdd} masks added`)
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
    const dims = pairMetadata?.ct_metadata?.dimensions
    const sp = pairMetadata?.ct_metadata?.spacing
    const maxSliceIndex = dims?.[axis] ?? 100
    const maxSliceIdxInclusive = maxSliceIndex - 1

    useViewerCanvasWheel(
        sliceWheelRef,
        Boolean(pair),
        maxSliceIdxInclusive,
        () => useViewerStore.getState().pairs.get(pairId)?.currentSliceIndex ?? 0,
        (n) => {
            void handleSliceChange([n])
        },
        () => useViewerStore.getState().pairs.get(pairId)?.zoom ?? 1,
        (z) => updatePairZoom(pairId, z)
    )

    const sliceAspect = (() => {
        if (!dims) return 1
        const sx = (sp?.[0] ?? 1) * dims[0]
        const sy = (sp?.[1] ?? 1) * dims[1]
        const sz = (sp?.[2] ?? 1) * dims[2]
        if ((pair?.orientation ?? 'axial') === 'axial') return sx / sy
        if ((pair?.orientation ?? 'axial') === 'sagittal') return sy / sz
        return sx / sz
    })()
    const updateFrameSize = useCallback(() => {
        const el = frameRef.current
        if (!el) return
        const availW = Math.max(1, el.clientWidth)
        const top = el.getBoundingClientRect().top
        const inset = 16 /* matches main content p-4 */
        const availH = Math.max(96, window.innerHeight - top - inset)
        const hIdeal = availW / sliceAspect
        const h = Math.max(1, Math.min(Math.floor(hIdeal), Math.floor(availH)))
        const w = Math.max(1, Math.round(h * sliceAspect))
        const we = (w >> 1) << 1
        const he = (h >> 1) << 1
        setFrameSize((prev) => (prev.width === we && prev.height === he ? prev : { width: we, height: he }))
    }, [sliceAspect])

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
        if (!pair || !pairMetadata) return
        const maxIdx = maxSliceIndex - 1
        if (pair.currentSliceIndex > maxIdx && maxIdx >= 0) {
            updatePairSlice(pairId, maxIdx)
        }
    }, [pair, pairMetadata, pairId, updatePairSlice, maxSliceIndex])

    useEffect(() => {
        if (slicePrefetchDebounceRef.current) {
            clearTimeout(slicePrefetchDebounceRef.current)
            slicePrefetchDebounceRef.current = null
        }
        slicePrefetchGenRef.current += 1
        const gen = slicePrefetchGenRef.current
        slicePrefetchDebounceRef.current = setTimeout(() => {
            slicePrefetchDebounceRef.current = null
            if (gen !== slicePrefetchGenRef.current) return
            if (!pair) return
            const maxIdx = maxSliceIndex - 1
            if (maxIdx < 0) return
            const ori = pair.orientation ?? 'axial'
            const base = {
                volume_id: pair.ctVolumeId,
                orientation: ori,
                window_level: pair.windowLevel,
                window_width: pair.windowWidth,
                format: 'png' as const,
            }
            const idxs = [pair.currentSliceIndex - 1, pair.currentSliceIndex + 1]
            idxs.forEach((sliceIndex) => {
                if (sliceIndex < 0 || sliceIndex > maxIdx) return
                const params = { ...base, slice_index: sliceIndex }
                queryClient.prefetchQuery({
                    queryKey: queryKeys.ctSlice(params),
                    queryFn: () => fetchCTSlice(params),
                    staleTime: 5 * 60 * 1000,
                    gcTime: 10 * 60 * 1000,
                })
            })
            if (segVolumes.length === 0) return
            idxs.forEach((slice_index) => {
                if (slice_index < 0 || slice_index > maxIdx) return
                segVolumes.forEach((seg) => {
                    const params = {
                        volume_id: seg.volumeId,
                        slice_index,
                        orientation: ori,
                        mode: seg.mode ?? 'filled',
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
        }, 140)
        return () => {
            if (slicePrefetchDebounceRef.current) {
                clearTimeout(slicePrefetchDebounceRef.current)
                slicePrefetchDebounceRef.current = null
            }
        }
    }, [
        pair,
        pair?.currentSliceIndex,
        pair?.orientation,
        pair?.windowLevel,
        pair?.windowWidth,
        pair?.ctVolumeId,
        segVolumes,
        maxSliceIndex,
        queryClient,
    ])

    useEffect(() => {
        if (!pair || !pairMetadata?.seg_stats || segVolumes.length === 0) return
        pairMetadata.seg_stats.forEach((stats, i) => {
            const labelValues = stats.label_values ?? []
            if (labelValues.length <= 1) return
            const seg = segVolumes[i]
            if (!seg) return
            const keys = Array.from(seg.colorMap.keys())
            if (keys.length > 1) return
            const colorMap = createColorMapFromPalette(labelValues, 'colorblind', i)
            updateSegColorMap(pairId, i, colorMap)
        })
    }, [pairId, pair, pairMetadata?.seg_stats, segVolumes, updateSegColorMap])

    const orientationLabel = { axial: 'Axial (Z)', sagittal: 'Sagittal (X)', coronal: 'Coronal (Y)' } as const
    const health = useMemo(
        () =>
            computePairHealth(
                pairMetadata?.ct_metadata,
                pairMetadata?.seg_metadatas ?? (pairMetadata?.seg_metadata ? [pairMetadata.seg_metadata] : []),
                ctSliceError ?? null,
                segErrors
            ),
        [pairMetadata, ctSliceError, segErrors]
    )
    const healthBadgeClass =
        health.status === 'red'
            ? 'bg-red-500 text-white hover:bg-red-500'
            : health.status === 'orange'
                ? 'bg-amber-400 text-black hover:bg-amber-400'
                : 'bg-emerald-500 text-white hover:bg-emerald-500'
    const healthCounts = useMemo(
        () =>
            health.details.reduce(
                (acc, d) => {
                    if (d.status === 'red') acc.fail += 1
                    else if (d.status === 'orange') acc.warn += 1
                    else acc.pass += 1
                    return acc
                },
                { pass: 0, warn: 0, fail: 0 }
            ),
        [health.details]
    )
    const labelStats = useMemo(
        () =>
            segVolumes.map((seg, i) => {
                const name = seg.name ?? (seg.role === 'pred' ? 'Prediction' : seg.role === 'gt' ? 'Label' : `Segmentation ${i + 1}`)
                const stats = pairMetadata?.seg_stats?.[i]
                return { name, stats }
            }),
        [segVolumes, pairMetadata?.seg_stats]
    )

    if (!pair) {
        return (
            <Card>
                <CardContent className="p-6">
                    <p className="text-muted-foreground">Pair not found</p>
                </CardContent>
            </Card>
        )
    }

    return (
        <Card className="w-full min-w-0 overflow-hidden">
            <CardHeader>
                <CardTitle className="text-sm font-medium">Pair {pairId.slice(0, 8)}</CardTitle>
            </CardHeader>
            <CardContent className="min-w-0 space-y-4 overflow-x-hidden">
                <div className="mx-auto w-full min-w-0 max-w-[512px] space-y-4">
                    {pairMetadata && (
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
                                            { title: 'Image', meta: pairMetadata.ct_metadata },
                                            ...(pairMetadata.seg_metadata
                                                ? [{ title: 'Label', meta: pairMetadata.seg_metadata }]
                                                : []),
                                        ]}
                                        onClose={() => setVolumeInfoOpen(false)}
                                    />
                                </PopoverContent>
                            </Popover>
                            {segVolumes.length > 0 && (
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
                                                            <div>Foreground: {s.stats ? (s.stats.all_background ? 'No' : 'Yes') : 'Unknown'}</div>
                                                            <div>Components: {s.stats ? s.stats.component_count : '—'}</div>
                                                            <div>Multi‑label: {s.stats ? (s.stats.multi_label ? 'Yes' : 'No') : '—'}</div>
                                                            <div>Labels: {s.stats ? s.stats.nonzero_label_count : '—'}</div>
                                                            {s.stats?.label_values && s.stats.label_values.length > 0 && (
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
                            )}
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
                    {/* Canvas Renderer */}
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
                                    markerPosition={markerPosition}
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

                {/* Controls collapse toggle */}
                <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 rounded-md border border-transparent py-2 px-1 text-left text-sm font-medium hover:bg-muted/50 hover:border-border transition-colors"
                    onClick={() => setPairControlsExpanded(pairId, !controlsExpanded)}
                    aria-expanded={controlsExpanded}
                >
                    <span>Controls</span>
                    {controlsExpanded ? (
                        <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                </button>

                {controlsExpanded && (
                    <>
                        {/* Go to coordinates */}
                        <div className="space-y-2">
                            <Button
                                variant="outline"
                                size="sm"
                                className="w-full gap-2"
                                onClick={() => setGoToBarOpen((o) => !o)}
                            >
                                <Crosshair className="h-4 w-4" />
                                Go to coordinates
                            </Button>
                            {goToBarOpen && (
                                <div className="space-y-2 rounded-lg border bg-muted/30 p-2">
                                    <div
                                        className="inline-flex h-8 w-full items-center justify-center rounded-lg bg-muted p-0.5 text-muted-foreground"
                                        role="tablist"
                                        aria-label="Coordinate mode"
                                    >
                                        <button
                                            type="button"
                                            role="tab"
                                            aria-selected={goToMode === 'voxel'}
                                            onClick={() => setGoToMode('voxel')}
                                            className={cn(
                                                'inline-flex flex-1 items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-[11px] font-medium transition-all sm:text-xs',
                                                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                                                goToMode === 'voxel'
                                                    ? 'bg-background text-foreground shadow'
                                                    : 'text-muted-foreground hover:text-foreground/80'
                                            )}
                                        >
                                            Voxel
                                        </button>
                                        <button
                                            type="button"
                                            role="tab"
                                            aria-selected={goToMode === 'physical'}
                                            onClick={() => setGoToMode('physical')}
                                            className={cn(
                                                'inline-flex flex-1 items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-[11px] font-medium transition-all sm:text-xs',
                                                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                                                goToMode === 'physical'
                                                    ? 'bg-background text-foreground shadow'
                                                    : 'text-muted-foreground hover:text-foreground/80'
                                            )}
                                        >
                                            Physical (mm)
                                        </button>
                                    </div>
                                    <div className="flex gap-1">
                                        <Input
                                            placeholder="X"
                                            value={goToX}
                                            onChange={(e) => setGoToX(e.target.value)}
                                            className="h-8 text-xs"
                                        />
                                        <Input
                                            placeholder="Y"
                                            value={goToY}
                                            onChange={(e) => setGoToY(e.target.value)}
                                            className="h-8 text-xs"
                                        />
                                        <Input
                                            placeholder="Z"
                                            value={goToZ}
                                            onChange={(e) => setGoToZ(e.target.value)}
                                            className="h-8 text-xs"
                                        />
                                    </div>
                                    <Button
                                        size="sm"
                                        className="w-full"
                                        onClick={() => handleGoToSearch()}
                                    >
                                        Find
                                    </Button>
                                </div>
                            )}
                        </div>

                        {/* Viewing direction toggle */}
                        <div className="flex min-h-9 items-center justify-center">
                            <div
                                className="grid h-8 w-full max-w-md grid-cols-3 items-center justify-center gap-0.5 rounded-lg bg-muted p-0.5 text-muted-foreground"
                                role="tablist"
                                aria-label="View orientation"
                            >
                                {(['axial', 'sagittal', 'coronal'] as const).map((ori) => (
                                    <button
                                        key={ori}
                                        type="button"
                                        role="tab"
                                        aria-selected={pair.orientation === ori}
                                        onClick={() => updatePairOrientation(pairId, ori)}
                                        className={cn(
                                            'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-[11px] font-medium transition-all sm:text-xs',
                                            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                                            pair.orientation === ori
                                                ? 'bg-background text-foreground shadow'
                                                : 'text-muted-foreground hover:text-foreground/80'
                                        )}
                                    >
                                        {orientationLabel[ori]}
                                    </button>
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
                        <div className="space-y-2">
                            <Select
                                value={presetId ?? ''}
                                onValueChange={(val) => {
                                    const preset = WINDOW_PRESETS.find((p) => p.id === val)
                                    if (!preset || !pair) return
                                    setPresetId(preset.id)
                                    setLocalWindowLevel(preset.wl)
                                    setLocalWindowWidth(preset.ww)
                                    updatePairWindowLevel(pairId, preset.wl, preset.ww)
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
                        <div className="grid grid-cols-2 gap-4">
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
                        <div className="min-w-0 space-y-3 border-t pt-3">
                            {gtVolumeId && predVolumeId && diceData && (
                                <div className="flex items-center gap-2 text-xs">
                                    <span className="text-muted-foreground">DICE:</span>
                                    <Badge variant="outline" className="font-mono">
                                        {diceData.dice.toFixed(4)}
                                    </Badge>
                                </div>
                            )}
                            {segVolumes.length > 1 && (
                                <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
                                    {segVolumes.map((seg, i) => {
                                        const stats = pairMetadata?.seg_stats?.[i]
                                        const labelValues = stats?.label_values ?? []
                                        const multiLabel = labelValues.length > 1
                                        const colors = multiLabel
                                            ? labelValues.map((lv) => seg.colorMap.get(lv) ?? DEFAULT_LABEL_COLOR)
                                            : [seg.colorMap.get(1) ?? DEFAULT_LABEL_COLOR]
                                        return (
                                            <span key={i} className="flex max-w-full min-w-0 items-center gap-1.5">
                                                <div className="flex max-w-[4.5rem] gap-0.5 overflow-x-auto [scrollbar-width:thin]">
                                                    {colors.map((c, j) => (
                                                        <span
                                                            key={j}
                                                            className="h-2.5 w-2.5 shrink-0 rounded-sm border border-border"
                                                            style={{ backgroundColor: c }}
                                                            aria-hidden
                                                        />
                                                    ))}
                                                </div>
                                                <span className="shrink-0">Mask {i + 1}</span>
                                            </span>
                                        )
                                    })}
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
                                    <span className="truncate text-xs">Masks ({segVolumes.length})</span>
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
                            {segVolumes.map((seg, i) => {
                                const stats = pairMetadata?.seg_stats?.[i]
                                const labelValues = stats?.label_values ?? []
                                const multiLabel = labelValues.length > 1
                                return (
                                    <div
                                        key={i}
                                        className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-2"
                                    >
                                        <div className="flex min-w-0 flex-1 items-center gap-2">
                                            {multiLabel ? (
                                                <div
                                                    className="flex max-w-[5.5rem] shrink-0 gap-0.5 overflow-x-auto py-0.5 [scrollbar-width:thin]"
                                                    title={
                                                        labelValues.length > 5
                                                            ? `${labelValues.length} labels`
                                                            : undefined
                                                    }
                                                >
                                                    {labelValues
                                                        .slice()
                                                        .sort((a, b) => a - b)
                                                        .map((labelVal) => (
                                                            <HexColorPopover
                                                                key={labelVal}
                                                                value={
                                                                    seg.colorMap.get(labelVal) ??
                                                                    DEFAULT_LABEL_COLOR
                                                                }
                                                                onChange={(hex) =>
                                                                    handleSegLabelColorChange(
                                                                        i,
                                                                        labelVal,
                                                                        hex
                                                                    )
                                                                }
                                                                className="h-6 w-6 shrink-0"
                                                                ariaLabel={`Color for label ${labelVal}`}
                                                                title={`Label ${labelVal}`}
                                                            />
                                                        ))}
                                                </div>
                                            ) : (
                                                <HexColorPopover
                                                    value={
                                                        seg.colorMap.get(1) ?? DEFAULT_LABEL_COLOR
                                                    }
                                                    onChange={(hex) => handleColorChange(hex, i)}
                                                    className="h-7 w-7 shrink-0"
                                                />
                                            )}
                                            <Input
                                                value={seg.name ?? ''}
                                                onChange={(e) => updateSegName(pairId, i, e.target.value)}
                                                placeholder={`Mask ${i + 1}`}
                                                className="h-7 min-w-0 flex-1 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-1"
                                            />
                                        </div>
                                        <div className="flex min-w-0 flex-wrap items-center gap-1 sm:shrink-0">
                                            <div className="flex items-center gap-1 shrink-0">
                                                <Button
                                                    type="button"
                                                    variant={seg.role === 'gt' ? 'default' : 'outline'}
                                                    size="sm"
                                                    className="h-5 px-1.5 text-[10px]"
                                                    onClick={() => updateSegRole(pairId, i, seg.role === 'gt' ? undefined : 'gt')}
                                                >
                                                    GT
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant={seg.role === 'pred' ? 'default' : 'outline'}
                                                    size="sm"
                                                    className="h-5 px-1.5 text-[10px]"
                                                    onClick={() => updateSegRole(pairId, i, seg.role === 'pred' ? undefined : 'pred')}
                                                >
                                                    Pred
                                                </Button>
                                            </div>
                                            <Switch
                                                checked={seg.visible !== false}
                                                onCheckedChange={(v) => updateSegVisible(pairId, i, v)}
                                            />
                                            <ToggleGroup
                                                type="single"
                                                value={seg.mode ?? 'filled'}
                                                onValueChange={(v) => {
                                                    if (v === 'filled' || v === 'boundary')
                                                        handleMaskModeChange(i, v)
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
                                    </div>
                                )
                            })}
                            </div>
                            {segVolumes.length > 0 && (
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
                            )}
                            {segVolumes.length < 20 && (
                                <>
                                    <input
                                        ref={addMaskInputRef}
                                        type="file"
                                        accept=".nii,.gz,.mha,.mhd"
                                        multiple
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
                    </>
                )}
            </CardContent>
        </Card>
    )
}

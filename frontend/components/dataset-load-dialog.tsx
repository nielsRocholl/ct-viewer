'use client'

import { useState, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { registerDataset, openDatasetCase, fetchDatasetCaseStatistics } from '@/lib/api-client'
import type {
    CaseStatisticsResponse,
    OpenCaseResponse,
    RegisterDatasetResponse,
    SegmentationDir,
    SegmentationVolumeInfo,
} from '@/lib/api-types'
import { buildDatasetStatisticsPayload, type StatisticsInclusion } from '@/lib/dataset-stats-aggregate'
import { useViewerStore, type DatasetCaseState } from '@/lib/store'
import {
    DEFAULT_LABEL_COLOR,
    DEFAULT_PRED_COLOR,
    generateDistinctColor,
    createColorMapFromPalette,
    colorMapToRecord,
} from '@/lib/color-utils'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from './ui/dialog'
import { Button } from './ui/button'
import { Label } from './ui/label'
import { Input } from './ui/input'
import { Badge } from './ui/badge'
import { Card, CardContent, CardHeader } from './ui/card'
import { Progress } from './ui/progress'
import { Switch } from './ui/switch'
import { FolderOpen, ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

const isElectron = typeof window !== 'undefined' && window.electronAPI

const ordinal = (n: number) => {
    const v = n % 100
    const s = ['th', 'st', 'nd', 'rd']
    return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

const defaultStatUi = () => ({
    include_global_ct_intensity: true,
    include_lesion_connected_components: true,
    include_label_segmentation_stats: true,
    include_per_label_ct_intensity: true,
    include_file_metadata: true,
})

function resolvedStatisticsInclusion(ui: ReturnType<typeof defaultStatUi>): StatisticsInclusion {
    return {
        include_global_ct_intensity: ui.include_global_ct_intensity,
        include_lesion_connected_components: ui.include_lesion_connected_components,
        include_label_segmentation_stats:
            ui.include_label_segmentation_stats || ui.include_per_label_ct_intensity,
        include_per_label_ct_intensity: ui.include_per_label_ct_intensity,
        include_file_metadata: ui.include_file_metadata,
    }
}

interface DatasetLoadDialogProps {
    trigger?: React.ReactNode
    open?: boolean
    onOpenChange?: (open: boolean) => void
    mode?: 'load' | 'stats'
}

interface SegEntry extends SegmentationDir {
    color: string
}

function segVolumesFromOpenResponse(
    openRes: OpenCaseResponse,
    segs: SegEntry[]
): DatasetCaseState['segVolumes'] {
    return (
        openRes.seg_volume_ids?.map((s: SegmentationVolumeInfo, i: number) => {
            const labelValues = s.label_values ?? []
            const multiLabel = labelValues.length > 1
            const colorMap =
                multiLabel
                    ? colorMapToRecord(createColorMapFromPalette(labelValues, 'colorblind', i))
                    : undefined
            return {
                volumeId: s.volume_id,
                role: s.role,
                name: s.name,
                allBackground: s.all_background ?? null,
                componentCount: s.component_count ?? null,
                multiLabel: s.multi_label ?? null,
                nonzeroLabelCount: s.nonzero_label_count ?? null,
                labelValues,
                color:
                    !multiLabel
                        ? (segs[i]?.color ??
                            (s.role === 'pred'
                                ? DEFAULT_PRED_COLOR
                                : generateDistinctColor(i, openRes.seg_volume_ids?.length)))
                        : undefined,
                colorMap,
                visible: true,
                mode: 'filled' as const,
            }
        }) ?? [
            ...(openRes.label_volume_id
                ? [
                    {
                        volumeId: openRes.label_volume_id,
                        role: 'gt' as const,
                        name: 'Label',
                        allBackground: openRes.label_all_background ?? null,
                        componentCount: null,
                        multiLabel: null,
                        nonzeroLabelCount: null,
                        labelValues: null,
                        color: DEFAULT_LABEL_COLOR,
                        visible: true,
                        mode: 'filled' as const,
                    },
                ]
                : []),
            ...(openRes.pred_volume_id
                ? [
                    {
                        volumeId: openRes.pred_volume_id,
                        role: 'pred' as const,
                        name: 'Prediction',
                        allBackground: null,
                        componentCount: null,
                        multiLabel: null,
                        nonzeroLabelCount: null,
                        labelValues: null,
                        color: DEFAULT_PRED_COLOR,
                        visible: true,
                        mode: 'filled' as const,
                    },
                ]
                : []),
        ]
    )
}

function datasetCaseFromOpen(
    reg: RegisterDatasetResponse,
    openRes: OpenCaseResponse,
    segs: SegEntry[]
): DatasetCaseState {
    return {
        datasetId: reg.dataset_id,
        caseIndex: openRes.case_index,
        caseCount: reg.case_count,
        caseId: openRes.case_id,
        imageVolumeId: openRes.image_volume_id,
        segVolumes: segVolumesFromOpenResponse(openRes, segs),
        warnings: openRes.warnings ?? [],
    }
}

export function DatasetLoadDialog({
    trigger,
    open: openProp,
    onOpenChange,
    mode = 'load',
}: DatasetLoadDialogProps) {
    const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
    const controlled = openProp !== undefined
    const open = controlled ? openProp : uncontrolledOpen

    const statsCancelRequestedRef = useRef(false)
    const statsScanActiveRef = useRef(false)

    const setDialogOpen = (v: boolean) => {
        if (!v) {
            if (statsScanActiveRef.current) statsCancelRequestedRef.current = true
            setScanProgress(null)
        }
        if (!controlled) setUncontrolledOpen(v)
        onOpenChange?.(v)
    }
    const [imagesDir, setImagesDir] = useState('')
    const [segs, setSegs] = useState<SegEntry[]>([])
    const [expandedSeg, setExpandedSeg] = useState<number | null>(null)
    const segInputRefs = useRef<(HTMLInputElement | null)[]>([])

    const setViewMode = useViewerStore((s) => s.setViewMode)
    const setDatasetCase = useViewerStore((s) => s.setDatasetCase)
    const setDatasetLesionStats = useViewerStore((s) => s.setDatasetLesionStats)

    const [scanProgress, setScanProgress] = useState<{ current: number; total: number } | null>(null)
    const [statUi, setStatUi] = useState(defaultStatUi)

    const registerMutation = useMutation({
        mutationFn: registerDataset,
        onError: (e: Error) => {
            toast.error('Dataset registration failed', { description: e.message })
        },
    })

    const openCaseMutation = useMutation({
        mutationFn: ({ datasetId }: { datasetId: string }) =>
            openDatasetCase(datasetId, { case_index: 0 }),
        onError: (e: Error) => {
            toast.error('Failed to open first case', { description: e.message })
        },
    })

    const handleSubmit = async () => {
        const images = imagesDir.trim()
        if (!images) {
            toast.error('Images directory is required')
            return
        }
        try {
            const reg = await registerMutation.mutateAsync({
                images_dir: images,
                segmentations: segs
                    .map((s) => ({
                        path: s.path.trim(),
                        role: s.role,
                        name: s.name?.trim() || undefined,
                    }))
                    .filter((s) => s.path),
            })
            const openRes = await openCaseMutation.mutateAsync({
                datasetId: reg.dataset_id,
            })
            setViewMode('dataset')
            setDatasetLesionStats(null)
            const segVolumes = segVolumesFromOpenResponse(openRes, segs)
            setDatasetCase(datasetCaseFromOpen(reg, openRes, segs))
            setDialogOpen(false)
            toast.success('Dataset loaded', {
                description: `${reg.case_count} cases, viewing case 1`,
            })
            if (segVolumes.some((s) => s.allBackground)) {
                toast.info('Label is all background', {
                    description: `Case "${openRes.case_id}" has no segmentation foreground.`,
                })
            }
        } catch {
            // Errors handled in mutations
        }
    }

    const handleStatsSubmit = async () => {
        const images = imagesDir.trim()
        if (!images) {
            toast.error('Images directory is required')
            return
        }
        const segIndex = segs.findIndex((s) => s.path.trim())
        if (segIndex < 0) {
            toast.error('Add at least one segmentation folder', {
                description: 'Lesion statistics require a segmentation volume for each case.',
            })
            return
        }
        try {
            statsCancelRequestedRef.current = false
            const reg = await registerMutation.mutateAsync({
                images_dir: images,
                segmentations: segs
                    .map((s) => ({
                        path: s.path.trim(),
                        role: s.role,
                        name: s.name?.trim() || undefined,
                    }))
                    .filter((s) => s.path),
            })
            if (statsCancelRequestedRef.current) {
                toast.info('Statistics cancelled')
                return
            }
            const responses: CaseStatisticsResponse[] = []
            const inclusion = resolvedStatisticsInclusion(statUi)
            setScanProgress({ current: 0, total: reg.case_count })
            statsScanActiveRef.current = true
            for (let i = 0; i < reg.case_count; i++) {
                if (statsCancelRequestedRef.current) {
                    toast.info('Statistics cancelled')
                    return
                }
                const r = await fetchDatasetCaseStatistics(reg.dataset_id, {
                    case_index: i,
                    seg_index: segIndex,
                    include_global_ct_intensity: inclusion.include_global_ct_intensity,
                    include_lesion_connected_components: inclusion.include_lesion_connected_components,
                    include_label_segmentation_stats: inclusion.include_label_segmentation_stats,
                    include_per_label_ct_intensity: inclusion.include_per_label_ct_intensity,
                    include_file_metadata: inclusion.include_file_metadata,
                })
                responses.push(r)
                setScanProgress({ current: i + 1, total: reg.case_count })
            }
            const s = segs[segIndex]
            const segName =
                s?.name?.trim() ||
                (s?.role === 'pred' ? 'Prediction' : s?.role === 'gt' ? 'Ground truth' : null)
            setDatasetLesionStats(
                buildDatasetStatisticsPayload({
                    responses,
                    datasetId: reg.dataset_id,
                    segIndex,
                    segName,
                    inclusion,
                })
            )
            setDatasetCase(null)
            setViewMode('datasetStats')
            setDialogOpen(false)
            const nCc = responses.reduce((n, r) => n + r.volumes_mm3.length, 0)
            toast.success('Dataset statistics ready', {
                description:
                    inclusion.include_lesion_connected_components && nCc > 0
                        ? `${nCc} connected components across ${reg.case_count} cases`
                        : `Processed ${reg.case_count} cases`,
            })
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'Statistics run failed'
            toast.error(msg)
        } finally {
            statsScanActiveRef.current = false
            setScanProgress(null)
            statsCancelRequestedRef.current = false
        }
    }

    const mutationBusy =
        registerMutation.isPending || (mode === 'load' && openCaseMutation.isPending)
    const statsScanning = mode === 'stats' && scanProgress !== null
    const isLoading = mutationBusy || statsScanning

    const showTrigger = trigger != null || !controlled

    return (
        <Dialog open={open} onOpenChange={setDialogOpen}>
            {showTrigger ? (
                <DialogTrigger asChild>
                    {trigger ?? (
                        <Button variant="outline" className="w-full gap-2">
                            <FolderOpen className="h-4 w-4" />
                            Load Dataset
                        </Button>
                    )}
                </DialogTrigger>
            ) : null}
            <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto overflow-x-hidden min-w-0">
                <DialogHeader>
                    <DialogTitle>{mode === 'stats' ? 'Dataset statistics' : 'Load Dataset'}</DialogTitle>
                    <DialogDescription>
                        {mode === 'stats'
                            ? 'Pick folders, then choose which analyses to run. Disabling heavy steps speeds up large cohorts.'
                            : isElectron
                              ? 'Choose folders for images (required) and optional segmentation folders. Cases matched by base name (nnUNet supported).'
                              : 'Enter server-accessible folder paths. Cases are matched by base name (nnUNet convention supported).'}
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-6 py-4 min-w-0 overflow-hidden">
                    {scanProgress && scanProgress.total > 0 ? (
                        <div className="space-y-2" aria-live="polite">
                            <p className="text-sm text-muted-foreground">
                                Scanning cases… {scanProgress.current} / {scanProgress.total}
                            </p>
                            <Progress
                                value={Math.round((100 * scanProgress.current) / scanProgress.total)}
                            />
                        </div>
                    ) : null}
                    {/* Images directory */}
                    <div className="space-y-2">
                        <Label htmlFor="images-dir" className="text-sm font-medium">
                            Images directory
                        </Label>
                        <p className="text-xs text-muted-foreground">Required. Folder containing volume images.</p>
                        {isElectron ? (
                            <div className="flex gap-2 items-center min-w-0 overflow-hidden">
                                <div
                                    id="images-dir"
                                    className={`h-8 rounded-md border border-input bg-muted px-3 py-1 text-sm flex items-center min-w-0 flex-1 overflow-hidden ${imagesDir ? 'truncate-start' : ''}`}
                                    title={imagesDir || undefined}
                                >
                                    {imagesDir ? (
                                        <span className="[direction:ltr]">{imagesDir}</span>
                                    ) : (
                                        <span className="text-muted-foreground">No folder chosen</span>
                                    )}
                                </div>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-8 shrink-0"
                                    onClick={() =>
                                        window.electronAPI?.showFolderPicker({ which: 'images' }).then((p) => {
                                            if (p) setImagesDir(p)
                                        })
                                    }
                                    disabled={isLoading}
                                >
                                    Choose folder
                                </Button>
                            </div>
                        ) : (
                            <div className="min-w-0 overflow-hidden">
                                <Input
                                    id="images-dir"
                                    placeholder="/path/to/imagesTr"
                                    value={imagesDir}
                                    onChange={(e) => setImagesDir(e.target.value)}
                                    disabled={isLoading}
                                    className="h-8 w-full max-w-full min-w-0 truncate-start"
                                    title={imagesDir || undefined}
                                />
                            </div>
                        )}
                    </div>

                    {/* Segmentation masks */}
                    <div className="space-y-2 min-w-0 overflow-hidden">
                        <Label className="text-sm font-medium">Segmentation masks</Label>
                        <p className="text-xs text-muted-foreground">
                            Add up to 5 optional folders. Choose folder, optional name, and role (Ground truth or Prediction).
                        </p>
                        <div className="space-y-2 min-w-0">
                            {segs.map((seg, idx) => (
                                <Card key={idx} className="w-full min-w-0 overflow-hidden border-sidebar bg-sidebar text-sidebar-foreground">
                                    <CardHeader
                                        className="flex flex-row items-center justify-between gap-2 space-y-0 p-3 cursor-pointer hover:bg-sidebar-accent transition-colors min-w-0 overflow-hidden"
                                        onClick={() => setExpandedSeg(expandedSeg === idx ? null : idx)}
                                    >
                                        <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
                                            <span className="text-sm font-medium shrink-0 whitespace-nowrap min-w-[7rem]">
                                                Segmentation {idx + 1}
                                            </span>
                                            {seg.role && (
                                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                                                    {seg.role === 'pred' ? 'Pred' : 'GT'}
                                                </Badge>
                                            )}
                                            {seg.path && (
                                                <span className="text-xs text-muted-foreground truncate-start min-w-0 block" title={seg.path}>
                                                    <span className="[direction:ltr]">{seg.path}</span>
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8"
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    setSegs((prev) => prev.filter((_, i) => i !== idx))
                                                    setExpandedSeg((e) =>
                                                        e === null ? null : e === idx ? null : e > idx ? e - 1 : e
                                                    )
                                                }}
                                                disabled={isLoading}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                            {expandedSeg === idx ? (
                                                <ChevronUp className="h-4 w-4 text-muted-foreground" />
                                            ) : (
                                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                            )}
                                        </div>
                                    </CardHeader>
                                    {expandedSeg === idx && (
                                        <CardContent className="p-3 pt-0 space-y-3 min-w-0 overflow-hidden">
                                            <div className="flex flex-col gap-2">
                                                <Label htmlFor={`seg-dir-${idx}`} className="text-xs">
                                                    Folder
                                                </Label>
                                                {isElectron ? (
                                                    <div className="flex gap-2 items-center min-w-0 overflow-hidden">
                                                        <div
                                                            id={`seg-dir-${idx}`}
                                                            className={`h-8 rounded-md border border-input bg-muted px-3 py-1 text-sm flex items-center min-w-0 flex-1 overflow-hidden ${seg.path ? 'truncate-start' : ''}`}
                                                            title={seg.path || undefined}
                                                        >
                                                            {seg.path ? (
                                                                <span className="[direction:ltr]">{seg.path}</span>
                                                            ) : (
                                                                <span className="text-muted-foreground">No folder chosen</span>
                                                            )}
                                                        </div>
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            size="sm"
                                                            className="h-8 shrink-0"
                                                            onClick={() =>
                                                                window.electronAPI
                                                                    ?.showFolderPicker({
                                                                        which: seg.role === 'pred' ? 'preds' : 'labels',
                                                                    })
                                                                    .then((p) => {
                                                                        if (p) {
                                                                            const next = [...segs]
                                                                            next[idx] = { ...next[idx], path: p }
                                                                            setSegs(next)
                                                                        }
                                                                    })
                                                            }
                                                            disabled={isLoading}
                                                        >
                                                            Choose folder
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <div className="min-w-0 overflow-hidden">
                                                        <Input
                                                            id={`seg-dir-${idx}`}
                                                            ref={(el) => {
                                                                segInputRefs.current[idx] = el
                                                            }}
                                                            placeholder="/path/to/segmentations"
                                                            value={seg.path}
                                                            onChange={(e) => {
                                                                const next = [...segs]
                                                                next[idx] = { ...next[idx], path: e.target.value }
                                                                setSegs(next)
                                                            }}
                                                            disabled={isLoading}
                                                            className="h-8 w-full max-w-full min-w-0 truncate-start text-sm"
                                                            title={seg.path || undefined}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex flex-col gap-2">
                                                <Label htmlFor={`seg-name-${idx}`} className="text-xs">
                                                    Name
                                                </Label>
                                                <Input
                                                    id={`seg-name-${idx}`}
                                                    value={seg.name ?? ''}
                                                    onChange={(e) => {
                                                        const next = [...segs]
                                                        next[idx] = { ...next[idx], name: e.target.value }
                                                        setSegs(next)
                                                    }}
                                                    disabled={isLoading}
                                                    className="h-8 text-sm"
                                                    placeholder="Optional label"
                                                />
                                            </div>
                                            <div className="flex flex-col gap-2">
                                                <Label className="text-xs">Color & role</Label>
                                                <div className="flex items-center gap-3">
                                                    <input
                                                        type="color"
                                                        value={seg.color}
                                                        onChange={(e) => {
                                                            const next = [...segs]
                                                            next[idx] = { ...next[idx], color: e.target.value }
                                                            setSegs(next)
                                                        }}
                                                        className="h-8 w-10 cursor-pointer rounded border border-input"
                                                        disabled={isLoading}
                                                    />
                                                    <div className="flex items-center gap-1">
                                                        <Button
                                                            type="button"
                                                            variant={seg.role === 'gt' ? 'default' : 'outline'}
                                                            className="h-8 py-0 px-2 text-xs"
                                                            onClick={() => {
                                                                const next = [...segs]
                                                                next[idx] = { ...next[idx], role: seg.role === 'gt' ? undefined : 'gt' }
                                                                setSegs(next)
                                                            }}
                                                            disabled={isLoading}
                                                        >
                                                            Ground truth
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            variant={seg.role === 'pred' ? 'default' : 'outline'}
                                                            className="h-8 py-0 px-2 text-xs"
                                                            onClick={() => {
                                                                const next = [...segs]
                                                                next[idx] = { ...next[idx], role: seg.role === 'pred' ? undefined : 'pred' }
                                                                setSegs(next)
                                                            }}
                                                            disabled={isLoading}
                                                        >
                                                            Prediction
                                                        </Button>
                                                    </div>
                                                </div>
                                            </div>
                                        </CardContent>
                                    )}
                                </Card>
                            ))}
                        </div>
                        {segs.length < 5 && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="gap-2 w-full"
                                onClick={async () => {
                                    const newIndex = segs.length
                                    setSegs((prev) => [
                                        ...prev,
                                        {
                                            path: '',
                                            role: undefined,
                                            name: '',
                                            color: generateDistinctColor(prev.length),
                                        },
                                    ])
                                    setExpandedSeg(newIndex)
                                    if (isElectron) {
                                        const p = await window.electronAPI?.showFolderPicker({ which: 'labels' })
                                        if (p) {
                                            setSegs((prev) => {
                                                if (!prev[newIndex]) return prev
                                                const next = [...prev]
                                                next[newIndex] = { ...next[newIndex], path: p }
                                                return next
                                            })
                                        }
                                    } else {
                                        requestAnimationFrame(() => segInputRefs.current[newIndex]?.focus())
                                    }
                                }}
                                disabled={isLoading}
                            >
                                {segs.length === 0
                                    ? 'Add segmentation mask'
                                    : `Add ${ordinal(segs.length + 1)} segmentation`}
                            </Button>
                        )}
                    </div>

                    {mode === 'stats' ? (
                        <Card className="w-full min-w-0 overflow-hidden">
                            <CardHeader className="p-4 pb-2 space-y-1">
                                <span className="text-sm font-medium leading-none">What to compute</span>
                                <p className="text-xs text-muted-foreground font-normal leading-snug">
                                    Geometry checks always run. Turn off voxel-heavy work when you only need
                                    alignment or headers.
                                </p>
                            </CardHeader>
                            <CardContent className="p-4 pt-0 space-y-4">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0 space-y-0.5">
                                        <Label htmlFor="stat-cc" className="text-sm font-medium">
                                            Lesion connected components
                                        </Label>
                                        <p className="text-xs text-muted-foreground leading-snug">
                                            Histogram, max CC volume, per-case largest component (26-connected).
                                        </p>
                                    </div>
                                    <Switch
                                        id="stat-cc"
                                        checked={statUi.include_lesion_connected_components}
                                        onCheckedChange={(v) =>
                                            setStatUi((s) => ({ ...s, include_lesion_connected_components: v }))
                                        }
                                        disabled={isLoading}
                                        className="shrink-0"
                                    />
                                </div>
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0 space-y-0.5">
                                        <Label htmlFor="stat-label" className="text-sm font-medium">
                                            Label segmentation stats
                                        </Label>
                                        <p className="text-xs text-muted-foreground leading-snug">
                                            Per-label voxel counts and volumes (label IDs &gt; 0).
                                        </p>
                                    </div>
                                    <Switch
                                        id="stat-label"
                                        checked={statUi.include_label_segmentation_stats}
                                        onCheckedChange={(v) =>
                                            setStatUi((s) => ({
                                                ...s,
                                                include_label_segmentation_stats: v,
                                                include_per_label_ct_intensity: v
                                                    ? s.include_per_label_ct_intensity
                                                    : false,
                                            }))
                                        }
                                        disabled={isLoading}
                                        className="shrink-0"
                                    />
                                </div>
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0 space-y-0.5">
                                        <Label htmlFor="stat-plct" className="text-sm font-medium">
                                            Per-label CT intensity
                                        </Label>
                                        <p className="text-xs text-muted-foreground leading-snug">
                                            Mean / σ / min / max HU inside each label (requires label stats).
                                        </p>
                                    </div>
                                    <Switch
                                        id="stat-plct"
                                        checked={statUi.include_per_label_ct_intensity}
                                        onCheckedChange={(v) =>
                                            setStatUi((s) => ({
                                                ...s,
                                                include_per_label_ct_intensity: v,
                                                include_label_segmentation_stats:
                                                    v || s.include_label_segmentation_stats,
                                            }))
                                        }
                                        disabled={isLoading}
                                        className="shrink-0"
                                    />
                                </div>
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0 space-y-0.5">
                                        <Label htmlFor="stat-gi" className="text-sm font-medium">
                                            Global CT intensity
                                        </Label>
                                        <p className="text-xs text-muted-foreground leading-snug">
                                            Full-volume mean and cohort outlier scan (|z| &gt; 3).
                                        </p>
                                    </div>
                                    <Switch
                                        id="stat-gi"
                                        checked={statUi.include_global_ct_intensity}
                                        onCheckedChange={(v) =>
                                            setStatUi((s) => ({ ...s, include_global_ct_intensity: v }))
                                        }
                                        disabled={isLoading}
                                        className="shrink-0"
                                    />
                                </div>
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0 space-y-0.5">
                                        <Label htmlFor="stat-meta" className="text-sm font-medium">
                                            File metadata
                                        </Label>
                                        <p className="text-xs text-muted-foreground leading-snug">
                                            Header key/value aggregation in the dashboard.
                                        </p>
                                    </div>
                                    <Switch
                                        id="stat-meta"
                                        checked={statUi.include_file_metadata}
                                        onCheckedChange={(v) =>
                                            setStatUi((s) => ({ ...s, include_file_metadata: v }))
                                        }
                                        disabled={isLoading}
                                        className="shrink-0"
                                    />
                                </div>
                            </CardContent>
                        </Card>
                    ) : null}
                </div>
                <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={mutationBusy}>
                        Cancel
                    </Button>
                    <Button
                        onClick={mode === 'stats' ? handleStatsSubmit : handleSubmit}
                        disabled={isLoading}
                    >
                        {isLoading
                            ? mode === 'stats'
                                ? 'Working…'
                                : 'Loading…'
                            : mode === 'stats'
                              ? 'Calculate statistics'
                              : 'Load dataset'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}

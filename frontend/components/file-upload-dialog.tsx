'use client'

import { useState, useRef, useEffect, DragEvent, ChangeEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api-hooks'
import {
    uploadVolume,
    createPair,
    addSegmentToPair,
    fetchFirstSliceWithMask,
    getPairMetadata,
} from '@/lib/api-client'
import { VolumeMetadata, CreatePairResponse } from '@/lib/api-types'
import { useViewerStore } from '@/lib/store'
import { shallow } from 'zustand/shallow'
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
import { Progress } from './ui/progress'
import { Alert, AlertDescription, AlertTitle } from './ui/alert'
import { Badge } from './ui/badge'
import { Card, CardContent, CardHeader } from './ui/card'
import { Input } from './ui/input'
import { Upload, FileUp, CheckCircle2, XCircle, AlertCircle, Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'
import {
    createColorMapFromPalette,
    generateDistinctColor,
} from '@/lib/color-utils'

interface FileUploadDialogProps {
    trigger?: React.ReactNode
    open?: boolean
    onOpenChange?: (open: boolean) => void
}

type UploadStage = 'idle' | 'uploading-ct' | 'uploading-seg' | 'creating-pair' | 'success' | 'error'
type SegRole = 'gt' | 'pred' | null
type SegEntry = { file: File | null; name: string; color: string; role: SegRole }

const ordinal = (n: number) => {
    const v = n % 100
    const s = ['th', 'st', 'nd', 'rd']
    return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

export function FileUploadDialog({ trigger, open: openProp, onOpenChange }: FileUploadDialogProps) {
    const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
    const controlled = openProp !== undefined
    const open = controlled ? openProp : uncontrolledOpen
    const [ctFile, setCtFile] = useState<File | null>(null)
    const [segs, setSegs] = useState<SegEntry[]>([])
    const [stage, setStage] = useState<UploadStage>('idle')
    const [expandedSeg, setExpandedSeg] = useState<number | null>(null)
    const [uploadProgress, setUploadProgress] = useState(0)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)
    const [validationResult, setValidationResult] = useState<CreatePairResponse | null>(null)
    const [isDraggingCt, setIsDraggingCt] = useState(false)

    const ctInputRef = useRef<HTMLInputElement>(null)
    const segInputRefs = useRef<(HTMLInputElement | null)[]>([])
    const addMultiSegInputRef = useRef<HTMLInputElement>(null)
    const dialogContentRef = useRef<HTMLDivElement>(null)
    const pendingPickRef = useRef<number | null>(null)

    const scrollBottom = () => {
        const el = dialogContentRef.current
        if (!el) return
        el.scrollTop = el.scrollHeight - el.clientHeight
    }

    useEffect(() => {
        scrollBottom()
        const t = requestAnimationFrame(scrollBottom)
        return () => cancelAnimationFrame(t)
    }, [segs.length, expandedSeg, stage])

    useEffect(() => {
        const idx = pendingPickRef.current
        if (idx === null) return
        const el = segInputRefs.current[idx]
        if (!el) return
        pendingPickRef.current = null
        requestAnimationFrame(() => el.click())
    }, [expandedSeg, segs.length])

    const queryClient = useQueryClient()
    const addPair = useViewerStore((state) => state.addPair)
    const addSegToPairStore = useViewerStore((state) => state.addSegToPair)
    const updatePairSlice = useViewerStore((state) => state.updatePairSlice)
    const snapToMask = useViewerStore((state) => state.snapToMask)
    const pairs = useViewerStore((state) => state.pairs)

    const uploadCtMutation = useMutation({
        mutationFn: uploadVolume,
        onSuccess: () => {
            setUploadProgress(50)
        },
        onError: (error: Error) => {
            setStage('error')
            setErrorMessage(`Failed to upload CT volume: ${error.message}`)
            toast.error('CT upload failed', { description: error.message })
        },
    })

    const uploadSegMutation = useMutation({
        mutationFn: uploadVolume,
        onSuccess: () => {
            setUploadProgress(75)
        },
        onError: (error: Error) => {
            setStage('error')
            setErrorMessage(`Failed to upload segmentation volume: ${error.message}`)
            toast.error('Segmentation upload failed', { description: error.message })
        },
    })

    const createPairMutation = useMutation({
        mutationFn: createPair,
        onSuccess: async (response) => {
            setUploadProgress(100)
            setValidationResult(response)
            setStage('success')
            const firstSeg = segs[0]
            const firstColor = firstSeg?.color ?? generateDistinctColor(0)
            let colorMap = new Map<number, string>([[1, firstColor]])
            const hasSeg = !!response.seg_metadata
            if (hasSeg) {
                try {
                    const meta = await getPairMetadata(response.pair_id)
                    const stats = meta.seg_stats?.[0]
                    const labelValues = stats?.label_values ?? []
                    if (labelValues.length > 1) {
                        colorMap = createColorMapFromPalette(labelValues, 'colorblind')
                    }
                } catch {
                    // keep default single-color map
                }
            }
            addPair({
                pairId: response.pair_id,
                ctVolumeId: response.ct_metadata.volume_id,
                ...(hasSeg && { segVolumeId: response.seg_metadata!.volume_id }),
                segVolumes: hasSeg
                    ? [{
                        volumeId: response.seg_metadata!.volume_id,
                        colorMap,
                        visible: true,
                        mode: 'filled',
                        name: firstSeg?.name,
                        role: firstSeg?.role ?? undefined,
                    }]
                    : [],
                currentSliceIndex: 0,
                orientation: 'axial',
                windowLevel: 40,
                windowWidth: 400,
                zoom: 1,
                pan: { x: 0, y: 0 },
                overlayVisible: true,
                overlayMode: 'filled',
                overlayOpacity: 0.5,
                colorMap,
            })
            if (hasSeg && snapToMask) {
                fetchFirstSliceWithMask(response.seg_metadata!.volume_id, 'axial')
                    .then((data) => updatePairSlice(response.pair_id, data.slice_index))
                    .catch(() => { })
            }

            toast.success('Pair created successfully', {
                description: !hasSeg
                    ? 'CT volume added'
                    : response.resampled
                        ? 'Segmentation was resampled to match CT geometry'
                        : 'Geometry validation passed',
            })
        },
        onError: (error: Error) => {
            setStage('error')
            setErrorMessage(`Failed to create pair: ${error.message}`)
            toast.error('Pair creation failed', { description: error.message })
        },
    })

    const handleCtFileChange = (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (file) {
            setCtFile(file)
            setErrorMessage(null)
            requestAnimationFrame(scrollBottom)
        }
    }

    const addSegEntry = () => {
        const newIndex = segs.length
        pendingPickRef.current = newIndex
        setSegs((prev) => {
            if (prev.length >= 20) return prev
            return [
                ...prev,
                {
                    file: null,
                    name: `Segmentation ${prev.length + 1}`,
                    color: generateDistinctColor(prev.length),
                    role: null,
                },
            ]
        })
        setExpandedSeg(newIndex)
        requestAnimationFrame(scrollBottom)
    }

    const handleAddMultiMasks = (e: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? [])
        e.target.value = ''
        if (files.length === 0) return
        const toAdd = Math.min(files.length, 20 - segs.length)
        if (toAdd <= 0) return
        setSegs((prev) => [
            ...prev,
            ...files.slice(0, toAdd).map((file, i) => ({
                file,
                name: `Segmentation ${prev.length + i + 1}`,
                color: generateDistinctColor(prev.length + i),
                role: null as SegRole,
            })),
        ])
        setExpandedSeg(segs.length + toAdd - 1)
        requestAnimationFrame(scrollBottom)
    }

    const updateSeg = (index: number, patch: Partial<SegEntry>) => {
        setSegs((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)))
        setErrorMessage(null)
        if (patch.file) requestAnimationFrame(scrollBottom)
    }

    const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault()
        e.stopPropagation()
    }

    const handleCtDragEnter = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDraggingCt(true)
    }

    const handleCtDragLeave = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDraggingCt(false)
    }

    const handleCtDrop = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDraggingCt(false)

        const file = e.dataTransfer.files[0]
        if (file) {
            setCtFile(file)
            setErrorMessage(null)
            requestAnimationFrame(scrollBottom)
        }
    }

    const handleUpload = async () => {
        if (!ctFile) {
            setErrorMessage('Please select a CT file')
            return
        }
        if (segs.length > 0 && segs.some((s) => !s.file)) {
            setErrorMessage('Each added segmentation slot must have a file selected')
            return
        }

        if (pairs.size >= 10) {
            setErrorMessage('Maximum of 10 pairs allowed. Please remove a pair before adding a new one.')
            toast.error('Pair limit reached', {
                description: 'Maximum of 10 pairs allowed',
            })
            return
        }
        if (segs.length > 20) {
            setErrorMessage('Maximum of 20 masks allowed per pair')
            return
        }

        scrollBottom()
        setStage('uploading-ct')
        setUploadProgress(0)
        setErrorMessage(null)
        setValidationResult(null)

        try {
            const totalSteps = 2 + segs.length + Math.max(0, segs.length - 1)
            let completed = 0
            const bump = (step: number) => {
                completed += step
                setUploadProgress(Math.min(100, Math.round((completed / totalSteps) * 100)))
            }

            setUploadProgress(5)
            const ctMetadata = await uploadCtMutation.mutateAsync(ctFile)
            bump(1)

            setStage('uploading-seg')
            const segMetas: VolumeMetadata[] = []
            for (const seg of segs) {
                const meta = await uploadSegMutation.mutateAsync(seg.file as File)
                segMetas.push(meta)
                bump(1)
            }

            setStage('creating-pair')
            const pairResponse = await createPairMutation.mutateAsync({
                ct_volume_id: ctMetadata.volume_id,
                ...(segMetas.length > 0 && { seg_volume_id: segMetas[0].volume_id }),
                auto_resample: true,
            })
            bump(1)

            for (let i = 1; i < segMetas.length; i += 1) {
                const updated = await addSegmentToPair(pairResponse.pair_id, {
                    seg_volume_id: segMetas[i].volume_id,
                    auto_resample: true,
                })
                const seg = segs[i]
                const lastStats = updated.seg_stats?.[updated.seg_stats.length - 1]
                const labelValues = lastStats?.label_values ?? []
                const colorMap =
                    labelValues.length > 1
                        ? createColorMapFromPalette(labelValues, 'colorblind', i)
                        : new Map([[1, seg.color ?? generateDistinctColor(i)]])
                addSegToPairStore(
                    pairResponse.pair_id,
                    segMetas[i].volume_id,
                    colorMap,
                    seg.name,
                    seg.role ?? undefined
                )
                bump(1)
            }

            queryClient.invalidateQueries({ queryKey: queryKeys.pair(pairResponse.pair_id) })
        } catch (error) {
            console.error('Upload failed:', error)
        }
    }

    const handleReset = () => {
        setCtFile(null)
        setSegs([])
        setStage('idle')
        setUploadProgress(0)
        setErrorMessage(null)
        setValidationResult(null)
        setExpandedSeg(null)
        if (ctInputRef.current) ctInputRef.current.value = ''
        segInputRefs.current = []
    }

    const handleOpenChange = (newOpen: boolean) => {
        if (!controlled) setUncontrolledOpen(newOpen)
        onOpenChange?.(newOpen)
    }

    const wasOpen = useRef(false)
    useEffect(() => {
        if (open && !wasOpen.current) handleReset()
        wasOpen.current = open
    }, [open])

    const isUploading = stage === 'uploading-ct' || stage === 'uploading-seg' || stage === 'creating-pair'
    const canUpload = ctFile && (segs.length === 0 || segs.every((s) => s.file)) && !isUploading

    const showTrigger = trigger != null || !controlled

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            {showTrigger ? (
                <DialogTrigger asChild>
                    {trigger ?? (
                        <Button className="gap-2">
                            <Upload className="h-4 w-4" />
                            Upload
                        </Button>
                    )}
                </DialogTrigger>
            ) : null}
            <DialogContent
                ref={dialogContentRef}
                className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto overflow-x-hidden min-w-0"
            >
                <DialogHeader>
                    <DialogTitle>Upload CT and Segmentation Pair</DialogTitle>
                    <DialogDescription>
                        Select a CT volume; optionally add up to 20 segmentation masks. Formats: .nii, .nii.gz, .mha, .mhd
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-4 min-w-0 overflow-hidden">
                    {/* CT File Upload */}
                    <div className="space-y-2 min-w-0 overflow-hidden">
                        <Label htmlFor="ct-file">CT Volume</Label>
                        <div
                            className={`border-2 border-dashed rounded-lg p-6 transition-colors w-full min-w-0 overflow-hidden ${isDraggingCt
                                ? 'border-primary bg-primary/5'
                                : 'border-muted-foreground/25 hover:border-muted-foreground/50'
                                }`}
                            onDragOver={handleDragOver}
                            onDragEnter={handleCtDragEnter}
                            onDragLeave={handleCtDragLeave}
                            onDrop={handleCtDrop}
                        >
                            <div className="flex flex-col items-center gap-2 text-center w-full min-w-0 overflow-hidden">
                                <FileUp className="h-8 w-8 text-muted-foreground shrink-0" />
                                <div className="text-sm w-full min-w-0 overflow-hidden">
                                    {ctFile ? (
                                        <p className="w-full max-w-full min-w-0 truncate-start font-medium text-foreground px-1 block" title={ctFile.name}>
                                            <span className="[direction:ltr]">{ctFile.name}</span>
                                        </p>
                                    ) : (
                                        <>
                                            <p className="font-medium">Drop CT file here or click to browse</p>
                                            <p className="text-muted-foreground text-xs mt-1">
                                                .nii, .nii.gz, .mha, .mhd
                                            </p>
                                        </>
                                    )}
                                </div>
                                <input
                                    ref={ctInputRef}
                                    id="ct-file"
                                    type="file"
                                    accept=".nii,.gz,.mha,.mhd"
                                    onChange={handleCtFileChange}
                                    className="hidden"
                                    disabled={isUploading}
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => ctInputRef.current?.click()}
                                    disabled={isUploading}
                                >
                                    Browse Files
                                </Button>
                            </div>
                        </div>
                    </div>

                    {/* Segmentation masks */}
                    <div className="space-y-2 min-w-0 overflow-hidden">
                        <Label className="text-sm font-medium">Segmentation masks</Label>
                        <p className="text-xs text-muted-foreground">
                            Add up to 20 masks. Choose file(s), optional name and color, and role (GT or Pred).
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
                                            {seg.file && (
                                                <span className="text-xs text-muted-foreground truncate-start min-w-0 block" title={seg.file.name}>
                                                    <span className="[direction:ltr]">{seg.file.name}</span>
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
                                                    setSegs((prev) => {
                                                        const next = prev.filter((_, i) => i !== idx)
                                                        setExpandedSeg((e) =>
                                                            e === null ? null : Math.min(e, next.length - 1)
                                                        )
                                                        return next
                                                    })
                                                }}
                                                disabled={isUploading}
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
                                            <div className="flex flex-col gap-2 min-w-0 overflow-hidden">
                                                <Label htmlFor={`seg-file-${idx}`} className="text-xs">
                                                    File
                                                </Label>
                                                <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                                                    <input
                                                        ref={(el) => {
                                                            segInputRefs.current[idx] = el
                                                        }}
                                                        id={`seg-file-${idx}`}
                                                        type="file"
                                                        accept=".nii,.gz,.mha,.mhd"
                                                        multiple
                                                        onChange={(e) => {
                                                            const files = Array.from(e.target.files ?? [])
                                                            e.target.value = ''
                                                            if (files.length === 0) return
                                                            const toAdd = Math.min(files.length, 20 - segs.length)
                                                            if (toAdd <= 0) return
                                                            setSegs((prev) => {
                                                                const next = [...prev]
                                                                next[idx] = { ...next[idx], file: files[0] }
                                                                for (let i = 1; i < toAdd; i++) {
                                                                    const slot = next.length
                                                                    next.push({
                                                                        file: files[i],
                                                                        name: `Segmentation ${slot + 1}`,
                                                                        color: generateDistinctColor(slot),
                                                                        role: null,
                                                                    })
                                                                }
                                                                return next
                                                            })
                                                            setExpandedSeg(toAdd === 1 ? idx : segs.length + toAdd - 2)
                                                            requestAnimationFrame(scrollBottom)
                                                        }}
                                                        className="hidden"
                                                        disabled={isUploading}
                                                    />
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => segInputRefs.current[idx]?.click()}
                                                        disabled={isUploading}
                                                        className="shrink-0"
                                                    >
                                                        Choose file
                                                    </Button>
                                                    <div className="min-w-0 flex-1 overflow-hidden">
                                                        <span className="text-xs text-muted-foreground truncate-start block" title={seg.file ? seg.file.name : undefined}>
                                                            <span className="[direction:ltr]">{seg.file ? seg.file.name : 'No file selected'}</span>
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex flex-col gap-2">
                                                <Label htmlFor={`seg-name-${idx}`} className="text-xs">
                                                    Name
                                                </Label>
                                                <Input
                                                    id={`seg-name-${idx}`}
                                                    value={seg.name}
                                                    onChange={(e) => updateSeg(idx, { name: e.target.value })}
                                                    className="h-8 text-sm"
                                                    placeholder="Optional label"
                                                    disabled={isUploading}
                                                />
                                            </div>
                                            <div className="flex flex-col gap-2">
                                                <Label className="text-xs">Color & role</Label>
                                                <div className="flex items-center gap-3">
                                                    <input
                                                        type="color"
                                                        value={seg.color}
                                                        onChange={(e) => updateSeg(idx, { color: e.target.value })}
                                                        className="h-8 w-10 cursor-pointer rounded border border-input"
                                                        disabled={isUploading}
                                                    />
                                                    <div className="flex items-center gap-1">
                                                        <Button
                                                            type="button"
                                                            variant={seg.role === 'gt' ? 'default' : 'outline'}
                                                            className="h-8 py-0 px-2 text-xs"
                                                            onClick={() =>
                                                                updateSeg(idx, { role: seg.role === 'gt' ? null : 'gt' })
                                                            }
                                                            disabled={isUploading}
                                                        >
                                                            Ground truth
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            variant={seg.role === 'pred' ? 'default' : 'outline'}
                                                            className="h-8 py-0 px-2 text-xs"
                                                            onClick={() =>
                                                                updateSeg(idx, {
                                                                    role: seg.role === 'pred' ? null : 'pred',
                                                                })
                                                            }
                                                            disabled={isUploading}
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
                        {segs.length < 20 && (
                            <>
                                <input
                                    ref={addMultiSegInputRef}
                                    type="file"
                                    accept=".nii,.gz,.mha,.mhd"
                                    multiple
                                    onChange={handleAddMultiMasks}
                                    className="hidden"
                                    disabled={isUploading}
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="gap-2 w-full"
                                    onClick={() => addMultiSegInputRef.current?.click()}
                                    disabled={isUploading}
                                >
                                    <Plus className="h-4 w-4" />
                                    {segs.length === 0
                                        ? 'Add masks (select one or more files)'
                                        : `Add more masks (${20 - segs.length} slots left)`}
                                </Button>
                            </>
                        )}
                    </div>

                    {/* Upload Progress */}
                    {isUploading && (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">
                                    {stage === 'uploading-ct' && 'Uploading CT volume...'}
                                    {stage === 'uploading-seg' && 'Uploading segmentation...'}
                                    {stage === 'creating-pair' && 'Validating geometry...'}
                                </span>
                                <span className="font-medium">{uploadProgress}%</span>
                            </div>
                            <Progress value={uploadProgress} className="h-2" />
                        </div>
                    )}

                    {/* Error Message */}
                    {errorMessage && (
                        <Alert variant="destructive">
                            <XCircle className="h-4 w-4" />
                            <AlertTitle>Error</AlertTitle>
                            <AlertDescription>{errorMessage}</AlertDescription>
                        </Alert>
                    )}

                    {/* Success Message with Validation Results */}
                    {stage === 'success' && validationResult && (
                        <Alert>
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                            <AlertTitle>Pair Created Successfully</AlertTitle>
                            <AlertDescription>
                                <div className="space-y-1 mt-2">
                                    <p>
                                        <strong>Pair ID:</strong> {validationResult.pair_id}
                                    </p>
                                    <p>
                                        <strong>Geometry:</strong>{' '}
                                        {validationResult.compatible ? 'Compatible' : 'Incompatible'}
                                    </p>
                                    {validationResult.resampled && (
                                        <div className="flex items-start gap-2 mt-2 p-2 bg-blue-50 dark:bg-blue-950 rounded">
                                            <AlertCircle className="h-4 w-4 text-blue-600 mt-0.5" />
                                            <p className="text-sm text-blue-900 dark:text-blue-100">
                                                Segmentation was automatically resampled to match CT geometry
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </AlertDescription>
                        </Alert>
                    )}
                </div>

                {/* Action Buttons */}
                <div className="flex justify-end gap-2">
                    {stage === 'success' ? (
                        <>
                            <Button variant="outline" onClick={handleReset}>
                                Upload Another
                            </Button>
                            <Button onClick={() => handleOpenChange(false)}>Close</Button>
                        </>
                    ) : (
                        <>
                            <Button variant="outline" onClick={handleReset} disabled={isUploading}>
                                Clear
                            </Button>
                            <Button onClick={handleUpload} disabled={!canUpload}>
                                {isUploading ? 'Uploading...' : 'Upload'}
                            </Button>
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}

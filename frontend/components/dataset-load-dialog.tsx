'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { registerDataset, openDatasetCase } from '@/lib/api-client'
import type { SegmentationDir, SegmentationVolumeInfo } from '@/lib/api-types'
import { useViewerStore } from '@/lib/store'
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
import { FolderOpen } from 'lucide-react'
import { toast } from 'sonner'

const isElectron = typeof window !== 'undefined' && window.electronAPI

interface DatasetLoadDialogProps {
    trigger?: React.ReactNode
}

export function DatasetLoadDialog({ trigger }: DatasetLoadDialogProps) {
    const [open, setOpen] = useState(false)
    const [imagesDir, setImagesDir] = useState('')
    const [segs, setSegs] = useState<SegmentationDir[]>([{ path: '', role: undefined, name: '' }])

    const setViewMode = useViewerStore((s) => s.setViewMode)
    const setDatasetCase = useViewerStore((s) => s.setDatasetCase)

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
            const segVolumes =
                openRes.seg_volume_ids?.map((s: SegmentationVolumeInfo) => ({
                    volumeId: s.volume_id,
                    role: s.role,
                    name: s.name,
                    allBackground: s.all_background ?? null,
                })) ??
                [
                    ...(openRes.label_volume_id
                        ? [{ volumeId: openRes.label_volume_id, role: 'gt' as const, name: 'Label', allBackground: openRes.label_all_background ?? null }]
                        : []),
                    ...(openRes.pred_volume_id
                        ? [{ volumeId: openRes.pred_volume_id, role: 'pred' as const, name: 'Prediction', allBackground: null }]
                        : []),
                ]
            setDatasetCase({
                datasetId: reg.dataset_id,
                caseIndex: openRes.case_index,
                caseCount: reg.case_count,
                caseId: openRes.case_id,
                imageVolumeId: openRes.image_volume_id,
                segVolumes,
                warnings: openRes.warnings ?? [],
            })
            setOpen(false)
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

    const isLoading = registerMutation.isPending || openCaseMutation.isPending

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {trigger ?? (
                    <Button variant="outline" className="w-full gap-2">
                        <FolderOpen className="h-4 w-4" />
                        Load Dataset
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>Load Dataset</DialogTitle>
                    <DialogDescription>
                        {isElectron
                            ? 'Choose folders for images (required), labels and predictions (optional). Cases matched by base name (nnUNet supported).'
                            : 'Enter server-accessible folder paths. Cases are matched by base name (nnUNet convention supported).'}
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="images-dir">Images directory *</Label>
                        {isElectron ? (
                            <div className="flex gap-2 items-center">
                                <Input
                                    id="images-dir"
                                    readOnly
                                    placeholder="No folder chosen"
                                    value={imagesDir}
                                    className="bg-muted"
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
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
                            <Input
                                id="images-dir"
                                placeholder="/path/to/imagesTr"
                                value={imagesDir}
                                onChange={(e) => setImagesDir(e.target.value)}
                                disabled={isLoading}
                            />
                        )}
                    </div>
                    {segs.map((seg, idx) => (
                        <div key={idx} className="space-y-2">
                            <Label htmlFor={`seg-dir-${idx}`}>Segmentation {idx + 1} (optional)</Label>
                            {isElectron ? (
                                <div className="flex gap-2 items-center">
                                    <Input
                                        id={`seg-dir-${idx}`}
                                        readOnly
                                        placeholder="No folder chosen"
                                        value={seg.path}
                                        className="bg-muted"
                                    />
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                            window.electronAPI?.showFolderPicker({ which: seg.role === 'pred' ? 'preds' : 'labels' }).then((p) => {
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
                                <Input
                                    id={`seg-dir-${idx}`}
                                    placeholder="/path/to/segmentations"
                                    value={seg.path}
                                    onChange={(e) => {
                                        const next = [...segs]
                                        next[idx] = { ...next[idx], path: e.target.value }
                                        setSegs(next)
                                    }}
                                    disabled={isLoading}
                                />
                            )}
                            <div className="flex items-center gap-2">
                                <Label className="text-xs w-10">Name</Label>
                                <Input
                                    value={seg.name ?? ''}
                                    onChange={(e) => {
                                        const next = [...segs]
                                        next[idx] = { ...next[idx], name: e.target.value }
                                        setSegs(next)
                                    }}
                                    disabled={isLoading}
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <Button
                                    type="button"
                                    size="sm"
                                    variant={seg.role === 'gt' ? 'default' : 'outline'}
                                    onClick={() => {
                                        const next = [...segs]
                                        next[idx] = { ...next[idx], role: seg.role === 'gt' ? undefined : 'gt' }
                                        setSegs(next)
                                    }}
                                    disabled={isLoading}
                                >
                                    GT
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant={seg.role === 'pred' ? 'default' : 'outline'}
                                    onClick={() => {
                                        const next = [...segs]
                                        next[idx] = { ...next[idx], role: seg.role === 'pred' ? undefined : 'pred' }
                                        setSegs(next)
                                    }}
                                    disabled={isLoading}
                                >
                                    Pred
                                </Button>
                                {segs.length > 1 && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setSegs((prev) => prev.filter((_, i) => i !== idx))}
                                        disabled={isLoading}
                                    >
                                        Remove
                                    </Button>
                                )}
                            </div>
                        </div>
                    ))}
                    {segs.length < 5 && segs[0]?.path && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setSegs((prev) => [...prev, { path: '', role: undefined, name: '' }])}
                            disabled={isLoading}
                        >
                            Add segmentation
                        </Button>
                    )}
                </div>
                <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setOpen(false)} disabled={isLoading}>
                        Cancel
                    </Button>
                    <Button onClick={handleSubmit} disabled={isLoading}>
                        {isLoading ? 'Loading…' : 'Load dataset'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}

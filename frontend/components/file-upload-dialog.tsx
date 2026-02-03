'use client'

import { useState, useRef, DragEvent, ChangeEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { uploadVolume, createPair, fetchFirstSliceWithMask } from '@/lib/api-client'
import { VolumeMetadata, CreatePairResponse } from '@/lib/api-types'
import { useViewerStore } from '@/lib/store'
import { generateDefaultColorMap } from '@/lib/color-utils'
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
import { Upload, FileUp, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'

interface FileUploadDialogProps {
    trigger?: React.ReactNode
}

type UploadStage = 'idle' | 'uploading-ct' | 'uploading-seg' | 'creating-pair' | 'success' | 'error'

export function FileUploadDialog({ trigger }: FileUploadDialogProps) {
    const [open, setOpen] = useState(false)
    const [ctFile, setCtFile] = useState<File | null>(null)
    const [segFile, setSegFile] = useState<File | null>(null)
    const [stage, setStage] = useState<UploadStage>('idle')
    const [uploadProgress, setUploadProgress] = useState(0)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)
    const [validationResult, setValidationResult] = useState<CreatePairResponse | null>(null)
    const [isDraggingCt, setIsDraggingCt] = useState(false)
    const [isDraggingSeg, setIsDraggingSeg] = useState(false)

    const ctInputRef = useRef<HTMLInputElement>(null)
    const segInputRef = useRef<HTMLInputElement>(null)

    const addPair = useViewerStore((state) => state.addPair)
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
        onSuccess: (response) => {
            setUploadProgress(100)
            setValidationResult(response)
            setStage('success')
            const colorMap = generateDefaultColorMap([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
            addPair({
                pairId: response.pair_id,
                ctVolumeId: response.ct_metadata.volume_id,
                segVolumeId: response.seg_metadata.volume_id,
                segVolumes: [{ volumeId: response.seg_metadata.volume_id, colorMap, visible: true }],
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
            if (snapToMask) {
                fetchFirstSliceWithMask(response.seg_metadata.volume_id, 'axial')
                    .then((data) => updatePairSlice(response.pair_id, data.slice_index))
                    .catch(() => { })
            }

            toast.success('Pair created successfully', {
                description: response.resampled
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
        }
    }

    const handleSegFileChange = (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (file) {
            setSegFile(file)
            setErrorMessage(null)
        }
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
        }
    }

    const handleSegDragEnter = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDraggingSeg(true)
    }

    const handleSegDragLeave = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDraggingSeg(false)
    }

    const handleSegDrop = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDraggingSeg(false)

        const file = e.dataTransfer.files[0]
        if (file) {
            setSegFile(file)
            setErrorMessage(null)
        }
    }

    const handleUpload = async () => {
        if (!ctFile || !segFile) {
            setErrorMessage('Please select both CT and segmentation files')
            return
        }

        if (pairs.size >= 10) {
            setErrorMessage('Maximum of 10 pairs allowed. Please remove a pair before adding a new one.')
            toast.error('Pair limit reached', {
                description: 'Maximum of 10 pairs allowed',
            })
            return
        }

        setStage('uploading-ct')
        setUploadProgress(0)
        setErrorMessage(null)
        setValidationResult(null)

        try {
            setUploadProgress(10)
            const ctMetadata = await uploadCtMutation.mutateAsync(ctFile)

            setStage('uploading-seg')
            setUploadProgress(40)
            const segMetadata = await uploadSegMutation.mutateAsync(segFile)

            setStage('creating-pair')
            setUploadProgress(70)
            await createPairMutation.mutateAsync({
                ct_volume_id: ctMetadata.volume_id,
                seg_volume_id: segMetadata.volume_id,
                auto_resample: true, // Enable automatic resampling
            })
        } catch (error) {
            console.error('Upload failed:', error)
        }
    }

    const handleReset = () => {
        setCtFile(null)
        setSegFile(null)
        setStage('idle')
        setUploadProgress(0)
        setErrorMessage(null)
        setValidationResult(null)
        if (ctInputRef.current) ctInputRef.current.value = ''
        if (segInputRef.current) segInputRef.current.value = ''
    }

    const handleOpenChange = (newOpen: boolean) => {
        setOpen(newOpen)
        if (!newOpen && stage === 'success') {
            setTimeout(handleReset, 300)
        }
    }

    const isUploading = stage === 'uploading-ct' || stage === 'uploading-seg' || stage === 'creating-pair'
    const canUpload = ctFile && segFile && !isUploading

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
                {trigger || (
                    <Button className="gap-2">
                        <Upload className="h-4 w-4" />
                        Upload Pair
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                    <DialogTitle>Upload CT and Segmentation Pair</DialogTitle>
                    <DialogDescription>
                        Select or drag and drop CT volume and segmentation mask files. Supported formats: .nii,
                        .nii.gz, .mha, .mhd
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-4">
                    {/* CT File Upload */}
                    <div className="space-y-2">
                        <Label htmlFor="ct-file">CT Volume</Label>
                        <div
                            className={`border-2 border-dashed rounded-lg p-6 transition-colors w-full min-w-0 ${isDraggingCt
                                ? 'border-primary bg-primary/5'
                                : 'border-muted-foreground/25 hover:border-muted-foreground/50'
                                }`}
                            onDragOver={handleDragOver}
                            onDragEnter={handleCtDragEnter}
                            onDragLeave={handleCtDragLeave}
                            onDrop={handleCtDrop}
                        >
                            <div className="flex flex-col items-center gap-2 text-center w-full min-w-0">
                                <FileUp className="h-8 w-8 text-muted-foreground shrink-0" />
                                <div className="text-sm w-full min-w-0">
                                    {ctFile ? (
                                        <p className="font-medium text-foreground break-all">{ctFile.name}</p>
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

                    {/* Segmentation File Upload */}
                    <div className="space-y-2">
                        <Label htmlFor="seg-file">Segmentation Mask</Label>
                        <div
                            className={`border-2 border-dashed rounded-lg p-6 transition-colors w-full min-w-0 ${isDraggingSeg
                                ? 'border-primary bg-primary/5'
                                : 'border-muted-foreground/25 hover:border-muted-foreground/50'
                                }`}
                            onDragOver={handleDragOver}
                            onDragEnter={handleSegDragEnter}
                            onDragLeave={handleSegDragLeave}
                            onDrop={handleSegDrop}
                        >
                            <div className="flex flex-col items-center gap-2 text-center w-full min-w-0">
                                <FileUp className="h-8 w-8 text-muted-foreground shrink-0" />
                                <div className="text-sm w-full min-w-0">
                                    {segFile ? (
                                        <p className="font-medium text-foreground break-all">{segFile.name}</p>
                                    ) : (
                                        <>
                                            <p className="font-medium">Drop segmentation file here or click to browse</p>
                                            <p className="text-muted-foreground text-xs mt-1">
                                                .nii, .nii.gz, .mha, .mhd
                                            </p>
                                        </>
                                    )}
                                </div>
                                <input
                                    ref={segInputRef}
                                    id="seg-file"
                                    type="file"
                                    accept=".nii,.gz,.mha,.mhd"
                                    onChange={handleSegFileChange}
                                    className="hidden"
                                    disabled={isUploading}
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => segInputRef.current?.click()}
                                    disabled={isUploading}
                                >
                                    Browse Files
                                </Button>
                            </div>
                        </div>
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
                            <Button onClick={() => setOpen(false)}>Close</Button>
                        </>
                    ) : (
                        <>
                            <Button variant="outline" onClick={handleReset} disabled={isUploading}>
                                Clear
                            </Button>
                            <Button onClick={handleUpload} disabled={!canUpload}>
                                {isUploading ? 'Uploading...' : 'Upload and Create Pair'}
                            </Button>
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}

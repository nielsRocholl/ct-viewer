'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Loader2, Search } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useViewerStore, type DatasetCaseState } from '@/lib/store'
import { getDatasetCases, openDatasetCase } from '@/lib/api-client'
import type { OpenCaseResponse } from '@/lib/api-types'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandShortcut,
} from '@/components/ui/command'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { mergeSegDisplay, type DatasetSeg } from '@/lib/dataset-seg-merge'
import { queryKeys } from '@/lib/api-hooks'
import { cn } from '@/lib/utils'

function segVolumesRawFromOpenResponse(res: OpenCaseResponse): DatasetSeg[] {
    return (
        res.seg_volume_ids?.map((s) => ({
            volumeId: s.volume_id,
            role: s.role,
            name: s.name,
            allBackground: s.all_background ?? null,
            componentCount: s.component_count ?? null,
            multiLabel: s.multi_label ?? null,
            nonzeroLabelCount: s.nonzero_label_count ?? null,
            labelValues: s.label_values ?? null,
        })) ?? [
            ...(res.label_volume_id
                ? [
                      {
                          volumeId: res.label_volume_id,
                          role: 'gt' as const,
                          name: 'Label',
                          allBackground: res.label_all_background ?? null,
                          componentCount: null,
                          multiLabel: null,
                          nonzeroLabelCount: null,
                          labelValues: null,
                      },
                  ]
                : []),
            ...(res.pred_volume_id
                ? [
                      {
                          volumeId: res.pred_volume_id,
                          role: 'pred' as const,
                          name: 'Prediction',
                          allBackground: null,
                          componentCount: null,
                          multiLabel: null,
                          nonzeroLabelCount: null,
                          labelValues: null,
                      },
                  ]
                : []),
        ]
    )
}

function applyOpenCaseResponse(
    res: OpenCaseResponse,
    prev: DatasetCaseState,
    setDatasetCase: (s: DatasetCaseState) => void
) {
    const segVolumesRaw = segVolumesRawFromOpenResponse(res)
    const segVolumes = mergeSegDisplay(prev.segVolumes, segVolumesRaw)
    setDatasetCase({
        datasetId: prev.datasetId,
        caseIndex: res.case_index,
        caseCount: prev.caseCount,
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
}

/** Prominent case navigation for dataset mode — lives in the app header. */
export function DatasetCaseNav({ className }: { className?: string }) {
    const datasetCase = useViewerStore((s) => s.datasetCase)
    const setDatasetCase = useViewerStore((s) => s.setDatasetCase)
    const [loading, setLoading] = useState(false)
    const [pickerOpen, setPickerOpen] = useState(false)

    const { data: casesData, isLoading: casesLoading, isError: casesListError, error: casesListErr } = useQuery({
        queryKey: datasetCase ? queryKeys.datasetCases(datasetCase.datasetId) : ['datasets', 'none', 'cases'],
        queryFn: () => getDatasetCases(datasetCase!.datasetId),
        enabled: pickerOpen && !!datasetCase,
    })

    useEffect(() => {
        if (!casesListError || !casesListErr) return
        const description =
            casesListErr instanceof Error ? casesListErr.message : 'Unknown error'
        toast.error('Failed to load case list', { description })
    }, [casesListError, casesListErr])

    const runOpenCase = useCallback(
        async (open: () => Promise<void>) => {
            if (!datasetCase || loading) return
            setLoading(true)
            try {
                await open()
            } catch (e) {
                toast.error('Failed to open case', {
                    description: e instanceof Error ? e.message : 'Unknown error',
                })
            } finally {
                setLoading(false)
            }
        },
        [datasetCase, loading]
    )

    const go = useCallback(
        async (delta: number) => {
            if (!datasetCase || loading) return
            const nextIndex = datasetCase.caseIndex + delta
            if (nextIndex < 0 || nextIndex >= datasetCase.caseCount) return
            await runOpenCase(async () => {
                const res = await openDatasetCase(datasetCase.datasetId, {
                    case_index: nextIndex,
                })
                applyOpenCaseResponse(res, datasetCase, setDatasetCase)
            })
        },
        [datasetCase, loading, runOpenCase, setDatasetCase]
    )

    const pickCaseById = useCallback(
        async (caseId: string) => {
            const prev = useViewerStore.getState().datasetCase
            if (!prev || loading) return
            if (caseId === prev.caseId) {
                setPickerOpen(false)
                return
            }
            setPickerOpen(false)
            await runOpenCase(async () => {
                const res = await openDatasetCase(prev.datasetId, { case_id: caseId })
                applyOpenCaseResponse(res, prev, setDatasetCase)
            })
        },
        [loading, runOpenCase, setDatasetCase]
    )

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!datasetCase || pickerOpen) return
            if (e.key === 'ArrowLeft') {
                e.preventDefault()
                void go(-1)
            } else if (e.key === 'ArrowRight') {
                e.preventDefault()
                void go(1)
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [datasetCase, go, pickerOpen])

    if (!datasetCase) return null

    const canPrev = datasetCase.caseIndex > 0
    const canNext = datasetCase.caseIndex < datasetCase.caseCount - 1
    const caseCount = casesData?.case_count ?? datasetCase.caseCount

    return (
        <>
            <nav
                className={cn(
                    'relative flex min-h-9 w-full items-center py-1 pl-1 pr-1 rounded-lg border border-border bg-card/95 shadow-md shadow-black/[0.056] ring-1 ring-black/[0.035] backdrop-blur-sm dark:bg-card/90 dark:shadow-black/[0.175] dark:ring-white/[0.07]',
                    className
                )}
                aria-label="Case navigator — navigate dataset cases"
                aria-busy={loading}
            >
                <span className="sr-only">Case navigator</span>
                <div className="flex min-w-0 flex-1 items-center justify-start gap-1">
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="relative z-10 size-9 shrink-0 rounded-md border-input bg-background shadow-sm"
                        onClick={() => void go(-1)}
                        disabled={!canPrev || loading}
                        aria-label="Previous case"
                    >
                        <ChevronLeft className="size-4" />
                    </Button>
                    <TooltipProvider delayDuration={300}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="relative z-10 size-9 shrink-0 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                                    onClick={() => setPickerOpen(true)}
                                    disabled={loading}
                                    aria-label="Go to case — search or pick from list"
                                >
                                    <Search className="size-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs">
                                Go to case…
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
                <div className="pointer-events-none absolute left-1/2 top-1/2 z-0 flex min-w-[6.5rem] max-w-[min(100%,11rem)] -translate-x-1/2 -translate-y-1/2 items-center justify-center px-1 text-center">
                    {loading ? (
                        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
                    ) : (
                        <span className="text-sm font-semibold tabular-nums leading-none text-foreground">
                            {datasetCase.caseIndex + 1}
                            <span className="font-medium text-muted-foreground"> / {datasetCase.caseCount}</span>
                        </span>
                    )}
                </div>
                <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
                    <span className="size-9 shrink-0" aria-hidden />
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="relative z-10 size-9 shrink-0 rounded-md border-input bg-background shadow-sm"
                        onClick={() => void go(1)}
                        disabled={!canNext || loading}
                        aria-label="Next case"
                    >
                        <ChevronRight className="size-4" />
                    </Button>
                </div>
            </nav>

            <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
                <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
                    <DialogHeader className="px-4 pt-4 pb-2">
                        <DialogTitle>Go to case</DialogTitle>
                        <DialogDescription>
                            Search by case id or index, then choose a row to open it.
                        </DialogDescription>
                    </DialogHeader>
                    <Command className="rounded-none border-t" shouldFilter={!casesLoading}>
                        <CommandInput placeholder="Filter cases…" disabled={casesLoading} />
                        <CommandList>
                            <CommandEmpty>
                                {casesLoading ? 'Loading cases…' : 'No matching cases.'}
                            </CommandEmpty>
                            {!casesLoading && casesData && (
                                <CommandGroup
                                    heading={`${casesData.case_ids.length} case${casesData.case_ids.length !== 1 ? 's' : ''}`}
                                >
                                    {casesData.case_ids.map((id, i) => (
                                        <CommandItem
                                            key={id}
                                            value={`${id} ${i + 1} ${i + 1}/${caseCount}`}
                                            onSelect={() => void pickCaseById(id)}
                                            className="gap-2"
                                        >
                                            <span className="min-w-0 flex-1 truncate font-mono text-xs">{id}</span>
                                            {id === datasetCase.caseId ? (
                                                <Check className="size-4 shrink-0 text-primary" aria-hidden />
                                            ) : null}
                                            <CommandShortcut className="tabular-nums">
                                                {i + 1}/{caseCount}
                                            </CommandShortcut>
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            )}
                        </CommandList>
                    </Command>
                </DialogContent>
            </Dialog>
        </>
    )
}

'use client'

import { useViewerStore } from '@/lib/store'
import { shallow } from 'zustand/shallow'
import { ViewerPanel } from './viewer-panel'
import { DatasetViewerPanel, DatasetNav } from './dataset-viewer-panel'
import { Button } from './ui/button'
import { X } from 'lucide-react'
import { Card, CardContent } from './ui/card'
import { toast } from 'sonner'

const MAX_PAIRS = 10

const GRID_COLS_CLASS: Record<number, string> = {
    1: 'md:grid-cols-1',
    2: 'md:grid-cols-2',
    3: 'md:grid-cols-3',
    4: 'md:grid-cols-4',
}

export function ViewerGrid() {
    const pairArray = useViewerStore((state) => Array.from(state.pairs.values()), shallow)
    const removePair = useViewerStore((state) => state.removePair)
    const gridColumns = useViewerStore((state) => state.gridColumns)
    const viewMode = useViewerStore((state) => state.viewMode)
    const datasetCase = useViewerStore((state) => state.datasetCase)
    const canAddMore = pairArray.length < MAX_PAIRS
    const gridColsClass = GRID_COLS_CLASS[Math.min(4, Math.max(1, gridColumns))] ?? 'md:grid-cols-2'

    const handleRemovePair = (pairId: string) => {
        removePair(pairId)
        toast.success('Pair removed', {
            description: `Removed pair ${pairId.slice(0, 8)}`,
        })
    }

    if (viewMode === 'dataset') {
        if (!datasetCase) {
            return (
                <div className="flex items-center justify-center min-h-[400px]">
                    <Card className="w-full max-w-md">
                        <CardContent className="p-8 text-center">
                            <p className="text-muted-foreground mb-4">
                                No dataset loaded. Use &quot;Load dataset&quot; in the sidebar and enter server folder paths.
                            </p>
                        </CardContent>
                    </Card>
                </div>
            )
        }
        return (
            <div className="space-y-6">
                <DatasetNav />
                <div className="w-full max-w-[1800px] px-2">
                    <DatasetViewerPanel />
                </div>
            </div>
        )
    }

    if (pairArray.length === 0) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Card className="w-full max-w-md">
                    <CardContent className="p-8 text-center space-y-2">
                        <p className="text-muted-foreground">
                            No data loaded yet.
                        </p>
                        <p className="text-sm text-muted-foreground">
                            Use <span className="font-medium text-foreground">Upload</span> for single CT + masks,
                            or <span className="font-medium text-foreground">Load dataset</span> for folders.
                        </p>
                        <p className="text-xs text-muted-foreground">
                            Up to {MAX_PAIRS} pairs at once.
                        </p>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* Grid Info */}
            <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                    {pairArray.length} / {MAX_PAIRS} pairs loaded
                </p>
                {!canAddMore && (
                    <p className="text-sm text-amber-600 dark:text-amber-400">
                        Maximum pair limit reached
                    </p>
                )}
            </div>

            {/* Responsive Grid Layout */}
            <div className={`grid grid-cols-1 ${gridColsClass} gap-6 auto-rows-fr`}>
                {pairArray.map((pair) => (
                    <div key={pair.pairId} className="relative">
                        {/* Remove Button */}
                        <Button
                            variant="destructive"
                            size="icon"
                            className="absolute -top-2 -right-2 z-10 h-8 w-8 rounded-full shadow-lg"
                            onClick={() => handleRemovePair(pair.pairId)}
                            aria-label={`Remove pair ${pair.pairId}`}
                        >
                            <X className="h-4 w-4" />
                        </Button>

                        {/* Viewer Panel */}
                        <ViewerPanel pairId={pair.pairId} />
                    </div>
                ))}
            </div>
        </div>
    )
}

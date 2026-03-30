'use client'

import { AppSidebar } from '@/components/app-sidebar'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { ViewerGrid } from '@/components/viewer-grid'
import { useViewerStore } from '@/lib/store'
import { cn } from '@/lib/utils'

export default function Home() {
    const viewMode = useViewerStore((s) => s.viewMode)
    const datasetCase = useViewerStore((s) => s.datasetCase)
    const datasetLesionStats = useViewerStore((s) => s.datasetLesionStats)
    const datasetFill = viewMode === 'dataset' && datasetCase !== null
    const statsScroll =
        viewMode === 'datasetStats' && datasetLesionStats !== null

    return (
        <SidebarProvider
            className="min-h-0 w-full min-w-0 flex-1 basis-0 overflow-hidden"
            style={{ '--sidebar-width': '19rem' } as React.CSSProperties}
        >
            <AppSidebar />
            <SidebarInset className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="pointer-events-none absolute left-2 top-2 z-20 hidden md:block">
                    <SidebarTrigger className="pointer-events-auto bg-background/80 shadow-sm backdrop-blur-sm" />
                </div>
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
                    <div
                        className={cn(
                            'flex min-h-0 w-full flex-1 flex-col',
                            statsScroll ? 'overflow-y-auto overflow-x-hidden' : 'overflow-hidden',
                            datasetFill ? 'max-w-none' : 'mx-auto max-w-7xl'
                        )}
                    >
                        <ViewerGrid />
                    </div>
                </div>
            </SidebarInset>
        </SidebarProvider>
    )
}

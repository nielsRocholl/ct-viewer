'use client'

import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { ViewerGrid } from '@/components/viewer-grid'
import { ThemeToggle } from '@/components/theme-toggle'

export default function Home() {
    return (
        <SidebarProvider
            style={{ '--sidebar-width': '19rem' } as React.CSSProperties}
        >
            <AppSidebar />
            <SidebarInset>
                <header className="flex h-16 shrink-0 items-center justify-end gap-2 px-4">
                    <ThemeToggle />
                </header>
                <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 pt-0">
                    <div className="max-w-7xl mx-auto w-full space-y-6">
                        <ViewerGrid />
                    </div>
                </div>
            </SidebarInset>
        </SidebarProvider>
    )
}

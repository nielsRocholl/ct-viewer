'use client'

import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent } from '@/components/ui/sidebar'
import { GlobalControls } from './global-controls'

export function AppSidebar() {
    return (
        <Sidebar variant="floating">
            <div className="sidebar-drag-region absolute left-0 right-0 top-0 z-10 h-11 shrink-0" aria-hidden />
            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupContent className="p-4">
                        <GlobalControls />
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>
        </Sidebar>
    )
}

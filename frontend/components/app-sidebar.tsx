'use client'

import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
} from '@/components/ui/sidebar'
import { GlobalControls } from './global-controls'
import { ThemeToggle } from './theme-toggle'

export function AppSidebar() {
    return (
        <Sidebar variant="floating">
            <div className="sidebar-drag-region absolute left-0 right-0 top-0 z-10 h-11 shrink-0" aria-hidden />
            <SidebarContent>
                <SidebarGroup className="min-h-0 flex-1 flex flex-col">
                    <SidebarGroupContent className="min-h-0 flex-1 overflow-auto p-4">
                        <GlobalControls />
                    </SidebarGroupContent>
                </SidebarGroup>
                <SidebarFooter className="mt-auto shrink-0 border-t border-sidebar-border p-4">
                    <ThemeToggle />
                </SidebarFooter>
            </SidebarContent>
        </Sidebar>
    )
}

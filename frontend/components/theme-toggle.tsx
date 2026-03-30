'use client'

import { Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTheme } from '@/components/theme-provider'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSidebar } from '@/components/ui/sidebar'

export function ThemeToggle() {
    const [mounted, setMounted] = useState(false)
    const { resolvedTheme, setTheme } = useTheme()
    const { state, isMobile } = useSidebar()
    const sidebarCollapsed = state === 'collapsed' && !isMobile

    useEffect(() => setMounted(true), [])

    const isDark = mounted && resolvedTheme === 'dark'

    if (sidebarCollapsed) {
        return (
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="shrink-0"
                        disabled={!mounted}
                        onClick={() => setTheme(isDark ? 'light' : 'dark')}
                        aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
                    >
                        {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                    </Button>
                </TooltipTrigger>
                <TooltipContent side="right">{isDark ? 'Light mode' : 'Dark mode'}</TooltipContent>
            </Tooltip>
        )
    }

    return (
        <div className="flex items-center gap-2">
            <Sun
                className={`h-4 w-4 shrink-0 ${mounted ? 'text-muted-foreground' : ''}`}
                aria-hidden
            />
            <Switch
                checked={isDark}
                disabled={!mounted}
                onCheckedChange={(on) => setTheme(on ? 'dark' : 'light')}
                aria-label="Toggle theme"
            />
            <Moon
                className={`h-4 w-4 shrink-0 ${mounted ? 'text-muted-foreground' : ''}`}
                aria-hidden
            />
        </div>
    )
}

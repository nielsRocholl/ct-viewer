'use client'

import { Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTheme } from '@/components/theme-provider'
import { Switch } from '@/components/ui/switch'

export function ThemeToggle() {
    const [mounted, setMounted] = useState(false)
    const { resolvedTheme, setTheme } = useTheme()

    useEffect(() => setMounted(true), [])

    return (
        <div className="flex items-center gap-2">
            <Sun
                className={`h-4 w-4 shrink-0 ${mounted ? 'text-muted-foreground' : ''}`}
                aria-hidden
            />
            <Switch
                checked={mounted && resolvedTheme === 'dark'}
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

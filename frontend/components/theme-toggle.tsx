'use client'

import * as React from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/components/theme-provider'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'

export function ThemeToggle() {
    const { setTheme, resolvedTheme } = useTheme()
    const [mounted, setMounted] = React.useState(false)

    React.useEffect(() => {
        setMounted(true)
    }, [])

    if (!mounted) {
        return (
            <div className="flex items-center gap-2">
                <Sun className="h-4 w-4 text-muted-foreground" />
                <Switch disabled />
                <Moon className="h-4 w-4 text-muted-foreground" />
            </div>
        )
    }

    const isDark = resolvedTheme === 'dark'

    return (
        <div className="flex items-center gap-2">
            <Sun className="h-4 w-4 text-muted-foreground" />
            <Switch
                id="theme-toggle"
                checked={isDark}
                onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
                aria-label="Toggle theme"
            />
            <Label htmlFor="theme-toggle" className="cursor-pointer text-muted-foreground">
                <Moon className="h-4 w-4" />
            </Label>
        </div>
    )
}

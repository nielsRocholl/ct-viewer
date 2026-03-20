'use client'

import * as React from 'react'
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState } from 'react'
import type { Theme } from '@/types/theme'

interface ThemeProviderState {
    theme: Theme
    setTheme: (theme: Theme) => void
    systemTheme: 'light' | 'dark'
    resolvedTheme: 'light' | 'dark'
}

interface ThemeProviderProps {
    children: React.ReactNode
    defaultTheme?: Theme
    storageKey?: string
    attribute?: string
}

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined)

export function ThemeProvider({
    children,
    defaultTheme = 'system',
    storageKey = 'ui-theme',
}: ThemeProviderProps) {
    const [theme, setThemeState] = useState<Theme>(defaultTheme)
    const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>('light')

    useEffect(() => {
        try {
            const raw = localStorage.getItem(storageKey)
            if (raw === 'light' || raw === 'dark' || raw === 'system') setThemeState(raw)
        } catch {
            // ignore
        }
    }, [storageKey])

    useLayoutEffect(() => {
        const mq = window.matchMedia('(prefers-color-scheme: dark)')
        const readSystem = (): 'light' | 'dark' => (mq.matches ? 'dark' : 'light')

        const sync = () => {
            const st = readSystem()
            setSystemTheme(st)
            const root = document.documentElement
            const resolved = theme === 'system' ? st : theme
            root.classList.remove('light', 'dark')
            root.classList.add(resolved)
        }

        sync()
        mq.addEventListener('change', sync)
        return () => mq.removeEventListener('change', sync)
    }, [theme])

    const setTheme = useCallback(
        (newTheme: Theme) => {
            setThemeState(newTheme)
            try {
                localStorage.setItem(storageKey, newTheme)
            } catch {
                // ignore
            }
        },
        [storageKey]
    )

    const resolvedTheme = theme === 'system' ? systemTheme : theme

    return (
        <ThemeProviderContext.Provider value={{ theme, setTheme, systemTheme, resolvedTheme }}>
            {children}
        </ThemeProviderContext.Provider>
    )
}

export function useTheme() {
    const context = useContext(ThemeProviderContext)
    if (context === undefined) {
        throw new Error('useTheme must be used within a ThemeProvider')
    }
    return context
}

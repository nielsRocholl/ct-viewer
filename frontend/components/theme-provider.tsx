'use client'

import * as React from 'react'
import { createContext, useContext, useEffect, useState } from 'react'
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

function getInitialTheme(storageKey: string, defaultTheme: Theme): Theme {
    void storageKey
    void defaultTheme
    return 'system'
}

function getInitialSystemTheme(): 'light' | 'dark' {
    if (typeof window === 'undefined') return 'light'
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({
    children,
    defaultTheme = 'system',
    storageKey = 'ui-theme',
}: ThemeProviderProps) {
    const [theme, setThemeState] = useState<Theme>(() => getInitialTheme(storageKey, defaultTheme))
    const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(getInitialSystemTheme)

    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
        setSystemTheme(mediaQuery.matches ? 'dark' : 'light')
        const handleChange = (e: MediaQueryListEvent) => {
            setSystemTheme(e.matches ? 'dark' : 'light')
        }
        mediaQuery.addEventListener('change', handleChange)
        return () => mediaQuery.removeEventListener('change', handleChange)
    }, [])

    useEffect(() => {
        const root = window.document.documentElement
        const resolved = theme === 'system' ? systemTheme : theme
        root.classList.remove('light', 'dark')
        root.classList.add(resolved)
    }, [theme, systemTheme])

    const setTheme = (newTheme: Theme) => {
        try {
            localStorage.setItem(storageKey, 'system')
        } catch {
            // ignore
        }
        setThemeState('system')
    }

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

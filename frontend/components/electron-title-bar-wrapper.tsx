'use client'

import { useEffect, useState } from 'react'

const TITLE_BAR_HEIGHT = 21 /* 40% of 52px (reduced by 60%) */

export function ElectronTitleBarWrapper({ children }: { children: React.ReactNode }) {
    const [isElectron, setIsElectron] = useState(false)

    useEffect(() => {
        if (typeof window !== 'undefined' && window.electronAPI) {
            setIsElectron(true)
            document.documentElement.style.background = 'transparent'
            document.body.style.background = 'transparent'
            document.body.dataset.electron = 'true'
            return () => {
                document.documentElement.style.background = ''
                document.body.style.background = ''
                delete document.body.dataset.electron
            }
        }
    }, [])

    if (!isElectron) {
        return (
            <div className="flex h-svh max-h-svh min-h-0 flex-col overflow-hidden bg-background">
                {children}
            </div>
        )
    }

    return (
        <div
            className="box-border flex h-svh max-h-svh flex-col overflow-hidden bg-background"
            style={{ paddingTop: TITLE_BAR_HEIGHT }}
        >
            <div className="flex min-h-0 flex-1 basis-0 flex-col overflow-hidden">{children}</div>
        </div>
    )
}

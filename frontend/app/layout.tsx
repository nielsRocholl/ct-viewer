import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { QueryProvider } from "@/components/query-provider"
import { ElectronTitleBarWrapper } from "@/components/electron-title-bar-wrapper"
import { Toaster } from "sonner"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
    title: "CT Segmentation Viewer",
    description: "Web-based CT volume and segmentation mask viewer",
}

export default function RootLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <html lang="en" suppressHydrationWarning>
            <head>
                <script
                    dangerouslySetInnerHTML={{
                        __html: `(function(){var s=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.classList.add(s);})();`,
                    }}
                />
            </head>
            <body className={inter.className}>
                <ThemeProvider defaultTheme="system" storageKey="ui-theme">
                    <QueryProvider>
                        <ElectronTitleBarWrapper>
                            {children}
                            <Toaster
                                position="top-right"
                                expand={false}
                                richColors
                                closeButton
                                duration={5000}
                            />
                        </ElectronTitleBarWrapper>
                    </QueryProvider>
                </ThemeProvider>
            </body>
        </html>
    )
}

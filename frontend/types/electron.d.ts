export { }

declare global {
    interface Window {
        electronAPI?: {
            showFolderPicker: (payload: { which: 'images' | 'labels' | 'preds' }) => Promise<string | null>
        }
    }
}

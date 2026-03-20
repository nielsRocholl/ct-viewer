/** Limits concurrent slice HTTP+blob work so many masks do not stampede the main thread (Electron + localhost). */
const CAP = Math.max(2, Number(process.env.NEXT_PUBLIC_SLICE_FETCH_CONCURRENCY) || 12)

let active = 0
const waiters: Array<() => void> = []

export async function withSliceFetchSlot<T>(fn: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve) => {
        const tryRun = () => {
            if (active < CAP) {
                active++
                resolve()
            } else {
                waiters.push(tryRun)
            }
        }
        tryRun()
    })
    try {
        return await fn()
    } finally {
        active--
        const next = waiters.shift()
        if (next) next()
    }
}

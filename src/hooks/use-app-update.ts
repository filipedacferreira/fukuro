import { relaunch } from '@tauri-apps/plugin-process'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { useEffect, useRef, useState } from 'react'

type AppUpdateState =
  | { status: 'idle' }
  | { status: 'available'; version: string }
  | {
      status: 'downloading'
      version: string
      downloaded: number
      contentLength: number | null
    }
  | { status: 'ready'; version: string }
  | { status: 'installing' }
  | { status: 'error'; message: string }

// Checks GitHub Releases for a newer published version once, on app startup — no periodic
// re-checks and no manual "Check for updates" entry point (see docs/roadmap.md's App
// auto-update entry). A failed check is a silent no-op, since it's a passive background
// check the user never triggered; a failure after they've accepted the prompt (download or
// install) surfaces as an error instead, since they've now taken an explicit action.
export const useAppUpdate = () => {
  const [state, setState] = useState<AppUpdateState>({ status: 'idle' })
  // Holds the plugin's Update handle (its download/install methods) across renders. Not
  // state itself — nothing needs to re-render when this changes on its own.
  const updateRef = useRef<Update | null>(null)

  useEffect(() => {
    check()
      .then((update) => {
        if (!update) return
        updateRef.current = update
        setState({ status: 'available', version: update.version })
      })
      .catch(() => {
        // Silent — see the comment above.
      })
  }, [])

  const download = () => {
    const update = updateRef.current
    if (!update) return

    setState({
      status: 'downloading',
      version: update.version,
      downloaded: 0,
      contentLength: null,
    })

    update
      .download((event) => {
        if (event.event === 'Started') {
          setState((prev) =>
            prev.status === 'downloading'
              ? { ...prev, contentLength: event.data.contentLength ?? null }
              : prev,
          )
        } else if (event.event === 'Progress') {
          setState((prev) =>
            prev.status === 'downloading'
              ? {
                  ...prev,
                  downloaded: prev.downloaded + event.data.chunkLength,
                }
              : prev,
          )
        }
      })
      .then(() => setState({ status: 'ready', version: update.version }))
      .catch((e) => setState({ status: 'error', message: String(e) }))
  }

  const restartNow = () => {
    const update = updateRef.current
    if (!update) return
    setState({ status: 'installing' })
    update
      .install()
      .then(() => relaunch())
      .catch((e) => setState({ status: 'error', message: String(e) }))
  }

  // Discards the downloaded update rather than installing it in the background — the next
  // app launch's startup check will find the same release again and the whole
  // prompt/download/restart flow repeats, instead of trying to persist install state across
  // a process exit.
  const restartLater = () => {
    updateRef.current = null
    setState({ status: 'idle' })
  }

  const dismiss = () => {
    updateRef.current = null
    setState({ status: 'idle' })
  }

  return { state, download, restartNow, restartLater, dismiss }
}

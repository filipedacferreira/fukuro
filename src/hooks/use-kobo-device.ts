import { listen } from '@tauri-apps/api/event'
import { useEffect, useState } from 'react'
import { api } from '@/lib/tauri'
import type { KoboDevice } from '@/types'

// Tracks the currently-connected Kobo device (or null) for the lifetime of the calling
// component. `get_kobo_device` seeds the initial value from the Rust-side poller's cached
// state (see kobo.rs) so the caller doesn't start blank for up to 3s waiting on the first
// poll tick; `kobo-device-changed` covers every connect/disconnect after that. Mirrors the
// `getLibraryRoot` + `projects-updated` pattern `ProjectList` already uses for the library
// watcher.
export const useKoboDevice = () => {
  const [device, setDevice] = useState<KoboDevice | null>(null)

  useEffect(() => {
    api.getKoboDevice().then(setDevice)
  }, [])

  useEffect(() => {
    const unlisten = listen<KoboDevice | null>(
      'kobo-device-changed',
      (event) => {
        setDevice(event.payload)
      },
    )
    return () => {
      unlisten.then((fn) => fn())
    }
  }, [])

  return device
}

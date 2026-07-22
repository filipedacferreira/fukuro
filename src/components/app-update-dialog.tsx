import type { FC } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { useAppUpdate } from '@/hooks/use-app-update'

// Fully controlled (no Dialog.Trigger) — this dialog is driven entirely by the startup
// update check's own state machine, not by a user-clicked button. Renders across every
// step of the flow (prompt → download progress → restart choice → error) as one dialog
// whose content swaps with `state.status`, rather than a different dialog per step.
export const AppUpdateDialog: FC = () => {
  const { state, download, restartNow, restartLater, dismiss } = useAppUpdate()

  const open = state.status !== 'idle'
  // Downloading/installing must run to completion — closing mid-flight would abandon the
  // in-progress download or leave the install half-applied. Mirrors KoboSyncDrawer's guard
  // against Esc/backdrop dismissal during its own in-flight batch.
  const dismissable =
    state.status !== 'downloading' && state.status !== 'installing'

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !dismissable) return
        if (!next) dismiss()
      }}
    >
      <Dialog.Content className="w-96">
        {state.status === 'available' && (
          <>
            <Dialog.Title>Update available</Dialog.Title>
            <Dialog.Description>
              Version {state.version} is available. Download and install it now?
            </Dialog.Description>
            <Dialog.Actions>
              <Button onClick={download}>Download & install</Button>
              <Button variant="outline" onClick={dismiss}>
                Not now
              </Button>
            </Dialog.Actions>
          </>
        )}

        {state.status === 'downloading' && (
          <>
            <Dialog.Title>Downloading update…</Dialog.Title>
            <Dialog.Description>
              Version {state.version} is downloading. This won't take long.
            </Dialog.Description>
            <Progress
              value={state.downloaded}
              max={state.contentLength || 1}
              size="sm"
            />
          </>
        )}

        {state.status === 'ready' && (
          <>
            <Dialog.Title>Update ready</Dialog.Title>
            <Dialog.Description>
              Version {state.version} is ready to install. Restart now, or later
              next time you close and reopen fukuro?
            </Dialog.Description>
            <Dialog.Actions>
              <Button onClick={restartNow}>Restart now</Button>
              <Button variant="outline" onClick={restartLater}>
                Restart later
              </Button>
            </Dialog.Actions>
          </>
        )}

        {state.status === 'installing' && (
          <>
            <Dialog.Title>Installing update…</Dialog.Title>
            <Dialog.Description>
              fukuro will restart shortly.
            </Dialog.Description>
          </>
        )}

        {state.status === 'error' && (
          <>
            <Dialog.Title>Update failed</Dialog.Title>
            <Dialog.Description>{state.message}</Dialog.Description>
            <Dialog.Actions>
              <Button variant="outline" onClick={dismiss}>
                Dismiss
              </Button>
            </Dialog.Actions>
          </>
        )}
      </Dialog.Content>
    </Dialog>
  )
}

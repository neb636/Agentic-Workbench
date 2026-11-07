// Only mounted by a lab, only in local Vite development. The public game has no desktop IPC access.
import { useEffect, useRef } from 'react'
import { LAB_CHANNEL, STUDIO_ORIGIN, snapshotKey, validateProposal, type LabSnapshot, type LabProposal } from '../../../workbench/src/shared/labs'

export function useStudioBridge(read: () => LabSnapshot, apply: (proposal: LabProposal) => void) {
  const current = useRef({ read, apply })
  current.current = { read, apply }
  useEffect(() => {
    if (!import.meta.env.DEV || parent === window || location.hostname !== '127.0.0.1') return
    const receive = (event: MessageEvent) => {
      if (event.source !== parent || event.origin !== STUDIO_ORIGIN || event.data?.channel !== LAB_CHANNEL) return
      const { id, action } = event.data
      if (typeof id !== 'string') return
      try {
        const snapshot = current.current.read()
        if (action === 'apply') {
          if (event.data.expected !== snapshotKey(snapshot)) throw new Error('The scene or controls changed. Ask AI again for this moment.')
          current.current.apply(validateProposal(snapshot, event.data.proposal))
        } else if (action !== 'snapshot') return
        parent.postMessage({ channel: LAB_CHANNEL, id, snapshot: current.current.read() }, STUDIO_ORIGIN)
      } catch (error) {
        parent.postMessage({ channel: LAB_CHANNEL, id, error: String(error) }, STUDIO_ORIGIN)
      }
    }
    addEventListener('message', receive)
    return () => removeEventListener('message', receive)
  }, [])
  useEffect(() => {
    if (import.meta.env.DEV && parent !== window && location.hostname === '127.0.0.1') parent.postMessage({ channel: LAB_CHANNEL, ready: true, snapshot: current.current.read() }, STUDIO_ORIGIN)
  })
}

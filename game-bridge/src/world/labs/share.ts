import { LAB_CHANNEL, STUDIO_ORIGIN, type LabShare } from '../../../workbench/src/shared/labs'

export function inStudio() {
  return import.meta.env.DEV && parent !== window && location.hostname === '127.0.0.1'
}

/** Studio owns the clipboard and composer. Wait for its acknowledgement before showing success. */
export async function shareLab(text: string, label: string, action: LabShare['action'] = 'copy'): Promise<string> {
  if (inStudio()) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID()
      const cleanup = () => { clearTimeout(timer); removeEventListener('message', receive) }
      const receive = (event: MessageEvent) => {
        if (event.source !== parent || event.origin !== STUDIO_ORIGIN || event.data?.channel !== LAB_CHANNEL || event.data.shareId !== id) return
        cleanup()
        if (event.data.error) reject(new Error(event.data.error))
        else resolve(action === 'agent' ? 'Added to agent composer — review and send' : `${label} copied`)
      }
      const timer = setTimeout(() => { cleanup(); reject(new Error('Studio did not respond. Reopen the game pane and try again.')) }, 5000)
      addEventListener('message', receive)
      parent.postMessage({ channel: LAB_CHANNEL, shareId: id, share: { action, text, label } }, STUDIO_ORIGIN)
    })
  }
  try {
    await navigator.clipboard.writeText(text)
    return `${label} copied`
  } catch {
    window.prompt(`Copy ${label.toLowerCase()}:`, text)
    return 'Copy the text from the dialog'
  }
}

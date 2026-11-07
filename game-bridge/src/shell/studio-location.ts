// Gamepack Studio's game pane shows which section is on screen (its breadcrumb and Sections tree). Only in local Vite
// development inside the Studio's frame; the public game never posts anything. The labs' own bridge is
// src/world/labs/workbench.ts.
import { useEffect } from 'react'
import { LAB_CHANNEL, STUDIO_ORIGIN } from '../../workbench/src/shared/labs'

/** `enter()` rewrites the address with replaceState, which fires no event, so it checks twice a second. */
export function useStudioLocation() {
  useEffect(() => {
    if (!import.meta.env.DEV || parent === window || location.hostname !== '127.0.0.1') return
    let last = ''
    const tell = () => {
      if (location.href === last) return
      last = location.href
      parent.postMessage({ channel: LAB_CHANNEL, location: last }, STUDIO_ORIGIN)
    }
    tell()
    const timer = setInterval(tell, 500)
    addEventListener('hashchange', tell)
    return () => { clearInterval(timer); removeEventListener('hashchange', tell) }
  }, [])
}

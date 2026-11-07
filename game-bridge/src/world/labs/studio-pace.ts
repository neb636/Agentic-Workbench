// The desktop Studio's game pane only (local Vite dev, `?studio=1` inside the Studio's iframe; main.tsx loads this
// file nowhere else, so Kaylee's builds never see it). It keeps Dad's Mac cool:
// - While the Studio window is in the background, every animation (three.js, Phaser, puppets, motion) gets about
//   8 frames a second and CSS animations pause. The Studio tells us with `{ channel, studioFocused }`.
// - The 3D engine also caps itself at 30 fps in the Studio and draws fewer pixels (engine3d/loop.ts, View3D.tsx).
import { LAB_CHANNEL, STUDIO_ORIGIN } from '../../../workbench/src/shared/labs'

const AWAY_FRAME_MS = 125

let away = false
const nativeRequest = window.requestAnimationFrame.bind(window)
const nativeCancel = window.cancelAnimationFrame.bind(window)
// Frames held back while away: our id → the timer, then the native frame it became.
const held = new Map<number, { timer?: ReturnType<typeof setTimeout>; frame?: number }>()
let nextId = -1 // negative, so it never clashes with a native id

window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
  if (!away) return nativeRequest(callback)
  const id = nextId--
  const entry: { timer?: ReturnType<typeof setTimeout>; frame?: number } = {}
  entry.timer = setTimeout(() => {
    entry.timer = undefined
    entry.frame = nativeRequest((now) => { held.delete(id); callback(now) })
  }, AWAY_FRAME_MS)
  held.set(id, entry)
  return id
}

window.cancelAnimationFrame = (id: number): void => {
  const entry = held.get(id)
  if (!entry) return nativeCancel(id)
  held.delete(id)
  if (entry.timer) clearTimeout(entry.timer)
  if (entry.frame !== undefined) nativeCancel(entry.frame)
}

const style = document.createElement('style')
style.textContent = '.studio-away *, .studio-away *::before, .studio-away *::after { animation-play-state: paused !important; }'
document.head.append(style)

addEventListener('message', (event: MessageEvent) => {
  if (event.source !== parent || event.origin !== STUDIO_ORIGIN || event.data?.channel !== LAB_CHANNEL) return
  if (typeof event.data.studioFocused !== 'boolean') return
  away = !event.data.studioFocused
  document.documentElement.classList.toggle('studio-away', away)
})

import { PIXEL_REVEAL_CONFIG } from '../config'
import type { PixelRevealSchedule } from './pixelGrid'

export function getPixelRevealStart(horizontal: number, vertical: number, schedule: PixelRevealSchedule) {
  const distance = Math.max(0, Math.hypot(horizontal - schedule.origin[0], vertical - schedule.origin[1]) - schedule.minDistance)
  if (distance < 1e-6) return 0
  const nearRadius = Math.max(1, schedule.nearRadius)
  const radius = Math.max(nearRadius + 1, schedule.maxDistance - schedule.minDistance)
  const lastStart = PIXEL_REVEAL_CONFIG.duration - PIXEL_REVEAL_CONFIG.cellDuration
  const localEnd = PIXEL_REVEAL_CONFIG.localDuration - PIXEL_REVEAL_CONFIG.cellDuration
  const start = distance <= nearRadius
    ? distance / nearRadius * localEnd
    : localEnd + Math.sqrt(Math.min(1, (distance - nearRadius) / (radius - nearRadius))) * (lastStart - localEnd)
  const noise = Math.sin(horizontal * 0.0001271 + vertical * 0.0003117) * 43758.5453
  return Math.min(lastStart, start + (noise - Math.floor(noise)) * PIXEL_REVEAL_CONFIG.stagger)
}

export function getPixelRevealAmount(time: number, start: number) {
  const amount = Math.min(1, Math.max(0, (time - start) / PIXEL_REVEAL_CONFIG.cellDuration))
  return amount * amount * (3 - 2 * amount)
}

import { gsap } from 'gsap'
import { Coordinate } from 'maptalks'
import type { Map as MapInstance } from 'maptalks'
import { MAP_FLIGHT_CONFIG } from '../config'

interface MapFlightOptions {
  getMap: () => MapInstance | null
  onFlightChange: (active: boolean) => void
  onSettled: () => void
}

export interface MapFlightView {
  center: Coordinate
  zoom: number
}

export function createFlightPlan(
  distance: number,
  viewportSpan: number,
  startZoom: number,
  targetZoom: number,
  sameSite: boolean,
  minZoom: number,
) {
  const config = MAP_FLIGHT_CONFIG
  const distanceRatio = distance / Math.max(1, viewportSpan)
  const zoomDelta = Math.abs(targetZoom - startZoom)
  const far = distanceRatio > config.farDistanceRatio
  const close = sameSite && !far
  const minDuration = far ? config.farMinDuration : close ? config.minDuration : config.nearbyMinDuration
  const maxDuration = far ? config.maxDuration : close ? config.sameSiteMaxDuration : config.nearbyMaxDuration
  const duration = Math.min(maxDuration, Math.max(minDuration,
    config.minDuration + Math.log2(1 + distanceRatio) * 0.35 + zoomDelta * 0.08))
  const cruiseZoom = far
    ? Math.max(minZoom, Math.min(startZoom, targetZoom) - Math.min(config.maxPullback, Math.log2(distanceRatio)))
    : null
  return {
    duration,
    cruiseZoom,
    arrived: distance <= config.centerTolerance && zoomDelta <= config.zoomTolerance,
  }
}

export function stopMapAnimation(map: MapInstance) {
  if (map.isAnimating()) map.animateTo(map.getView(), { duration: 1 })?.cancel()
}

export function useMapFlight(options: MapFlightOptions) {
  let timeline: gsap.core.Timeline | null = null
  let lastSiteId: string | null = null

  function stop(notify: boolean) {
    if (!timeline) return
    const previous = timeline
    timeline = null
    previous.kill()
    options.onFlightChange(false)
    if (notify) options.onSettled()
  }

  function flyTo(target: MapFlightView, siteId: string) {
    const map = options.getMap()
    if (!map || ![target.center.x, target.center.y, target.zoom].every(Number.isFinite)) return
    stop(false)
    stopMapAnimation(map)
    const startCenter = map.getCenter()
    const startZoom = map.getZoom()
    const targetZoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), target.zoom))
    const projection = map.getProjection()
    const start = projection.project(startCenter)
    const end = projection.project(target.center)
    const startPoint = map.coordToPoint(startCenter)
    const endPoint = map.coordToPoint(target.center)
    const distance = Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y)
    const size = map.getSize()
    const plan = createFlightPlan(distance, Math.min(size.width, size.height), startZoom, targetZoom,
      siteId === lastSiteId, map.getMinZoom())
    lastSiteId = siteId
    if (plan.arrived || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (!plan.arrived) map.setCenterAndZoom(target.center, targetZoom)
      options.onSettled()
      return
    }

    const state = { progress: 0, zoom: startZoom }
    timeline = gsap.timeline({
      paused: true,
      onUpdate: () => {
        const center = projection.unproject(new Coordinate(
          start.x + (end.x - start.x) * state.progress,
          start.y + (end.y - start.y) * state.progress,
        ))
        map.setCenterAndZoom(center, state.zoom)
      },
      onComplete: () => {
        map.setCenterAndZoom(target.center, targetZoom)
        stop(true)
      },
    })
    timeline.to(state, { progress: 1, duration: plan.duration, ease: MAP_FLIGHT_CONFIG.centerEase }, 0)
    if (plan.cruiseZoom !== null) {
      const pullbackDuration = plan.duration * MAP_FLIGHT_CONFIG.pullbackRatio
      timeline.to(state, { zoom: plan.cruiseZoom, duration: pullbackDuration, ease: MAP_FLIGHT_CONFIG.pullbackEase }, 0)
      timeline.to(state, { zoom: targetZoom, duration: plan.duration - pullbackDuration, ease: MAP_FLIGHT_CONFIG.approachEase }, pullbackDuration)
    } else {
      timeline.to(state, { zoom: targetZoom, duration: plan.duration, ease: MAP_FLIGHT_CONFIG.approachEase }, 0)
    }
    options.onFlightChange(true)
    timeline.play()
  }

  return {
    flyTo,
    isFlying: () => timeline !== null,
    cancel: () => stop(true),
    dispose: () => { stop(false); lastSiteId = null },
  }
}

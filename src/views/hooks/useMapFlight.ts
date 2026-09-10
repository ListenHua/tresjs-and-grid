import { gsap } from 'gsap'
import { Coordinate } from 'maptalks'
import type { Map as MapInstance } from 'maptalks'
import { MAP_FLIGHT_CONFIG, MAP_FOG_CONFIG } from '../config'

interface MapFlightOptions {
  getMap: () => MapInstance | null
  onFlightChange: (active: boolean) => void
  onSettled: () => void
  onFogChange?: (coverage: number) => void
  canUseFog?: () => boolean
  getFogConfig?: () => Partial<typeof MAP_FOG_CONFIG>
  prepareArrival?: (siteId: string, signal: AbortSignal) => Promise<void>
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
  let dismissal: gsap.core.Tween | null = null
  let cleanupArrival: (() => void) | null = null
  let revision = 0
  let active = false
  let disposed = false
  let lastSiteId: string | null = null
  const fog = { coverage: 0 }

  function publishFog() {
    options.onFogChange?.(fog.coverage)
  }

  function setActive(value: boolean) {
    if (active === value) return
    active = value
    options.onFlightChange(value)
  }

  function stopAnimations() {
    revision += 1
    timeline?.kill()
    timeline = null
    dismissal?.kill()
    dismissal = null
    cleanupArrival?.()
    cleanupArrival = null
  }

  function cancel(immediate = false) {
    const wasActive = active
    stopAnimations()
    setActive(false)
    if (wasActive) options.onSettled()
    if (!immediate && fog.coverage > 0 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      dismissal = gsap.to(fog, {
        coverage: 0, duration: (options.getFogConfig?.().cancelDuration ?? MAP_FOG_CONFIG.cancelDuration), ease: 'power2.out',
        onUpdate: publishFog,
        onComplete: () => { dismissal = null; fog.coverage = 0; publishFog() },
      })
    } else {
      fog.coverage = 0
      publishFog()
    }
  }

  function suspend() {
    stopAnimations()
    if (fog.coverage > 0) setActive(true)
  }

  function waitForArrival(siteId: string, current: gsap.core.Timeline, token: number) {
    const controller = new AbortController()
    let finished = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      finished = true
      clearTimeout(timer)
      controller.abort()
    }
    cleanupArrival = cleanup
    const resume = () => {
      if (finished) return
      cleanup()
      if (cleanupArrival === cleanup) cleanupArrival = null
      if (!disposed && token === revision && timeline === current) current.play()
    }
    timer = setTimeout(resume, options.getFogConfig?.().maxWaitMs ?? MAP_FOG_CONFIG.maxWaitMs)
    try {
      Promise.resolve(options.prepareArrival?.(siteId, controller.signal)).then(resume, resume)
    } catch {
      resume()
    }
  }

  function flyTo(target: MapFlightView, siteId: string) {
    const map = options.getMap()
    if (disposed || !map || ![target.center.x, target.center.y, target.zoom].every(Number.isFinite)) {
      cancel()
      return
    }
    stopAnimations()
    const token = revision
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
    const sameSite = siteId === lastSiteId
    const plan = createFlightPlan(distance, Math.min(size.width, size.height), startZoom, targetZoom,
      sameSite, map.getMinZoom())
    lastSiteId = siteId
    if (plan.arrived || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (!plan.arrived) map.setCenterAndZoom(target.center, targetZoom)
      fog.coverage = 0
      publishFog()
      setActive(false)
      options.onSettled()
      return
    }

    const state = { progress: 0, zoom: startZoom }
    const render = () => {
      const center = projection.unproject(new Coordinate(
        start.x + (end.x - start.x) * state.progress,
        start.y + (end.y - start.y) * state.progress,
      ))
      map.setCenterAndZoom(center, state.zoom)
      publishFog()
    }
    timeline = gsap.timeline({
      paused: true,
      onUpdate: render,
      onComplete: () => {
        map.setCenterAndZoom(target.center, targetZoom)
        stopAnimations()
        fog.coverage = 0
        publishFog()
        setActive(false)
        options.onSettled()
      },
    })
    const fogConfig = { ...MAP_FOG_CONFIG, ...options.getFogConfig?.() }
    const fogEnabled = fogConfig.enabled && options.onFogChange && (options.canUseFog?.() ?? true)
    if (fogEnabled && (!sameSite || plan.cruiseZoom !== null || fog.coverage > 0)) {
      const closeDuration = fogConfig.closeDuration * (1 - fog.coverage)
      const arrivalZoom = Math.max(map.getMinZoom(), targetZoom - fogConfig.approachZoomOffset)
      const departureZoom = Math.max(map.getMinZoom(), Math.min(startZoom, plan.cruiseZoom ?? arrivalZoom))
      const travelDuration = Math.min(fogConfig.travelMaxDuration,
        Math.max(fogConfig.travelMinDuration, plan.duration * 0.45))
      const arrivalTime = closeDuration + travelDuration
      const current = timeline
      timeline.addLabel('close', 0)
      timeline.to(fog, { coverage: 1, duration: closeDuration, ease: fogConfig.fogEase }, 0)
      timeline.to(state, { zoom: departureZoom, duration: closeDuration, ease: MAP_FLIGHT_CONFIG.pullbackEase }, 0)
      timeline.addLabel('travel', closeDuration)
      timeline.to(state, { progress: 1, zoom: arrivalZoom, duration: travelDuration, ease: MAP_FLIGHT_CONFIG.centerEase }, 'travel')
      timeline.addLabel('arrival', arrivalTime)
      timeline.addPause('arrival', () => { render(); waitForArrival(siteId, current, token) })
      timeline.addLabel('reveal', arrivalTime)
      timeline.to(fog, { coverage: 0, duration: fogConfig.revealDuration, ease: fogConfig.fogEase }, 'reveal')
      timeline.to(state, { zoom: targetZoom, duration: Math.max(fogConfig.approachDuration, fogConfig.revealDuration),
        ease: MAP_FLIGHT_CONFIG.approachEase }, 'reveal')
    } else {
      fog.coverage = 0
      publishFog()
      timeline.to(state, { progress: 1, duration: plan.duration, ease: MAP_FLIGHT_CONFIG.centerEase }, 0)
      if (plan.cruiseZoom !== null) {
        const pullbackDuration = plan.duration * MAP_FLIGHT_CONFIG.pullbackRatio
        timeline.to(state, { zoom: plan.cruiseZoom, duration: pullbackDuration, ease: MAP_FLIGHT_CONFIG.pullbackEase }, 0)
        timeline.to(state, { zoom: targetZoom, duration: plan.duration - pullbackDuration, ease: MAP_FLIGHT_CONFIG.approachEase }, pullbackDuration)
      } else {
        timeline.to(state, { zoom: targetZoom, duration: plan.duration, ease: MAP_FLIGHT_CONFIG.approachEase }, 0)
      }
    }
    setActive(true)
    timeline.play()
  }

  return {
    flyTo,
    isFlying: () => active,
    cancel,
    suspend,
    dispose: () => {
      disposed = true
      stopAnimations()
      fog.coverage = 0
      publishFog()
      setActive(false)
      lastSiteId = null
    },
  }
}

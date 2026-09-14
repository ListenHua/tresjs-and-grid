import type { Ref } from 'vue'
import * as maptalks from 'maptalks'
import type { HandlerFnResultType } from 'maptalks/dist/core/Eventable'
import type { Deck } from '@deck.gl/core'
import { gsap } from 'gsap'
import { AREA_TYPE_COLORS, EXTRUSION_CONFIG, PIXEL_MAP_CONFIG, PIXEL_REVEAL_CONFIG } from '../config'
import { PROTECT_AREAS, PROTECT_AREA_SITES, SITE_BY_ID } from '../data/protectAreas'
import type { ProtectAreaSite } from '../data/protectAreas'
import type { ProtectAreaFeature, ProtectAreaType, GeographicExtent } from '../types/map'
import { MERCATOR_WORLD_SIZE, projectPixelPoint, resolvePixelLevel, unprojectPixelPoint, getPixelRevealAmount, getPixelRevealStart } from '../utils/pixelGrid'
import type { PixelBounds, PixelGridRequest, PixelGridResult } from '../utils/pixelGrid'
import type { PixelCell, MaptalksView } from '../utils/pixelDeck'

interface PixelMapOptions {
  container: Ref<HTMLElement | null>
  getVisibleTypes: () => ProtectAreaType[]
  getRegionsVisible: () => boolean
  getSelection: () => ProtectAreaFeature | null
  onSelect: (feature: ProtectAreaFeature | null) => void
  onHover: (feature: ProtectAreaFeature | null) => void
  onLocate: (sites: ProtectAreaSite[], extent: GeographicExtent) => void
  onError: (message: string) => void
}

const CELL_VERTICES = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]] as [number, number][]
const VIEW_EVENTS = 'moving zooming rotating pitching moveend zoomend rotateend pitchend resize'

export function usePixelMapLayer(options: PixelMapOptions) {
  let map: maptalks.Map | null = null
  let deck: Deck<MaptalksView> | null = null
  let renderer: typeof import('../utils/pixelDeck') | null = null
  let canvas: HTMLCanvasElement | null = null
  let markers: maptalks.VectorLayer | null = null
  let worker: Worker | null = null
  let initialization: Promise<void> | null = null
  let finishInitialization: (() => void) | null = null
  let cells: PixelCell[][] = [[], []]
  let origin: [number, number] = [0, 0]
  let thickness = 0
  let raisedHeight = 0
  let active = false
  let engaged = false
  let disposed = false
  let flying = false
  let hoveredId: string | null = null
  let revision = 0
  let appliedKey = ''
  let requestedKey = ''
  let latestWork: Promise<boolean> = Promise.resolve(false)
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  let frozenGrid: Omit<PixelGridRequest, 'id' | 'visibleTypes'> | null = null
  let revealArmed = false
  let revealTween: gsap.core.Tween | null = null
  const revealTime = { value: PIXEL_REVEAL_CONFIG.duration }
  let pending: { request: PixelGridRequest; key: string; resolve: (ready: boolean) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null
  const cellCounts = new Map<string, number>()
  const supportsHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  function syncSelection(immediate = false) {
    if (!deck || !map || !renderer) return
    const selectedId = options.getSelection()?.id
    const visibleTypes = options.getRegionsVisible() ? options.getVisibleTypes() : []
    deck.setProps({ layers: cells.map((data, index) => new renderer!.PixelColumnLayer({
      id: `pixel-${index}`, data, visible: active, pickable: index === 1,
      coordinateSystem: renderer!.COORDINATE_SYSTEM.CARTESIAN,
      diskResolution: 4, vertices: CELL_VERTICES,
      radius: 1, radiusUnits: 'common', coverage: 1 - PIXEL_MAP_CONFIG.gapRatio,
      getPosition: cell => cell.position,
      getFillColor: cell => !cell.feature || visibleTypes.includes(cell.feature.properties.BHDLX) ? cell.color : [0, 0, 0, 0],
      getElevation: cell => thickness + (cell.feature && (cellCounts.get(cell.feature.id) ?? 0) > 1
        && (cell.feature.id === selectedId || cell.feature.id === hoveredId) ? raisedHeight : 0),
      elevationScale: Math.max(0.001, Math.min(1, map!.getPitch() / 10)),
      revealTime: revealTime.value,
      updateTriggers: { getElevation: [selectedId, hoveredId, thickness, raisedHeight], getFillColor: [visibleTypes.join(',')] },
      transitions: { getElevation: immediate || reducedMotion || !active ? 0 : EXTRUSION_CONFIG.raiseDuration * 1000 },
      material: PIXEL_MAP_CONFIG.material,
    })) })
  }

  function syncView() {
    if (!deck || !map || !active) return
    const size = map.getSize()
    deck.setProps({ width: size.width, height: size.height, views: renderer!.createMaptalksDeckView(map, origin) })
    syncSelection()
    deck.redraw('map camera')
  }

  function clearHover() {
    if (hoveredId) {
      hoveredId = null
      syncSelection()
      options.onHover(null)
    }
    options.container.value?.classList.remove('is-picking')
  }

  function createMarkers(request: PixelGridRequest, result: PixelGridResult) {
    markers?.clear()
    if (!markers || !map || !options.getRegionsVisible()) return
    const represented = new Set(result.owners)
    const clusters = new Map<string, ProtectAreaSite[]>()
    PROTECT_AREA_SITES.forEach(site => {
      const visibleZones = site.zones.filter(zone => options.getVisibleTypes().includes(zone.properties.BHDLX))
      if (!visibleZones.length) return
      if (visibleZones.some(zone => represented.has(PROTECT_AREAS.features.indexOf(zone)))) return
      const [horizontal, vertical] = projectPixelPoint((site.extent.west + site.extent.east) / 2, (site.extent.south + site.extent.north) / 2)
      if (horizontal < request.bounds[0] || horizontal > request.bounds[2] || vertical < request.bounds[1] || vertical > request.bounds[3]) return
      const key = `${Math.floor(horizontal / (result.size * 3))}/${Math.floor(vertical / (result.size * 3))}`
      const cluster = clusters.get(key) ?? []
      cluster.push(site)
      clusters.set(key, cluster)
    })
    clusters.forEach(sites => {
      const extent = {
        west: Math.min(...sites.map(site => site.extent.west)), south: Math.min(...sites.map(site => site.extent.south)),
        east: Math.max(...sites.map(site => site.extent.east)), north: Math.max(...sites.map(site => site.extent.north)),
      }
      const longitude = (extent.west + extent.east) / 2
      const latitude = (extent.south + extent.north) / 2
      const projected = projectPixelPoint(longitude, latitude)
      const revealStart = result.reveal ? getPixelRevealStart(...projected, result.reveal) : 0
      const opacity = getPixelRevealAmount(revealTime.value, revealStart)
      const marker = new maptalks.Marker([longitude, latitude], {
        symbol: {
          markerType: 'square', markerWidth: 12, markerHeight: 12,
          markerFill: PIXEL_MAP_CONFIG.markerColor, markerLineColor: PIXEL_MAP_CONFIG.markerLineColor, markerLineWidth: 2,
          textName: sites.length > 1 ? String(sites.length) : '', textSize: 11, textFill: PIXEL_MAP_CONFIG.markerTextColor,
          textHaloFill: PIXEL_MAP_CONFIG.markerTextHaloColor, textHaloRadius: 2, textDy: -16,
          markerOpacity: opacity, textOpacity: opacity,
        },
        properties: { sites, extent, revealStart },
      })
      marker.setInfoWindow({ content: sites.length > 1 ? `${sites.length} 处保护区，点击放大查看` : sites[0]!.name, autoOpenOn: 'mouseover', autoCloseOn: 'mouseout' })
      markers?.addGeometry(marker)
    })
  }

  function applyGrid(request: PixelGridRequest, result: PixelGridResult) {
    if (!deck || !map) return
    const resolution = map.getGLRes()
    const center = new maptalks.Coordinate(unprojectPixelPoint(
      (request.bounds[0] + request.bounds[2]) / 2, (request.bounds[1] + request.bounds[3]) / 2))
    const point = map.coordToPointAtRes(center, resolution)
    origin = [point.x, point.y]
    thickness = result.sizes.reduce((minimum, size) => Math.min(minimum, size), result.size) / resolution * PIXEL_MAP_CONFIG.thicknessRatio
    raisedHeight = map.altitudeToPoint(EXTRUSION_CONFIG.height, resolution, center)
    clearHover()
    cells = [[], []]
    cellCounts.clear()
    result.owners.forEach((owner, index) => {
      const feature = owner >= 0 ? PROTECT_AREAS.features[owner] : undefined
      const color = feature ? AREA_TYPE_COLORS[feature.properties.BHDLX] : PIXEL_MAP_CONFIG.landColor
      const coordinate = new maptalks.Coordinate(unprojectPixelPoint(result.cells[index * 2]!, result.cells[index * 2 + 1]!))
      const position = map!.coordToPointAtRes(coordinate, resolution)
      cells[feature ? 1 : 0]!.push({
        position: [position.x - origin[0], position.y - origin[1], 0],
        size: result.sizes[index]! / resolution, start: result.starts[index]!, feature,
        color: [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16)) as [number, number, number],
      })
      if (feature) cellCounts.set(feature.id, (cellCounts.get(feature.id) ?? 0) + 1)
    })
    deck.setProps({ views: renderer!.createMaptalksDeckView(map, origin) })
    syncSelection(true)
    createMarkers(request, result)
  }

  function settlePending(ready: boolean, error?: Error) {
    if (!pending) return
    clearTimeout(pending.timer)
    const job = pending
    pending = null
    if (error) { requestedKey = ''; job.reject(error) }
    else job.resolve(ready)
  }

  function initialize(mapInstance: maptalks.Map) {
    if (initialization) return initialization
    initialization = import('../utils/pixelDeck').then(runtime => {
      if (disposed) return
      renderer = runtime
      map = mapInstance
      worker = new Worker(new URL('../workers/pixelGrid.worker.ts', import.meta.url), { type: 'module' })
      const ready = new Promise<void>(resolve => { finishInitialization = resolve })
      worker.onerror = () => {
        const error = new Error('像素地图计算线程加载失败，请刷新后重试')
        settlePending(false, error)
        if (engaged) options.onError(error.message)
      }
      worker.onmessage = ({ data: result }: MessageEvent<PixelGridResult>) => {
        if (!pending || result.id !== pending.request.id || !engaged || disposed) return
        if (result.error) { settlePending(false, new Error(result.error)); return }
        try {
          applyGrid(pending.request, result)
          appliedKey = pending.key
          settlePending(true)
        } catch (error) {
          settlePending(false, error instanceof Error ? error : new Error('像素图层渲染失败'))
        }
      }
      canvas = document.createElement('canvas')
      canvas.className = 'pixel-deck-canvas'
      canvas.style.cssText = 'position:absolute;inset:0;pointer-events:none;display:none'
      // A separate stacking context keeps positioned deck canvas below map markers.
      map.getPanels().backStatic.append(canvas)
      deck = new runtime.Deck({
        canvas, controller: false, views: runtime.createMaptalksDeckView(map, origin), viewState: {},
        width: map.width, height: map.height,
        onLoad: () => { finishInitialization?.(); finishInitialization = null },
        onError: error => { settlePending(false, error); if (engaged) options.onError(error.message) },
      })
      markers = new maptalks.VectorLayer('pixel-sites', [], { geometryEvents: false }).addTo(map)
      markers.hide()
      map.on(VIEW_EVENTS, handleGridViewChange)
      map.on(VIEW_EVENTS, syncView)
      map.on('mousemove', handleHover)
      options.container.value?.addEventListener('pointerleave', clearHover)
      return ready
    })
    return initialization
  }

  function getViewportGrid(mapInstance: maptalks.Map, budget = PIXEL_MAP_CONFIG.maxCells) {
    const extent = mapInstance.getExtent()
    if (extent.xmin === null || extent.ymin === null || extent.xmax === null || extent.ymax === null) return null
    const longitudePadding = extent.getWidth() * PIXEL_MAP_CONFIG.overscan
    const latitudePadding = extent.getHeight() * PIXEL_MAP_CONFIG.overscan
    const southwest = projectPixelPoint(Math.max(70, extent.xmin - longitudePadding), Math.max(0, extent.ymin - latitudePadding))
    const northeast = projectPixelPoint(Math.min(140, extent.xmax + longitudePadding), Math.min(56, extent.ymax + latitudePadding))
    const bounds: PixelBounds = [...southwest, ...northeast]
    const level = resolvePixelLevel(bounds, Math.round(mapInstance.getZoom()) + PIXEL_MAP_CONFIG.gridZoomOffset, budget)
    return { bounds, level, detail: mapInstance.getZoom() >= PIXEL_MAP_CONFIG.detailZoom }
  }

  function refreshNow(): Promise<boolean> {
    clearTimeout(refreshTimer)
    refreshTimer = undefined
    if (!engaged || !map || !worker || disposed) return Promise.resolve(false)
    const grid = frozenGrid ?? getViewportGrid(map)
    if (!grid) return Promise.resolve(false)
    const visibleTypes = options.getRegionsVisible() ? [...options.getVisibleTypes()] : []
    syncSelection()
    if (!options.getRegionsVisible()) markers?.clear()
    const request: PixelGridRequest = { id: revision + 1, ...grid, visibleTypes }
    const key = JSON.stringify({ ...request, id: 0 })
    if (key === requestedKey) return latestWork
    requestedKey = key
    revision = request.id
    settlePending(false)
    latestWork = new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => settlePending(false, new Error('像素地图生成超时，请重新切换模式')), PIXEL_MAP_CONFIG.workerTimeout)
      pending = { request, key, resolve, reject, timer }
      try { worker!.postMessage(request) }
      catch (error) { settlePending(false, error instanceof Error ? error : new Error('像素地图任务发送失败')) }
    })
    return latestWork
  }

  function scheduleRefresh() {
    if (!engaged || frozenGrid || refreshTimer) return
    refreshTimer = setTimeout(() => { void refreshNow().catch(error => options.onError(error.message)) }, PIXEL_MAP_CONFIG.refreshInterval)
  }

  function handleGridViewChange() {
    if (!active) return
    if (frozenGrid) finishReveal(true)
    else scheduleRefresh()
  }

  async function prepare(mapInstance: maptalks.Map, animate = false) {
    engaged = true
    if (animate && !reducedMotion) {
      const focus = getViewportGrid(mapInstance, Math.floor(PIXEL_MAP_CONFIG.maxCells * PIXEL_REVEAL_CONFIG.focusBudgetRatio))
      if (focus) {
        const center = mapInstance.getCenter()
        const origin = projectPixelPoint(center.x, center.y)
        const extent = PIXEL_REVEAL_CONFIG.nationalExtent
        const bounds: PixelBounds = [...projectPixelPoint(extent.west, extent.south), ...projectPixelPoint(extent.east, extent.north)]
        const nearRadius = Math.max(...[focus.bounds[0], focus.bounds[2]].flatMap(horizontal =>
          [focus.bounds[1], focus.bounds[3]].map(vertical => Math.hypot(horizontal - origin[0], vertical - origin[1]))))
        frozenGrid = {
          bounds, level: PIXEL_REVEAL_CONFIG.overviewLevel, detail: false,
          reveal: { origin, focusBounds: focus.bounds, focusLevel: focus.level, nearRadius },
        }
        revealArmed = true
        revealTime.value = 0
      }
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        initialize(mapInstance),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('像素图层初始化超时，请重新切换模式')), PIXEL_MAP_CONFIG.workerTimeout)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
    if (!engaged || disposed) return false
    await refreshNow()
    while (engaged && !disposed && appliedKey !== requestedKey) await latestWork
    return engaged && !disposed
  }

  function setActive(value: boolean) {
    active = value
    engaged = value
    if (canvas) canvas.style.display = value ? 'block' : 'none'
    if (value) { markers?.show(); syncView(); syncSelection(true); scheduleRefresh() }
    else {
      revealTween?.kill()
      revealTween = null
      revealArmed = false
      frozenGrid = null
      revealTime.value = PIXEL_REVEAL_CONFIG.duration
      revision += 1
      requestedKey = ''
      appliedKey = ''
      clearTimeout(refreshTimer)
      refreshTimer = undefined
      clearHover()
      syncSelection(true)
      markers?.hide()
      settlePending(false)
    }
  }

  function publishRevealTime() {
    markers?.getGeometries().forEach(marker => {
      const opacity = getPixelRevealAmount(revealTime.value, marker.getProperties()?.revealStart ?? 0)
      marker.updateSymbol({ markerOpacity: opacity, textOpacity: opacity })
    })
    syncSelection()
  }

  function finishReveal(immediate = false) {
    if (!revealArmed && !revealTween && !frozenGrid) return
    if (immediate && frozenGrid?.reveal && map) {
      // Drop the overview cells before the camera reveals them. Keep nearby detail
      // on screen until the worker returns the grid for the new viewport.
      const detailSize = MERCATOR_WORLD_SIZE / 2 ** frozenGrid.reveal.focusLevel / map.getGLRes()
      cells = cells.map(data => data.filter(cell => cell.size <= detailSize * 1.001))
      cellCounts.clear()
      cells[1]!.forEach(cell => {
        if (cell.feature) cellCounts.set(cell.feature.id, (cellCounts.get(cell.feature.id) ?? 0) + 1)
      })
    }
    revealTween?.kill()
    revealTween = null
    revealArmed = false
    frozenGrid = null
    revealTime.value = PIXEL_REVEAL_CONFIG.duration
    publishRevealTime()
    if (immediate) void refreshNow().catch(error => options.onError(error.message))
    else scheduleRefresh()
  }

  function startReveal() {
    if (!active || !revealArmed || disposed) return
    revealTween?.kill()
    if (reducedMotion) { finishReveal(); return }
    revealTween = gsap.to(revealTime, {
      value: PIXEL_REVEAL_CONFIG.duration, duration: PIXEL_REVEAL_CONFIG.duration, ease: 'none',
      onUpdate: publishRevealTime, onComplete: finishReveal,
    })
  }

  function identify(event: { coordinate: maptalks.Coordinate; containerPoint?: maptalks.Point }) {
    if (!active || !map || !deck || !options.getRegionsVisible()) return null
    const point = event.containerPoint ?? map.coordToContainerPoint(event.coordinate)
    const cell = deck.pickObject({ x: point.x, y: point.y, layerIds: ['pixel-1'] })?.object as PixelCell | undefined
    if (!cell || getPixelRevealAmount(revealTime.value, cell.start) <= 0.001) return null
    return cell.feature && options.getVisibleTypes().includes(cell.feature.properties.BHDLX) ? cell.feature : null
  }

  function handleClick(event: { coordinate: maptalks.Coordinate; containerPoint?: maptalks.Point }) {
    if (!active) return
    const marker = markers?.identify(event.coordinate).find(geometry => getPixelRevealAmount(revealTime.value, geometry.getProperties()?.revealStart ?? 0) > 0.001)
    if (marker) {
      const properties = marker.getProperties()
      finishReveal()
      if (properties) options.onLocate(properties.sites, properties.extent)
      return
    }
    const feature = identify(event)
    if (feature) finishReveal()
    // A single cell acts as a locator until zooming reveals the area's shape.
    if (feature && cellCounts.get(feature.id) === 1) {
      const site = SITE_BY_ID.get(feature.properties.BHDBM)
      if (site) {
        clearHover()
        options.onLocate([site], site.extent)
        return
      }
    }
    options.onSelect(feature?.id === options.getSelection()?.id ? null : feature)
  }

  function handleHover(event?: HandlerFnResultType) {
    if (!active || flying || frozenGrid || !supportsHover || !event?.coordinate) return
    const feature = identify({ coordinate: event.coordinate as maptalks.Coordinate, containerPoint: event.containerPoint as maptalks.Point | undefined })
    const id = feature?.id ?? null
    if (hoveredId === id) return
    hoveredId = id
    options.container.value?.classList.toggle('is-picking', !!feature)
    options.onHover(feature)
    syncSelection()
  }

  function setFlightActive(value: boolean) {
    flying = value
    if (value) { clearHover(); finishReveal() }
  }

  function dispose() {
    disposed = true
    setActive(false)
    finishInitialization?.()
    worker?.terminate()
    worker = null
    map?.off(VIEW_EVENTS, handleGridViewChange)
    map?.off(VIEW_EVENTS, syncView)
    map?.off('mousemove', handleHover)
    options.container.value?.removeEventListener('pointerleave', clearHover)
    cells = [[], []]
    cellCounts.clear()
    markers?.remove()
    deck?.finalize()
    canvas?.remove()
    map = null
    deck = null
    canvas = null
  }

  return { prepare, setActive, refreshNow, syncSelection, handleClick, setFlightActive, startReveal, finishReveal, dispose,
    isReady: () => engaged && !!appliedKey && appliedKey === requestedKey }
}

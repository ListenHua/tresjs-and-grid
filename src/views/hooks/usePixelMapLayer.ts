import type { Ref } from 'vue'
import * as maptalks from 'maptalks'
import type { HandlerFnResultType } from 'maptalks/dist/core/Eventable'
import { ThreeLayer } from 'maptalks.three'
import * as THREE from 'three'
import { gsap } from 'gsap'
import { AREA_TYPE_COLORS, EXTRUSION_CONFIG, PIXEL_MAP_CONFIG, PIXEL_REVEAL_CONFIG } from '../config'
import { PROTECT_AREAS, PROTECT_AREA_SITES } from '../data/protectAreas'
import type { ProtectAreaSite } from '../data/protectAreas'
import type { ProtectAreaFeature, ProtectAreaType } from '../types/map'
import type { GeographicExtent } from '../utils/RasterAtlasManager'
import { projectPixelPoint, resolvePixelLevel, unprojectPixelPoint } from '../utils/pixelGrid'
import type { PixelBounds, PixelGridRequest, PixelGridResult } from '../utils/pixelGrid'
import { createPixelRevealMaterial } from '../utils/pixelRevealMaterial'
import { getPixelRevealAmount, getPixelRevealStart } from '../utils/pixelRevealTiming'

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

export function usePixelMapLayer(options: PixelMapOptions) {
  let map: maptalks.Map | null = null
  let layer: ThreeLayer | null = null
  let markers: maptalks.VectorLayer | null = null
  let worker: Worker | null = null
  let initialization: Promise<void> | null = null
  let finishInitialization: (() => void) | null = null
  let group: THREE.Group | null = null
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
  const pending = new Map<number, { resolve: (ready: boolean) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  const batches = new Map<string, THREE.InstancedMesh>()
  const animations = new Map<string, gsap.core.Tween>()
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const supportsHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  function releaseGroup() {
    animations.forEach(animation => animation.kill())
    animations.clear()
    if (group) {
      layer?.removeMesh(group, false)
      group.traverse(object => {
        if (object instanceof THREE.InstancedMesh) {
          object.geometry.dispose()
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          materials.forEach(material => material.dispose())
          object.dispose()
        }
      })
    }
    group = null
    batches.clear()
  }

  function syncSelection(immediate = false) {
    const selectedId = options.getSelection()?.id
    batches.forEach((batch, id) => {
      const raised = id === selectedId || id === hoveredId
      const target = raised ? batch.userData.raisedScale as number : 1
      animations.get(id)?.kill()
      animations.delete(id)
      if (immediate || reducedMotion || !active) batch.scale.z = target
      else animations.set(id, gsap.to(batch.scale, {
        z: target,
        duration: raised ? EXTRUSION_CONFIG.raiseDuration : EXTRUSION_CONFIG.lowerDuration,
        ease: raised ? EXTRUSION_CONFIG.raiseEase : EXTRUSION_CONFIG.lowerEase,
        onUpdate: () => layer?.renderScene(),
        onComplete: () => { animations.delete(id) },
      }))
    })
    layer?.renderScene()
  }

  function clearHover() {
    if (hoveredId) {
      hoveredId = null
      syncSelection()
      options.onHover(null)
    }
    options.container.value?.classList.remove('is-picking')
  }

  function syncPitch() {
    if (group && map) group.scale.z = Math.max(0.001, Math.min(1, map.getPitch() / 10))
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
          markerFill: PIXEL_MAP_CONFIG.markerColor, markerLineColor: '#15201d', markerLineWidth: 2,
          textName: sites.length > 1 ? String(sites.length) : '', textSize: 11, textFill: '#f2f0e9',
          textHaloFill: '#15201d', textHaloRadius: 2, textDy: -16,
          markerOpacity: opacity, textOpacity: opacity,
        },
        properties: { sites, extent, revealStart },
      })
      marker.setInfoWindow({ content: sites.length > 1 ? `${sites.length} 处保护区，点击放大查看` : sites[0]!.name, autoOpenOn: 'mouseover', autoCloseOn: 'mouseout' })
      markers?.addGeometry(marker)
    })
  }

  function applyGrid(request: PixelGridRequest, result: PixelGridResult) {
    if (!layer || !map) return
    const nextGroup = new THREE.Group()
    const originCoordinate = unprojectPixelPoint((request.bounds[0] + request.bounds[2]) / 2, (request.bounds[1] + request.bounds[3]) / 2)
    const origin = layer.coordinateToVector3(originCoordinate)
    nextGroup.position.copy(origin)
    const width = Math.abs(layer.coordinateToVector3(unprojectPixelPoint(request.bounds[0] + result.size, request.bounds[1])).x
      - layer.coordinateToVector3(unprojectPixelPoint(request.bounds[0], request.bounds[1])).x)
    const minimumSize = result.sizes.reduce((minimum, size) => Math.min(minimum, size), result.size)
    const thickness = width * minimumSize / result.size * PIXEL_MAP_CONFIG.thicknessRatio
    const cellsByOwner = new Map<number, number[]>()
    result.owners.forEach((owner, index) => {
      const indices = cellsByOwner.get(owner) ?? []
      indices.push(index)
      cellsByOwner.set(owner, indices)
    })
    const nextBatches = new Map<string, THREE.InstancedMesh>()
    const transform = new THREE.Object3D()
    cellsByOwner.forEach((indices, owner) => {
      const feature = owner >= 0 ? PROTECT_AREAS.features[owner] : undefined
      const color = feature ? AREA_TYPE_COLORS[feature.properties.BHDLX] : PIXEL_MAP_CONFIG.landColor
      const material = result.reveal ? createPixelRevealMaterial(color, revealTime) : new THREE.MeshLambertMaterial({ color })
      const batch = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, indices.length)
      const starts = new Float32Array(indices.length)
      indices.forEach((cellIndex, instanceIndex) => {
        const cellWidth = width * result.sizes[cellIndex]! / result.size
        const coordinate = unprojectPixelPoint(result.cells[cellIndex * 2]!, result.cells[cellIndex * 2 + 1]!)
        transform.position.copy(layer!.coordinateToVector3(coordinate)).sub(origin)
        transform.position.z = thickness / 2
        transform.scale.set(cellWidth * (1 - PIXEL_MAP_CONFIG.gapRatio), cellWidth * (1 - PIXEL_MAP_CONFIG.gapRatio), thickness)
        transform.updateMatrix()
        batch.setMatrixAt(instanceIndex, transform.matrix)
        starts[instanceIndex] = result.starts[cellIndex]!
      })
      batch.geometry.setAttribute('pixelRevealStart', new THREE.InstancedBufferAttribute(starts, 1))
      batch.instanceMatrix.needsUpdate = true
      batch.computeBoundingSphere()
      if (feature) {
        batch.userData.feature = feature
        batch.userData.raisedScale = 1 + Math.abs(layer!.altitudeToVector3(EXTRUSION_CONFIG.height, EXTRUSION_CONFIG.height, originCoordinate).x) / thickness
        nextBatches.set(feature.id, batch)
      }
      nextGroup.add(batch)
    })
    clearHover()
    releaseGroup()
    group = nextGroup
    group.visible = active
    nextBatches.forEach((batch, id) => batches.set(id, batch))
    syncPitch()
    layer.addMesh(group, false)
    syncSelection(true)
    createMarkers(request, result)
    layer.renderScene()
  }

  function failPending(error: Error) {
    requestedKey = ''
    pending.forEach(job => { clearTimeout(job.timer); job.reject(error) })
    pending.clear()
  }

  function initialize(mapInstance: maptalks.Map) {
    if (initialization) return initialization
    map = mapInstance
    worker = new Worker(new URL('../workers/pixelGrid.worker.ts', import.meta.url), { type: 'module' })
    initialization = new Promise<void>(resolve => { finishInitialization = resolve })
    worker.onerror = () => {
      const error = new Error('像素地图计算线程加载失败，请刷新后重试')
      failPending(error)
      if (engaged) options.onError(error.message)
    }
    layer = new ThreeLayer('pixel-map', { forceRenderOnMoving: true, forceRenderOnRotating: true, forceRenderOnZooming: true, geometryEvents: false })
    layer.prepareToDraw = (_gl, scene) => {
      scene.add(new THREE.HemisphereLight('#ffffff', '#315342', 2))
      const light = new THREE.DirectionalLight('#ffffff', 1.4)
      light.position.set(-3, -5, 8)
      scene.add(light)
      finishInitialization?.()
      finishInitialization = null
      return []
    }
    layer.addTo(map)
    markers = new maptalks.VectorLayer('pixel-sites', [], { geometryEvents: false }).addTo(map)
    markers.hide()
    map.on('moving zooming moveend zoomend resize rotateend pitchend', scheduleRefresh)
    map.on('pitching pitchend', syncPitch)
    map.on('mousemove', handleHover)
    options.container.value?.addEventListener('pointerleave', clearHover)
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
    batches.forEach(batch => { batch.visible = visibleTypes.includes((batch.userData.feature as ProtectAreaFeature).properties.BHDLX) })
    if (!options.getRegionsVisible()) markers?.clear()
    const request: PixelGridRequest = { id: revision + 1, ...grid, visibleTypes }
    const key = JSON.stringify({ ...request, id: 0 })
    if (key === requestedKey) return latestWork
    requestedKey = key
    revision = request.id
    latestWork = new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(request.id)
        if (request.id !== revision || !engaged || disposed) { resolve(false); return }
        if (requestedKey === key) requestedKey = ''
        reject(new Error('像素地图生成超时，请重新切换模式'))
      }, PIXEL_MAP_CONFIG.workerTimeout)
      pending.set(request.id, { resolve, reject, timer })
      worker!.onmessage = (event: MessageEvent<PixelGridResult>) => {
        const result = event.data
        const job = pending.get(result.id)
        if (!job) return
        clearTimeout(job.timer)
        pending.delete(result.id)
        if (result.id !== revision || !engaged || disposed) { job.resolve(false); return }
        if (result.error) { requestedKey = ''; job.reject(new Error(result.error)); return }
        try {
          applyGrid(request, result)
          appliedKey = key
          job.resolve(true)
        } catch (error) {
          requestedKey = ''
          job.reject(error instanceof Error ? error : new Error('像素图层渲染失败'))
        }
      }
      try {
        worker!.postMessage(request)
      } catch (error) {
        clearTimeout(timer)
        pending.delete(request.id)
        if (requestedKey === key) requestedKey = ''
        reject(error instanceof Error ? error : new Error('像素地图任务发送失败'))
      }
    })
    return latestWork
  }

  function scheduleRefresh() {
    if (!engaged || frozenGrid || refreshTimer) return
    refreshTimer = setTimeout(() => { void refreshNow().catch(error => options.onError(error.message)) }, PIXEL_MAP_CONFIG.refreshInterval)
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
    if (value) { if (group) group.visible = true; layer?.show(); markers?.show(); syncSelection(true); scheduleRefresh() }
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
      layer?.hide()
      markers?.hide()
      pending.forEach(job => { clearTimeout(job.timer); job.resolve(false) })
      pending.clear()
    }
  }

  function publishRevealTime() {
    markers?.getGeometries().forEach(marker => {
      const opacity = getPixelRevealAmount(revealTime.value, marker.getProperties()?.revealStart ?? 0)
      marker.updateSymbol({ markerOpacity: opacity, textOpacity: opacity })
    })
    layer?.renderScene()
  }

  function finishReveal() {
    if (!revealArmed && !revealTween && !frozenGrid) return
    revealTween?.kill()
    revealTween = null
    revealArmed = false
    frozenGrid = null
    revealTime.value = PIXEL_REVEAL_CONFIG.duration
    group?.children.forEach(object => {
      if (!(object instanceof THREE.InstancedMesh)) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach(material => { if (material.transparent) { material.transparent = false; material.needsUpdate = true } })
    })
    publishRevealTime()
    scheduleRefresh()
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
    if (!active || !map || !layer || !group || !options.getRegionsVisible()) return null
    const point = event.containerPoint ?? map.coordToContainerPoint(event.coordinate)
    const size = map.getSize()
    pointer.set(point.x / size.width * 2 - 1, 1 - point.y / size.height * 2)
    group.updateMatrixWorld(true)
    raycaster.setFromCamera(pointer, layer.getCamera())
    const hit = raycaster.intersectObjects([...batches.values()], false)[0]
    if (hit && typeof hit.instanceId === 'number' && hit.object instanceof THREE.InstancedMesh) {
      const start = hit.object.geometry.getAttribute('pixelRevealStart')?.getX(hit.instanceId) ?? 0
      if (getPixelRevealAmount(revealTime.value, start) <= 0.001) return null
    }
    const feature = hit?.object.userData.feature as ProtectAreaFeature | undefined
    return feature && options.getVisibleTypes().includes(feature.properties.BHDLX) ? feature : null
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
    map?.off('moving zooming moveend zoomend resize rotateend pitchend', scheduleRefresh)
    map?.off('pitching pitchend', syncPitch)
    map?.off('mousemove', handleHover)
    options.container.value?.removeEventListener('pointerleave', clearHover)
    releaseGroup()
    markers?.remove()
    layer?.remove()
    map = null
    layer = null
  }

  return { prepare, setActive, refreshNow, syncSelection, handleClick, setFlightActive, startReveal, finishReveal, dispose,
    isReady: () => engaged && !!appliedKey && appliedKey === requestedKey }
}

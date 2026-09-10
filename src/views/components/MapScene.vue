<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as maptalks from 'maptalks'
import 'maptalks/dist/maptalks.css'
import { useProtectAreaLayer } from '../hooks/useProtectAreaLayer'
import { usePixelMapLayer } from '../hooks/usePixelMapLayer'
import { stopMapAnimation, useMapFlight } from '../hooks/useMapFlight'
import { resolveRasterSource } from '../utils/RasterSource'
import { getFocusPadding, getFocusView, isValidFocusExtent } from '../utils/mapNavigation'
import type { GeographicExtent } from '../utils/RasterAtlasManager'
import { waitForMapArrival } from '../utils/waitForMapArrival'
import MapFlightFog from './MapFlightFog.vue'
import PixelMapFog from './PixelMapFog.vue'
import { FEATURE_BY_ID, SITE_BY_ID, getFeatureExtent } from '../data/protectAreas'
import { MAP_VIEW_CONFIG, PIXEL_MAP_CONFIG, PIXEL_FOG_CONFIG } from '../config'
import type { AreaRequest, BaseMapConfig, MapRenderMode, MapViewState, ProtectAreaFeature, ProtectAreaType, SceneCommand } from '../types/map'

const props = defineProps<{
  command: { id: number; type: SceneCommand }
  regionsVisible: boolean
  baseMap: BaseMapConfig | null
  visibleTypes: ProtectAreaType[]
  areaRequest: AreaRequest | null
  initialSiteId?: string | null
  renderMode: MapRenderMode
}>()
const emit = defineEmits<{
  ready: [count: number]
  error: [message: string]
  hover: [feature: ProtectAreaFeature | null]
  select: [feature: ProtectAreaFeature | null]
  view: [state: MapViewState]
  'raster-error': [message: string | null]
  'update:renderMode': [mode: MapRenderMode]
  'mode-loading': [loading: boolean]
  'locate-site': [id: string]
}>()

const mapContainer = ref<HTMLElement | null>(null)
const flightFog = ref<InstanceType<typeof MapFlightFog> | null>(null)
const canvasVisible = ref(false)
const pixelFog = ref<InstanceType<typeof PixelMapFog> | null>(null)
const modeSwitching = ref(false)
let flightCoverage = 0
let activeMode: MapRenderMode = 'standard'
let modeError: string | null = null
let modeRevision = 0
let disposed = false
let map: maptalks.Map | null = null
let sceneReady = false
let pendingAreaRequest = props.areaRequest
let focusRevision = 0
let nativeAnimation: ReturnType<maptalks.Map['animateTo']> | null = null
let inputContainer: HTMLElement | null = null
const inputEvents = ['pointerdown', 'wheel', 'touchstart', 'keydown'] as const
const protectAreaLayer = useProtectAreaLayer({
  container: mapContainer,
  getVisibleTypes: () => props.visibleTypes,
  onHover: feature => emit('hover', feature),
  onSelect: feature => { emit('select', feature); pixelLayer.syncSelection() },
  onRasterError: message => emit('raster-error', message),
  onMeshesReady: () => { void processAreaRequest() },
  onReady: count => {
    sceneReady = true
    protectAreaLayer.setVisible(props.regionsVisible)
    emit('ready', count)
    reportView()
    void processAreaRequest()
    if (props.renderMode !== activeMode) void switchRenderMode(props.renderMode)
  },
})
const pixelLayer = usePixelMapLayer({
  container: mapContainer,
  getVisibleTypes: () => props.visibleTypes,
  getRegionsVisible: () => props.regionsVisible,
  getSelection: protectAreaLayer.getSelection,
  onSelect: feature => { if (feature) protectAreaLayer.selectFeature(feature.id); else protectAreaLayer.clearSelection() },
  onHover: feature => emit('hover', feature),
  onLocate: (sites, extent) => {
    if (sites.length === 1) { emit('locate-site', sites[0]!.id); return }
    cancelAreaRequest()
    const target = getAreaFocusView(extent)
    if (target) mapFlight.flyTo(target, 'pixel-cluster')
  },
  onError: message => {
    modeError = message
    emit('raster-error', message)
    emit('update:renderMode', 'standard')
  },
})
const mapFlight = useMapFlight({
  getMap: () => map,
  onFlightChange: active => { protectAreaLayer.setFlightActive(active); pixelLayer.setFlightActive(active) },
  onFogChange: coverage => { flightCoverage = coverage; publishFog() },
  canUseFog: () => !modeSwitching.value && (activeMode === 'pixel'
    ? pixelFog.value?.isReady() ?? false : flightFog.value?.isReady() ?? false),
  getFogConfig: () => activeMode === 'pixel' ? {
    ...PIXEL_FOG_CONFIG, approachZoomOffset: 0, approachDuration: 0,
    maxWaitMs: PIXEL_MAP_CONFIG.workerTimeout,
  } : {},
  prepareArrival: async (siteId, signal) => {
    if (!map || signal.aborted) return
    if (activeMode === 'pixel') {
      void pixelLayer.refreshNow().catch(error => emit('raster-error', error.message))
      await waitForMapArrival(map, pixelLayer.isReady, signal)
      return
    }
    protectAreaLayer.refreshRasterNow()
    await waitForMapArrival(map, () => protectAreaLayer.isSiteRasterReady(siteId), signal)
  },
  onSettled: () => {
    protectAreaLayer.refreshRaster()
    if (activeMode === 'pixel') void pixelLayer.refreshNow().catch(error => emit('raster-error', error.message))
    reportView()
  },
})

function publishFog() {
  pixelFog.value?.setCoverage(activeMode === 'pixel' ? flightCoverage : 0)
  flightFog.value?.setCoverage(activeMode === 'standard' ? flightCoverage : 0)
}

async function switchRenderMode(mode: MapRenderMode) {
  if (!map || !sceneReady || disposed) return
  const revision = ++modeRevision
  modeSwitching.value = true
  cancelAreaRequest(true)
  emit('mode-loading', true)
  const stale = () => revision !== modeRevision || disposed
  try {
    if (mode === 'pixel') {
      // Entry uses the map's own cell reveal, without a fog transition.
      modeError = null
      if (activeMode === 'pixel') {
        pixelLayer.setActive(true)
        return
      }
      pixelLayer.setActive(false)
      const ready = await pixelLayer.prepare(map, true)
      if (!ready || stale()) return
      protectAreaLayer.setRasterSource(null)
      protectAreaLayer.setActive(false)
      map.removeBaseLayer()
      pixelLayer.setActive(true)
      activeMode = 'pixel'
      pixelLayer.startReveal()
    } else {
      pixelLayer.setActive(false)
      const baseLayer = createBaseLayer(props.baseMap)
      if (baseLayer) map.setBaseLayer(baseLayer)
      else map.removeBaseLayer()
      syncRasterSource(baseLayer)
      protectAreaLayer.setActive(true)
      activeMode = 'standard'
    }
    activeMode = mode
    publishFog()
    emit('raster-error', modeError)
  } catch (error) {
    if (stale()) return
    pixelLayer.setActive(false)
    activeMode = 'standard'
    protectAreaLayer.setActive(true)
    const baseLayer = createBaseLayer(props.baseMap)
    if (baseLayer && map) map.setBaseLayer(baseLayer)
    syncRasterSource(baseLayer)
    modeError = error instanceof Error ? error.message : '像素地图加载失败'
    emit('raster-error', modeError)
    // The parent mode watcher owns recovery and cancels this transition.
    if (props.renderMode !== 'standard') emit('update:renderMode', 'standard')
  } finally {
    if (!stale()) {
      modeSwitching.value = false
      emit('mode-loading', false)
      void processAreaRequest()
    }
  }
}

function reportView() {
  if (map && sceneReady && !mapFlight.isFlying()) emit('view', { zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() })
}

function stopNativeAnimation() {
  if (nativeAnimation && map) stopMapAnimation(map)
  nativeAnimation = null
}

function cancelAreaRequest(immediate = false) {
  pendingAreaRequest = null
  focusRevision += 1
  mapFlight.cancel(immediate)
  stopNativeAnimation()
}

function handleResize() { cancelAreaRequest() }

function handleUserInput(event: Event) {
  if (event instanceof KeyboardEvent && !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '+', '-', '=', 'Escape'].includes(event.key)) return
  cancelAreaRequest()
}

function getAreaFocusView(extent: GeographicExtent) {
  const container = mapContainer.value
  if (!map || !container || !isValidFocusExtent(extent)) return null
  const viewport = container.getBoundingClientRect()
  if (viewport.width <= 0 || viewport.height <= 0) return null
  const overlays = Array.from(container.parentElement?.querySelectorAll<HTMLElement>('[data-map-overlay]') ?? [])
    .map(element => {
      const bounds = element.getBoundingClientRect()
      return { kind: element.dataset.mapOverlay ?? '', left: bounds.left - viewport.left, right: bounds.right - viewport.left,
        top: bounds.top - viewport.top, bottom: bounds.bottom - viewport.top }
    })
  const padding = getFocusPadding(viewport.width, viewport.height, overlays, map.getPitch())
  const target = getFocusView(map, new maptalks.Extent(extent.west, extent.south, extent.east, extent.north), padding)
  return [target.center.x, target.center.y, target.zoom].every(Number.isFinite) ? target : null
}

function applyInitialView() {
  if (!map) return
  let extent: GeographicExtent | undefined
  const request = pendingAreaRequest || (focusRevision === 0 && props.command.id === 0) ? props.areaRequest : null
  if (request?.type === 'zone') {
    const feature = FEATURE_BY_ID.get(request.targetId)
    if (feature) extent = getFeatureExtent(feature)
  } else if (request?.type === 'site') {
    extent = SITE_BY_ID.get(request.targetId)?.extent
  } else if (focusRevision === 0 && props.command.id === 0 && props.initialSiteId) {
    extent = SITE_BY_ID.get(props.initialSiteId)?.extent
  }
  if (!extent) return
  try {
    const target = getAreaFocusView(extent)
    if (target) map.setCenterAndZoom(target.center, target.zoom)
  } catch {
    map.setCenterAndZoom(new maptalks.Coordinate(MAP_VIEW_CONFIG.center), MAP_VIEW_CONFIG.zoom)
  }
}

async function processAreaRequest() {
  if (modeSwitching.value || !map || !sceneReady || !pendingAreaRequest || !protectAreaLayer.isSelectionReady()) return
  const request = pendingAreaRequest
  const revision = focusRevision
  let extent
  let siteId: string
  if (request.type === 'zone') {
    const feature = FEATURE_BY_ID.get(request.targetId)
    if (!feature || !props.regionsVisible || !props.visibleTypes.includes(feature.properties.BHDLX)) {
      pendingAreaRequest = null
      mapFlight.cancel()
      return
    }
    if (!protectAreaLayer.selectFeature(feature.id)) {
      pendingAreaRequest = null
      mapFlight.cancel()
      return
    }
    extent = getFeatureExtent(feature)
    siteId = feature.properties.BHDBM
  } else {
    const site = SITE_BY_ID.get(request.targetId)
    if (!site) { pendingAreaRequest = null; mapFlight.cancel(); return }
    if (protectAreaLayer.getSelection()?.properties.BHDBM !== site.id) protectAreaLayer.clearSelection()
    extent = site.extent
    siteId = site.id
  }
  pendingAreaRequest = null
  await nextTick()
  if (!map || !sceneReady || revision !== focusRevision || props.areaRequest?.id !== request.id) return
  try {
    const target = getAreaFocusView(extent)
    if (!target) { mapFlight.cancel(); return }
    mapFlight.flyTo(target, siteId)
  } catch (error) {
    mapFlight.cancel()
    emit('error', error instanceof Error ? error.message : '保护区定位失败')
  }
}

function createBaseLayer(baseMap: BaseMapConfig | null) {
  return baseMap?.options
    ? new maptalks.TileLayer(`base-${baseMap.id}`, { ...baseMap.options })
    : undefined
}

function syncRasterSource(baseLayer?: maptalks.TileLayer) {
  try {
    protectAreaLayer.setRasterSource(baseLayer ? resolveRasterSource(baseLayer) : null)
  } catch (error) {
    protectAreaLayer.setRasterSource(null)
    const message = error instanceof Error ? error.message : '底图纹理源初始化失败'
    emit('raster-error', `${message}，顶面已显示分区颜色`)
  }
}

function executeCommand(type: SceneCommand) {
  cancelAreaRequest()
  if (!map || modeSwitching.value) return
  stopMapAnimation(map)
  if (type === 'zoom-in') nativeAnimation = map.animateTo({ zoom: Math.min(MAP_VIEW_CONFIG.maxZoom, map.getZoom() + 1) })
  if (type === 'zoom-out') nativeAnimation = map.animateTo({ zoom: Math.max(MAP_VIEW_CONFIG.minZoom, map.getZoom() - 1) })
  if (type === 'reset') nativeAnimation = map.animateTo(MAP_VIEW_CONFIG, { duration: MAP_VIEW_CONFIG.resetDuration })
  if (type === 'set-2d' || type === 'set-3d') {
    nativeAnimation = map.animateTo(
      { pitch: type === 'set-2d' ? 0 : MAP_VIEW_CONFIG.pitch, bearing: MAP_VIEW_CONFIG.bearing },
      { duration: MAP_VIEW_CONFIG.dimensionDuration },
    )
  }
}

onMounted(async () => {
  await nextTick()
  if (disposed || !mapContainer.value) return
  try {
    const baseLayer = createBaseLayer(props.baseMap)
    map = new maptalks.Map(mapContainer.value, {
      center: MAP_VIEW_CONFIG.center,
      zoom: MAP_VIEW_CONFIG.zoom,
      pitch: MAP_VIEW_CONFIG.pitch,
      bearing: MAP_VIEW_CONFIG.bearing,
      baseLayer,
      minZoom: MAP_VIEW_CONFIG.minZoom,
      maxZoom: MAP_VIEW_CONFIG.maxZoom,
      spatialReference: { projection: MAP_VIEW_CONFIG.projection },
      zoomControl: false,
      attribution: false,
    })
    map.on('zoomend moveend pitchend rotateend', reportView)
    map.on('resize', handleResize)
    inputContainer = mapContainer.value
    inputEvents.forEach(event => inputContainer?.addEventListener(event, handleUserInput, { capture: true, passive: true }))
    map.on('click', (event: any) => {
      cancelAreaRequest()
      if (activeMode === 'pixel') { pixelLayer.handleClick(event); return }
      if (props.renderMode === 'pixel') return
      if (!protectAreaLayer.identify(event.coordinate).length) protectAreaLayer.clearSelection()
    })
    applyInitialView()
    canvasVisible.value = true
    syncRasterSource(baseLayer)
    protectAreaLayer.createLayer(map)
  } catch (error) {
    cancelAreaRequest()
    emit('error', error instanceof Error ? error.message : '地图初始化失败')
  } finally {
    if (!disposed) canvasVisible.value = true
  }
})

watch(() => props.command.id, () => executeCommand(props.command.type))
watch(() => props.renderMode, mode => { void switchRenderMode(mode) })
watch(() => props.regionsVisible, visible => {
  pixelLayer.finishReveal()
  if (!visible) cancelAreaRequest()
  protectAreaLayer.setVisible(visible)
  if (activeMode === 'pixel') void pixelLayer.refreshNow().catch(error => emit('raster-error', error.message))
})
watch(() => props.baseMap, baseMap => {
  if (!map || activeMode === 'pixel' || props.renderMode === 'pixel') return
  try {
    const baseLayer = createBaseLayer(baseMap)
    if (baseLayer) map.setBaseLayer(baseLayer)
    else map.removeBaseLayer()
    syncRasterSource(baseLayer)
  } catch (error) {
    emit('error', error instanceof Error ? error.message : '底图切换失败')
  }
})
watch(() => props.visibleTypes, types => {
  pixelLayer.finishReveal()
  const selection = protectAreaLayer.getSelection()
  if (selection && !types.includes(selection.properties.BHDLX)) cancelAreaRequest()
  protectAreaLayer.scheduleRebuild()
  if (activeMode === 'pixel') void pixelLayer.refreshNow().catch(error => emit('raster-error', error.message))
}, { deep: true })
watch(() => props.areaRequest, request => {
  pixelLayer.finishReveal()
  if (!request) { cancelAreaRequest(); return }
  focusRevision += 1
  mapFlight.suspend()
  stopNativeAnimation()
  pendingAreaRequest = request
  void processAreaRequest()
}, { flush: 'post' })

onBeforeUnmount(() => {
  disposed = true
  modeRevision += 1
  sceneReady = false
  pendingAreaRequest = null
  focusRevision += 1
  inputEvents.forEach(event => inputContainer?.removeEventListener(event, handleUserInput, true))
  inputContainer = null
  map?.off('resize', handleResize)
  mapFlight.dispose()
  stopNativeAnimation()
  protectAreaLayer.dispose()
  pixelLayer.dispose()
  map?.remove()
  map = null
})
</script>

<template>
  <div ref="mapContainer" class="map-canvas" :class="{ 'is-initializing': !canvasVisible }" :inert="modeSwitching" tabindex="0" aria-label="广西原生境保护区三维地图"></div>
  <MapFlightFog ref="flightFog" />
  <PixelMapFog ref="pixelFog" />
</template>

<style scoped>
.map-canvas { position: absolute; inset: 0; cursor: grab; background: #15201d; }
.map-canvas.is-initializing { visibility:hidden }
.map-canvas:active { cursor: grabbing; }.map-canvas.is-picking { cursor: pointer; }
.map-canvas:focus-visible { outline:2px solid var(--mint);outline-offset:-2px }
:deep(.maptalks-canvas-layer), :deep(.maptalks-front-layer) { outline: none; }
</style>

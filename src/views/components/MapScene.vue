<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as maptalks from 'maptalks'
import 'maptalks/dist/maptalks.css'
import { useProtectAreaLayer } from '../hooks/useProtectAreaLayer'
import { resolveRasterSource } from '../utils/RasterSource'
import { MAP_VIEW_CONFIG } from '../config'
import type { BaseMapConfig, MapViewState, ProtectAreaFeature, ProtectAreaType, SceneCommand } from '../types/map'

const props = defineProps<{
  command: { id: number; type: SceneCommand }
  regionsVisible: boolean
  baseMap: BaseMapConfig | null
  visibleTypes: ProtectAreaType[]
}>()
const emit = defineEmits<{
  ready: [count: number]
  error: [message: string]
  hover: [feature: ProtectAreaFeature | null]
  select: [feature: ProtectAreaFeature | null]
  view: [state: MapViewState]
  'raster-error': [message: string | null]
}>()

const mapContainer = ref<HTMLElement | null>(null)
let map: maptalks.Map | null = null
const protectAreaLayer = useProtectAreaLayer({
  container: mapContainer,
  getVisibleTypes: () => props.visibleTypes,
  onHover: feature => emit('hover', feature),
  onSelect: feature => emit('select', feature),
  onRasterError: message => emit('raster-error', message),
  onReady: count => {
    protectAreaLayer.setVisible(props.regionsVisible)
    emit('ready', count)
    reportView()
  },
})

function reportView() {
  if (map) emit('view', { zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() })
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
  if (!map) return
  if (type === 'zoom-in') map.setZoom(Math.min(MAP_VIEW_CONFIG.maxZoom, map.getZoom() + 1))
  if (type === 'zoom-out') map.setZoom(Math.max(MAP_VIEW_CONFIG.minZoom, map.getZoom() - 1))
  if (type === 'reset') map.animateTo(MAP_VIEW_CONFIG, { duration: MAP_VIEW_CONFIG.resetDuration })
  if (type === 'set-2d' || type === 'set-3d') {
    map.animateTo(
      { pitch: type === 'set-2d' ? 0 : MAP_VIEW_CONFIG.pitch, bearing: MAP_VIEW_CONFIG.bearing },
      { duration: MAP_VIEW_CONFIG.dimensionDuration },
    )
  }
}

onMounted(() => {
  if (!mapContainer.value) return
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
      attribution: { content: '底图', position: { left: 12, bottom: 0 } },
    })
    map.on('zoomend moveend pitchend rotateend', reportView)
    map.on('click', (event: any) => {
      if (!protectAreaLayer.identify(event.coordinate).length) protectAreaLayer.clearSelection()
    })
    syncRasterSource(baseLayer)
    protectAreaLayer.createLayer(map)
  } catch (error) {
    emit('error', error instanceof Error ? error.message : '地图初始化失败')
  }
})

watch(() => props.command.id, () => executeCommand(props.command.type))
watch(() => props.regionsVisible, protectAreaLayer.setVisible)
watch(() => props.baseMap, baseMap => {
  if (!map) return
  try {
    const baseLayer = createBaseLayer(baseMap)
    if (baseLayer) map.setBaseLayer(baseLayer)
    else map.removeBaseLayer()
    syncRasterSource(baseLayer)
  } catch (error) {
    emit('error', error instanceof Error ? error.message : '底图切换失败')
  }
})
watch(() => props.visibleTypes, protectAreaLayer.scheduleRebuild, { deep: true })

onBeforeUnmount(() => {
  protectAreaLayer.dispose()
  map?.remove()
  map = null
})
</script>

<template><div ref="mapContainer" class="map-canvas" aria-label="广西原生境保护区三维地图"></div></template>

<style scoped>
.map-canvas { position: absolute; inset: 0; cursor: grab; background: #15201d; }
.map-canvas:active { cursor: grabbing; }.map-canvas.is-picking { cursor: pointer; }
:deep(.maptalks-canvas-layer), :deep(.maptalks-front-layer) { outline: none; }
:deep(.maptalks-attribution) { max-width:calc(100vw - 24px);padding:1px 4px;color:#b9c5be;background:rgba(16,27,24,.8);font-size:9px;line-height:1.5 }
:deep(.maptalks-attribution a) { color:inherit }
</style>

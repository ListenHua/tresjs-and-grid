<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as maptalks from 'maptalks'
import 'maptalks/dist/maptalks.css'
import { useProtectAreaLayer } from '../hooks/useProtectAreaLayer'
import { BASE_MAP_CONFIG, MAP_VIEW_CONFIG } from '../map/config'
import type { MapViewState, ProtectAreaFeature, ProtectAreaType, SceneCommand } from '../types/map'

const props = defineProps<{
  command: { id: number; type: SceneCommand }
  regionsVisible: boolean
  visibleTypes: ProtectAreaType[]
}>()
const emit = defineEmits<{
  ready: [count: number]
  error: [message: string]
  hover: [feature: ProtectAreaFeature | null]
  select: [feature: ProtectAreaFeature | null]
  view: [state: MapViewState]
}>()

const mapContainer = ref<HTMLElement | null>(null)
let map: maptalks.Map | null = null
const protectAreaLayer = useProtectAreaLayer({
  container: mapContainer,
  getVisibleTypes: () => props.visibleTypes,
  onHover: feature => emit('hover', feature),
  onSelect: feature => emit('select', feature),
  onReady: count => {
    emit('ready', count)
    reportView()
  },
})

function reportView() {
  if (map) emit('view', { zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() })
}

function executeCommand(type: SceneCommand) {
  if (!map) return
  if (type === 'zoom-in') map.setZoom(map.getZoom() + 1)
  if (type === 'zoom-out') map.setZoom(map.getZoom() - 1)
  if (type === 'reset') map.animateTo(MAP_VIEW_CONFIG, { duration: MAP_VIEW_CONFIG.resetDuration })
  if (type === 'toggle-dimension') {
    const is3d = map.getPitch() > 10
    map.animateTo(
      { pitch: is3d ? 0 : MAP_VIEW_CONFIG.pitch, bearing: MAP_VIEW_CONFIG.bearing },
      { duration: MAP_VIEW_CONFIG.dimensionDuration },
    )
  }
}

onMounted(() => {
  if (!mapContainer.value) return
  try {
    const baseLayer = new maptalks.TileLayer(BASE_MAP_CONFIG.id, {
      urlTemplate: BASE_MAP_CONFIG.urlTemplate,
      attribution: BASE_MAP_CONFIG.attribution,
      crossOrigin: BASE_MAP_CONFIG.crossOrigin,
    })
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
    map.on('click', (event: any) => {
      if (!protectAreaLayer.identify(event.coordinate).length) protectAreaLayer.clearSelection()
    })
    protectAreaLayer.createLayer(map)
  } catch (error) {
    emit('error', error instanceof Error ? error.message : '地图初始化失败')
  }
})

watch(() => props.command.id, () => executeCommand(props.command.type))
watch(() => props.regionsVisible, protectAreaLayer.setVisible)
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
</style>

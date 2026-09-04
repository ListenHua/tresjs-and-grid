<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as maptalks from 'maptalks'
import { ThreeLayer } from 'maptalks.three'
import type BaseObject from 'maptalks.three/dist/BaseObject'
import * as THREE from 'three'
import 'maptalks/dist/maptalks.css'
import { INITIAL_VIEW, REGIONS } from '../data/regions'
import type { MapViewState, RegionDatum, SceneCommand } from '../types/map'

const props = defineProps<{ command: { id: number; type: SceneCommand }; regionsVisible: boolean; heightScale: number }>()
const emit = defineEmits<{ ready: []; error: [message: string]; hover: [region: RegionDatum | null]; select: [region: RegionDatum | null]; view: [state: MapViewState] }>()

const mapContainer = ref<HTMLElement | null>(null)
const meshes = new Map<string, BaseObject>()
const materials = new Map<string, THREE.MeshPhongMaterial>()
let map: maptalks.Map | null = null
let threeLayer: ThreeLayer | null = null
let selectedId: string | null = null
let hoveredId: string | null = null

const regionColor = (region: RegionDatum) => region.category === '生态区' ? '#5b9a84' : '#e35d3f'

function updateMaterial(id: string) {
  const material = materials.get(id)
  const region = REGIONS.find(item => item.id === id)
  if (!material || !region) return
  material.color.set(id === selectedId ? '#b9f27c' : id === hoveredId ? '#ffd273' : regionColor(region))
  material.emissive.set(id === selectedId ? '#25442f' : '#000000')
  material.needsUpdate = true
  threeLayer?.renderScene()
}

function updateSelection(region: RegionDatum | null) {
  const previous = selectedId
  selectedId = region?.id ?? null
  if (previous) updateMaterial(previous)
  if (selectedId) updateMaterial(selectedId)
  emit('select', region)
}

function reportView() {
  if (map) emit('view', { zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() })
}

function createRegionMesh(region: RegionDatum) {
  if (!threeLayer) return
  const material = new THREE.MeshPhongMaterial({ color: regionColor(region), shininess: 18, transparent: true, opacity: 0.92 })
  const polygon = new maptalks.Polygon(region.coordinates, { properties: region })
  const mesh = threeLayer.toExtrudePolygon(polygon, { height: region.height * props.heightScale, interactive: true, topColor: '#f2a17b' }, material)
  mesh.setId(region.id).setProperties(region)
  mesh.on('mouseover', () => {
    const previous = hoveredId
    hoveredId = region.id
    if (previous && previous !== selectedId) updateMaterial(previous)
    updateMaterial(region.id)
    mapContainer.value?.classList.add('is-picking')
    emit('hover', region)
  })
  mesh.on('mouseout', () => {
    hoveredId = null
    updateMaterial(region.id)
    mapContainer.value?.classList.remove('is-picking')
    emit('hover', null)
  })
  mesh.on('click', () => updateSelection(selectedId === region.id ? null : region))
  materials.set(region.id, material)
  meshes.set(region.id, mesh)
  threeLayer.addMesh(mesh)
}

function disposeRegions() {
  meshes.forEach(mesh => {
    threeLayer?.removeMesh(mesh)
    mesh.getObject3d().traverse(object => { if (object instanceof THREE.Mesh) object.geometry?.dispose() })
  })
  materials.forEach(material => material.dispose())
  meshes.clear()
  materials.clear()
}

function rebuildRegions() {
  if (!threeLayer) return
  disposeRegions()
  REGIONS.forEach(createRegionMesh)
  if (!props.regionsVisible) threeLayer.hide()
}

function executeCommand(type: SceneCommand) {
  if (!map) return
  if (type === 'zoom-in') map.setZoom(map.getZoom() + 1)
  if (type === 'zoom-out') map.setZoom(map.getZoom() - 1)
  if (type === 'reset') map.animateTo(INITIAL_VIEW, { duration: 650 })
  if (type === 'toggle-dimension') {
    const is3d = map.getPitch() > 10
    map.animateTo({ pitch: is3d ? 0 : INITIAL_VIEW.pitch, bearing: is3d ? 0 : INITIAL_VIEW.bearing }, { duration: 520 })
  }
}

onMounted(() => {
  if (!mapContainer.value) return
  try {
    const baseLayer = new maptalks.TileLayer('base', {
      urlTemplate: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles © Esri', crossOrigin: 'anonymous',
    })
    map = new maptalks.Map(mapContainer.value, {
      ...INITIAL_VIEW, baseLayer, minZoom: 3, maxZoom: 19,
      spatialReference: { projection: 'EPSG:3857' }, zoomControl: false, attribution: false,
    })
    map.on('zoomend moveend pitchend rotateend', reportView)
    map.on('click', (event: any) => {
      if (!threeLayer?.identify(event.coordinate, {}).length) updateSelection(null)
    })
    threeLayer = new ThreeLayer('regions', {
      forceRenderOnMoving: true, forceRenderOnRotating: true, forceRenderOnZooming: true, identifyCountOnEvent: 1,
    })
    threeLayer.prepareToDraw = (_gl, scene) => {
      scene.add(new THREE.HemisphereLight('#cfe4ff', '#24362f', 2.4))
      const light = new THREE.DirectionalLight('#fff4df', 3.8)
      light.position.set(0, -10, 16)
      scene.add(light)
      rebuildRegions()
      emit('ready')
      reportView()
      return []
    }
    threeLayer.addTo(map)
  } catch (error) {
    emit('error', error instanceof Error ? error.message : '地图初始化失败')
  }
})

watch(() => props.command.id, () => executeCommand(props.command.type))
watch(() => props.regionsVisible, visible => visible ? threeLayer?.show() : threeLayer?.hide())
watch(() => props.heightScale, rebuildRegions)

onBeforeUnmount(() => {
  mapContainer.value?.classList.remove('is-picking')
  disposeRegions()
  threeLayer?.remove()
  map?.remove()
  threeLayer = null
  map = null
})
</script>

<template><div ref="mapContainer" class="map-canvas" aria-label="城市规划三维地图"></div></template>

<style scoped>
.map-canvas { position: absolute; inset: 0; cursor: grab; background: #15201d; }
.map-canvas:active { cursor: grabbing; }.map-canvas.is-picking { cursor: pointer; }
:deep(.maptalks-canvas-layer), :deep(.maptalks-front-layer) { outline: none; }
</style>

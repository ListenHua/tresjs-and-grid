import type { Ref } from 'vue'
import * as maptalks from 'maptalks'
import { ThreeLayer } from 'maptalks.three'
import type BaseObject from 'maptalks.three/dist/BaseObject'
import * as THREE from 'three'
import protectAreaJson from '../data/protect_area.json'
import {
  AREA_TYPE_COLORS,
  EXTRUSION_CONFIG,
  INTERACTION_COLORS,
  LIGHT_CONFIG,
  THREE_LAYER_CONFIG,
} from '../map/config'
import type { ProtectAreaCollection, ProtectAreaFeature, ProtectAreaType } from '../types/map'

interface ProtectAreaLayerOptions {
  container: Ref<HTMLElement | null>
  getVisibleTypes: () => ProtectAreaType[]
  onHover: (feature: ProtectAreaFeature | null) => void
  onSelect: (feature: ProtectAreaFeature | null) => void
  onReady: (count: number) => void
}

const PROTECT_AREAS = protectAreaJson as ProtectAreaCollection

export function useProtectAreaLayer(options: ProtectAreaLayerOptions) {
  const meshes = new Map<string, BaseObject>()
  const materials = new Map<string, THREE.MeshPhongMaterial>()
  const featureById = new Map<string, ProtectAreaFeature>()
  let layer: ThreeLayer | null = null
  let selectedId: string | null = null
  let hoveredId: string | null = null
  let rebuildTimer: ReturnType<typeof setTimeout> | undefined

  function featureId(feature: ProtectAreaFeature, index: number) {
    return `${feature.properties.BHDBM}-${feature.properties.BHDLX}-${index}`
  }

  function updateMaterial(id: string) {
    const material = materials.get(id)
    const feature = featureById.get(id)
    if (!material || !feature) return
    const color = id === selectedId
      ? INTERACTION_COLORS.selected
      : id === hoveredId ? INTERACTION_COLORS.hover : AREA_TYPE_COLORS[feature.properties.BHDLX]
    material.color.set(color)
    material.emissive.set(id === selectedId ? INTERACTION_COLORS.selectedEmissive : '#000000')
    material.needsUpdate = true
    layer?.renderScene()
  }

  function setSelection(feature: ProtectAreaFeature | null) {
    const previous = selectedId
    selectedId = feature
      ? [...featureById.entries()].find(([, value]) => value === feature)?.[0] ?? null
      : null
    if (previous) updateMaterial(previous)
    if (selectedId) updateMaterial(selectedId)
    options.onSelect(feature)
  }

  function createMesh(feature: ProtectAreaFeature, index: number) {
    if (!layer || !options.getVisibleTypes().includes(feature.properties.BHDLX)) return
    const id = featureId(feature, index)
    const geometry = maptalks.GeoJSON.toGeometry(feature as any)
    if (!(geometry instanceof maptalks.Polygon) && !(geometry instanceof maptalks.MultiPolygon)) return
    const material = new THREE.MeshPhongMaterial({
      color: AREA_TYPE_COLORS[feature.properties.BHDLX],
      shininess: EXTRUSION_CONFIG.shininess,
      transparent: true,
      opacity: EXTRUSION_CONFIG.opacity,
    })
    const mesh = layer.toExtrudePolygon(geometry, {
      height: EXTRUSION_CONFIG.height,
      interactive: true,
    }, material)
    mesh.setId(id).setProperties(feature.properties)
    mesh.on('mouseover', () => {
      const previous = hoveredId
      hoveredId = id
      if (previous && previous !== selectedId) updateMaterial(previous)
      updateMaterial(id)
      options.container.value?.classList.add('is-picking')
      options.onHover(feature)
    })
    mesh.on('mouseout', () => {
      hoveredId = null
      updateMaterial(id)
      options.container.value?.classList.remove('is-picking')
      options.onHover(null)
    })
    mesh.on('click', () => setSelection(selectedId === id ? null : feature))
    featureById.set(id, feature)
    materials.set(id, material)
    meshes.set(id, mesh)
    layer.addMesh(mesh)
  }

  function disposeMeshes() {
    meshes.forEach(mesh => {
      layer?.removeMesh(mesh)
      mesh.getObject3d().traverse(object => {
        if (object instanceof THREE.Mesh) object.geometry?.dispose()
      })
    })
    materials.forEach(material => material.dispose())
    meshes.clear()
    materials.clear()
    featureById.clear()
  }

  function rebuild() {
    if (!layer) return
    selectedId = null
    hoveredId = null
    options.onSelect(null)
    options.onHover(null)
    disposeMeshes()
    PROTECT_AREAS.features.forEach(createMesh)
  }

  function scheduleRebuild() {
    clearTimeout(rebuildTimer)
    rebuildTimer = setTimeout(rebuild, 120)
  }

  function createLayer(map: maptalks.Map) {
    layer = new ThreeLayer(THREE_LAYER_CONFIG.id, THREE_LAYER_CONFIG)
    layer.prepareToDraw = (_gl, scene) => {
      scene.add(new THREE.HemisphereLight(
        LIGHT_CONFIG.hemisphere.skyColor,
        LIGHT_CONFIG.hemisphere.groundColor,
        LIGHT_CONFIG.hemisphere.intensity,
      ))
      const directional = new THREE.DirectionalLight(
        LIGHT_CONFIG.directional.color,
        LIGHT_CONFIG.directional.intensity,
      )
      directional.position.set(...LIGHT_CONFIG.directional.position)
      scene.add(directional)
      rebuild()
      options.onReady(PROTECT_AREAS.features.length)
      return []
    }
    layer.addTo(map)
    return layer
  }

  function identify(coordinate: maptalks.Coordinate) {
    return layer?.identify(coordinate, {}) ?? []
  }

  function setVisible(visible: boolean) {
    if (visible) layer?.show()
    else layer?.hide()
  }

  function clearSelection() {
    setSelection(null)
  }

  function dispose() {
    clearTimeout(rebuildTimer)
    options.container.value?.classList.remove('is-picking')
    disposeMeshes()
    layer?.remove()
    layer = null
  }

  return { createLayer, identify, setVisible, clearSelection, scheduleRebuild, dispose }
}

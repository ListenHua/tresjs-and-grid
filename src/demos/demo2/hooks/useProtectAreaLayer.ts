import type { Ref } from 'vue'
import * as maptalks from 'maptalks'
import { ThreeLayer } from 'maptalks.three'
import type BaseObject from 'maptalks.three/dist/BaseObject'
import * as THREE from 'three'
import protectAreaJson from '../data/protect_area.json'
import {
  AREA_TYPE_COLORS,
  BASE_MAP_CONFIG,
  EXTRUSION_CONFIG,
  INTERACTION_COLORS,
  LIGHT_CONFIG,
  RASTER_TOP_CONFIG,
  THREE_LAYER_CONFIG,
} from '../config'
import type { ProtectAreaCollection, ProtectAreaFeature, ProtectAreaType } from '../types/map'
import { RasterAtlasManager } from '../utils/RasterAtlasManager'
import type { GeographicExtent, RasterAtlas } from '../utils/RasterAtlasManager'

interface ProtectAreaLayerOptions {
  container: Ref<HTMLElement | null>
  getVisibleTypes: () => ProtectAreaType[]
  onHover: (feature: ProtectAreaFeature | null) => void
  onSelect: (feature: ProtectAreaFeature | null) => void
  onReady: (count: number) => void
}

const PROTECT_AREAS = protectAreaJson as ProtectAreaCollection

function buildSiteExtents(features: ProtectAreaFeature[]) {
  const extents = new Map<string, GeographicExtent>()
  features.forEach((feature) => {
    const id = feature.properties.BHDBM
    const extent = extents.get(id) ?? {
      west: Infinity,
      south: Infinity,
      east: -Infinity,
      north: -Infinity,
    }
    feature.geometry.coordinates.forEach(polygon => polygon.forEach(ring => ring.forEach(([lng, lat]) => {
      extent.west = Math.min(extent.west, lng)
      extent.south = Math.min(extent.south, lat)
      extent.east = Math.max(extent.east, lng)
      extent.north = Math.max(extent.north, lat)
    })))
    extents.set(id, extent)
  })
  return extents
}

const SITE_EXTENTS = buildSiteExtents(PROTECT_AREAS.features)

interface RasterRequestState {
  requestId: number
  requestedZoom: number
  extent: GeographicExtent
}

interface AppliedRasterState {
  atlas: RasterAtlas
  requestedZoom: number
}

function intersectExtents(a: GeographicExtent, b: GeographicExtent): GeographicExtent | null {
  const extent = {
    west: Math.max(a.west, b.west),
    south: Math.max(a.south, b.south),
    east: Math.min(a.east, b.east),
    north: Math.min(a.north, b.north),
  }
  return extent.west < extent.east && extent.south < extent.north ? extent : null
}

function expandExtent(extent: GeographicExtent, ratio: number): GeographicExtent {
  const longitudePadding = (extent.east - extent.west) * ratio
  const latitudePadding = (extent.north - extent.south) * ratio
  return {
    west: extent.west - longitudePadding,
    south: extent.south - latitudePadding,
    east: extent.east + longitudePadding,
    north: extent.north + latitudePadding,
  }
}

function containsExtent(container: GeographicExtent, target: GeographicExtent) {
  const epsilon = 1e-9
  return container.west <= target.west + epsilon
    && container.south <= target.south + epsilon
    && container.east >= target.east - epsilon
    && container.north >= target.north - epsilon
}

function isTopTriangle(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  a: number,
  b: number,
  c: number,
  topZ: number,
  epsilon: number,
) {
  return Math.abs(position.getZ(a) - topZ) <= epsilon
    && Math.abs(position.getZ(b) - topZ) <= epsilon
    && Math.abs(position.getZ(c) - topZ) <= epsilon
}

function configureExtrudedMaterials(
  mesh: THREE.Mesh,
  topMaterial: THREE.Material,
  sideMaterial: THREE.Material,
) {
  const geometry = mesh.geometry
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  if (!position || !index) throw new Error('Extruded polygon geometry is incomplete')

  let topZ = -Infinity
  for (let i = 0; i < position.count; i += 1) topZ = Math.max(topZ, position.getZ(i))
  const epsilon = Math.max(1e-6, Math.abs(topZ) * 1e-5)
  const topIndices: number[] = []
  const bodyIndices: number[] = []

  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i)
    const b = index.getX(i + 1)
    const c = index.getX(i + 2)
    const target = isTopTriangle(position, a, b, c, topZ, epsilon) ? topIndices : bodyIndices
    target.push(a, b, c)
  }
  if (topIndices.length === 0) throw new Error('Extruded polygon has no top surface')

  geometry.setIndex([...topIndices, ...bodyIndices])
  geometry.clearGroups()
  geometry.addGroup(0, topIndices.length, 0)
  geometry.addGroup(topIndices.length, bodyIndices.length, 1)
  mesh.material = [topMaterial, sideMaterial]
}

function applyRasterAtlasUv(mesh: THREE.Mesh, targetLayer: ThreeLayer, atlas: RasterAtlas) {
  const position = mesh.geometry.getAttribute('position')
  if (!position) return

  const northWest = targetLayer.coordinateToVector3([atlas.extent.west, atlas.extent.north])
  const southEast = targetLayer.coordinateToVector3([atlas.extent.east, atlas.extent.south])
  const sourceWidth = atlas.sourcePixels.right - atlas.sourcePixels.left
  const sourceHeight = atlas.sourcePixels.bottom - atlas.sourcePixels.top
  const canvasWidth = atlas.canvasPixels.right - atlas.canvasPixels.left
  const canvasHeight = atlas.canvasPixels.bottom - atlas.canvasPixels.top
  const uv = new Float32Array(position.count * 2)

  for (let i = 0; i < position.count; i += 1) {
    const worldX = mesh.position.x + position.getX(i)
    const worldY = mesh.position.y + position.getY(i)
    const xRatio = (worldX - northWest.x) / (southEast.x - northWest.x)
    const yRatio = (worldY - northWest.y) / (southEast.y - northWest.y)
    const globalPixelX = atlas.sourcePixels.left + xRatio * sourceWidth
    const globalPixelY = atlas.sourcePixels.top + yRatio * sourceHeight
    // Out-of-range UVs preserve interpolation when the atlas only covers the viewport.
    uv[i * 2] = (globalPixelX - atlas.canvasPixels.left) / canvasWidth
    uv[i * 2 + 1] = 1 - (globalPixelY - atlas.canvasPixels.top) / canvasHeight
  }

  mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
}

export function useProtectAreaLayer(options: ProtectAreaLayerOptions) {
  const meshes = new Map<string, BaseObject>()
  const sideMaterials = new Map<string, THREE.MeshPhongMaterial>()
  const topMaterials = new Map<string, THREE.MeshBasicMaterial>()
  const featureById = new Map<string, ProtectAreaFeature>()
  const rasterRequestIds = new Map<string, number>()
  const pendingRasterRequests = new Map<string, RasterRequestState>()
  const appliedRasterStates = new Map<string, AppliedRasterState>()
  const warnedRasterRequests = new Set<string>()
  let layer: ThreeLayer | null = null
  let mapInstance: maptalks.Map | null = null
  let atlasManager: RasterAtlasManager | null = null
  let selectedId: string | null = null
  let hoveredId: string | null = null
  let rebuildRevision = 0
  let rasterPrioritySequence = 0
  let rebuildTimer: ReturnType<typeof setTimeout> | undefined
  let detailTimer: ReturnType<typeof setTimeout> | undefined

  function featureId(feature: ProtectAreaFeature, index: number) {
    return `${feature.properties.BHDBM}-${feature.properties.BHDLX}-${index}`
  }

  function updateMaterial(id: string) {
    const sideMaterial = sideMaterials.get(id)
    const topMaterial = topMaterials.get(id)
    const feature = featureById.get(id)
    if (!sideMaterial || !topMaterial || !feature) return
    const color = id === selectedId
      ? INTERACTION_COLORS.selected
      : id === hoveredId ? INTERACTION_COLORS.hover : AREA_TYPE_COLORS[feature.properties.BHDLX]
    sideMaterial.color.set(color)
    sideMaterial.emissive.set(id === selectedId ? INTERACTION_COLORS.selectedEmissive : '#000000')
    sideMaterial.needsUpdate = true
    topMaterial.color.set(topMaterial.map
      ? id === selectedId
        ? INTERACTION_COLORS.rasterSelectedTint
        : id === hoveredId ? INTERACTION_COLORS.rasterHoverTint : '#ffffff'
      : color)
    topMaterial.needsUpdate = true
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

  function requestRasterTexture(
    id: string,
    feature: ProtectAreaFeature,
    mesh: BaseObject,
    object3d: THREE.Mesh,
    topMaterial: THREE.MeshBasicMaterial,
    requestedZoom: number,
    requestExtent: GeographicExtent,
    visibleExtent: GeographicExtent,
  ) {
    if (!atlasManager) return
    const siteId = feature.properties.BHDBM
    const applied = appliedRasterStates.get(id)
    if (
      applied?.requestedZoom === requestedZoom
      && containsExtent(applied.atlas.extent, visibleExtent)
    ) return
    const pending = pendingRasterRequests.get(id)
    if (
      pending?.requestedZoom === requestedZoom
      && containsExtent(pending.extent, visibleExtent)
    ) return

    const requestId = (rasterRequestIds.get(id) ?? 0) + 1
    const revision = rebuildRevision
    rasterRequestIds.set(id, requestId)
    pendingRasterRequests.set(id, { requestId, requestedZoom, extent: requestExtent })

    atlasManager.getAtlas(siteId, requestExtent, requestedZoom, ++rasterPrioritySequence)
      .then((atlas) => {
        if (
          revision !== rebuildRevision
          || rasterRequestIds.get(id) !== requestId
          || meshes.get(id) !== mesh
          || !layer
        ) return
        pendingRasterRequests.delete(id)
        applyRasterAtlasUv(object3d, layer, atlas)
        const previous = appliedRasterStates.get(id)?.atlas
        if (previous !== atlas) atlasManager?.retainAtlas(atlas)
        topMaterial.map = atlas.texture
        appliedRasterStates.set(id, { atlas, requestedZoom })
        if (previous && previous !== atlas) atlasManager?.releaseAtlas(previous)
        updateMaterial(id)
        const warningKey = `${siteId}:${atlas.zoom}`
        if (atlas.failedTiles > 0 && !warnedRasterRequests.has(warningKey)) {
          warnedRasterRequests.add(warningKey)
          console.warn(`Raster atlas ${siteId} loaded with ${atlas.failedTiles} missing tile(s)`)
        }
        const fallbackKey = `${siteId}:${requestedZoom}:${atlas.zoom}:fallback`
        if (atlas.zoom !== requestedZoom && !warnedRasterRequests.has(fallbackKey)) {
          warnedRasterRequests.add(fallbackKey)
          console.warn(`Raster atlas ${siteId} fell back from z${requestedZoom} to z${atlas.zoom}`)
        }
        if (import.meta.env.DEV) {
          console.debug('[ProtectAreaRaster] texture applied', {
            siteId,
            requestedZoom,
            appliedZoom: atlas.zoom,
          })
        }
      })
      .catch((error) => {
        if (revision !== rebuildRevision || rasterRequestIds.get(id) !== requestId) return
        pendingRasterRequests.delete(id)
        const warningKey = `${siteId}:${requestedZoom}:error`
        if (warnedRasterRequests.has(warningKey)) return
        warnedRasterRequests.add(warningKey)
        console.warn(`Unable to texture protected area ${siteId}`, error)
      })
  }

  function refreshRasterTextures() {
    if (!mapInstance || !atlasManager) return
    const view = mapInstance.getExtent()
    const { xmin, ymin, xmax, ymax } = view
    if (
      xmin === null
      || ymin === null
      || xmax === null
      || ymax === null
      || ![xmin, ymin, xmax, ymax].every(value => Number.isFinite(value))
    ) return
    const viewExtent: GeographicExtent = {
      west: xmin,
      south: ymin,
      east: xmax,
      north: ymax,
    }
    const expandedView = expandExtent(viewExtent, RASTER_TOP_CONFIG.overscanRatio)
    const requestedZoom = Math.max(
      RASTER_TOP_CONFIG.minZoom,
      Math.min(RASTER_TOP_CONFIG.maxZoom, Math.round(mapInstance.getZoom())),
    )

    featureById.forEach((feature, id) => {
      const siteExtent = SITE_EXTENTS.get(feature.properties.BHDBM)
      if (!siteExtent) return
      const visibleExtent = intersectExtents(siteExtent, viewExtent)
      if (!visibleExtent) return
      const overscannedExtent = intersectExtents(siteExtent, expandedView)
      const requestExtent = overscannedExtent
        && atlasManager?.canRenderAtZoom(overscannedExtent, requestedZoom)
        ? overscannedExtent
        : visibleExtent
      const mesh = meshes.get(id)
      const topMaterial = topMaterials.get(id)
      const object3d = mesh?.getObject3d()
      if (!mesh || !topMaterial || !(object3d instanceof THREE.Mesh)) return
      requestRasterTexture(
        id,
        feature,
        mesh,
        object3d,
        topMaterial,
        requestedZoom,
        requestExtent,
        visibleExtent,
      )
    })
  }

  function scheduleRasterRefresh() {
    clearTimeout(detailTimer)
    detailTimer = setTimeout(refreshRasterTextures, RASTER_TOP_CONFIG.debounce)
  }

  function createMesh(feature: ProtectAreaFeature, index: number) {
    if (!layer || !options.getVisibleTypes().includes(feature.properties.BHDLX)) return
    const id = featureId(feature, index)
    const geometry = maptalks.GeoJSON.toGeometry(feature as any)
    if (!(geometry instanceof maptalks.Polygon) && !(geometry instanceof maptalks.MultiPolygon)) return
    const sideMaterial = new THREE.MeshPhongMaterial({
      color: AREA_TYPE_COLORS[feature.properties.BHDLX],
      shininess: EXTRUSION_CONFIG.shininess,
      transparent: true,
      opacity: EXTRUSION_CONFIG.opacity,
    })
    const topMaterial = new THREE.MeshBasicMaterial({
      color: AREA_TYPE_COLORS[feature.properties.BHDLX],
      toneMapped: false,
    })
    const mesh = layer.toExtrudePolygon(geometry, {
      height: EXTRUSION_CONFIG.height,
      interactive: true,
    }, sideMaterial)
    const object3d = mesh.getObject3d()
    if (!(object3d instanceof THREE.Mesh)) {
      sideMaterial.dispose()
      topMaterial.dispose()
      return
    }
    configureExtrudedMaterials(object3d, topMaterial, sideMaterial)
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
    sideMaterials.set(id, sideMaterial)
    topMaterials.set(id, topMaterial)
    meshes.set(id, mesh)
    layer.addMesh(mesh)
  }

  function disposeMeshes() {
    appliedRasterStates.forEach(({ atlas }) => atlasManager?.releaseAtlas(atlas))
    meshes.forEach(mesh => {
      layer?.removeMesh(mesh)
      mesh.getObject3d().traverse(object => {
        if (object instanceof THREE.Mesh) object.geometry?.dispose()
      })
    })
    sideMaterials.forEach(material => material.dispose())
    topMaterials.forEach(material => material.dispose())
    meshes.clear()
    sideMaterials.clear()
    topMaterials.clear()
    featureById.clear()
    rasterRequestIds.clear()
    pendingRasterRequests.clear()
    appliedRasterStates.clear()
  }

  function rebuild() {
    if (!layer) return
    rebuildRevision += 1
    selectedId = null
    hoveredId = null
    options.onSelect(null)
    options.onHover(null)
    disposeMeshes()
    PROTECT_AREAS.features.forEach(createMesh)
    scheduleRasterRefresh()
  }

  function scheduleRebuild() {
    clearTimeout(rebuildTimer)
    rebuildTimer = setTimeout(rebuild, 120)
  }

  function createLayer(map: maptalks.Map) {
    mapInstance = map
    map.on('zoomend moveend', scheduleRasterRefresh)
    layer = new ThreeLayer(THREE_LAYER_CONFIG.id, THREE_LAYER_CONFIG)
    layer.prepareToDraw = (_gl, scene) => {
      const renderer = layer?.getThreeRenderer()
      const supportedAnisotropy = renderer?.capabilities.getMaxAnisotropy() ?? 1
      atlasManager = new RasterAtlasManager({
        urlTemplate: BASE_MAP_CONFIG.urlTemplate,
        crossOrigin: BASE_MAP_CONFIG.crossOrigin,
        tileSize: RASTER_TOP_CONFIG.tileSize,
        paddingPixels: RASTER_TOP_CONFIG.paddingPixels,
        maxAtlasSize: RASTER_TOP_CONFIG.maxAtlasSize,
        maxConcurrentRequests: RASTER_TOP_CONFIG.maxConcurrentRequests,
        maxAnisotropy: Math.min(RASTER_TOP_CONFIG.maxAnisotropy, supportedAnisotropy),
        maxCachedAtlases: RASTER_TOP_CONFIG.maxCachedAtlases,
        maxCachedTexturePixels: RASTER_TOP_CONFIG.maxCachedTexturePixels,
        maxCachedImages: RASTER_TOP_CONFIG.maxCachedImages,
      })
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
    clearTimeout(detailTimer)
    rebuildRevision += 1
    mapInstance?.off('zoomend moveend', scheduleRasterRefresh)
    mapInstance = null
    options.container.value?.classList.remove('is-picking')
    disposeMeshes()
    atlasManager?.dispose()
    atlasManager = null
    layer?.remove()
    layer = null
  }

  return { createLayer, identify, setVisible, clearSelection, scheduleRebuild, dispose }
}

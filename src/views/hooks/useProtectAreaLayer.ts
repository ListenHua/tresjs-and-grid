import type { Ref } from 'vue'
import * as maptalks from 'maptalks'
import { ThreeLayer } from 'maptalks.three'
import type BaseObject from 'maptalks.three/dist/BaseObject'
import { gsap } from 'gsap'
import * as THREE from 'three'
import { PROTECT_AREAS, SITE_EXTENTS } from '../data/protectAreas'
import {
  AREA_TYPE_COLORS,
  AREA_TYPE_FILL_ORDER,
  EXTRUSION_CONFIG,
  INTERACTION_COLORS,
  LIGHT_CONFIG,
  MAP_FLIGHT_CONFIG,
  RASTER_TOP_CONFIG,
  THREE_LAYER_CONFIG,
} from '../config'
import type { ProtectAreaFeature, ProtectAreaType } from '../types/map'
import { RasterAtlasManager } from '../utils/RasterAtlasManager'
import type { GeographicExtent, RasterAtlas } from '../utils/RasterAtlasManager'
import type { RasterSource } from '../utils/RasterSource'

interface ProtectAreaLayerOptions {
  container: Ref<HTMLElement | null>
  getVisibleTypes: () => ProtectAreaType[]
  onHover: (feature: ProtectAreaFeature | null) => void
  onSelect: (feature: ProtectAreaFeature | null) => void
  onReady: (count: number) => void
  onRasterError?: (message: string | null) => void
  onMeshesReady?: () => void
}

interface RasterRequestState {
  requestId: number
  requestedZoom: number
  extent: GeographicExtent
}

interface AppliedRasterState {
  atlas: RasterAtlas
  manager: RasterAtlasManager
  requestedZoom: number
}

export type ExtrusionPhase = 'flat' | 'raising' | 'raised' | 'lowering'

export function resolveExtrusionRenderState(phase: ExtrusionPhase) {
  const isRaisedTarget = phase === 'raising' || phase === 'raised'
  const isVisible = phase !== 'flat'
  const fillVisible = phase !== 'raised'
  return {
    scaleZ: isRaisedTarget ? 1 : EXTRUSION_CONFIG.flatScale,
    topOpacity: isRaisedTarget ? 1 : 0,
    sideOpacity: isRaisedTarget ? EXTRUSION_CONFIG.opacity : 0,
    fillOpacity: phase === 'flat' || phase === 'lowering' ? EXTRUSION_CONFIG.fillOpacity : 0,
    topVisible: isVisible,
    sideVisible: isVisible,
    fillVisible,
    topTransparent: phase !== 'raised',
    topDepthWrite: isVisible,
    sideDepthWrite: isVisible,
  }
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

export function extractBoundaryEdgeIndices(topIndices: number[]) {
  const edges = new Map<string, { a: number; b: number; count: number }>()
  const addEdge = (a: number, b: number) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`
    const existing = edges.get(key)
    if (existing) existing.count += 1
    else edges.set(key, { a, b, count: 1 })
  }

  for (let index = 0; index < topIndices.length; index += 3) {
    const a = topIndices[index]
    const b = topIndices[index + 1]
    const c = topIndices[index + 2]
    addEdge(a, b)
    addEdge(b, c)
    addEdge(c, a)
  }

  return [...edges.values()]
    .filter(edge => edge.count === 1)
    .flatMap(edge => [edge.a, edge.b])
}

export function resolveOutlineRenderState(topZ: number) {
  return {
    depthTest: true,
    depthWrite: false,
    renderOrder: 2,
    zOffset: Math.abs(topZ) * EXTRUSION_CONFIG.outlineLiftRatio,
  }
}

function copyVertexPositions(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  indices: number[],
) {
  const positions = new Float32Array(indices.length * 3)
  indices.forEach((vertexIndex, index) => {
    positions[index * 3] = position.getX(vertexIndex)
    positions[index * 3 + 1] = position.getY(vertexIndex)
    positions[index * 3 + 2] = position.getZ(vertexIndex)
  })
  return positions
}

function createTopFill(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  topIndices: number[],
  topZ: number,
  material: THREE.MeshBasicMaterial,
  renderOrder: number,
) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(copyVertexPositions(position, topIndices), 3))
  const fill = new THREE.Mesh(geometry, material)
  fill.position.z = -Math.abs(topZ) * EXTRUSION_CONFIG.fillInsetRatio
  fill.renderOrder = renderOrder
  fill.raycast = () => {}
  return fill
}

function createTopOutline(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  topIndices: number[],
  topZ: number,
  material: THREE.LineBasicMaterial,
) {
  const boundaryIndices = extractBoundaryEdgeIndices(topIndices)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(copyVertexPositions(position, boundaryIndices), 3))
  const outline = new THREE.LineSegments(geometry, material)
  const renderState = resolveOutlineRenderState(topZ)
  material.depthTest = renderState.depthTest
  material.depthWrite = renderState.depthWrite
  outline.renderOrder = renderState.renderOrder
  outline.position.z = renderState.zOffset
  outline.raycast = () => {}
  return outline
}

function configureExtrudedMaterials(
  mesh: THREE.Mesh,
  topMaterial: THREE.Material,
  sideMaterial: THREE.Material,
  fillMaterial: THREE.MeshBasicMaterial,
  fillRenderOrder: number,
  outlineMaterial: THREE.LineBasicMaterial,
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
  const fill = createTopFill(position, topIndices, topZ, fillMaterial, fillRenderOrder)
  const outline = createTopOutline(position, topIndices, topZ, outlineMaterial)
  mesh.add(fill, outline)
  return { fill, outline }
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
  const fillMaterials = new Map<string, THREE.MeshBasicMaterial>()
  const outlineMaterials = new Map<string, THREE.LineBasicMaterial>()
  const outlineLines = new Map<string, THREE.LineSegments>()
  const extrusionAnimations = new Map<string, gsap.core.Timeline>()
  const featureById = new Map<string, ProtectAreaFeature>()
  const rasterRequestIds = new Map<string, number>()
  const pendingRasterRequests = new Map<string, RasterRequestState>()
  const appliedRasterStates = new Map<string, AppliedRasterState>()
  const warnedRasterRequests = new Set<string>()
  const failedRasterIds = new Set<string>()
  let layer: ThreeLayer | null = null
  let mapInstance: maptalks.Map | null = null
  let atlasManager: RasterAtlasManager | null = null
  let rasterSource: RasterSource | null = null
  let rasterSourceRevision = 0
  let rasterReady = false
  let maxAnisotropy = 1
  let selectedId: string | null = null
  let hoveredId: string | null = null
  let rebuildRevision = 0
  let rebuildPending = false
  let rebuildTimer: ReturnType<typeof setTimeout> | undefined
  let detailTimer: ReturnType<typeof setTimeout> | undefined
  let hoverExitTimer: ReturnType<typeof setTimeout> | undefined
  let flightActive = false
  let lastFlightRasterRefresh = 0
  const supportsHover = typeof window === 'undefined'
    || window.matchMedia('(hover: hover) and (pointer: fine)').matches
  const prefersReducedMotion = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  function applyMaterialRenderState(
    topMaterial: THREE.MeshBasicMaterial,
    sideMaterial: THREE.MeshPhongMaterial,
    fillMaterial: THREE.MeshBasicMaterial,
    phase: ExtrusionPhase,
    applyOpacity: boolean,
  ) {
    const state = resolveExtrusionRenderState(phase)
    const transparencyChanged = topMaterial.transparent !== state.topTransparent
    topMaterial.transparent = state.topTransparent
    topMaterial.depthWrite = state.topDepthWrite
    topMaterial.visible = state.topVisible
    sideMaterial.depthWrite = state.sideDepthWrite
    sideMaterial.visible = state.sideVisible
    fillMaterial.visible = state.fillVisible
    if (applyOpacity) {
      topMaterial.opacity = state.topOpacity
      sideMaterial.opacity = state.sideOpacity
      fillMaterial.opacity = state.fillOpacity
    }
    if (transparencyChanged) topMaterial.needsUpdate = true
    return state
  }

  function updateMaterial(id: string) {
    const sideMaterial = sideMaterials.get(id)
    const topMaterial = topMaterials.get(id)
    const outlineMaterial = outlineMaterials.get(id)
    const feature = featureById.get(id)
    if (!sideMaterial || !topMaterial || !outlineMaterial || !feature) return
    const color = AREA_TYPE_COLORS[feature.properties.BHDLX]
    sideMaterial.color.set(color)
    sideMaterial.emissive.set('#000000')
    sideMaterial.needsUpdate = true
    outlineMaterial.color.set(color)
    outlineMaterial.needsUpdate = true
    topMaterial.color.set(topMaterial.map
      ? id === hoveredId && id !== selectedId ? INTERACTION_COLORS.rasterHoverTint : '#ffffff'
      : color)
    topMaterial.needsUpdate = true
    layer?.renderScene()
  }

  function setMeshRaised(id: string, raised: boolean, immediate = false) {
    const object3d = meshes.get(id)?.getObject3d()
    const sideMaterial = sideMaterials.get(id)
    const topMaterial = topMaterials.get(id)
    const fillMaterial = fillMaterials.get(id)
    if (!(object3d instanceof THREE.Mesh) || !sideMaterial || !topMaterial || !fillMaterial) return

    extrusionAnimations.get(id)?.kill()
    extrusionAnimations.delete(id)
    const transitionPhase: ExtrusionPhase = raised ? 'raising' : 'lowering'
    const settledPhase: ExtrusionPhase = raised ? 'raised' : 'flat'
    const target = applyMaterialRenderState(topMaterial, sideMaterial, fillMaterial, transitionPhase, false)
    if (immediate || prefersReducedMotion) {
      const settled = applyMaterialRenderState(topMaterial, sideMaterial, fillMaterial, settledPhase, true)
      object3d.scale.z = settled.scaleZ
      layer?.renderScene()
      return
    }

    const duration = raised ? EXTRUSION_CONFIG.raiseDuration : EXTRUSION_CONFIG.lowerDuration
    const ease = raised ? EXTRUSION_CONFIG.raiseEase : EXTRUSION_CONFIG.lowerEase
    const timeline = gsap.timeline({
      defaults: { duration, ease, overwrite: true },
      onUpdate: () => layer?.renderScene(),
      onComplete: () => {
        if (extrusionAnimations.get(id) !== timeline) return
        applyMaterialRenderState(topMaterial, sideMaterial, fillMaterial, settledPhase, true)
        extrusionAnimations.delete(id)
        layer?.renderScene()
      },
    })
    timeline
      .to(object3d.scale, { z: target.scaleZ }, 0)
      .to(topMaterial, { opacity: target.topOpacity }, 0)
      .to(sideMaterial, { opacity: target.sideOpacity }, 0)
      .to(fillMaterial, { opacity: target.fillOpacity }, 0)
    extrusionAnimations.set(id, timeline)
  }

  function setSelection(feature: ProtectAreaFeature | null, immediate = false) {
    const previous = selectedId
    selectedId = feature && featureById.has(feature.id) ? feature.id : null
    if (previous && previous !== selectedId) {
      updateMaterial(previous)
      setMeshRaised(previous, previous === hoveredId, immediate)
    }
    if (selectedId) {
      updateMaterial(selectedId)
      setMeshRaised(selectedId, true, immediate)
      refreshRasterTextures()
    }
    options.onSelect(selectedId ? featureById.get(selectedId) ?? null : null)
  }

  function clearRasterTextures() {
    topMaterials.forEach((material, id) => {
      material.map = null
      updateMaterial(id)
    })
    appliedRasterStates.forEach(({ atlas, manager }) => manager.releaseAtlas(atlas))
    appliedRasterStates.clear()
    rasterRequestIds.clear()
    pendingRasterRequests.clear()
    warnedRasterRequests.clear()
    failedRasterIds.clear()
    options.onRasterError?.(null)
  }

  function initializeRasterManager() {
    if (!rasterReady || !rasterSource || atlasManager) return
    atlasManager = new RasterAtlasManager({
      source: rasterSource,
      paddingPixels: RASTER_TOP_CONFIG.paddingPixels,
      maxAtlasSize: RASTER_TOP_CONFIG.maxAtlasSize,
      maxConcurrentRequests: RASTER_TOP_CONFIG.maxConcurrentRequests,
      requestTimeout: RASTER_TOP_CONFIG.requestTimeout,
      maxAnisotropy,
      maxCachedAtlases: RASTER_TOP_CONFIG.maxCachedAtlases,
      maxCachedTexturePixels: RASTER_TOP_CONFIG.maxCachedTexturePixels,
      maxCachedImages: RASTER_TOP_CONFIG.maxCachedImages,
    })
    scheduleRasterRefresh()
  }

  function setRasterSource(source: RasterSource | null) {
    rasterSourceRevision += 1
    clearTimeout(detailTimer)
    detailTimer = undefined
    clearRasterTextures()
    atlasManager?.dispose()
    atlasManager = null
    rasterSource = source
    initializeRasterManager()
  }

  function rasterPriority(id: string) {
    return id === selectedId ? 3 : id === hoveredId ? 2 : 1
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
    const manager = atlasManager
    if (!manager) return
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
    const sourceRevision = rasterSourceRevision
    rasterRequestIds.set(id, requestId)
    pendingRasterRequests.set(id, { requestId, requestedZoom, extent: requestExtent })

    manager.getAtlas(siteId, requestExtent, requestedZoom, rasterPriority(id))
      .then((atlas) => {
        if (
          revision !== rebuildRevision
          || sourceRevision !== rasterSourceRevision
          || manager !== atlasManager
          || rasterRequestIds.get(id) !== requestId
          || meshes.get(id) !== mesh
          || !layer
        ) return
        pendingRasterRequests.delete(id)
        applyRasterAtlasUv(object3d, layer, atlas)
        const previous = appliedRasterStates.get(id)
        if (previous?.atlas !== atlas) manager.retainAtlas(atlas)
        topMaterial.map = atlas.texture
        appliedRasterStates.set(id, { atlas, manager, requestedZoom })
        if (previous && previous.atlas !== atlas) previous.manager.releaseAtlas(previous.atlas)
        if (failedRasterIds.delete(id) && failedRasterIds.size === 0) options.onRasterError?.(null)
        updateMaterial(id)
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
        if (revision !== rebuildRevision || sourceRevision !== rasterSourceRevision
          || manager !== atlasManager || rasterRequestIds.get(id) !== requestId || meshes.get(id) !== mesh) return
        pendingRasterRequests.delete(id)
        topMaterial.map = null
        updateMaterial(id)
        const previous = appliedRasterStates.get(id)
        if (previous) previous.manager.releaseAtlas(previous.atlas)
        appliedRasterStates.delete(id)
        failedRasterIds.add(id)
        options.onRasterError?.('部分顶面贴图加载失败，已显示分区颜色；请检查底图网络与跨域配置')
        const warningKey = `${siteId}:${requestedZoom}:error`
        if (warnedRasterRequests.has(warningKey)) return
        warnedRasterRequests.add(warningKey)
        console.warn(`Unable to texture protected area ${siteId}`, error)
      })
  }

  function refreshRasterTextures() {
    if (flightActive) {
      if (performance.now() - lastFlightRasterRefresh < MAP_FLIGHT_CONFIG.rasterRefreshInterval) {
        scheduleRasterRefresh()
        return
      }
      lastFlightRasterRefresh = performance.now()
    }
    if (!mapInstance || !atlasManager || !rasterSource || !layer?.isVisible()) return
    const requestedZoom = rasterSource.getZoom()
    if (requestedZoom === null) {
      if (appliedRasterStates.size > 0 || pendingRasterRequests.size > 0 || failedRasterIds.size > 0) setRasterSource(rasterSource)
      return
    }
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
    const prioritizedFeatures = [...featureById.entries()].sort(([firstId], [secondId]) =>
      rasterPriority(secondId) - rasterPriority(firstId))
    prioritizedFeatures.forEach(([id, feature]) => {
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
    if (flightActive && detailTimer !== undefined) return
    clearTimeout(detailTimer)
    const delay = flightActive
      ? Math.max(0, MAP_FLIGHT_CONFIG.rasterRefreshInterval - (performance.now() - lastFlightRasterRefresh))
      : RASTER_TOP_CONFIG.debounce
    detailTimer = setTimeout(() => {
      detailTimer = undefined
      refreshRasterTextures()
    }, delay)
  }

  function createMesh(feature: ProtectAreaFeature) {
    if (!layer || !options.getVisibleTypes().includes(feature.properties.BHDLX)) return
    const id = feature.id
    const geometry = maptalks.GeoJSON.toGeometry(feature as any)
    if (!(geometry instanceof maptalks.Polygon) && !(geometry instanceof maptalks.MultiPolygon)) return
    const sideMaterial = new THREE.MeshPhongMaterial({
      color: AREA_TYPE_COLORS[feature.properties.BHDLX],
      shininess: EXTRUSION_CONFIG.shininess,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      visible: false,
    })
    const topMaterial = new THREE.MeshBasicMaterial({
      color: AREA_TYPE_COLORS[feature.properties.BHDLX],
      transparent: true,
      opacity: 0,
      depthWrite: false,
      visible: false,
      toneMapped: false,
    })
    const fillMaterial = new THREE.MeshBasicMaterial({
      color: AREA_TYPE_COLORS[feature.properties.BHDLX],
      transparent: true,
      opacity: EXTRUSION_CONFIG.fillOpacity,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
    })
    const outlineMaterial = new THREE.LineBasicMaterial({
      color: AREA_TYPE_COLORS[feature.properties.BHDLX],
      transparent: true,
      opacity: EXTRUSION_CONFIG.outlineOpacity,
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
      fillMaterial.dispose()
      outlineMaterial.dispose()
      return
    }
    const { outline } = configureExtrudedMaterials(
      object3d,
      topMaterial,
      sideMaterial,
      fillMaterial,
      AREA_TYPE_FILL_ORDER[feature.properties.BHDLX],
      outlineMaterial,
    )
    object3d.scale.z = EXTRUSION_CONFIG.flatScale
    mesh.setId(id).setProperties(feature.properties)
    mesh.on('mouseover', () => {
      if (!supportsHover || flightActive) return
      clearTimeout(hoverExitTimer)
      if (hoveredId === id) return
      const previous = hoveredId
      hoveredId = id
      if (previous) {
        if (previous !== selectedId) setMeshRaised(previous, false)
        updateMaterial(previous)
      }
      updateMaterial(id)
      if (id !== selectedId) setMeshRaised(id, true)
      refreshRasterTextures()
      options.container.value?.classList.add('is-picking')
      options.onHover(feature)
    })
    mesh.on('mouseout', () => {
      if (!supportsHover || flightActive) return
      clearTimeout(hoverExitTimer)
      hoverExitTimer = setTimeout(() => {
        if (hoveredId !== id) return
        hoveredId = null
        if (id !== selectedId) setMeshRaised(id, false)
        updateMaterial(id)
        options.container.value?.classList.remove('is-picking')
        options.onHover(null)
      }, EXTRUSION_CONFIG.hoverExitDelay)
    })
    mesh.on('click', () => setSelection(selectedId === id ? null : feature))
    featureById.set(id, feature)
    sideMaterials.set(id, sideMaterial)
    topMaterials.set(id, topMaterial)
    fillMaterials.set(id, fillMaterial)
    outlineMaterials.set(id, outlineMaterial)
    outlineLines.set(id, outline)
    meshes.set(id, mesh)
    layer.addMesh(mesh)
  }

  function disposeMeshes() {
    clearTimeout(hoverExitTimer)
    extrusionAnimations.forEach(animation => animation.kill())
    extrusionAnimations.clear()
    appliedRasterStates.forEach(({ atlas, manager }) => manager.releaseAtlas(atlas))
    meshes.forEach(mesh => {
      layer?.removeMesh(mesh)
      mesh.getObject3d().traverse(object => {
        if (object instanceof THREE.Mesh) object.geometry?.dispose()
      })
    })
    outlineLines.forEach(outline => outline.geometry.dispose())
    sideMaterials.forEach(material => material.dispose())
    topMaterials.forEach(material => material.dispose())
    fillMaterials.forEach(material => material.dispose())
    outlineMaterials.forEach(material => material.dispose())
    meshes.clear()
    sideMaterials.clear()
    topMaterials.clear()
    fillMaterials.clear()
    outlineMaterials.clear()
    outlineLines.clear()
    featureById.clear()
    rasterRequestIds.clear()
    pendingRasterRequests.clear()
    appliedRasterStates.clear()
    failedRasterIds.clear()
    if (rasterSource) options.onRasterError?.(null)
  }

  function rebuild() {
    if (!layer) return
    clearTimeout(rebuildTimer)
    const selectedFeature = selectedId ? featureById.get(selectedId) : null
    rebuildRevision += 1
    selectedId = null
    hoveredId = null
    options.container.value?.classList.remove('is-picking')
    options.onHover(null)
    disposeMeshes()
    PROTECT_AREAS.features.forEach(createMesh)
    setSelection(selectedFeature && options.getVisibleTypes().includes(selectedFeature.properties.BHDLX)
      ? selectedFeature
      : null, true)
    rebuildPending = false
    scheduleRasterRefresh()
    options.onMeshesReady?.()
  }

  function scheduleRebuild() {
    rebuildPending = true
    clearTimeout(rebuildTimer)
    rebuildTimer = setTimeout(rebuild, 120)
  }

  function createLayer(map: maptalks.Map) {
    mapInstance = map
    map.on('zoomend moveend pitchend rotateend', scheduleRasterRefresh)
    layer = new ThreeLayer(THREE_LAYER_CONFIG.id, THREE_LAYER_CONFIG)
    layer.prepareToDraw = (_gl, scene) => {
      const renderer = layer?.getThreeRenderer()
      const supportedAnisotropy = renderer?.capabilities.getMaxAnisotropy() ?? 1
      maxAnisotropy = Math.min(RASTER_TOP_CONFIG.maxAnisotropy, supportedAnisotropy)
      rasterReady = true
      initializeRasterManager()
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
    if (visible) {
      layer?.show()
      scheduleRasterRefresh()
      return
    }

    clearTimeout(hoverExitTimer)
    if (hoveredId) {
      const previous = hoveredId
      hoveredId = null
      setMeshRaised(previous, false, true)
      updateMaterial(previous)
      options.onHover(null)
    }
    options.container.value?.classList.remove('is-picking')
    setSelection(null, true)
    layer?.hide()
  }

  function clearHover() {
    clearTimeout(hoverExitTimer)
    const previous = hoveredId
    hoveredId = null
    if (previous) {
      if (previous !== selectedId) setMeshRaised(previous, false)
      updateMaterial(previous)
    }
    options.container.value?.classList.remove('is-picking')
    options.onHover(null)
  }

  function isSelectionReady() {
    return rasterReady && !rebuildPending
  }

  function setFlightActive(active: boolean) {
    flightActive = active
    clearTimeout(detailTimer)
    detailTimer = undefined
    if (active) {
      clearHover()
      lastFlightRasterRefresh = performance.now()
      scheduleRasterRefresh()
    }
  }

  function refreshRasterNow() {
    clearTimeout(detailTimer)
    detailTimer = undefined
    lastFlightRasterRefresh = -Infinity
    refreshRasterTextures()
  }

  function isSiteRasterReady(siteId: string) {
    if (!rasterSource || !layer?.isVisible()) return true
    if (!isSelectionReady()) return false
    const zoom = rasterSource.getZoom()
    if (zoom === null) return true
    return [...featureById.entries()]
      .filter(([id, feature]) => feature.properties.BHDBM === siteId && (!selectedId || id === selectedId))
      .every(([id]) => appliedRasterStates.get(id)?.requestedZoom === zoom || failedRasterIds.has(id))
  }

  function selectFeature(id: string) {
    if (!isSelectionReady() || !layer?.isVisible()) return false
    const feature = featureById.get(id)
    if (!feature) return false
    clearHover()
    if (selectedId !== id) setSelection(feature)
    return true
  }

  function getSelection() {
    return selectedId ? featureById.get(selectedId) ?? null : null
  }

  function clearSelection() {
    clearHover()
    setSelection(null)
  }

  function dispose() {
    clearTimeout(rebuildTimer)
    clearTimeout(detailTimer)
    clearTimeout(hoverExitTimer)
    flightActive = false
    detailTimer = undefined
    rebuildRevision += 1
    rasterSourceRevision += 1
    rasterReady = false
    mapInstance?.off('zoomend moveend pitchend rotateend', scheduleRasterRefresh)
    mapInstance = null
    options.container.value?.classList.remove('is-picking')
    disposeMeshes()
    atlasManager?.dispose()
    atlasManager = null
    rasterSource = null
    layer?.remove()
    layer = null
  }

  return { createLayer, identify, setVisible, setRasterSource, clearSelection, selectFeature, getSelection,
    isSelectionReady, scheduleRebuild, setFlightActive, refreshRaster: refreshRasterTextures,
    refreshRasterNow, isSiteRasterReady, dispose }
}

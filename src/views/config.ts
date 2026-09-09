import type { BaseMapConfig, ProtectAreaType } from './types/map'
import satellitePreview from '../assets/images/map1.png'
import streetsPreview from '../assets/images/map2.png'

export const BASE_MAPS: BaseMapConfig[] = [
  {
    id: 'satellite',
    name: '卫星影像',
    description: '高德 · 卫星影像',
    previewImage: satellitePreview,
    options: {
      urlTemplate: 'https://webst01.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
      attribution: '© 高德地图',
      crossOrigin: 'anonymous',
    },
  },
  {
    id: 'streets',
    name: '街道地图',
    description: 'OpenStreetMap · 道路与地名',
    previewImage: streetsPreview,
    options: {
      urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
      crossOrigin: 'anonymous',
      maxAvailableZoom: 19,
    },
  },
  {
    id: 'none',
    name: '无底图',
    description: '仅展示保护区图层',
    options: null,
  },
]

export const MAP_VIEW_CONFIG = {
  center: [108.32, 23.75] as [number, number],
  zoom: 7.05,
  pitch: 46,
  bearing: 0,
  minZoom: 4,
  maxZoom: 18,
  projection: 'EPSG:3857',
  resetDuration: 650,
  dimensionDuration: 520,
}

export const MAP_FLIGHT_CONFIG = {
  minDuration: 0.6,
  maxDuration: 2,
  sameSiteMaxDuration: 0.9,
  nearbyMinDuration: 0.9,
  nearbyMaxDuration: 1.3,
  farMinDuration: 1.3,
  farDistanceRatio: 1.25,
  maxPullback: 3.5,
  pullbackRatio: 0.4,
  centerEase: 'power2.inOut',
  pullbackEase: 'power2.out',
  approachEase: 'power2.inOut',
  centerTolerance: 1,
  zoomTolerance: 0.005,
  zoomOffset: -0.5,
  rasterRefreshInterval: 450,
}

export const EXTRUSION_CONFIG = {
  height: 80,
  shininess: 14,
  opacity: 0.88,
  flatScale: 0.001,
  fillOpacity: 0.6,
  fillInsetRatio: 0.0005,
  outlineOpacity: 0.92,
  outlineLiftRatio: 0.001,
  raiseDuration: 0.22,
  lowerDuration: 0.16,
  raiseEase: 'power3.out',
  lowerEase: 'power2.out',
  hoverExitDelay: 40,
}

export const RASTER_TOP_CONFIG = {
  debounce: 180,
  overscanRatio: 0.15,
  paddingPixels: 1,
  maxAtlasSize: 2048,
  maxConcurrentRequests: 8,
  requestTimeout: 15000,
  maxAnisotropy: 8,
  maxCachedAtlases: 32,
  maxCachedTexturePixels: 12 * 1024 * 1024,
  maxCachedImages: 256,
}

export const AREA_TYPE_STYLES: { type: ProtectAreaType; color: string }[] = [
  { type: '核心区', color: '#e35d3f' },
  { type: '缓冲区', color: '#56a68b' },
  { type: '抢救园', color: '#f2bd56' },
  { type: '试验区', color: '#6299cc' },
  { type: '实验区', color: '#8c78b8' },
]

export const AREA_TYPE_COLORS = Object.fromEntries(
  AREA_TYPE_STYLES.map(item => [item.type, item.color]),
) as Record<ProtectAreaType, string>

export const AREA_TYPE_FILL_ORDER: Record<ProtectAreaType, number> = {
  '缓冲区': -10,
  '核心区': -9,
  '试验区': -8,
  '实验区': -8,
  '抢救园': -7,
}

export const INTERACTION_COLORS = {
  rasterHoverTint: '#fff1d8',
}

export const THREE_LAYER_CONFIG = {
  id: 'protect-areas',
  forceRenderOnMoving: true,
  forceRenderOnRotating: true,
  forceRenderOnZooming: true,
  identifyCountOnEvent: 1,
}

export const LIGHT_CONFIG = {
  hemisphere: { skyColor: '#d7e8ff', groundColor: '#203a31', intensity: 2.5 },
  directional: { color: '#fff4df', intensity: 3.6, position: [0, -10, 16] as [number, number, number] },
}

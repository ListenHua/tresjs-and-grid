import type { BaseMapConfig, ProtectAreaType } from './types/map'

export const BASE_MAPS: BaseMapConfig[] = [
  {
    id: 'satellite',
    name: '卫星影像',
    description: 'Esri · 地表影像',
    options: {
      urlTemplate: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles © Esri',
      crossOrigin: 'anonymous',
    },
  },
  {
    id: 'streets',
    name: '街道地图',
    description: 'OpenStreetMap · 道路与地名',
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
  minZoom: 3,
  maxZoom: 19,
  projection: 'EPSG:3857',
  resetDuration: 650,
  dimensionDuration: 520,
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
  selected: '#c8ff8c',
  selectedEmissive: '#274b35',
  rasterHoverTint: '#fff1d8',
  rasterSelectedTint: '#e9ffdc',
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

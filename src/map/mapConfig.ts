import type { MapLoggerOptions } from '../hooks/useMapLogger'

export type TileSourceId = 'arcgis' | 'tianditu'

export interface TileSource {
  id: TileSourceId
  name: string
  url: string
  subdomains?: readonly string[]
  minZoom: number
  maxZoom: number
  attribution: string
}

const tiandituToken = import.meta.env.VITE_TIANDITU_TOKEN
  || '35fd5da95dbbef583f40a26838898642'

export const MAP_LOG_CONFIG: MapLoggerOptions = {
  enabled: true,
  level: import.meta.env.DEV ? 'debug' : 'info',
  maxRecords: 200,
}

export const MAP_CONFIG: Record<TileSourceId, TileSource> = {
  arcgis: {
    id: 'arcgis',
    name: 'ArcGIS World Imagery',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    minZoom: 2,
    maxZoom: 19,
    attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
  },
  tianditu: {
    id: 'tianditu',
    name: '天地图影像',
    url: `https://t{s}.tianditu.gov.cn/img_w/wmts?tk=${tiandituToken}&SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&STYLE=default&TILEMATRIXSET=w&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=tiles&LAYER=img`,
    subdomains: ['0', '1', '2', '3', '4', '5', '6', '7'],
    minZoom: 2,
    maxZoom: 18,
    attribution: '国家地理信息公共服务平台 天地图',
  },
}

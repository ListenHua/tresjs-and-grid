export type ProtectAreaType = '核心区' | '缓冲区' | '抢救园' | '试验区' | '实验区'

export interface ProtectAreaProperties {
  BHDLX: ProtectAreaType
  MJ: number
  BHDMC: string
  PXZQDM: number
  PXZQMC: string
  CXZQDM: string
  CXZQMC: string
  FXZQDM: string
  FXZQMC: string
  BHDBM: string
  BHDMC2: string
  WZMC: string
  LON: number
  LAT: number
  xmax: number
  xmin: number
  ymax: number
  ymin: number
}

export interface ProtectAreaFeature {
  type: 'Feature'
  properties: ProtectAreaProperties
  geometry: { type: 'MultiPolygon'; coordinates: number[][][][] }
}

export interface ProtectAreaCollection {
  type: 'FeatureCollection'
  name: string
  features: ProtectAreaFeature[]
}

export interface MapViewState {
  zoom: number
  pitch: number
  bearing: number
}

export type SceneCommand = 'zoom-in' | 'zoom-out' | 'reset' | 'toggle-dimension'

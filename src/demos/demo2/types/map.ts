export interface RegionDatum {
  id: string
  name: string
  category: '核心区' | '更新区' | '生态区'
  value: number
  height: number
  coordinates: number[][]
}

export interface MapViewState {
  zoom: number
  pitch: number
  bearing: number
}

export type SceneCommand = 'zoom-in' | 'zoom-out' | 'reset' | 'toggle-dimension'

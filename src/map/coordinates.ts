export const EARTH_RADIUS = 6378137
export const WEB_MERCATOR_LIMIT = 85.0511287798
export const WORLD_SIZE = 2 * Math.PI * EARTH_RADIUS

export interface Coordinate {
  lng: number
  lat: number
}

export interface MercatorCoordinate {
  x: number
  y: number
}

export interface TileCoordinate {
  x: number
  y: number
  z: number
}

export interface TileBounds {
  west: number
  east: number
  north: number
  south: number
}

export function clampLatitude(lat: number) {
  return Math.max(-WEB_MERCATOR_LIMIT, Math.min(WEB_MERCATOR_LIMIT, lat))
}

export function lngLatToMercator({ lng, lat }: Coordinate): MercatorCoordinate {
  const safeLat = clampLatitude(lat)
  return {
    x: EARTH_RADIUS * (lng * Math.PI / 180),
    y: EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + safeLat * Math.PI / 360)),
  }
}

export function mercatorToLngLat({ x, y }: MercatorCoordinate): Coordinate {
  return {
    lng: x / EARTH_RADIUS * 180 / Math.PI,
    lat: (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) * 180 / Math.PI,
  }
}

export function lngLatToTile({ lng, lat }: Coordinate, z: number): TileCoordinate {
  const scale = 2 ** z
  const safeLat = clampLatitude(lat) * Math.PI / 180
  return {
    x: Math.floor((lng + 180) / 360 * scale),
    y: Math.floor((1 - Math.asinh(Math.tan(safeLat)) / Math.PI) / 2 * scale),
    z,
  }
}

export function tileBounds(x: number, y: number, z: number): TileBounds {
  const tileSize = WORLD_SIZE / 2 ** z
  return {
    west: -WORLD_SIZE / 2 + x * tileSize,
    east: -WORLD_SIZE / 2 + (x + 1) * tileSize,
    north: WORLD_SIZE / 2 - y * tileSize,
    south: WORLD_SIZE / 2 - (y + 1) * tileSize,
  }
}

export function normalizeTileX(x: number, z: number) {
  const count = 2 ** z
  return ((x % count) + count) % count
}


import protectAreaJson from './protect_area.json'
import type { ProtectAreaCollection, ProtectAreaFeature } from '../types/map'
import type { GeographicExtent } from '../utils/RasterAtlasManager'

export interface ProtectAreaSite {
  id: string
  name: string
  species: string
  city: string
  district: string
  zones: ProtectAreaFeature[]
  extent: GeographicExtent
}

export const PROTECT_AREAS = {
  ...protectAreaJson,
  features: protectAreaJson.features.map((feature, index) => ({
    ...feature,
    id: `${feature.properties.BHDBM}-${feature.properties.BHDLX}-${index}`,
  })),
} as ProtectAreaCollection

export function getFeatureExtent(feature: ProtectAreaFeature): GeographicExtent {
  const extent = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity }
  feature.geometry.coordinates.forEach(polygon => polygon.forEach(ring => ring.forEach(([longitude, latitude]) => {
    extent.west = Math.min(extent.west, longitude)
    extent.south = Math.min(extent.south, latitude)
    extent.east = Math.max(extent.east, longitude)
    extent.north = Math.max(extent.north, latitude)
  })))
  return extent
}

const sitesById = new Map<string, ProtectAreaSite>()
PROTECT_AREAS.features.forEach(feature => {
  const properties = feature.properties
  const extent = getFeatureExtent(feature)
  const site = sitesById.get(properties.BHDBM)
  if (site) {
    site.zones.push(feature)
    site.extent.west = Math.min(site.extent.west, extent.west)
    site.extent.south = Math.min(site.extent.south, extent.south)
    site.extent.east = Math.max(site.extent.east, extent.east)
    site.extent.north = Math.max(site.extent.north, extent.north)
    return
  }
  sitesById.set(properties.BHDBM, {
    id: properties.BHDBM,
    name: properties.BHDMC,
    species: properties.WZMC,
    city: properties.CXZQMC,
    district: properties.FXZQMC,
    zones: [feature],
    extent,
  })
})

export const PROTECT_AREA_SITES = [...sitesById.values()]
export const SITE_BY_ID = sitesById
export const FEATURE_BY_ID = new Map(PROTECT_AREAS.features.map(feature => [feature.id, feature]))
export const SITE_EXTENTS = new Map(PROTECT_AREA_SITES.map(site => [site.id, site.extent]))

export function filterProtectAreaSites(sites: ProtectAreaSite[], query: string) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return sites.filter(site => {
    const text = [site.name, site.species, site.city, site.district, site.id].join(' ').toLocaleLowerCase()
    return terms.every(term => text.includes(term))
  })
}

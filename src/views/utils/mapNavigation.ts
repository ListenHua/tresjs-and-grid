import { Extent, Point } from 'maptalks'
import type { Map as MapInstance } from 'maptalks'
import { MAP_FLIGHT_CONFIG } from '../config'

export interface FocusPadding {
  paddingLeft: number
  paddingRight: number
  paddingTop: number
  paddingBottom: number
}

export interface MapOverlayBounds {
  kind: string
  left: number
  top: number
  right: number
  bottom: number
}

export function getFocusView(map: MapInstance, extent: Extent, padding: FocusPadding) {
  const zoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(),
    map.getFitZoom(extent, true, padding) + MAP_FLIGHT_CONFIG.zoomOffset))
  const projectedExtent = extent.convertTo(coordinate => map.coordToPoint(coordinate, zoom))
  const center = projectedExtent.getCenter()
  const size = map.getSize()
  const viewportCenter = new Point(size.width / 2, size.height / 2)
  const paddedCenter = new Point(
    (size.width + padding.paddingLeft - padding.paddingRight) / 2,
    (size.height + padding.paddingTop - padding.paddingBottom) / 2,
  )
  const origin = map.coordToPoint(map.containerPointToCoord(viewportCenter))
  const offset = map.coordToPoint(map.containerPointToCoord(paddedCenter))
  return {
    center: map.pointToCoord(new Point(center.x + origin.x - offset.x, center.y + origin.y - offset.y), zoom),
    zoom,
  }
}

export function getFocusPadding(width: number, height: number, overlays: MapOverlayBounds[], pitch: number): FocusPadding {
  let paddingLeft = 24
  let paddingRight = 72
  let paddingTop = pitch > 10 ? 80 : 32
  let paddingBottom = 32
  for (const overlay of overlays) {
    if (width > 900) {
      if (overlay.kind === 'list' || overlay.kind === 'legend') paddingLeft = Math.max(paddingLeft, overlay.right + 20)
      if (overlay.kind === 'details') paddingRight = Math.max(paddingRight, width - overlay.left + 20)
    } else {
      if (overlay.kind === 'list') paddingTop = Math.max(paddingTop, overlay.bottom + 20)
      if (overlay.kind === 'legend' || overlay.kind === 'details') paddingBottom = Math.max(paddingBottom, height - overlay.top + 20)
    }
  }
  const horizontalScale = Math.min(1, Math.max(0, width - Math.min(160, width * 0.6)) / (paddingLeft + paddingRight))
  const verticalScale = Math.min(1, Math.max(0, height - Math.min(120, height * 0.6)) / (paddingTop + paddingBottom))
  return {
    paddingLeft: paddingLeft * horizontalScale,
    paddingRight: paddingRight * horizontalScale,
    paddingTop: paddingTop * verticalScale,
    paddingBottom: paddingBottom * verticalScale,
  }
}

<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useTresContext } from '@tresjs/core'
import { Group, PerspectiveCamera, Vector3, WebGLRenderer } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { lngLatToMercator, mercatorToLngLat } from '../map/coordinates'
import { TileManager } from '../map/TileManager'
import type { TileStats } from '../map/TileManager'
import { MAP_CONFIG, MAP_LOG_CONFIG } from '../map/mapConfig'
import type { TileSourceId } from '../map/mapConfig'
import { useMapLogger } from '../hooks/useMapLogger'

const props = defineProps<{
  source: TileSourceId
  opacity: number
  command: { id: number; type: 'zoom-in' | 'zoom-out' | 'reset' }
}>()

const emit = defineEmits<{
  stats: [value: TileStats]
  position: [value: { lng: number; lat: number }]
}>()

const DEFAULT_CENTER = { lng: 116.3913, lat: 39.9075 }
const DEFAULT_CAMERA = new Vector3(0, 5200, 5200)
const origin = lngLatToMercator(DEFAULT_CENTER)
const target = new Vector3()
const group = new Group()
const { scene, camera, renderer } = useTresContext()
const { createLogger } = useMapLogger(MAP_LOG_CONFIG)
const logger = createLogger('MapTileLayer')
let controls: OrbitControls | undefined
let manager: TileManager | undefined
let lastViewLogAt = 0

function reportPosition() {
  emit('position', mercatorToLngLat({
    x: origin.x + target.x,
    y: origin.y - target.z,
  }))
}

function refresh() {
  manager?.update(target)
  reportPosition()

  const now = performance.now()
  if (now - lastViewLogAt < 300) return
  lastViewLogAt = now

  const activeCamera = camera.activeCamera.value
  if (!(activeCamera instanceof PerspectiveCamera)) return
  const center = mercatorToLngLat({
    x: origin.x + target.x,
    y: origin.y - target.z,
  })
  logger.debug('map.view.change', '地图视角发生变化', {
    center: {
      lng: Number(center.lng.toFixed(6)),
      lat: Number(center.lat.toFixed(6)),
    },
    camera: {
      x: Math.round(activeCamera.position.x),
      y: Math.round(activeCamera.position.y),
      z: Math.round(activeCamera.position.z),
    },
    distance: Math.round(activeCamera.position.distanceTo(target)),
    zoom: manager?.zoom,
  })
}

function executeCommand(type: typeof props.command.type) {
  const activeCamera = camera.activeCamera.value
  if (!(activeCamera instanceof PerspectiveCamera) || !controls) return
  if (type === 'reset') {
    target.set(0, 0, 0)
    activeCamera.position.copy(DEFAULT_CAMERA)
  } else {
    const factor = type === 'zoom-in' ? 0.68 : 1.45
    activeCamera.position.sub(target).multiplyScalar(factor).add(target)
  }
  controls.target.copy(target)
  controls.update()
  manager?.update(target, true)
  logger.info('map.command', '执行地图视角命令', { type })
}

onMounted(() => {
  const activeCamera = camera.activeCamera.value
  const activeRenderer = renderer.instance
  if (!(activeCamera instanceof PerspectiveCamera) || !(activeRenderer instanceof WebGLRenderer)) return

  logger.info('map.initialize', '初始化地图瓦片层', {
    center: DEFAULT_CENTER,
    source: props.source,
  })

  scene.value.add(group)
  controls = new OrbitControls(activeCamera, activeRenderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.screenSpacePanning = false
  controls.minDistance = 180
  controls.maxDistance = 150000
  controls.maxPolarAngle = Math.PI * 0.47
  controls.target.copy(target)
  controls.addEventListener('change', refresh)
  controls.update()

  manager = new TileManager({
    group,
    camera: activeCamera,
    origin,
    source: MAP_CONFIG[props.source],
    opacity: props.opacity,
    logger: createLogger('TileManager'),
    onStats: stats => emit('stats', stats),
  })
  manager.update(target, true)
  reportPosition()
})

watch(() => props.source, value => manager?.setSource(MAP_CONFIG[value], target))
watch(() => props.opacity, value => manager?.setOpacity(value))
watch(() => props.command.id, () => executeCommand(props.command.type))

onBeforeUnmount(() => {
  controls?.removeEventListener('change', refresh)
  controls?.dispose()
  manager?.dispose()
  scene.value.remove(group)
})
</script>

<template></template>

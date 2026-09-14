<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { PIXEL_FOG_CONFIG } from '../config'

const container = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
let context: CanvasRenderingContext2D | null = null
let observer: ResizeObserver | null = null
let cells: FogCell[] = []
let coverage = 0
let reducedMotion: MediaQueryList | null = null

interface FogCell { threshold: number; tone: number }

function hash(x: number, y: number) {
  const value = Math.sin(x * 127.1 + y * 311.7 + 19.3) * 43758.5453
  return value - Math.floor(value)
}

function noise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y)
  const fx = x - ix, fy = y - iy
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy)
  const top = hash(ix, iy) * (1 - sx) + hash(ix + 1, iy) * sx
  const bottom = hash(ix, iy + 1) * (1 - sx) + hash(ix + 1, iy + 1) * sx
  return top * (1 - sy) + bottom * sy
}

function createFogCells(columns: number, rows: number): FogCell[] {
  return Array.from({ length: columns * rows }, (_, index) => {
    const x = index % columns, y = Math.floor(index / columns)
    const cloud = noise(x / 13, y / 10) * 0.7 + noise(x / 5, y / 4) * 0.3
    const edgeDistance = Math.min((x + 0.5) / columns, 1 - (x + 0.5) / columns) * 2
    return {
      threshold: Math.max(0.04, Math.min(0.88, 0.08 + edgeDistance * 0.66 + (cloud - 0.5) * 0.26)),
      tone: Math.min(3, Math.floor(cloud * 4)),
    }
  })
}

function getFogAlpha(threshold: number, coverage: number) {
  // Four opacity steps keep the fringe pixelated; endpoints are exact.
  return Math.ceil(Math.max(0, Math.min(1, (coverage - threshold) / 0.1)) * 4) / 4
}

function draw() {
  const element = container.value, surface = canvas.value
  if (!element || !surface) return
  element.style.visibility = coverage > 0 ? 'visible' : 'hidden'
  const fade = reducedMotion?.matches || !context
  element.style.opacity = fade ? String(coverage) : '1'
  element.style.backgroundColor = fade ? PIXEL_FOG_CONFIG.palette[2] : 'transparent'
  surface.style.visibility = fade ? 'hidden' : 'inherit'
  if (!context || !coverage || fade) return
  context.clearRect(0, 0, surface.width, surface.height)
  cells.forEach((cell, index) => {
    const alpha = getFogAlpha(cell.threshold, coverage)
    if (!alpha) return
    context!.globalAlpha = alpha
    context!.fillStyle = PIXEL_FOG_CONFIG.palette[cell.tone]!
    context!.fillRect(index % surface.width, Math.floor(index / surface.width), 1, 1)
  })
  context.globalAlpha = 1
}

function resize() {
  if (!container.value || !canvas.value) return
  const { width, height } = container.value.getBoundingClientRect()
  const size = Math.max(1, PIXEL_FOG_CONFIG.cellSize)
  canvas.value.width = Math.max(1, Math.ceil(width / size))
  canvas.value.height = Math.max(1, Math.ceil(height / size))
  canvas.value.style.width = `${canvas.value.width * size}px`
  canvas.value.style.height = `${canvas.value.height * size}px`
  cells = createFogCells(canvas.value.width, canvas.value.height)
  draw()
}

function setCoverage(value: number) {
  const next = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
  if (coverage === next) return
  coverage = next
  draw()
}

onMounted(() => {
  context = canvas.value?.getContext('2d') ?? null
  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  reducedMotion.addEventListener('change', draw)
  observer = new ResizeObserver(resize)
  if (container.value) observer.observe(container.value)
  resize()
})

onBeforeUnmount(() => {
  observer?.disconnect()
  reducedMotion?.removeEventListener('change', draw)
  cells = []
  context = null
})

defineExpose({ setCoverage, isReady: () => Boolean(container.value) })
</script>

<template>
  <div ref="container" class="pixel-map-fog" aria-hidden="true"><canvas ref="canvas" /></div>
</template>

<style scoped>
.pixel-map-fog { position:absolute;inset:0;z-index:2;overflow:hidden;visibility:hidden;pointer-events:none;contain:strict }
canvas { display:block;image-rendering:pixelated }
</style>

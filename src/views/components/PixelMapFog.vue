<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { PIXEL_FOG_CONFIG } from '../config'
import { createFogCells, getFogAlpha } from '../utils/pixelFog'
import type { FogCell } from '../utils/pixelFog'

const container = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
let context: CanvasRenderingContext2D | null = null
let observer: ResizeObserver | null = null
let cells: FogCell[] = []
let coverage = 0
let reducedMotion: MediaQueryList | null = null

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

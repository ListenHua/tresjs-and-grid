<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { Box, Check, Grid2X2, Layers3, LocateFixed, Map, Minus, Plus } from '@lucide/vue'
import { MAP_VIEW_CONFIG } from '../config'
import type { BaseMapConfig, MapRenderMode, MapViewState, SceneCommand } from '../types/map'

const props = defineProps<{
  view: MapViewState
  baseMaps: BaseMapConfig[]
  baseMapId: string
  renderMode: MapRenderMode
  modeLoading: boolean
}>()
const emit = defineEmits<{
  command: [type: SceneCommand]
  'update:baseMapId': [id: string]
  'update:renderMode': [mode: MapRenderMode]
}>()
const is3d = computed(() => props.view.pitch > 10)
const activeBaseMap = computed(() => props.baseMaps.find(item => item.id === props.baseMapId))
const baseMapControl = ref<HTMLElement | null>(null)
const baseMapButton = ref<HTMLButtonElement | null>(null)
const baseMapPanel = ref<HTMLElement | null>(null)
const baseMapMenuOpen = ref(false)
const baseMapPanelId = useId()
const failedPreviews = ref(new Set<string>())

function markPreviewFailed(source?: string) {
  if (source) failedPreviews.value.add(source)
}

async function toggleBaseMaps() {
  if (props.renderMode === 'pixel') return
  baseMapMenuOpen.value = !baseMapMenuOpen.value
  if (!baseMapMenuOpen.value) return
  await nextTick()
  const selectedButton = baseMapPanel.value?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
    ?? baseMapPanel.value?.querySelector<HTMLButtonElement>('button')
  selectedButton?.focus()
}

function closeBaseMaps() {
  baseMapMenuOpen.value = false
  baseMapButton.value?.focus()
}

function selectBaseMap(id: string) {
  if (id !== props.baseMapId) emit('update:baseMapId', id)
  closeBaseMaps()
}

function closeOnOutsideClick(event: PointerEvent) {
  if (event.target instanceof Node && !baseMapControl.value?.contains(event.target)) {
    baseMapMenuOpen.value = false
  }
}

function closeOnFocusOut(event: FocusEvent) {
  if (!(event.relatedTarget instanceof Node) || !baseMapControl.value?.contains(event.relatedTarget)) {
    baseMapMenuOpen.value = false
  }
}

onMounted(() => document.addEventListener('pointerdown', closeOnOutsideClick))
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeOnOutsideClick))
watch(() => props.renderMode, () => { baseMapMenuOpen.value = false })
</script>

<template>
  <nav class="map-controls" aria-label="地图导航工具">
    <button type="button" title="放大" aria-label="放大" :disabled="view.zoom >= MAP_VIEW_CONFIG.maxZoom"
      @click="emit('command', 'zoom-in')"><Plus :size="19" /></button>
    <button type="button" title="缩小" aria-label="缩小" :disabled="view.zoom <= MAP_VIEW_CONFIG.minZoom"
      @click="emit('command', 'zoom-out')"><Minus :size="19" /></button>
    <button type="button" title="定位至初始范围" aria-label="定位至初始范围"
      @click="emit('command', 'reset')"><LocateFixed :size="18" /></button>
    <button class="dimension-trigger" type="button" :title="is3d ? '切换至二维视角' : '切换至三维视角'"
      :aria-label="is3d ? '切换至二维视角' : '切换至三维视角'"
      @click="emit('command', is3d ? 'set-2d' : 'set-3d')">
      <Box v-if="is3d" :size="19" /><Map v-else :size="19" />
    </button>
    <div ref="baseMapControl" class="base-map-control" @keydown.esc.stop.prevent="closeBaseMaps" @focusout="closeOnFocusOut">
      <button ref="baseMapButton" class="base-map-trigger" type="button" :title="renderMode === 'pixel' ? '常规模式下可切换底图' : '切换底图'"
        :aria-label="`切换底图，当前${activeBaseMap?.name ?? '无底图'}`" :aria-expanded="baseMapMenuOpen"
        :aria-controls="baseMapPanelId" aria-haspopup="dialog" :disabled="baseMaps.length === 0 || renderMode === 'pixel'"
        @click="toggleBaseMaps"><Layers3 :size="19" /></button>
      <div v-if="baseMapMenuOpen" :id="baseMapPanelId" ref="baseMapPanel" class="base-map-panel" role="dialog" aria-label="选择底图">
        <div class="base-map-options">
          <button v-for="item in baseMaps" :key="item.id" class="base-map-option" type="button"
            :aria-label="item.name" :aria-pressed="item.id === baseMapId" @click="selectBaseMap(item.id)">
            <img v-if="item.previewImage && !failedPreviews.has(item.previewImage)" class="base-map-preview"
              :src="item.previewImage" alt="" aria-hidden="true" draggable="false" @error="markPreviewFailed(item.previewImage)" />
            <span v-if="item.id === baseMapId" class="base-map-selected" aria-hidden="true"><Check :size="10" :stroke-width="3" /></span>
          </button>
        </div>
      </div>
    </div>
    <button class="pixel-trigger" type="button" :aria-pressed="renderMode === 'pixel'" :aria-busy="modeLoading"
      :title="modeLoading ? '正在切换地图模式，点击可取消' : renderMode === 'pixel' ? '切换至常规地图' : '切换至像素地图'"
      :aria-label="renderMode === 'pixel' ? '切换至常规地图' : '切换至像素地图'"
      @click="emit('update:renderMode', renderMode === 'pixel' ? 'standard' : 'pixel')"><Grid2X2 :size="18" /></button>
  </nav>
</template>

<style scoped>
.map-controls { position:absolute;top:20px;right:20px;z-index:3;display:flex;flex-direction:column;width:44px;border:1px solid rgba(242,240,233,.18);background:rgba(16,27,24,.92);box-shadow:0 8px 24px rgba(0,0,0,.2);backdrop-filter:blur(14px) }
.map-controls > button,.base-map-trigger { display:grid;place-items:center;width:42px;height:43px;padding:0;border:0;color:var(--paper);background:transparent;cursor:pointer;transition:color 150ms ease,background 150ms ease }
.map-controls > button + button { border-top:1px solid rgba(242,240,233,.12) }
.map-controls > button:disabled,.base-map-trigger:disabled { opacity:.3;cursor:not-allowed }
.base-map-control { position:relative;border-top:1px solid rgba(242,240,233,.12) }
.map-controls > .pixel-trigger { border-top:1px solid rgba(242,240,233,.12) }
.pixel-trigger[aria-pressed="true"] { color:var(--mint);background:rgba(185,242,124,.12) }
.pixel-trigger[aria-busy="true"] svg { animation:pixel-pulse 1s ease-in-out infinite alternate }
@keyframes pixel-pulse { to { opacity:.35 } }
.base-map-trigger[aria-expanded="true"] { color:var(--mint);background:rgba(185,242,124,.08) }
.base-map-panel { position:absolute;right:calc(100% + 12px);top:50%;display:flex;flex-direction:column;box-sizing:border-box;width:max-content;max-width:calc(100vw - 92px);max-height:min(360px,calc(100dvh - 48px));border:1px solid rgba(242,240,233,.18);background:rgba(16,27,24,.97);box-shadow:0 10px 30px rgba(0,0,0,.25);transform:translateY(-50%) }
.base-map-options { display:grid;grid-template-columns:40px;grid-auto-rows:40px;gap:8px;min-height:0;overflow-y:auto;padding:8px;overscroll-behavior:contain;scrollbar-width:thin }
.base-map-option { position:relative;box-sizing:border-box;width:40px;height:40px;overflow:hidden;padding:0;border:2px solid rgba(242,240,233,.18);border-radius:3px;background:#243830;cursor:pointer;transition:border-color 150ms ease }
.base-map-preview { display:block;width:100%;height:100%;object-fit:cover }
.base-map-option[aria-pressed="true"] { border-color:var(--mint) }
.base-map-selected { position:absolute;right:2px;bottom:2px;display:grid;place-items:center;width:14px;height:14px;border-radius:50%;color:var(--ink);background:var(--mint);box-shadow:0 1px 5px rgba(0,0,0,.3) }
button:focus-visible { outline:2px solid var(--mint);outline-offset:2px }
@media (hover:hover) { .map-controls > button:not(:disabled):hover,.base-map-trigger:not(:disabled):hover { color:var(--mint);background:rgba(185,242,124,.1) }.base-map-option:not([aria-pressed="true"]):hover { border-color:rgba(185,242,124,.65) } }
@media (max-width:700px) { .map-controls { top:12px;right:12px } }
@media (max-height:480px) { .base-map-panel { top:auto;bottom:0;max-height:210px;transform:none } }
@media (prefers-reduced-motion:reduce) { .map-controls > button,.base-map-trigger,.base-map-option { transition:none } }
@media (prefers-reduced-motion:reduce) { .pixel-trigger[aria-busy="true"] svg { animation:none } }
</style>

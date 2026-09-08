<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { Box, Check, Layers3, LocateFixed, Map, Minus, Plus } from '@lucide/vue'
import { MAP_VIEW_CONFIG } from '../config'
import type { BaseMapConfig, MapViewState, SceneCommand } from '../types/map'

const props = defineProps<{
  view: MapViewState
  baseMaps: BaseMapConfig[]
  baseMapId: string
}>()
const emit = defineEmits<{
  command: [type: SceneCommand]
  'update:baseMapId': [id: string]
}>()
const is3d = computed(() => props.view.pitch > 10)
const activeBaseMap = computed(() => props.baseMaps.find(item => item.id === props.baseMapId))
const baseMapControl = ref<HTMLElement | null>(null)
const baseMapButton = ref<HTMLButtonElement | null>(null)
const baseMapPanel = ref<HTMLElement | null>(null)
const baseMapMenuOpen = ref(false)
const baseMapPanelId = useId()

async function toggleBaseMaps() {
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
      <button ref="baseMapButton" class="base-map-trigger" type="button" title="切换底图"
        :aria-label="`切换底图，当前${activeBaseMap?.name ?? '无底图'}`" :aria-expanded="baseMapMenuOpen"
        :aria-controls="baseMapPanelId" aria-haspopup="dialog" :disabled="baseMaps.length === 0"
        @click="toggleBaseMaps"><Layers3 :size="19" /></button>
      <div v-if="baseMapMenuOpen" :id="baseMapPanelId" ref="baseMapPanel" class="base-map-panel" role="dialog" aria-label="选择底图">
        <div class="base-map-heading"><span>选择底图</span><small>{{ baseMaps.length }} 种底图</small></div>
        <div class="base-map-options">
          <button v-for="item in baseMaps" :key="item.id" class="base-map-option" type="button"
            :aria-pressed="item.id === baseMapId" @click="selectBaseMap(item.id)">
            <Map :size="18" />
            <span><b>{{ item.name }}</b><small v-if="item.description">{{ item.description }}</small></span>
            <Check v-if="item.id === baseMapId" :size="15" />
          </button>
        </div>
      </div>
    </div>
  </nav>
</template>

<style scoped>
.map-controls { position:absolute;top:20px;right:20px;z-index:3;display:flex;flex-direction:column;width:44px;border:1px solid rgba(242,240,233,.18);background:rgba(16,27,24,.92);box-shadow:0 8px 24px rgba(0,0,0,.2);backdrop-filter:blur(14px) }
.map-controls > button,.base-map-trigger { display:grid;place-items:center;width:42px;height:43px;padding:0;border:0;color:var(--paper);background:transparent;cursor:pointer;transition:color 150ms ease,background 150ms ease }
.map-controls > button + button { border-top:1px solid rgba(242,240,233,.12) }
.map-controls > button:disabled,.base-map-trigger:disabled { opacity:.3;cursor:not-allowed }
.base-map-control { position:relative;border-top:1px solid rgba(242,240,233,.12) }
.base-map-trigger[aria-expanded="true"] { color:var(--mint);background:rgba(185,242,124,.08) }
.base-map-panel { position:absolute;right:calc(100% + 12px);top:50%;display:flex;flex-direction:column;width:248px;max-width:calc(100vw - 92px);max-height:min(360px,calc(100dvh - 48px));border:1px solid rgba(242,240,233,.18);background:rgba(16,27,24,.97);box-shadow:0 10px 30px rgba(0,0,0,.25);transform:translateY(-50%) }
.base-map-heading { display:flex;flex-shrink:0;align-items:center;justify-content:space-between;gap:12px;padding:13px 14px;border-bottom:1px solid rgba(242,240,233,.1);font-size:12px;font-weight:600 }
.base-map-heading small { color:#8b9b95;font-size:10px;font-weight:400 }
.base-map-options { display:grid;gap:5px;min-height:0;overflow-y:auto;padding:8px;overscroll-behavior:contain;scrollbar-width:thin }
.base-map-option { display:grid;grid-template-columns:18px minmax(0,1fr) 15px;align-items:center;gap:10px;width:100%;min-height:56px;padding:10px;border:1px solid transparent;border-radius:2px;color:var(--paper);text-align:left;background:transparent;cursor:pointer }
.base-map-option > svg:first-child { color:#94a49c }
.base-map-option b { display:block;font-size:12px;font-weight:500;overflow-wrap:anywhere }
.base-map-option small { display:block;margin-top:5px;color:#8b9b95;font-size:10px;line-height:1.4;overflow-wrap:anywhere }
.base-map-option[aria-pressed="true"] { border-color:rgba(185,242,124,.28);color:var(--mint);background:rgba(185,242,124,.08) }
.base-map-option[aria-pressed="true"] > svg { color:var(--mint) }
button:focus-visible { outline:2px solid var(--mint);outline-offset:2px }
@media (hover:hover) { .map-controls > button:not(:disabled):hover,.base-map-trigger:not(:disabled):hover,.base-map-option:hover { color:var(--mint);background:rgba(185,242,124,.1) } }
@media (max-width:700px) { .map-controls { top:12px;right:12px } }
@media (max-height:480px) { .base-map-panel { top:auto;bottom:0;max-height:210px;transform:none } }
@media (prefers-reduced-motion:reduce) { .map-controls > button,.base-map-trigger { transition:none } }
</style>

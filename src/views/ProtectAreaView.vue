<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import MapControls from './components/MapControls.vue'
import MapScene from './components/MapScene.vue'
import SceneLegend from './components/SceneLegend.vue'
import type { MapViewState, ProtectAreaFeature, ProtectAreaType, SceneCommand } from './types/map'
import { AREA_TYPE_COLORS, AREA_TYPE_STYLES, BASE_MAPS, MAP_VIEW_CONFIG } from './config'

const status = ref<'loading' | 'ready' | 'error'>('loading')
const statusMessage = ref('正在构建空间场景')
const rasterError = ref<string | null>(null)
const selected = ref<ProtectAreaFeature | null>(null)
const hovered = ref<ProtectAreaFeature | null>(null)
const regionsVisible = ref(true)
const baseMapId = ref(BASE_MAPS[0]?.id ?? '')
const activeBaseMap = computed(() => BASE_MAPS.find(item => item.id === baseMapId.value) ?? null)
const visibleTypes = ref<ProtectAreaType[]>(AREA_TYPE_STYLES.map(item => item.type))
const command = reactive({ id: 0, type: 'reset' as SceneCommand })
const view = reactive<MapViewState>({
  zoom: MAP_VIEW_CONFIG.zoom,
  pitch: MAP_VIEW_CONFIG.pitch,
  bearing: MAP_VIEW_CONFIG.bearing,
})
const activeArea = computed(() => regionsVisible.value ? selected.value ?? hovered.value : null)

function runCommand(type: SceneCommand) { command.type = type; command.id += 1 }
function setReady() { status.value = 'ready'; statusMessage.value = '' }
function setError(message: string) { status.value = 'error'; statusMessage.value = message }
function toggleType(type: ProtectAreaType) {
  visibleTypes.value = visibleTypes.value.includes(type)
    ? visibleTypes.value.filter(item => item !== type)
    : [...visibleTypes.value, type]
}
</script>

<template>
  <main class="planning-workspace">
    <MapScene :command="command" :regions-visible="regionsVisible" :base-map="activeBaseMap" :visible-types="visibleTypes"
      @ready="setReady" @error="setError" @raster-error="rasterError = $event"
      @hover="hovered = $event" @select="selected = $event" @view="Object.assign(view, $event)" />
    <div class="map-shade" aria-hidden="true"></div>

    <SceneLegend v-model:regions-visible="regionsVisible"
      :visible-types="visibleTypes" :status="rasterError && status === 'ready' ? 'error' : status"
      :status-message="status === 'ready' && rasterError ? rasterError : statusMessage" @toggle-type="toggleType" />

    <section v-if="activeArea" class="region-card" aria-label="功能区信息" aria-live="polite">
      <div class="region-heading">
        <span>{{ activeArea.properties.BHDBM }}</span>
        <em><i :style="{ background: AREA_TYPE_COLORS[activeArea.properties.BHDLX] }"></i>{{ activeArea.properties.BHDLX }}</em>
      </div>
      <h2>{{ activeArea.properties.BHDMC }}</h2>
      <dl>
        <div><dt>保护物种</dt><dd class="text-value">{{ activeArea.properties.WZMC }}</dd></div>
        <div><dt>面积</dt><dd>{{ activeArea.properties.MJ }}<small>亩</small></dd></div>
        <div><dt>所属城市</dt><dd class="text-value">{{ activeArea.properties.CXZQMC }}</dd></div>
        <div><dt>区县</dt><dd class="text-value">{{ activeArea.properties.FXZQMC }}</dd></div>
      </dl>
      <p :class="{ locked: !!selected }">{{ selected ? '已锁定分区 · 点击空白处取消' : '点击分区锁定详情与地形' }}</p>
    </section>

    <MapControls v-model:base-map-id="baseMapId" :view="view" :base-maps="BASE_MAPS" @command="runCommand" />
  </main>
</template>

<style scoped>
.planning-workspace { --ink:#14201d;--paper:#f2f0e9;--coral:#e35d3f;--mint:#b9f27c;position:relative;width:100%;height:100%;overflow:hidden;color:var(--paper);background:var(--ink) }
.map-shade { position:absolute;inset:0;z-index:1;pointer-events:none;background:linear-gradient(0deg,rgba(9,16,14,.36),transparent 25%) }
.region-card { position:absolute;right:24px;bottom:24px;z-index:2;width:286px;max-height:calc(100dvh - 284px);overflow-y:auto;padding:18px;color:var(--ink);background:rgba(242,240,233,.96);border-top:3px solid var(--coral);box-shadow:5px 5px 0 rgba(227,93,63,.65);backdrop-filter:blur(12px) }
.region-heading { display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;color:var(--coral);font:700 10px/1.3 monospace }
.region-heading em { display:flex;align-items:center;gap:5px;padding:4px 6px;color:#38584d;background:#d9e3dc;font-style:normal }
.region-heading i { width:6px;height:6px }
.region-card h2 { margin:12px 0 15px;font-family:"Noto Serif SC","Songti SC",serif;font-size:18px;line-height:1.5;font-weight:600;overflow-wrap:anywhere }
.region-card dl { display:grid;grid-template-columns:1fr 1fr;gap:12px 8px;margin:0;padding-top:12px;border-top:1px solid #c6ccc8 }
.region-card dl div { min-width:0 }
.region-card dt { color:#63716a;font-size:10px }
.region-card dd { margin:5px 0 0;font:600 18px/1.2 monospace }
.region-card dd.text-value { font-family:"Noto Sans SC","Microsoft YaHei",sans-serif;font-size:12px;line-height:1.5;overflow-wrap:anywhere }
.region-card dd small { margin-left:4px;font-size:10px }
.region-card p { margin:15px 0 0;padding-top:10px;border-top:1px solid #d4d9d3;color:#63716a;font-size:10px;line-height:1.5 }
.region-card p.locked { color:#38584d }
@media (max-width:700px) { .region-card { right:16px;bottom:16px;width:min(286px,calc(100% - 236px));padding:14px }.region-card h2 { font-size:16px } }
@media (max-width:480px) { .region-card { width:calc(100% - 188px);padding:12px;max-height:calc(100dvh - 266px) }.region-heading { font-size:9px }.region-card h2 { margin:10px 0;font-size:14px }.region-card dl { grid-template-columns:1fr;gap:9px }.region-card dd { font-size:16px }.region-card dd.text-value { font-size:11px }.region-card p { font-size:9px } }
</style>

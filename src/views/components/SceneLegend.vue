<script setup lang="ts">
import { ref } from 'vue'
import { Check, ChevronDown, Eye, EyeOff, Layers3 } from '@lucide/vue'
import { AREA_TYPE_STYLES } from '../config'
import type { ProtectAreaType } from '../types/map'

defineProps<{
  regionsVisible: boolean
  visibleTypes: ProtectAreaType[]
  status: 'loading' | 'ready' | 'error'
  statusMessage: string
}>()
const emit = defineEmits<{
  'update:regionsVisible': [visible: boolean]
  'toggle-type': [type: ProtectAreaType]
}>()
const expanded = ref(true)
</script>

<template>
  <aside class="scene-legend" aria-label="场景图例">
    <button class="legend-heading" type="button" :aria-expanded="expanded" aria-controls="scene-legend-content"
      @click="expanded = !expanded">
      <Layers3 :size="16" /><span>场景图例</span><ChevronDown :size="15" :class="{ collapsed: !expanded }" />
    </button>
    <div v-show="expanded" id="scene-legend-content" class="legend-content">
      <button class="layer-row" type="button" role="switch" :aria-checked="regionsVisible" aria-label="原生境保护区"
        @click="emit('update:regionsVisible', !regionsVisible)">
        <i class="layer-swatch"></i><span>原生境保护区</span>
        <Eye v-if="regionsVisible" :size="15" /><EyeOff v-else :size="15" />
      </button>
      <div class="area-types" role="group" aria-label="功能区图例开关">
        <button v-for="item in AREA_TYPE_STYLES" :key="item.type" type="button" role="switch"
          :aria-label="item.type" :aria-checked="regionsVisible && visibleTypes.includes(item.type)" :disabled="!regionsVisible"
          @click="emit('toggle-type', item.type)">
          <i :style="{ background: item.color }"></i><span>{{ item.type }}</span>
          <Check v-if="regionsVisible && visibleTypes.includes(item.type)" :size="12" />
        </button>
      </div>
      <p v-if="status !== 'ready'" class="scene-state" :class="status" role="status"><i></i>{{ statusMessage }}</p>
    </div>
  </aside>
</template>

<style scoped>
.scene-legend { position:absolute;left:20px;bottom:24px;z-index:2;width:236px;border:1px solid rgba(242,240,233,.18);background:rgba(16,27,24,.92);box-shadow:0 10px 30px rgba(0,0,0,.24);backdrop-filter:blur(14px) }
button { color:inherit;cursor:pointer }
.legend-heading { display:flex;align-items:center;gap:9px;width:100%;height:43px;padding:0 13px;border:0;background:transparent;text-align:left }
.legend-heading span { flex:1;font-size:12px;font-weight:600;letter-spacing:1px }
.legend-heading > svg:first-child { color:var(--mint) }
.legend-heading > svg:last-child { color:#94a49c;transition:transform 150ms ease }
.legend-heading > svg.collapsed { transform:rotate(180deg) }
.legend-content { max-height:calc(100dvh - 100px);overflow-y:auto;border-top:1px solid rgba(242,240,233,.11) }
.layer-row { display:grid;grid-template-columns:18px 1fr 15px;align-items:center;gap:9px;width:100%;min-height:45px;padding:10px 13px;border:0;background:transparent;text-align:left;font-size:11px }
.layer-row > svg { color:#9cab9f }
.layer-swatch { width:16px;height:16px;border:1px solid rgba(255,255,255,.25);background:var(--coral);box-shadow:inset 0 -5px 0 rgba(0,0,0,.18) }
.area-types { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;padding:0 12px 12px }
.area-types button { display:grid;grid-template-columns:8px 1fr 12px;align-items:center;gap:7px;min-height:32px;padding:0 8px;border:1px solid rgba(242,240,233,.1);border-radius:2px;background:rgba(255,255,255,.025);text-align:left;font-size:11px }
.area-types i { width:8px;height:8px }
.area-types svg { color:var(--mint) }
button[aria-checked="false"] { opacity:.45 }
.area-types button:disabled { cursor:not-allowed }
.scene-state { display:flex;align-items:center;gap:7px;margin:0;padding:9px 13px;border-top:1px solid rgba(242,240,233,.09);color:#9eaca5;font-size:10px;line-height:1.5 }
.scene-state i { flex-shrink:0;width:5px;height:5px;border-radius:50%;background:#f1b35d }
.scene-state.error i { background:#ff6f5b }
button:focus-visible { outline:2px solid var(--mint);outline-offset:-3px }
@media (hover:hover) { button:not(:disabled):hover { background:rgba(185,242,124,.06) } }
@media (max-width:700px) { .scene-legend { left:12px;bottom:16px;width:196px }.area-types { gap:5px;padding:0 9px 10px }.area-types button { gap:5px;padding:0 6px;font-size:10px }.legend-heading,.layer-row { padding-right:10px;padding-left:10px } }
@media (max-width:480px) { .scene-legend { width:148px }.area-types { grid-template-columns:1fr }.scene-state { padding:8px 10px;font-size:9px } }
@media (prefers-reduced-motion:reduce) { .legend-heading > svg:last-child { transition:none } }
</style>

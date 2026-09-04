<script setup lang="ts">
import { shallowRef } from 'vue'
import { useLoop } from '@tresjs/core'
import { Vector3 } from 'three'
import type { Group } from 'three'

const props = defineProps<{
  speed: number
  paused: boolean
}>()

const structure = shallowRef<Group | null>(null)
const { onBeforeRender } = useLoop()

function blockPosition(index: number) {
  return new Vector3((index - 5) * 0.72, 0, 0)
}

onBeforeRender(({ delta }) => {
  if (!structure.value || props.paused) return
  structure.value.rotation.y += delta * props.speed
  structure.value.rotation.x = Math.sin(structure.value.rotation.y * 0.55) * 0.12
})
</script>

<template>
  <TresGroup ref="structure">
    <TresMesh v-for="index in 9" :key="index" :position="blockPosition(index)">
      <TresBoxGeometry :args="[0.54, 0.54 + Math.abs(index - 5) * 0.16, 0.54]" />
      <TresMeshStandardMaterial
        :color="index % 2 === 0 ? '#f45b38' : '#d8ff68'"
        :roughness="0.38"
        :metalness="0.12"
      />
    </TresMesh>
  </TresGroup>
</template>

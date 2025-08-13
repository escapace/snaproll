<template>
  <main>
    <RouterView />
  </main>
</template>

<script setup lang="ts">
import { useBattery, useLocalStorage } from '@vueuse/core'
import { Pane } from 'tweakpane'
import { onMounted, provide, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Snaproll, SnaprollActionType } from '../src'
import { FrequencyEstimation, MovingAverage, RmsIntervalJitter } from './utilities'
import { useDocumentVisibility } from '@vueuse/core'

const battery = useBattery()
const visibility = useDocumentVisibility()

const snaproll = new Snaproll()

watch(visibility, (current, previous) => {
  // or snaproll.resetPendingTime()

  if (current === 'visible' && previous === 'hidden') {
    snaproll.resume()
  } else {
    snaproll.pause()
  }
})

watch(battery.charging, () => snaproll.reset())

const drawRate = useLocalStorage('drawRate', 30)
const updateRate = useLocalStorage('updateRate', 60)
const perceptualAngle = useLocalStorage('perceptualAngle', 0.5)
watch(
  drawRate,
  (value) => {
    snaproll.drawRate = value
  },
  { immediate: true },
)
watch(
  updateRate,
  (value) => {
    snaproll.updateRate = value
  },
  { immediate: true },
)

provide('snaproll', snaproll)
provide('drawRate', drawRate)
provide('updateRate', updateRate)
provide('perceptualAngle', perceptualAngle)

const estimationBegin = new FrequencyEstimation()
const estimationUpdate = new FrequencyEstimation()
const estimationDraw = new FrequencyEstimation()
const estimationFrameDrop = new FrequencyEstimation()
const estimationFrameJitter = new RmsIntervalJitter()
const estimationFrameAlphaJitter = new MovingAverage()
const estimationQuantizationGrid = new MovingAverage()

const observer = new PerformanceObserver((list) => {
  const entries = list.getEntries()

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]

    if (entry.entryType !== 'mark') {
      continue
    }

    if (entry.name === 'snaproll-animate-frame-drop') {
      estimationFrameDrop.update(entry.startTime)
    } else if (entry.name === 'snaproll-animate-frame-jitter') {
      const { deltaTime, interpolationAlphaJitter, quantizationGrid } =
        // @ts-expect-error detail is not typed
        entry.detail as Record<string, number>
      estimationFrameAlphaJitter.update(interpolationAlphaJitter, entry.startTime)
      estimationQuantizationGrid.update(quantizationGrid, entry.startTime)
      estimationFrameJitter.update(deltaTime, entry.startTime)
    }
  }
})

const graphs = {
  get 'begin'() {
    return estimationBegin.value()
  },
  get 'update'() {
    return estimationUpdate.value()
  },
  get 'draw'() {
    return estimationDraw.value()
  },
  get 'drop'() {
    return estimationFrameDrop.value()
  },
  get 'frame jitter'() {
    return estimationFrameJitter.value()
  },
  get 'alpha jitter'() {
    return estimationFrameAlphaJitter.value()
  },
}

const numbers = {
  get 'quantization grid'() {
    return estimationQuantizationGrid.value()
  },
}

const pane = new Pane({ expanded: true })
const controls = pane.addFolder({ title: 'Controls' })
const examples = pane.addFolder({ title: 'Examples' })
const folder = pane.addFolder({ title: 'Measurements' })

const router = useRouter()

controls.addButton({ title: 'pause' }).on('click', () => {
  snaproll.pause()
  folder.disabled = snaproll.state === 'paused'
})

controls.addButton({ title: 'resume' }).on('click', () => {
  snaproll.resume()
  folder.disabled = snaproll.state === 'paused'
})

controls.addButton({ title: 'reset' }).on('click', () => {
  snaproll.reset()
  folder.disabled = snaproll.state === 'paused'
})

controls.addBinding(drawRate, 'value', { min: 1, max: 200, label: 'draw rate', step: 1 })
controls.addBinding(updateRate, 'value', {
  min: 1,
  max: 200,
  label: 'update rate',
  step: 1,
})

controls.addBlade({ view: 'separator' })
controls.addBinding(perceptualAngle, 'value', {
  min: 0.1,
  max: 0.5,
  label: 'speed',
  step: 0.01,
})

examples
  .addButton({
    title: 'Bouncing Balls',
  })
  .on('click', () => {
    snaproll.reset()
    router.push('/bouncing-balls')
  })

examples
  .addButton({
    title: 'Rectangles',
  })
  .on('click', () => {
    snaproll.reset()
    router.push('/rectangles')
  })

for (const key of Object.keys(numbers)) {
  folder.addBinding(numbers, key as keyof typeof numbers, {
    view: 'text',
    label: `${key}`,
    parse: (value: number) => `${value.toPrecision(10)}`,
    readonly: true,
  })
}

for (const key of Object.keys(graphs)) {
  folder.addBinding(graphs, key as keyof typeof graphs, {
    view: 'text',
    label: `${key}`,
    parse: (value: number) => `${value.toPrecision(6)}`,
    readonly: true,
  })

  folder.addBinding(graphs, key as keyof typeof graphs, {
    label: '',
    readonly: true,
    view: 'graph',
    bufferSize: 100,
    ...(key === 'alpha jitter'
      ? {
          min: -10,
          max: 10,
        }
      : key === 'frame jitter'
        ? {
            min: 0,
            max: 50,
          }
        : {
            min: 0,
            max: 100,
          }),
  })
}

onMounted(() => {
  performance.clearMarks()
  observer.observe({ entryTypes: ['mark'] })
  pane.element.style.opacity = '0.9'

  snaproll.subscribe((context): undefined => {
    if (context.action === SnaprollActionType.Begin) {
      estimationBegin.update()
    }

    if (context.action === SnaprollActionType.Update) {
      estimationUpdate.update()
    }

    if (context.action === SnaprollActionType.Draw) {
      estimationDraw.update()
    }
  })

  snaproll.resume()

  Object.assign(window, { snaproll })
})

import.meta.hot?.accept(() => {
  import.meta.hot?.invalidate()
})
</script>

<style>
* {
  overflow-x: hidden;
  margin: 0;
  padding: 0;
}

.tp-dfwv {
  min-width: 300px;
}

:root {
  --tp-base-background-color: hsla(0, 0%, 0%, 1);
  --tp-base-shadow-color: hsla(0, 0%, 0%, 0.2);
  --tp-button-background-color-active: hsla(0, 0%, 100%, 1);
  --tp-button-background-color-focus: hsla(0, 0%, 100%, 1);
  --tp-button-background-color-hover: hsla(0, 0%, 100%, 1);
  --tp-button-background-color: hsla(0, 0%, 100%, 1);
  --tp-button-foreground-color: hsla(0, 0%, 0%, 1);
  --tp-container-background-color-active: hsla(0, 0%, 0%, 1);
  --tp-container-background-color-focus: hsla(0, 0%, 0%, 1);
  --tp-container-background-color-hover: hsla(0, 0%, 0%, 1);
  --tp-container-background-color: hsla(0, 0%, 0%, 1);
  --tp-container-foreground-color: hsla(0, 0%, 100%, 1);
  --tp-groove-foreground-color: hsla(0, 0%, 0%, 1);
  --tp-input-background-color-active: hsla(0, 0%, 0%, 1);
  --tp-input-background-color-focus: hsla(0, 0%, 0%, 1);
  --tp-input-background-color-hover: hsla(0, 0%, 0%, 1);
  --tp-input-background-color: hsla(0, 0%, 0%, 1);
  --tp-input-foreground-color: hsla(0, 0%, 100%, 1);
  --tp-label-foreground-color: hsla(0, 0%, 100%, 1);
  --tp-monitor-background-color: hsla(0, 0%, 0%, 1);
  --tp-monitor-foreground-color: hsla(0, 0%, 100%, 1);
}

body {
  background-color: black;
}
</style>

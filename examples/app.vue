<template>
  <main>
    <RouterView />
  </main>
</template>

<script setup lang="ts">
import { useBattery, useDocumentVisibility, useLocalStorage } from '@vueuse/core'
import { Pane } from 'tweakpane'
import { onMounted, provide, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Snaproll, SnaprollActionType } from '../src'
import { FrequencyEstimation, MovingAverage, RmsIntervalJitter } from './utilities'
import {
  SnaprollDrawRateAdvisor,
  type SnaprollDrawRateAdvisorResponse,
} from '../src/draw-rate-advisor'

const battery = useBattery()
const visibility = useDocumentVisibility()

const snaproll = new Snaproll()
const advisor = new SnaprollDrawRateAdvisor()
const recommendation = ref<string>('')

onMounted(() => advisor.trigger())
advisor.subscribe((value) => {
  recommendation.value = JSON.stringify(value, null, 2)
  // advisor.trigger()
})

watch(visibility, (current, previous) => {
  if (current === 'visible' && previous === 'hidden') {
    snaproll.resume()
    advisor.trigger()
  } else {
    snaproll.pause()
  }
})

watch(battery.charging, () => {
  snaproll.reset()
  advisor.trigger()
})

const drawRate = useLocalStorage('drawRate', snaproll.drawRate)
const updateRate = useLocalStorage('updateRate', snaproll.updateRate)
const perceptualAngle = useLocalStorage('perceptualAngle', 0.25)

interface Instrumentation {
  estimationBegin: FrequencyEstimation
  estimationDraw: FrequencyEstimation
  estimationUpdate: FrequencyEstimation
  estimationFrameDrop: FrequencyEstimation
  estimationFrameJitter: RmsIntervalJitter
  estimationFrameAlphaJitter: MovingAverage
  estimationQuantizationGrid: MovingAverage
  dispose: () => void
}

const createInstrumentation = (): Instrumentation => {
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

  performance.clearMarks()
  observer.observe({ entryTypes: ['mark'] })

  const dispose = () => {
    observer.disconnect()
  }

  return {
    estimationBegin,
    estimationUpdate,
    estimationDraw,
    estimationFrameDrop,
    estimationFrameJitter,
    estimationFrameAlphaJitter,
    estimationQuantizationGrid,
    dispose,
  }
}

const instruments = shallowRef<Instrumentation | undefined>()
const instrumentation = ref(false)

watch(
  instrumentation,
  (value) => {
    instruments.value?.dispose()

    if (value) {
      instruments.value = createInstrumentation()
    } else {
      instruments.value = undefined
    }
  },
  { immediate: true },
)

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

const pane = new Pane({ expanded: true })
const controls = pane.addFolder({ title: 'Controls' })
const examples = pane.addFolder({ title: 'Examples' })
const measurements = pane.addFolder({ title: 'Measurements' })
measurements.expanded = instrumentation.value

measurements.on('fold', ({ expanded }) => {
  instrumentation.value = expanded
})

const router = useRouter()

controls.addButton({ title: 'pause' }).on('click', () => {
  // TODO: return boolean if successful?
  snaproll.pause()
  measurements.expanded = snaproll.state !== 'paused'
  measurements.disabled = snaproll.state === 'paused'
})

controls.addButton({ title: 'resume' }).on('click', () => {
  // TODO: return boolean if successful?
  snaproll.resume()
  measurements.expanded = measurements.expanded && snaproll.state !== 'paused'
  measurements.disabled = snaproll.state === 'paused'
})

controls.addButton({ title: 'reset' }).on('click', () => {
  // TODO: return boolean if successful?
  snaproll.reset()
  measurements.expanded = measurements.expanded && snaproll.state !== 'paused'
  measurements.disabled = snaproll.state === 'paused'
})

controls.addBinding(drawRate, 'value', {
  min: 1,
  max: 240,
  label: 'draw rate',
  step: 1,
})
controls.addBinding(updateRate, 'value', {
  min: 1,
  max: 240,
  label: 'update rate',
  step: 1,
})

// const drawRateAdvisorControls = controls.addButton({ title: 'detect' }).on('click', () => {
//   drawRateAdvisorControls.disabled = true
//   drawRateControls.disabled = true
//   updateRateControls.disabled = true
//
//   recommendDrawRates().then(({ score, values }) => {
//     console.log({ score, values })
//     drawRate.value = values[0]
//     drawRateControls.refresh()
//     drawRateAdvisorControls.disabled = false
//     drawRateControls.disabled = false
//     updateRateControls.disabled = false
//   })
// })

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

const graphs = {
  get 'begin'() {
    return instruments.value?.estimationBegin.value() ?? 0
  },
  get 'update'() {
    return instruments.value?.estimationUpdate.value() ?? 0
  },
  get 'draw'() {
    return instruments.value?.estimationDraw.value() ?? 0
  },
  get 'drop'() {
    return instruments.value?.estimationFrameDrop.value() ?? 0
  },
  get 'frame jitter'() {
    return instruments.value?.estimationFrameJitter.value() ?? 0
  },
  get 'alpha jitter'() {
    return instruments.value?.estimationFrameAlphaJitter.value() ?? 0
  },
}

const numbers = {
  get 'quantization grid'() {
    return instruments.value?.estimationQuantizationGrid.value() ?? 0
  },
}

for (const key of Object.keys(numbers)) {
  measurements.addBinding(numbers, key as keyof typeof numbers, {
    view: 'text',
    label: `${key}`,
    parse: (value: number) => `${value.toPrecision(10)}`,
    readonly: true,
  })
}

for (const key of Object.keys(graphs)) {
  measurements.addBinding(graphs, key as keyof typeof graphs, {
    view: 'text',
    label: `${key}`,
    parse: (value: number) => `${value.toPrecision(6)}`,
    readonly: true,
  })

  measurements.addBinding(graphs, key as keyof typeof graphs, {
    label: '',
    readonly: true,
    view: 'graph',
    bufferSize: 100,
    ...(key === 'alpha jitter'
      ? {
          min: -3,
          max: 3,
        }
      : key === 'frame jitter'
        ? {
            min: 0,
            max: 25,
          }
        : {
            min: 0,
            max: 100,
          }),
  })
}

measurements.addBinding(recommendation, 'value', {
  view: 'text',
  label: 'recommendation',
  readonly: true,
  multiline: true,
  parse: (value: unknown) => JSON.stringify(value),
  rows: 10,
})

onMounted(() => {
  snaproll.subscribe((context): undefined => {
    if (context.action === SnaprollActionType.Begin) {
      instruments.value?.estimationBegin.update()
    }

    if (context.action === SnaprollActionType.Update) {
      instruments.value?.estimationUpdate.update()
    }

    if (context.action === SnaprollActionType.Draw) {
      instruments.value?.estimationDraw.update()
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

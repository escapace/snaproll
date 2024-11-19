<template>
  <div>
    <div clas="container">
      <div v-for="box in boxes" :key="box.id" ref="boxRefs" class="box"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { range } from 'lodash-es'
import { onMounted, ref } from 'vue'
import { snaproll, type Subscription, TypeAction } from './index'
import { Pane } from 'tweakpane'

// class Estimation {
//   private currentCount = 0
//   private lastSampleTime: number | undefined = undefined
//   private readonly samples: { count: number; time: number }[] = []
//
//   constructor(
//     private readonly windowSeconds = 1,
//     private readonly sampleInterval = 1000,
//   ) {}
//
//   update(currentTime: number = performance.now()): void {
//     this.currentCount++
//
//     if (
//       this.lastSampleTime === undefined ||
//       currentTime - this.lastSampleTime >= this.sampleInterval
//     ) {
//       this.samples.push({ count: this.currentCount, time: currentTime })
//       this.currentCount = 0
//       this.lastSampleTime = currentTime
//
//       // Remove outdated samples
//       const cutoffTime = currentTime - this.windowSeconds * 1000
//       this.samples.splice(
//         0,
//         this.samples.findIndex((sample) => sample.time >= cutoffTime),
//       )
//     }
//   }
//
//   getFrequency(): number {
//     if (!this.samples.length) return 0
//
//     const totalCount = this.samples.reduce((sum, { count }) => sum + count, 0)
//     const timeSpan = (this.samples.at(-1)!.time - this.samples[0].time) / 1000
//
//     return timeSpan ? totalCount / timeSpan : totalCount
//   }
//
//   reset(): void {
//     this.samples.length = 0
//     this.currentCount = 0
//     this.lastSampleTime = undefined
//   }
// }

class Estimation {
  private count = 0
  private last = 0
  private sum = 0

  constructor(
    private readonly sampleInterval = 1000
  ) {}

  update(currentTime: number = performance.now()): void {
    this.count++

    if (currentTime - this.last >= this.sampleInterval) {
      const factor = 0.8;
      this.sum = this.sum * (1 - factor) + this.count * factor;
      this.count = 0;
      this.last = currentTime;
    }
  }

  getFrequency(): number {
    return this.sum;
  }

  reset(): void {
    this.count = 0;
    this.sum = 0;
    this.last = 0;
  }
}

const loop = snaproll({ fps: 30 })
const boxRefs = ref<HTMLElement[]>([])

function lerp(v0: number, v1: number, t: number) {
  return v0 * (1 - t) + v1 * t
}

const boxes = range(50).map((_, index) => {
  const width = 5
  const limit = 100 - width
  const position = Math.random() * limit
  const velocity = Math.random() / 50

  const box = {
    index,
    id: `box${index}`,
    lastPosition: position,
    limit,
    position,
    velocity,
  }

  const subscription: Subscription = (action) => {
    const element = boxRefs.value[box.index]

    switch (action.type) {
      case TypeAction.FrameUpdate:
        box.lastPosition = box.position
        box.position += box.velocity * action.timestep
        // Switch directions if we go too far
        if (box.position >= box.limit || box.position <= 0) box.velocity = -box.velocity
        break
      case TypeAction.FrameDraw:
        element.style.left = `${lerp(
          box.lastPosition,
          box.position,
          action.delta,
          // 1 - Math.exp(-lambda * action.delta),
        )}vw`

        break
      case TypeAction.FrameEnd:
        if (action.panic) {
          loop.resetFrameDelta()
        }
    }
  }

  loop.subscribe(subscription)

  return box
})

// pane.addBinding(store, 'model', {
//   label: 'theme',
//   options: {
//     one: 'one',
//     two: 'two',
//   },
// })
// pane.addBinding(store, 'lightness', { max: 1, min: 0, step: 0.01 })
// pane.addBinding(store, 'chroma', { max: 1, min: 0, step: 0.01 })
// pane.addBinding(store, 'contrast', { max: 1, min: 0, step: 0.01 })
// pane.addBinding(store, 'darkMode', { label: 'dark mode' })
//
// pane.addBinding(store, 'modelState', { label: 'state', readonly: true })

const estimationBegin = new Estimation()
const estimationUpdate = new Estimation()
const estimationDraw = new Estimation()
const estimationEnd = new Estimation()

const read = {
  get fps() {
    return loop.fps
  },
  get begin() {
    return estimationBegin.getFrequency()
  },
  get update() {
    return estimationUpdate.getFrequency()
  },
  get draw() {
    return estimationDraw.getFrequency()
  },
  get end() {
    return estimationEnd.getFrequency()
  },
}

// .on('change', (ev) => {
//   console.log(ev.value.toFixed(2));
//   if (ev.last) {
//     console.log('(last)');
//   }
// });

const pane = new Pane({ title: 'snaproll', expanded: true })

pane
  .addBinding({ fps: 30 }, 'fps', {
    min: 10,
    max: 80,
  })
  .on('change', ({ value }) => {
    loop.fps = value
  })

pane
  .addBinding({ timestep: loop.timestep }, 'timestep', {
    min: 1,
    max: 100,
  })
  .on('change', ({ value }) => {
    loop.timestep = value
  })

pane.addBlade({
  view: 'separator',
})

Object.keys(read).forEach((key) => {
  pane.addBinding(read, key as keyof typeof read, {
    view: 'text',
    label: `${key}`,
    parse: (value: number) => `${value.toPrecision(6)}`,
    readonly: true,
    // value: 'sketch-01',
  })

  pane.addBinding(read, key as keyof typeof read, {
    label: '',
    readonly: true,
    view: 'graph',
    min: 0,
    max: 200,
    bufferSize: 100,
  })
})

pane
  .addButton({
    title: 'pause',
  })
  .on('click', () => {
    loop.pause()
  })

pane
  .addButton({
    title: 'resume',
  })
  .on('click', () => {
    loop.resume()
  })

loop.subscribe((action) => {
  if (action.type === TypeAction.FrameBegin) {
    estimationBegin.update()
  }

  if (action.type === TypeAction.FrameUpdate) {
    estimationUpdate.update()
  }

  if (action.type === TypeAction.FrameDraw) {
    estimationDraw.update()
  }

  if (action.type === TypeAction.FrameEnd) {
    estimationEnd.update()
  }
})

onMounted(() => {
  loop.resume()

  window.loop = loop
})
</script>

<style>
* {
  overflow-x: hidden;
  margin: 0;
  padding: 0;
}

.container {
  width: 100vw;
  height: 100vh;
  scroll-behavior: none;
}

.fps {
  font-kerning: none;
  position: fixed;
  margin-top: 5vw;
  margin-bottom: 5vw;
  margin-right: 5vw;
  margin-left: 5vw;
  top: 2vw;
  right: 2vw;
  text-align: right;
  font-weight: 300;
  font-size: 5vw;
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    Roboto,
    Oxygen,
    Ubuntu,
    Cantarell,
    'Open Sans',
    'Helvetica Neue',
    sans-serif;
}

.box {
  z-index: -1;
  position: relative;
  background-color: navy;
  height: 4.9vw;
  margin-bottom: 0.05vw;
  margin-top: 0.05vw;
  margin-left: 0.05vw;
  margin-right: 0.05vw;
  width: 4.9vw;
}
</style>

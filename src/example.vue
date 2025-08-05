<template>
  <div>
    <div clas="container">
      <div
        v-for="box in boxes"
        :key="box.id"
        ref="boxRefs"
        class="box"
        :style="{ width: `${box.width}vw` }"
      ></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { range } from 'lodash-es'
import { Pane } from 'tweakpane'
import { onMounted, ref } from 'vue'
import { Snaproll, SnaprollActionType, type SnaprollSubscription } from './index'

class Estimation {
  private count = 0
  private last = 0
  private sum = 0

  constructor(private readonly sampleInterval = 1000) {}

  update(currentTime: number = performance.now(), update = true): void {
    if (update) {
      this.count++
    }

    if (currentTime - this.last >= this.sampleInterval) {
      const factor = 0.9
      this.sum = this.sum * (1 - factor) + this.count * factor
      this.count = 0
      this.last = currentTime
    }
  }

  getFrequency(): number {
    this.update(performance.now(), false)
    return this.sum
  }

  reset(): void {
    this.count = 0
    this.sum = 0
    this.last = 0
  }
}

const loop = new Snaproll({ fps: 30 })
const boxRefs = ref<HTMLElement[]>([])

function lerp(v0: number, v1: number, t: number) {
  return v0 * (1 - t) + v1 * t
}

interface BoxState {
  index: number
  id: string
  lastPosition: number // positive number 0-100
  position: number // positive number 0-100
  velocity: number // positive or negative number, per millisecond
  width: number // positive number 0-100
}

function updateBox(state: BoxState, deltaTime: number): void {
  const x0 = state.position
  const v0 = state.velocity
  const L = 100 - state.width // effective track length (0 … L)

  state.lastPosition = x0 // remember where we just were

  // -------- unfolded coordinate -------------------------------------------
  const s = x0 + v0 * deltaTime // no limits, can be ±big

  // -------- fold back into corridor (position) ----------------------------
  const doubleL = 2 * L
  let m = ((s % doubleL) + doubleL) % doubleL // 0 … 2L  (always ≥ 0)
  if (m > L) m = doubleL - m // mirror right half
  state.position = m // 0 … L

  // -------- direction after all the impacts --------------------------------
  const halfLaps = Math.floor(s / L) // may be negative
  const bouncedOdd = (halfLaps & 1) !== 0 // parity test
  state.velocity = bouncedOdd ? -v0 : v0 // keep speed, maybe flip
}

class LerpSnap {
  private snapped: number | null = null;
  private isSnapped = false;

  constructor(
    private step    = 0.05,     // grid step (units), not pixels
    private snapIn  = 0.0125,     // ≥ drift to lock onto a *new* step
    private snapOut = 0.0025     // ≤ drift to stay locked
  ) {}

  private snap(value: number): number {
    return Math.round(value / this.step) * this.step;
  }

  update(a: number, b: number, t: number): { real: number; draw: number } {
    const real = (1 - t) * a + t * b;

    if (this.snapped === null) {          // first call
      this.snapped  = this.snap(real);
      this.isSnapped = true;
      return { real, draw: this.snapped };
    }

    const delta = real - this.snapped;

    if (this.isSnapped && Math.abs(delta) < this.snapOut) {
      return { real, draw: this.snapped };      // stay locked
    }
    if (!this.isSnapped && Math.abs(delta) < this.snapIn) {
      return { real, draw: this.snapped };      // keep floating
    }

    this.snapped   = this.snap(real);           // lock to next step
    this.isSnapped = true;
    return { real, draw: this.snapped };
  }
}

const boxes = range(100).map((_, index) => {
  const position = Math.random() * 100
  const box: BoxState = {
    index,
    id: `box${index}`,
    lastPosition: position,
    position,
    width: 5 + 20 * Math.random(),
    velocity: Math.random() / 100,
  }

  // const snapper = new LerpSnap()

  const subscription: SnaprollSubscription = (action) => {
    switch (action.type) {
      case SnaprollActionType.Begin:
        break
      case SnaprollActionType.Update:
        const jump = action.updateStep >= 10

        const timestep = jump ? action.updateStep * action.timestep : action.timestep

        updateBox(box, timestep)

        return jump
      case SnaprollActionType.Draw:
        if (action.alpha > 1 || action.alpha < 0) {
          console.log(action.alpha)
        }

        const value = lerp(
          box.lastPosition,
          box.position,
          action.alpha,
          // 1 - Math.pow(0.25, action.alpha),
        )

        // const { draw: value } = snapper.update(
        //   box.lastPosition,
        //   box.position,
        //   action.alpha,
        // )
        boxRefs.value[box.index].style.transform = `translateX(${value}vw)`

        break
    }

    return
  }

  loop.subscribe(subscription)

  return box
})

const estimationBegin = new Estimation()
const estimationUpdate = new Estimation()
const estimationDraw = new Estimation()
const estimationFrameDrop = new Estimation()

performance.clearMarks()

const observer = new PerformanceObserver((list) => {
  list.getEntries().forEach((entry) => {
    if (entry.entryType === 'mark' && entry.name === 'snaproll-animate-frame-drop') {
      estimationFrameDrop.update(entry.startTime)
    }
  })
})

observer.observe({ entryTypes: ['mark'] })

const read = {
  get begin() {
    return estimationBegin.getFrequency()
  },
  get update() {
    return estimationUpdate.getFrequency()
  },
  get draw() {
    return estimationDraw.getFrequency()
  },
  get drops() {
    return estimationFrameDrop.getFrequency()
  },
}

// .on('change', (ev) => {
//   console.log(ev.value.toFixed(2));
//   if (ev.last) {
//     console.log('(last)');
//   }
// });

const pane = new Pane({ expanded: true })

pane.element.style.opacity = '0.9'

const controls = pane.addFolder({
  title: 'Controls',
})

const folder = pane.addFolder({
  title: 'Measurements',
})

controls
  .addButton({
    title: 'pause',
  })
  .on('click', () => {
    folder.disabled = true
    loop.pause()
  })

controls
  .addButton({
    title: 'resume',
  })
  .on('click', () => {
    folder.disabled = false
    loop.resume()
  })

controls
  .addBinding({ fps: loop.fps }, 'fps', {
    min: 1,
    max: 100,
  })
  .on('change', ({ value }) => {
    loop.fps = value
  })

controls
  .addBinding({ timestep: loop.timestep }, 'timestep', {
    min: 1,
    max: 100,
  })
  .on('change', ({ value }) => {
    loop.timestep = value
  })

Object.keys(read).forEach((key) => {
  folder.addBinding(read, key as keyof typeof read, {
    view: 'text',
    label: `${key}`,
    parse: (value: number) => `${value.toPrecision(6)}`,
    readonly: true,
    // value: 'sketch-01',
  })

  folder.addBinding(read, key as keyof typeof read, {
    label: '',
    readonly: true,
    view: 'graph',
    min: 0,
    max: 100,
    bufferSize: 100,
  })
})

loop.subscribe((action): undefined => {
  if (action.type === SnaprollActionType.Begin) {
    estimationBegin.update()
  }

  if (action.type === SnaprollActionType.Update) {
    estimationUpdate.update()
  }

  if (action.type === SnaprollActionType.Draw) {
    estimationDraw.update()
  }
})

onMounted(() => {
  loop.resume()

  Object.assign(window, { loop })
})
</script>

<style>
* {
  overflow-x: hidden;
  margin: 0;
  padding: 0;
  /* background-color: black; */
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

.container {
  width: 100vw;
  height: 100vh;
  scroll-behavior: none;
}

body {
  background-color: black;
}

.box {
  /* transition: transform 40ms linear; */
  z-index: -1;
  position: relative;
  background-color: white;
  height: 4.9vw;
  margin-bottom: 0.05vw;
  margin-top: 0.05vw;
  margin-left: 0.05vw;
  margin-right: 0.05vw;
}
</style>

<template>
  <div>
    <div clas="container">
      <div
        v-for="box in boxes"
        :key="box.id"
        ref="boxReferences"
        class="box"
        :style="{ width: `${box.width}vw`, 'background-color': `${box.color}` }"
      ></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useWindowSize } from '@vueuse/core'
import { range } from 'es-toolkit'
import { inject, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { SnaprollActionType, type Snaproll, type SnaprollSubscription } from '../src'
import { decomposeVelocityMagnitude, lerp } from './utilities'

const snaproll = inject<Snaproll>('snaproll')!
const drawRate = inject<Ref<number>>('drawRate')!
const perceptualAngle = inject<Ref<number>>('perceptualAngle')!
const { width: windowWidth, height: windowHeight } = useWindowSize()

const boxReferences = ref<HTMLElement[]>([])

interface BoxState {
  index: number
  id: string
  lastPosition: number // positive number 0-100
  position: number // positive number 0-100
  xSpeed: number // positive or negative number, per millisecond
  width: number // positive number 0-100
  color: string
}

function updateBox(state: BoxState, deltaTime: number): void {
  const x0 = state.position
  const v0 = state.xSpeed
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
  state.xSpeed = bouncedOdd ? -v0 : v0 // keep speed, maybe flip
}

const boxes = range(32).map((_, index) => {
  const position = Math.random() * 100
  const weight = Math.random()

  const box: Omit<BoxState, 'xSpeed'> = {
    index,
    id: `box${index}`,
    lastPosition: position,
    position,
    width: 5 + 20 * Math.random(),
    color: `hsl(${Math.random() * 360}, 70%, 70%)`,
  }

  watch(
    [windowWidth, windowHeight, drawRate, perceptualAngle],
    ([windowWidth, windowHeight, drawRate, perceptualAngle]) => {
      Object.assign(
        box,
        decomposeVelocityMagnitude(
          { drawRate, windowHeight, windowWidth, perceptualAngle: perceptualAngle * weight },
          box as BoxState,
        ),
      )
    },
    { immediate: true, flush: 'sync' },
  )

  const subscription: SnaprollSubscription = (action) => {
    switch (action.type) {
      case SnaprollActionType.Begin:
        break
      case SnaprollActionType.Update:
        const jump = action.updateStep >= 100

        const timestep = jump ? action.updateStep * action.timestep : action.timestep

        updateBox(box as BoxState, timestep)

        return jump
      case SnaprollActionType.Draw:
        // if (action.alpha > 1 || action.alpha < 0) {
        //   console.log(action.alpha)
        // }

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
        boxReferences.value[box.index].style.transform = `translateX(${value}vw)`

        break
    }

    return
  }

  const { unsubscribe } = snaproll.subscribe(subscription)

  onBeforeUnmount(() => unsubscribe())

  return box
})
</script>

<style>
.container {
  width: 100vw;
  height: 100vh;
  scroll-behavior: none;
}

.box {
  z-index: -1;
  position: relative;
  height: 4.9vw;
  margin-bottom: 0.05vw;
  margin-top: 0.05vw;
  margin-left: 0.05vw;
  margin-right: 0.05vw;
}
</style>

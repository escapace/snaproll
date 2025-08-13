# snaproll

Fixed‑timestep update loop with independent draw rate and quantized interpolation.

---

## Core concepts

- **updateRate (Hz)** — how often updates execute. Fixed timestep: `Δt = 1000 / updateRate` (ms).
- **drawRate (Hz)** — target draw cadence. Frame gate period: `Δd = 1000 / drawRate` (ms).
- **Accumulator** — internal `pendingTime ∈ [0, Δt)` stores leftover fractional time after consuming whole updates each frame. This field is **internal** (not exposed on the public action object).
- **Quantized interpolation** — `alpha = ⌊Q · a⌋ / Q` with `a = pendingTime / Δt` and quantization grid `Q = 2^{⌈log₂(drawRate)⌉}` (e.g., 60 Hz → `Q = 64`). Quantization bounds interpolation jitter to `< Δt / Q`.

### Defaults

- `updateRate = 60 Hz`
- `drawRate = 60 Hz`

### Notation ↔ API

| Math                | Meaning                         | Public action field                 |
| ------------------- | ------------------------------- | ----------------------------------- |
| `Δt`                | fixed timestep (ms)             | `timestep`                          |
| `Δd`                | draw period (ms)                | _(internal)_                        |
| `A_n`               | accumulator before quantization | _(internal)_                        |
| `a = A_n / Δt`      | fractional progress             | _(derived)_                         |
| `Q`                 | quantization grid               | _(internal)_                        |
| `α`                 | interpolation alpha             | `alpha`                             |
| `k_n = ⌊(A⁺_n)/Δt⌋` | updates this frame              | `updateStep` (per Update iteration) |

> snaproll‑owned keys appear on the context but are only meaningful during their documented phase.

---

## Action phases & accessible fields

The action/context object is **phase‑discriminated**. Only read the fields listed for the active phase.

### Begin

- `type: SnaprollActionType.Begin`
- `timestamp` — high‑resolution time for this frame (ms)

### Update

- `type: SnaprollActionType.Update`
- `timestep` — `Δt`
- `updateStep` — `k, k−1, …, 1` within this frame (**counts down**)

### Draw

- `type: SnaprollActionType.Draw`
- `alpha ∈ [0, 1)` — quantized interpolation fraction

> Note: Other fields from previous phases may be present but should not be relied upon.

---

## Short‑circuiting (control flow)

Subscribers run in **deterministic subscription order** during each phase. A subscriber may return `true` to signal control flow changes:

- **`SnaprollActionType.Begin`** — returning `true` **skips** Update and Draw for this frame. The accumulator is **not** touched (no catch‑up occurs or is dropped).
- **`SnaprollActionType.Update`** — if **any** subscriber returns `true` during an Update iteration, snaproll **ends the Update phase for this frame, zeros the internal accumulator, and skips Draw**. This is a deliberate “jump‑cut” used to shed backlog.
- **`SnaprollActionType.Draw`** — return values are **ignored** for control flow.

`updateStep` exposes the remaining number of fixed updates **this frame** (starts at `k` on the first Update, decrements to `1`). This lets you make early decisions under heavy backlog.

### Example: coalesce many updates into one step

```ts
const subscription: SnaprollSubscription = (action) => {
  switch (action.type) {
    case SnaprollActionType.Begin:
      break
    case SnaprollActionType.Update: {
      const coalesce = action.updateStep >= 100
      const timestep = coalesce ? action.updateStep * action.timestep : action.timestep

      updateBall(ball, timestep)

      // Returning true signals snaproll to end the Update phase
      // after all subscribers have run for this iteration.
      return coalesce
    }
    case SnaprollActionType.Draw:
      drawBalls(action.alpha)
      break
  }

  return
}
```

---

## Rate changes & `reset()`

### Hot‑swapping rates

Updating `updateRate`/`drawRate` **does not** clear the accumulator; new rates take effect immediately. If `Δt` shrinks, the existing accumulator may cause one extra Update on the next frame (time‑continuous behavior).

### `reset()` (hard reset of loop state)

- Cancels any pending RAF if active.
- Re‑initializes the loop: accumulator set to `0`, `timestamp` reseeded, `frameIndex` recomputed.
- Subscriptions: preserved by default; pass `keepSubscriptions: false` to drop.
- Context: resolved per **Context merge policy** (`keepContext`, `context`).
- Rates: unchanged by `reset()`.
- Auto‑resume: if the loop wasn’t paused before `reset()`, it restarts and ends up **active** if any subscription is active; otherwise **idle**.

---

## Lifecycle & subscriptions

**States**

- **active** — at least one subscription is active. Frames are scheduled at the draw gate; every frame delivers `Begin → Update* → Draw` in subscription order.
- **idle** — no subscriptions are active. The loop is not running.
- **paused** — you explicitly paused the loop. The loop is not running.

**Transitions**

- `idle → active`: happens when any subscription becomes active (new subscription with `immediate: true`, or resuming an existing one).
- `active → idle`: happens when all subscriptions are paused or unsubscribed.
- `active → paused`: `pause()` stops the loop; your subscriptions remain registered.
- `paused → active`: `resume()` restarts the loop; the accumulator is cleared.

**Subscriptions**

- `subscribe(fn, { immediate = true })` registers a subscriber. With `immediate: false` it starts paused; use the returned controls to `resume()` it.
- Each subscription exposes `{ pause, resume, unsubscribe }`.
- Call order is deterministic and equals subscription order.

**Notes**

- Resetting while **active** clears the accumulator and keeps running.
- Resetting while **idle** keeps the loop idle until a subscription is active.

---

## Context merge policy

Snaproll uses a single **context object** for both your state (if you store it there) and snaproll‑owned fields.

- Choosing what happens to the context when you call `reset()` or change options:
  - Provide a `context` and set `keepContext: true` → use your object as the context and **merge** the current context into it.
  - Provide a `context` and set `keepContext: false` → **replace** the context with your object.
  - Omit `context` and set `keepContext: true` → **keep** the current context as‑is.
  - Omit `context` and set `keepContext: false` → **start fresh** with an empty context.

**snaproll‑owned fields** (`alpha`, `timestamp`, `timestep`, `type`, `updateStep`) are read‑only from user code and only meaningful in their phase.

> **TypeScript:** extend `SnaprollContext` via declaration merging:
>
> ```ts
> declare module 'snaproll' {
>   interface SnaprollContext {
>     gameState?: {
>       player: { x: number; y: number }
>       score: number
>     }
>   }
> }
> ```

---

## Mathematical model (reference)

- **Gate:** open when `g(t) = ⌊t / Δd⌋` increases (≤1 Begin+Draw per gate).
- **Accumulator update:** `A⁺ₙ = Aₙ₋₁ + (tₙ − tₙ₋₁)`.
- **Whole steps this frame:** `kₙ = ⌊A⁺ₙ / Δt⌋`.
- **Consume:** iterate `kₙ` times; after each, `A⁺ₙ ← A⁺ₙ − Δt`; expose `updateStep = kₙ, …, 1`.
- **Post‑update accumulator:** `Aₙ = A⁺ₙ ∈ [0, Δt)`.
- **Interpolation:** `a = Aₙ / Δt`, `alpha = ⌊Q a⌋ / Q`, `Q = 2^{⌈log₂(drawRate)⌉}`.
- **Stability guardrail:** let `c_u` be average Update cost, `c_d` Draw cost; require `c_d + E[kₙ]·c_u < Δd`.

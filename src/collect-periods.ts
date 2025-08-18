export interface CollectPeriodsOptions {
  samples: number
  warmup: number
}

function timestampsToPeriods(timestamps: number[]): number[] {
  if (timestamps.length < 2) {
    return []
  }

  const periods: number[] = []
  for (let index = 1; index < timestamps.length; index++) {
    periods.push(timestamps[index] - timestamps[index - 1])
  }

  return periods
}

export async function collectPeriods(
  options: CollectPeriodsOptions,
  onCancel: (cancelCallback: () => unknown) => void,
): Promise<number[]> {
  const { samples, warmup } = options

  const timestamps: number[] = []
  const timestampsRequired = samples + warmup + 1
  let pendingAnimationFrame: number | undefined = undefined
  let cancelled = false

  onCancel(() => {
    cancelled = true
    if (pendingAnimationFrame !== undefined) {
      cancelAnimationFrame(pendingAnimationFrame)
    }
  })

  await new Promise<void>((resolve) => {
    const collectFrame = (timestamp: number) => {
      timestamps.push(timestamp)

      if (cancelled || timestamps.length >= timestampsRequired) {
        return resolve()
      } else {
        pendingAnimationFrame = requestAnimationFrame(collectFrame)
      }
    }

    pendingAnimationFrame = requestAnimationFrame(collectFrame)
  })

  if (cancelled) {
    return []
  }

  return timestampsToPeriods(timestamps.slice(warmup))
}

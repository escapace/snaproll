import { describe, expectTypeOf, it } from 'vitest'
import { Snaproll, SnaprollActionType, type SnaprollContext } from './snaproll'

describe('Snaproll type tests', () => {
  it('correctly flows custom context through to subscriptions', () => {
    interface MyContext {
      customScore: number
    }

    const snaproll = new Snaproll<MyContext>({
      context: { customScore: 0 },
    })

    expectTypeOf(snaproll).toEqualTypeOf<Snaproll<MyContext>>()

    snaproll.subscribe((context) => {
      // It should inherit properties from MyContext
      expectTypeOf(context.customScore).toEqualTypeOf<number>()

      // It should inherit properties from SnaprollContext (base)
      expectTypeOf(context.action).toEqualTypeOf<SnaprollActionType>()

      // We can also narrow by action
      if (context.action === SnaprollActionType.Draw) {
        expectTypeOf(context.alpha).toEqualTypeOf<number>()
      } else if (context.action === SnaprollActionType.Update) {
        expectTypeOf(context.timestep).toEqualTypeOf<number>()
        expectTypeOf(context.updateStep).toEqualTypeOf<number>()
      }

      return undefined
    })
  })

  it('defaults to SnaprollContext<{}> without a type parameter', () => {
    const snaproll = new Snaproll()

    snaproll.subscribe((context) => {
      expectTypeOf(context).toEqualTypeOf<SnaprollContext>()
      expectTypeOf(context.action).toEqualTypeOf<SnaprollActionType>()

      return undefined
    })
  })
})

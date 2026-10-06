// Which exception escapes, and where an early exit stops, must not depend on
// which thread got there first.
import { join, par, range } from '@geastack/parallel'

class Rejected extends Error {
  constructor(readonly index: number) {
    super(`rejected ${index}`)
  }
}

const describe = (run: () => number): string => {
  try {
    return `value ${run()}`
  } catch (error) {
    if (error instanceof Rejected) return `threw ${error.index}`
    return error instanceof RangeError ? `range error ${error.message}` : 'threw something else'
  }
}

for (let round = 0; round < 50; round++) {
  // Many tasks throw; the lowest index is the one a sequential loop reaches first.
  console.log(
    describe(() =>
      range(0, 20000)
        .map((i) => {
          if (i % 997 === 996 - (round % 7)) throw new Rejected(i)
          return i
        })
        .reduce((a, b) => a + b, 0)
    )
  )
  // A decision at a low index makes every higher exception unreachable.
  console.log(
    describe(() =>
      range(0, 20000).findIndex((i) => {
        if (i > 300 + round) throw new Rejected(i)
        return i === 300 + round
      })
    )
  )
  // An exception below the decision still escapes.
  console.log(
    describe(() =>
      range(0, 20000).findIndex((i) => {
        if (i === 50 + round) throw new Rejected(i)
        return i === 15000
      })
    )
  )
}

const values: number[] = []
for (let i = 0; i < 4096; i++) values.push((i * 37) % 101)
console.log(
  par(values).every((v) => v < 101),
  par(values).some((v) => v === 100),
  par(values).findIndex((v) => v === 100)
)
console.log(
  describe(() => {
    const [a, b] = join(
      () => range(0, 1000).reduce((x, y) => x + y, 0),
      (): number => {
        if (values.length > 0) throw new Rejected(-1)
        return 0
      }
    )
    return a + b
  })
)

// The language's own errors, built inside a task.
console.log(
  describe(() =>
    par(values)
      .map((v, i) => {
        if (v === 77) throw new RangeError(`${v} at ${i}`)
        return v
      })
      .reduce((a, b) => a + b, 0)
  )
)

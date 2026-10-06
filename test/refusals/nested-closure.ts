// expect: assigns
import { range } from '@geastack/parallel'

let total = 0
range(0, 4).map((i) => {
  const bump = (): void => {
    total += i
  }
  bump()
  return i
})
console.log(total)

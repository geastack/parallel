// expect: calls set on an object that existed before the parallel region
import { range } from '@geastack/parallel'

const index = new Map<number, number>()
range(0, 16).map((i) => {
  index.set(i, i * i)
  return i
})
console.log(index.size)

// expect: calls push on an object that existed before the parallel region
import { range } from '@geastack/parallel'

const seen: number[] = []
range(0, 100).map((i) => {
  seen.push(i)
  return i
})
console.log(seen.length)

// expect: calls push on an object that existed before the parallel region
import { range } from '@geastack/parallel'

const log: string[] = []
function record(message: string): void {
  log.push(message)
}
range(0, 4).map((i) => {
  record(`task ${i}`)
  return i
})
console.log(log.length)

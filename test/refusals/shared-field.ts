// expect: writes to an object that existed before the parallel region
import { par } from '@geastack/parallel'

class Counter {
  hits = 0
}
const counter = new Counter()
const values = [1, 2, 3, 4]
par(values).map((value) => {
  counter.hits = counter.hits + value
  return value
})
console.log(counter.hits)

// expect: writes to an object that existed before the parallel region
import { par } from '@geastack/parallel'

class Lazy {
  reads = 0
  get value(): number {
    this.reads++
    return 7
  }
}
const lazy = new Lazy()
const values = [1, 2, 3]
par(values).map((v) => v + lazy.value)
console.log(lazy.reads)

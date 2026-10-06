// expect: writes to an object that existed before the parallel region
import { range } from '@geastack/parallel'

class Tally {
  count = 0
  bump(by: number): number {
    this.count += by
    return this.count
  }
}
const tally = new Tally()
range(0, 4).map((i) => tally.bump(i))
console.log(tally.count)

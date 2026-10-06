// expect: assigns
import { par } from '@geastack/parallel'

let total = 0
const values = [1, 2, 3, 4, 5, 6, 7, 8]
par(values).map((value) => {
  total += value
  return value
})
console.log(total)

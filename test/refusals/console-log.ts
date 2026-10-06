// expect: calls console.log
import { range } from '@geastack/parallel'

const squares = range(0, 100).map((i) => {
  console.log(i)
  return i * i
})
console.log(squares.length)

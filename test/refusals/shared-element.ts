// expect: writes to an object that existed before the parallel region
import { range } from '@geastack/parallel'

const grid: number[] = [0, 0, 0, 0, 0, 0, 0, 0]
range(0, 8).map((i) => {
  grid[7 - i] = i
  return i
})
console.log(grid.join(','))

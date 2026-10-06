// expect: writes to an object that existed before the parallel region
import { par } from '@geastack/parallel'

interface Point {
  x: number
  y: number
}
const points: Point[] = [
  { x: 1, y: 2 },
  { x: 3, y: 4 }
]
par(points).map((point) => {
  point.x = point.y
  return point.x
})
console.log(points[0]!.x)

import { join, par, range, sorted } from '@geastack/parallel'

interface Point {
  readonly x: number
  readonly y: number
}

const points: Point[] = []
for (let i = 0; i < 100000; i++) points.push({ x: i % 97, y: (i * 7) % 113 })

const lengths = par(points).map((p) => Math.sqrt(p.x * p.x + p.y * p.y))
console.log(lengths.length, Math.round(lengths[12345]! * 1000))

const far = par(points).filter((p) => p.x + p.y > 150)
console.log(far.length, far[0]!.x, far[0]!.y)

console.log(
  range(0, 1000000).mapReduce(
    (i) => i * i,
    (a, b) => a + b,
    0
  )
)
console.log(
  par(points).every((p) => p.x < 97),
  par(points).some((p) => p.y === 112),
  par(points).findIndex((p) => p.x === 50 && p.y === 1)
)

const pairs = par(points).flatMap((p) => (p.x === 0 ? [p.y, -p.y - 1] : []))
console.log(pairs.length, pairs[1])

const words = range(0, 20000).map((i) => 'w' + ((i * 7919) % 1000))
const order = sorted(words, (a, b) => (a < b ? -1 : a > b ? 1 : 0))
console.log(order[0], order[order.length - 1], order.length)

const [a, b] = join(
  () => range(0, 1000).reduce((x, y) => x + y, 0),
  () => par(words).filter((w) => w.endsWith('7')).length
)
console.log(a, b)

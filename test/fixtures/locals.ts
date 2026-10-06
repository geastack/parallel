// Everything a task may do to what it allocated itself: the region checker
// must certify all of it, and every thread count must print the same thing.
import { par, range, sorted } from '@geastack/parallel'

class Histogram {
  readonly buckets: number[] = []
  total = 0
  constructor(size: number) {
    for (let i = 0; i < size; i++) this.buckets.push(0)
  }
  add(value: number): void {
    this.buckets[value % this.buckets.length] = this.buckets[value % this.buckets.length]! + 1
    this.total++
  }
}

const words = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa']

// A closure the task allocated writes the task's own `let`.
const sums = range(0, 64).map((task) => {
  let sum = 0
  const add = (value: number): void => {
    sum += value
  }
  for (let i = 0; i <= task; i++) add(i)
  return sum
})

// Local class instances, Maps and arrays, mutated freely.
const histograms = range(0, 32).map((task) => {
  const histogram = new Histogram(7)
  for (let i = 0; i < 100 + task; i++) histogram.add(i * 31 + task)
  const counts = new Map<string, number>()
  for (const word of words) {
    const key = word.slice(0, 1 + (task % 3))
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return histogram.total + histogram.buckets[3]! + counts.size
})

// Reading shared data, builtin callbacks, and string work.
const lengths = par(words).map((word, index) =>
  word
    .split('')
    .map((letter) => letter.charCodeAt(0))
    .filter((code) => code % 2 === index % 2)
    .reduce((a, b) => a + b, 0)
)
const longest = par(words).mapReduce(
  (word) => word,
  (a, b) => (b.length > a.length ? b : a),
  ''
)
const ordered = sorted(words, (a, b) => (a < b ? -1 : a > b ? 1 : 0))

console.log(
  sums[63],
  sums.reduce((a, b) => a + b, 0)
)
console.log(histograms.reduce((a, b) => a + b, 0))
console.log(lengths.join(','), longest, ordered.join(' '))

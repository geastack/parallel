// expect: calls Math.random
import { range } from '@geastack/parallel'

const noise = range(0, 100).map((i) => i + Math.random())
console.log(noise.length)

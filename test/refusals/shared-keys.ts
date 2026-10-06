// expect: enumerates the keys of an object that existed before the parallel region
import { range } from '@geastack/parallel'

interface Settings {
  width: number
  height?: number
}
const settings: Settings = { width: 3 }
const counts = range(0, 4).map((i) => Object.keys(settings).length + i)
console.log(counts.join(','))

// expect: writes to an object that existed before the parallel region
import { range } from '@geastack/parallel'

class Registry {
  static created = 0
}
range(0, 4).map((i) => {
  Registry.created = Registry.created + 1
  return i
})
console.log(Registry.created)

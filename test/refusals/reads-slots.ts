// expect: reads an array whose slots the tasks of this region are writing
import { tasks } from '@geastack/parallel/native'

const slots: number[] = [0, 0, 0, 0]
tasks(4, (index) => {
  slots[index] = index > 0 ? slots[index - 1]! + 1 : 1
  return false
})
console.log(slots.join(','))

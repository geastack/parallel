// expect: calls push on an object that existed before the parallel region
import { range } from '@geastack/parallel'

const shared: number[] = []
range(0, 4).map((i) => {
  const holder = { list: shared, count: 0 }
  holder.count++
  holder.list.push(i)
  return holder.count
})
console.log(shared.length)

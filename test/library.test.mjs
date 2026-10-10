// The library's meaning under Node, which is its definition everywhere: each
// operation against the `Array.prototype` method it stands for, including the
// order callbacks run in, which exception escapes, and where an early exit
// stops.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join, par, range, sorted } from '@geastack/parallel'
import { tasks } from '@geastack/parallel/native'

const sizes = [0, 1, 2, 7, 1023, 1024, 1025, 5000]
const input = (length) => Array.from({ length }, (_, index) => (index * 7919) % 1000)

test('map, filter and flatMap equal the Array methods at every size', () => {
  for (const length of sizes) {
    const items = input(length)
    assert.deepEqual(
      par(items).map((value, index) => value * 2 + index),
      items.map((value, index) => value * 2 + index)
    )
    assert.deepEqual(
      par(items).filter((value) => value % 3 === 0),
      items.filter((value) => value % 3 === 0)
    )
    assert.deepEqual(
      par(items).flatMap((value) => (value % 2 ? [value, -value] : [])),
      items.flatMap((value) => (value % 2 ? [value, -value] : []))
    )
  }
})

test('callbacks run in index order, once each', () => {
  const seen = []
  par(input(3000)).map((_, index) => seen.push(index))
  assert.deepEqual(
    seen,
    Array.from({ length: 3000 }, (_, index) => index)
  )
})

test('every, some and findIndex answer the lowest index and stop there', () => {
  const items = input(4000)
  const target = items.findIndex((value) => value > 990)
  const visited = []
  assert.equal(
    par(items).findIndex((value, index) => {
      visited.push(index)
      return value > 990
    }),
    target
  )
  assert.equal(visited.at(-1), target)
  assert.equal(
    par(items).some((value) => value > 990),
    true
  )
  assert.equal(
    par(items).every((value) => value < 1000),
    true
  )
  assert.equal(
    par(items).every((value) => value < 990),
    false
  )
  assert.equal(
    par([]).findIndex(() => true),
    -1
  )
})

test('an exception escapes from the lowest index, and none past a decision', () => {
  const items = input(3000)
  assert.throws(
    () =>
      par(items).map((_, index) => {
        if (index === 1500 || index === 2500) throw new Error(`at ${index}`)
        return index
      }),
    /at 1500/
  )
  // findIndex decides at 10; the throw at 2000 is past it and never happens.
  assert.equal(
    par(items).findIndex((_, index) => {
      if (index === 2000) throw new Error('past the decision')
      return index === 10
    }),
    10
  )
})

test('reduce and mapReduce fold in a fixed, size-only order', () => {
  for (const length of sizes) {
    const items = input(length).map((value) => value / 7)
    const leaves = Math.min(length, 1024)
    let expected = 0
    for (let leaf = 0; leaf < leaves; leaf++) {
      let partial = 0
      const end = Math.floor(((leaf + 1) * length) / leaves)
      for (let index = Math.floor((leaf * length) / leaves); index < end; index++) partial += items[index]
      expected += partial
    }
    assert.equal(
      par(items).reduce((a, b) => a + b, 0),
      expected
    )
    assert.equal(
      par(items).mapReduce(
        (value) => value * 2,
        (a, b) => a + b,
        0
      ),
      expected * 2
    )
  }
})

test('range reads integers without an array', () => {
  assert.deepEqual(
    range(3, 9).map((value) => value),
    [3, 4, 5, 6, 7, 8]
  )
  assert.deepEqual(
    range(5, 5).map((value) => value),
    []
  )
  assert.deepEqual(
    range(9, 3).map((value) => value),
    []
  )
  assert.equal(
    range(0, 10001).reduce((a, b) => a + b, 0),
    50005000
  )
})

test('sorted is a stable sort that leaves its input alone', () => {
  for (const length of sizes) {
    const items = input(length).map((value, index) => ({ key: value % 17, index }))
    const before = items.map((item) => item.index)
    const compare = (a, b) => a.key - b.key
    assert.deepEqual(sorted(items, compare), [...items].sort(compare))
    assert.deepEqual(
      items.map((item) => item.index),
      before
    )
  }
})

test('sorted equals the stable Array sort on every input shape', () => {
  const lengths = [0, 1, 2, 3, 5, 255, 256, 257, 511, 513, 4099, 65537]
  const shapes = {
    random: (length) => Array.from({ length }, (_, index) => (index * 2654435761) % 4093),
    duplicates: (length) => Array.from({ length }, (_, index) => (index * 7919) % 5),
    equal: (length) => Array.from({ length }, () => 3),
    ascending: (length) => Array.from({ length }, (_, index) => index),
    descending: (length) => Array.from({ length }, (_, index) => length - index),
    sawtooth: (length) => Array.from({ length }, (_, index) => index % 300)
  }
  for (const [shape, keys] of Object.entries(shapes)) {
    for (const length of lengths) {
      const items = keys(length).map((key, index) => ({ key, index }))
      const compare = (a, b) => a.key - b.key
      const expected = [...items].sort(compare).map((item) => item.index)
      assert.deepEqual(
        sorted(items, compare).map((item) => item.index),
        expected,
        `${shape} at length ${length}`
      )
      // Descending by key, so ties still come out in input order.
      const reverse = (a, b) => b.key - a.key
      assert.deepEqual(
        sorted(items, reverse).map((item) => item.index),
        [...items].sort(reverse).map((item) => item.index),
        `${shape} reversed at length ${length}`
      )
    }
  }
})

test('sorted returns a permutation even for an inconsistent comparator', () => {
  for (const length of [...sizes, 65537]) {
    const items = input(length)
    let turn = 0
    const result = sorted(items, () => ((turn = (turn * 1103515245 + 12345) % 2147483648) % 3) - 1)
    assert.deepEqual(
      [...result].sort((a, b) => a - b),
      [...items].sort((a, b) => a - b)
    )
  }
})

test('join runs both and returns both; the first exception wins', () => {
  assert.deepEqual(
    join(
      () => 1,
      () => 'two'
    ),
    [1, 'two']
  )
  assert.throws(
    () =>
      join(
        () => {
          throw new Error('first')
        },
        () => {
          throw new Error('second')
        }
      ),
    /first/
  )
})

test('tasks stops at the first index that decides', () => {
  const ran = []
  tasks(10, (index) => {
    ran.push(index)
    return index === 4
  })
  assert.deepEqual(ran, [0, 1, 2, 3, 4])
})

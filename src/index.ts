import { tasks, type int } from '@geastack/parallel/native'

export type { int }

/**
 * Data parallelism with ordinary JavaScript meaning.
 *
 * Every operation here is DEFINED by the sequential program it compiles to
 * under Node: split the input into leaves whose boundaries depend on its
 * length alone, run each leaf in index order, combine the leaves in index
 * order. Under GeaStack the leaves run on every core. Nothing about a result
 * -- not the order of a filter, not the last bit of a floating-point
 * reduction, not which exception escapes -- depends on how many threads ran
 * it, because nothing in the definition mentions threads. The compiler
 * refuses a program whose callbacks could tell the difference (a write to
 * anything that existed before the call, I/O, a random number); see
 * docs/DESIGN.md.
 */

/** The most leaves one operation is cut into, whatever the machine. A constant, so a result never depends on the core count. */
const maxLeaves = 1024

const leavesFor = (length: number): number => (length < maxLeaves ? length : maxLeaves)

/** Where leaf `leaf` of `leaves` starts in `[0, length)`; leaf `leaves` is the end. */
const boundary = (leaf: number, leaves: number, length: number): number => Math.floor((leaf * length) / leaves)

/** `leaves` empty arrays, one result slot per leaf: the only thing a leaf writes that it did not allocate itself. */
function slotsOf<U>(leaves: number): U[][] {
  const slots: U[][] = []
  for (let leaf = 0; leaf < leaves; leaf++) slots.push([])
  return slots
}

// `flat` rather than a push per element: the runtime sizes the result once and
// copies each part as a block.
function concatenated<U>(parts: readonly (readonly U[])[]): U[] {
  return parts.flat()
}

/** One slot per leaf, `-1` until the leaf finds what it is looking for. */
function hitSlotsOf(leaves: number): number[] {
  const hits: number[] = []
  for (let leaf = 0; leaf < leaves; leaf++) hits.push(-1)
  return hits
}

function firstHit(hits: readonly number[]): number {
  for (const hit of hits) {
    if (hit >= 0) return hit
  }
  return -1
}

/**
 * The parallel operations over one source, read by index.
 *
 * A source is anything with a length and an element at each index: an array
 * (`par`) or the integers of a range (`range`). Each operation reads elements
 * only; none of them writes the source.
 */
export interface ParallelOperations<T> {
  /** `Array.prototype.map`. */
  map<U>(fn: (value: T, index: int) => U): U[]
  /** `Array.prototype.filter`, in input order. */
  filter(fn: (value: T, index: int) => boolean): T[]
  /** `Array.prototype.flatMap` for a callback that returns an array. */
  flatMap<U>(fn: (value: T, index: int) => readonly U[]): U[]
  /** `Array.prototype.every`. Stops early, and an element after the first failing one never decides the answer or its exception. */
  every(fn: (value: T, index: int) => boolean): boolean
  /** `Array.prototype.some`. */
  some(fn: (value: T, index: int) => boolean): boolean
  /** `Array.prototype.findIndex`: the LOWEST matching index, or -1. */
  findIndex(fn: (value: T, index: int) => boolean): number
  /**
   * Combines every element with an associative `combine` whose `identity`
   * leaves a value unchanged. Defined as: fold each leaf left to right from
   * `identity`, then fold the leaf results left to right from `identity`.
   * For an associative, exact operation that is `Array.prototype.reduce`;
   * for floating-point addition it is a fixed, thread-count-independent
   * summation order that Node computes identically.
   */
  reduce(combine: (left: T, right: T) => T, identity: T): T
  /** `map` then `reduce`, without the intermediate array. */
  mapReduce<U>(fn: (value: T, index: int) => U, combine: (left: U, right: U) => U, identity: U): U
}

/**
 * The shared implementation: `read(index)` is the element at an index. Kept
 * as one class with the source as a callback rather than one class per source
 * kind, so every operation is written once.
 */
export class Operations<T> implements ParallelOperations<T> {
  constructor(
    private readonly length: number,
    private readonly read: (index: int) => T
  ) {}

  map<U>(fn: (value: T, index: int) => U): U[] {
    const length = this.length
    const read = this.read
    const leaves = leavesFor(length)
    const parts = slotsOf<U>(leaves)
    tasks(leaves, (leaf) => {
      const end: int = boundary(leaf + 1, leaves, length)
      const out: U[] = []
      for (let index: int = boundary(leaf, leaves, length); index < end; index++) out.push(fn(read(index), index))
      parts[leaf] = out
      return false
    })
    return concatenated(parts)
  }

  filter(fn: (value: T, index: int) => boolean): T[] {
    const length = this.length
    const read = this.read
    const leaves = leavesFor(length)
    const parts = slotsOf<T>(leaves)
    tasks(leaves, (leaf) => {
      const end: int = boundary(leaf + 1, leaves, length)
      const out: T[] = []
      for (let index: int = boundary(leaf, leaves, length); index < end; index++) {
        const value = read(index)
        if (fn(value, index)) out.push(value)
      }
      parts[leaf] = out
      return false
    })
    return concatenated(parts)
  }

  flatMap<U>(fn: (value: T, index: int) => readonly U[]): U[] {
    const length = this.length
    const read = this.read
    const leaves = leavesFor(length)
    const parts = slotsOf<U>(leaves)
    tasks(leaves, (leaf) => {
      const end: int = boundary(leaf + 1, leaves, length)
      const out: U[] = []
      for (let index: int = boundary(leaf, leaves, length); index < end; index++) {
        for (const value of fn(read(index), index)) out.push(value)
      }
      parts[leaf] = out
      return false
    })
    return concatenated(parts)
  }

  every(fn: (value: T, index: int) => boolean): boolean {
    return this.findIndex((value, index) => !fn(value, index)) < 0
  }

  some(fn: (value: T, index: int) => boolean): boolean {
    return this.findIndex(fn) >= 0
  }

  findIndex(fn: (value: T, index: int) => boolean): number {
    const length = this.length
    const read = this.read
    const leaves = leavesFor(length)
    const hits = hitSlotsOf(leaves)
    tasks(leaves, (leaf) => {
      const end: int = boundary(leaf + 1, leaves, length)
      for (let index: int = boundary(leaf, leaves, length); index < end; index++) {
        if (fn(read(index), index)) {
          hits[leaf] = index
          return true
        }
      }
      return false
    })
    return firstHit(hits)
  }

  reduce(combine: (left: T, right: T) => T, identity: T): T {
    return this.mapReduce((value) => value, combine, identity)
  }

  mapReduce<U>(fn: (value: T, index: int) => U, combine: (left: U, right: U) => U, identity: U): U {
    const length = this.length
    const read = this.read
    const leaves = leavesFor(length)
    const parts = slotsOf<U>(leaves)
    tasks(leaves, (leaf) => {
      const end: int = boundary(leaf + 1, leaves, length)
      let accumulator = identity
      for (let index: int = boundary(leaf, leaves, length); index < end; index++) accumulator = combine(accumulator, fn(read(index), index))
      parts[leaf] = [accumulator]
      return false
    })
    let result = identity
    for (const part of parts) result = combine(result, part[0]!)
    return result
  }
}

/** Parallel operations over the elements of `items`, which none of them writes. */
export function par<T>(items: readonly T[]): Operations<T> {
  return new Operations<T>(items.length, (index) => items[index]!)
}

/**
 * Parallel operations over the integers `start, start + 1, ..., end - 1`,
 * without building the array. A bound that is not an integer is truncated
 * toward zero first, in every runtime, so the values are always `int`s.
 */
export function range(start: number, end: number): Operations<int> {
  const first: int = Math.trunc(start)
  const last: int = Math.trunc(end)
  return new Operations<int>(last > first ? last - first : 0, (index) => first + index)
}

/**
 * Runs `a` and `b`, possibly at the same time, and returns both results. As
 * `[a(), b()]` under Node; an exception from `a` wins over one from `b`.
 */
export function join<A, B>(a: () => A, b: () => B): [A, B] {
  const first: A[][] = [[], []]
  const second: B[][] = [[], []]
  tasks(2, (index) => {
    if (index === 0) first[index] = [a()]
    else second[index] = [b()]
    return false
  })
  return [first[0]![0]!, second[1]![0]!]
}

/**
 * The leaves a sort is cut into, and the pieces its output is cut into. A
 * constant, so the result never depends on the core count.
 */
const sortLeaves = 256

/** Samples taken from each sorted leaf to choose the splitters between output pieces. */
const sortSamples = 8

/** The first index of a sorted `run` whose element sorts strictly after `value`. */
function upperBound<T>(run: readonly T[], value: T, compare: (left: T, right: T) => number): int {
  let low: int = 0
  let high: int = run.length
  while (low < high) {
    const middle: int = Math.floor((low + high) / 2)
    if (compare(run[middle]!, value) > 0) high = middle
    else low = middle + 1
  }
  return low
}

/**
 * A stable sort, in parallel: returns a new array and leaves `items` alone.
 *
 * A sample sort with a fixed shape. The input is cut into `sortLeaves`
 * leaves, each sorted with the stable `Array.prototype.sort`. Samples from the
 * sorted leaves choose `sortLeaves - 1` splitters, and output piece `p` is
 * every element sorting after splitter `p - 1` and not after splitter `p`:
 * each piece gathers its range from every leaf, in leaf order, and sorts that
 * -- a concatenation of sorted runs, which the stable sort merges. Gathering
 * in leaf order is what keeps equal elements in input order, and because a
 * range is closed under "compares equal", every equal element lands in the
 * same piece. For a consistent comparator the result is exactly
 * `[...items].sort(compare)`; for any comparator it is a permutation, since
 * each leaf's cut points are forced to be non-decreasing.
 */
export function sorted<T>(items: readonly T[], compare: (left: T, right: T) => number): T[] {
  const length = items.length
  if (length === 0) return []
  const leaves = slotsOf<T>(sortLeaves)
  tasks(sortLeaves, (leaf) => {
    const out = items.slice(boundary(leaf, sortLeaves, length), boundary(leaf + 1, sortLeaves, length))
    out.sort(compare)
    leaves[leaf] = out
    return false
  })

  const pool: T[] = []
  for (const run of leaves) {
    for (let sample = 1; sample <= sortSamples; sample++) {
      const at: int = Math.floor((sample * run.length) / (sortSamples + 1))
      if (at < run.length) pool.push(run[at]!)
    }
  }
  pool.sort(compare)
  const splitters: T[] = []
  for (let piece = 1; piece < sortLeaves; piece++) splitters.push(pool[Math.floor((piece * pool.length) / sortLeaves)]!)

  // Copies, not `leaves` and `cuts` themselves: a region reads them while
  // writing a fresh set of slots, and every slot array comes from the one
  // allocation in `slotsOf`, so only a copy shows the compiler they differ.
  const runs = leaves.slice()
  // Where each leaf is cut between pieces: `cuts[leaf][p]` is the first of
  // its elements in piece `p`.
  const cuts = slotsOf<int>(sortLeaves)
  tasks(sortLeaves, (leaf) => {
    const run = runs[leaf]!
    const at: int[] = [0]
    let previous: int = 0
    for (const splitter of splitters) {
      const cut: int = upperBound(run, splitter, compare)
      previous = cut > previous ? cut : previous
      at.push(previous)
    }
    at.push(run.length)
    cuts[leaf] = at
    return false
  })

  const leafCuts = cuts.slice()
  const pieces = slotsOf<T>(sortLeaves)
  tasks(sortLeaves, (piece) => {
    const out: T[] = []
    for (let leaf = 0; leaf < sortLeaves; leaf++) {
      const run = runs[leaf]!
      const bounds = leafCuts[leaf]!
      const end: int = bounds[piece + 1]!
      for (let index: int = bounds[piece]!; index < end; index++) out.push(run[index]!)
    }
    out.sort(compare)
    pieces[piece] = out
    return false
  })
  return concatenated(pieces)
}

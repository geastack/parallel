# @geastack/parallel

Multithreaded array operations for TypeScript programs compiled with [GeaStack](https://geastack.com), inspired by Rayon.

```ts
import { par, range, sorted } from '@geastack/parallel'

const lengths = par(words).map((word) => word.length)
const primeCount = range(2, 10_000_000).mapReduce(
  (n) => (isPrime(n) ? 1 : 0),
  (a, b) => a + b,
  0
)
const ranked = sorted(players, (a, b) => b.score - a.score)
```

Compiled with GeaStack, each of these calls splits its input across every CPU core. A program whose callbacks could give a different answer depending on which thread ran first fails to compile.

The same code also runs under Node, one element at a time. That isn't faster than writing the loop yourself; it's there so you can test and debug your program with ordinary tools. The compiled program gives exactly the Node result, down to the last bit of a floating-point sum.

- [Install](#install)
- [Using it](#using-it)
- [What a callback may do](#what-a-callback-may-do)
- [API](#api)
- [Determinism](#determinism)
- [Performance](#performance)
- [Development](#development)

## Install

```sh
npm install @geastack/parallel
```

Compile your program with GeaStack (`@geastack/compiler` 1.0.27 or later). `gea build` loads the library's compiler plugin automatically from your dependencies. If you call the compiler directly, pass the plugin yourself:

```sh
geatsc compile src/main.ts --out-dir build --plugin node_modules/@geastack/parallel/plugin/index.mjs
```

## Using it

Wrap an array in `par`, or describe a range of integers with `range`, then call an operation on it:

```ts
import { par, range } from '@geastack/parallel'

// Every element, transformed. The result is in input order.
const squares = par(values).map((x) => x * x)

// Elements that pass a test, in input order.
const active = par(users).filter((user) => user.lastSeen > cutoff)

// The integers 0..n-1, without building an array of them.
const row = range(0, width).map((x) => shade(x, y))

// Stops early: once a match is found, later elements are not examined.
const hasNegative = par(values).some((x) => x < 0)
const firstBad = par(records).findIndex((record) => !isValid(record))
```

Callbacks receive `(value, index)`, like the `Array.prototype` methods.

`reduce` takes a different shape from `Array.prototype.reduce`. You pass a `combine` function and its `identity`, the value that leaves anything unchanged when combined with it: `0` for addition, `1` for multiplication, `''` for string concatenation, `-Infinity` for max. `combine` must be associative (`combine(a, combine(b, c))` equals `combine(combine(a, b), c)`), because the input is combined in pieces and the pieces are then combined with each other.

```ts
const total = par(prices).reduce((a, b) => a + b, 0)
const longest = par(words).mapReduce(
  (word) => word.length,
  (a, b) => Math.max(a, b),
  0
)
```

`mapReduce` is `map` followed by `reduce`, without building the intermediate array.

To run two independent computations at once, use `join`:

```ts
const [left, right] = join(
  () => build(leftHalf),
  () => build(rightHalf)
)
```

To sort, use `sorted`. It returns a new array and leaves the input unchanged. The sort is stable: elements that compare equal keep their input order, exactly as with `[...items].sort(compare)`.

```ts
const byDate = sorted(events, (a, b) => a.time - b.time)
```

## What a callback may do

A callback may read anything: shared arrays, objects, closures, module constants. It may allocate anything, from strings and arrays to class instances and whole trees, and return it.

A callback may not do anything whose result would depend on which thread got there first. When GeaStack compiles your program, it checks every callback passed to the library, along with every function those callbacks call. A program that does any of the following is refused, with an error naming the operation and its source position:

- assigning to a variable declared outside the callback;
- writing to an object or array that existed before the call (`shared.push(x)`, `cache[key] = value`, `counter.n++`);
- `console.log` or other I/O;
- `Math.random()` or `Date.now()`.

```
parallel region assigns `total`, a variable that existed before the parallel region (first at main.ts:7:3)
```

The fix is almost always to return the value instead of storing it. For example, rewrite

```ts
let total = 0
par(values).map((x) => {
  total += x
})
```

as

```ts
const total = par(values).reduce((a, b) => a + b, 0)
```

These rules are only checked when compiling. Under Node nothing stops you, so code that runs fine in Node can still be refused by the compiler.

Exceptions behave as they would in a sequential loop. If several callbacks throw, the program sees the exception from the lowest index, which is the one a loop would have hit first.

## API

### `par(items)`

Parallel operations over the elements of an array. None of them modifies `items`.

### `range(start, end)`

Parallel operations over the integers `start, start + 1, …, end - 1`. Non-integer bounds are truncated toward zero. An empty range has no elements.

### Operations

`par(...)` and `range(...)` both return an object with these methods:

| method                              | returns                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `.map(fn)`                          | a new array of `fn(value, index)`, like `Array.prototype.map`               |
| `.filter(fn)`                       | the elements for which `fn` returns `true`, in input order                  |
| `.flatMap(fn)`                      | the concatenation of the arrays `fn` returns, in input order                |
| `.every(fn)`                        | `true` if `fn` returns `true` for every element; stops at the first `false` |
| `.some(fn)`                         | `true` if `fn` returns `true` for any element; stops at the first `true`    |
| `.findIndex(fn)`                    | the lowest index for which `fn` returns `true`, or `-1`                     |
| `.reduce(combine, identity)`        | every element combined with an associative `combine`; `identity` if empty   |
| `.mapReduce(fn, combine, identity)` | `.map(fn).reduce(combine, identity)`, without the intermediate array        |

### `join(a, b)`

Calls `a()` and `b()`, possibly at the same time, and returns `[a(), b()]`. If both throw, the exception from `a` wins.

### `sorted(items, compare)`

A new array holding the elements of `items`, sorted stably by `compare`. Gives the same result as `[...items].sort(compare)` for any consistent comparator.

### `int`

The index type passed to callbacks. It is a `number` under Node and a 64-bit integer when compiled, so loops and array accesses in a callback stay in integer arithmetic.

### `GEA_PARALLEL_THREADS`

An environment variable read by a compiled program at startup. It sets the number of threads. The default is the number of hardware threads. `GEA_PARALLEL_THREADS=1` runs everything on the calling thread.

## Determinism

A result never depends on how many threads computed it. Every operation cuts its input into at most 1024 pieces, with boundaries that depend only on the input's length. It processes each piece in order and combines the pieces in order. Threads only decide which pieces run where, and the definition doesn't mention them. As a result:

- `map`, `filter` and `flatMap` keep input order;
- `findIndex` finds the lowest matching index, never just any match;
- a floating-point `reduce` adds in the same order on 1 thread, 20 threads and under Node. That order is fixed by the input length, so the last bit can differ from a plain left-to-right `Array.prototype.reduce`, but never from one machine or run to the next.

[`docs/DESIGN.md`](docs/DESIGN.md) covers what the compiler proves, how the runtime keeps reference counting sound across threads without atomics, and how exceptions and early exits are made exact.

## Performance

Milliseconds, best of seven, on a Ryzen 9 9900X3D under WSL2, 20 threads. Node and GeaStack run the same TypeScript source. Rust and C++ run the same algorithms, written for Rayon and for a hand-written `std::thread` pool.

| workload      | Node | GeaStack ×1 | GeaStack ×20 | Rust + Rayon ×20 | C++ ×20 |
| ------------- | ---: | ----------: | -----------: | ---------------: | ------: |
| binary-trees  |  391 |         583 |         72.0 |              113 |    99.7 |
| collatz       | 2893 |         250 |         14.7 |             14.9 |    14.5 |
| mandelbrot    |  562 |         556 |         33.5 |             34.8 |    34.2 |
| matmul        |  209 |         185 |         14.9 |             23.6 |    14.8 |
| nqueens       | 32.5 |        21.8 |         1.72 |             2.80 |    1.68 |
| primes        |  490 |         486 |         42.0 |             41.7 |    42.6 |
| sort          |  643 |        77.7 |         21.8 |             25.1 |    38.4 |
| spectral-norm |  345 |         140 |         12.8 |             12.3 |    16.7 |
| strings       |  338 |        80.1 |         7.61 |             7.92 |    7.66 |

Taking the geometric mean over the nine workloads, GeaStack at 20 threads is 23× faster than Node, 1.19× faster than Rayon and 1.14× faster than the C++ pool. It scales 10.6× from 1 to 20 threads. The sources, the scriptc and single-thread columns, and how each gap to Rayon was closed are in [`geastack/benchmarks`](https://github.com/geastack/benchmarks/tree/main/node/parallel).

## Development

```sh
npm run build          # compile src/ to dist/
npm test               # the library's behaviour under Node
npm run test:refusals  # every unsafe program in test/refusals is refused, every fixture compiles (needs @geastack/compiler)
npm run test:native    # builds each fixture natively at 1 and all threads, under TSan and ASan, and compares with Node (needs a Linux host with clang++)
```

## License

Apache-2.0

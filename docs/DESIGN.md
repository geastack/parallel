# @geastack/parallel — design

`@geastack/parallel` brings Rayon-style data parallelism to TypeScript without giving up ordinary JavaScript semantics. The same source file:

- under **Node** (or any JavaScript engine), runs **sequentially**, on one thread, as plain JavaScript; and
- under **GeaStack** (geatsc → C++), runs on **every core**, and produces **the same answer, bit for bit**.

The second property is not a hope. Two rules guarantee it:

1. **The library is defined by its sequential program.** Nothing in the definition of any operation mentions threads, so no result can depend on how many threads ran it.
2. **The compiler refuses a program that could tell the difference.** Any callback that could observe the order tasks ran in is a compile error that names the offending operation. It is never a race at run time.

## API

```ts
import { par, range, join, sorted } from '@geastack/parallel'

par(items).map((value, index) => ...)            // Array.prototype.map
par(items).filter(fn)                            // filter, in input order
par(items).flatMap(fn)                           // flatMap of an array-returning callback
par(items).every(fn) / .some(fn)                 // short-circuiting
par(items).findIndex(fn)                         // the LOWEST matching index
par(items).reduce(combine, identity)             // associative reduction
par(items).mapReduce(fn, combine, identity)      // map + reduce, no intermediate array
range(start, end).map(...) / .mapReduce(...)     // the integers [start, end) without an array
join(a, b)                                       // [a(), b()], possibly at the same time
sorted(items, compare)                           // stable parallel merge sort; a new array
```

Each operation's doc comment states which `Array.prototype` method it is equivalent to. `reduce` and `mapReduce` need an associative `combine` and its `identity`. For an exact operation such as integer addition, max, or string concatenation, the result equals `Array.prototype.reduce`. For floating-point addition, the summation order is fixed by the input length alone. Node computes that same order, so the native answer still matches Node exactly. It may differ in the last bit from a naive left fold.

## The definition: leaves

Every operation cuts its input into **leaves** with boundaries that depend only on the input length:

```ts
const maxLeaves = 1024
leaves = min(length, maxLeaves)
leaf i covers [floor(i * length / leaves), floor((i + 1) * length / leaves))
```

Each leaf is processed left to right into its own result slot, and the slots are combined left to right. That _is_ the sequential program Node runs. It is also exactly what each native thread does with the leaves it claims. Because the leaf count is a constant (not the core count), a float reduction gives the same bits on a 1-core and a 64-core machine. The cost is that an input of fewer than about 1024 elements gives one element per leaf. That is fine: a leaf is the unit of scheduling, not of overhead, and small inputs are cheap anyway.

`sorted` is a sample sort with a fixed shape. It runs three regions, each over 256 tasks (`sortLeaves`):

1. **Sort the leaves.** The input is cut into 256 leaves, and each is copied and sorted with the stable `Array.prototype.sort`.
2. **Cut the leaves.** Eight samples from each sorted leaf, sorted together, choose 255 splitters. Each leaf then finds, by binary search, where every splitter falls in it. The cut points are forced to be non-decreasing, so for any comparator, even an inconsistent one, the output is a permutation of the input.
3. **Build the pieces.** Output piece `p` gathers, from every leaf in leaf order, the elements that sort after splitter `p - 1` and not after splitter `p`, and sorts them. The gathered elements form a run of sorted runs, which the stable sort merges.

Gathering in leaf order is what keeps equal elements in input order, and every element equal to a given one lands in the same piece. So for a consistent comparator the result is exactly `[...items].sort(compare)`. As with the other operations, the shape depends only on the input length, never on the core count.

## The one primitive: `tasks`

The library is written in plain TypeScript (`src/index.ts`) on top of exactly one native function, `tasks`, from `@geastack/parallel/native`:

```ts
export declare function tasks(count: number, body: (index: int) => boolean): void
```

Its JavaScript implementation (`native/index.js`) is the reference: `for (let i = 0; i < count; i++) if (body(i)) return`. A body that returns `true` has **decided** the operation: `findIndex` found its match, or `every` found a counterexample. A sequential loop would stop there.

`int` is GeaStack's opt-in 64-bit integer type: a `number` under Node, a `long long` when compiled. Every task and element index is an `int`, so the library's loops and a callback's array accesses stay in integer arithmetic instead of converting a double at every step.

Under GeaStack, the plugin (`plugin/index.mjs`) claims the declaration file and binds `tasks` to the runtime's `gea::parallel::tasks`. It does this by declaration file, not by name, so a program that declares its own `tasks` is never mistaken for it. It also declares `gea::parallel::tasks` a **parallel region entry**, which is what makes the compiler certify its callback. Finally, it adds `#define GEA_RUNTIME_PARALLEL 1` to the program's preamble, which turns on the region runtime described below.

The package exports the plugin as `./geatsc-plugin`, the name `gea build` looks for in each of an app's dependencies, so an app only has to depend on `@geastack/parallel`. The compiler CLI takes it with `--plugin node_modules/@geastack/parallel/plugin/index.mjs`.

### Exceptions and early exit are exact

Native tasks are claimed from one counter in index order. A task that throws or decides cancels only the tasks **above** it. Every task below it has already been claimed and runs to completion. At the join, the runtime rethrows the exception from the **lowest index below the lowest decision**. That is precisely the exception a sequential loop would have thrown. An exception from a task above a decision is discarded, because a sequential loop would never have reached that task. `test/fixtures/exceptions.ts` checks this against Node, including `RangeError`/`TypeError` thrown from inside a region.

## What the compiler proves

`compiler/src/ir/certify/parallel-region.ts` certifies every region. A program in which any region could observe its own thread count is refused with a message that names the operation and its source position, for example:

```
parallel region assigns `total`, a variable that existed before the parallel region (first at main.ts:7:3)
parallel region calls Math.random, whose answer depends on how many draws other tasks made first
parallel region calls push on an object that existed before the parallel region
```

A region is certified when every body it can reach does all of the following:

- **Writes only objects it allocated itself.** There is one sanctioned exception, the hand-off the library uses: `slots[index] = value`, keyed by the region's own task index, into an array no task of the region reads (the _disjoint-slot write_).
- **Writes no binding that existed before the region**, such as a captured `let` or a module variable.
- **Does no I/O and asks no order-dependent question.** That rules out `console`, `Math.random`, `Date.now` and `await`.
- **Calls only what the compiler can name.** That means a program function, a callable whose every origin is known, a builtin whose effect is modelled, or a host error constructor (`Error`, `TypeError`, `RangeError`, …). `AggregateError` is excluded because it iterates its argument.

Reading pre-existing data is allowed: shared arrays, objects, typed arrays, closures. Allocating is allowed, including arrays, objects, class instances, strings and whole trees.

The proof is two flow-insensitive points-to analyses. The first is a whole-program, context-insensitive analysis (Andersen-style, field-sensitive on constant keys). It answers only one question: _which functions can this callable value be?_ The second runs once per region over the bodies the region reaches. Every object that existed before the region collapses into one abstract `SHARED` object, and every allocation inside the region is its own site. A write whose target may be `SHARED` is the race, and it is refused. An unmodelled operation is also refused: the check fails closed.

`test/refusals/` holds one program per refusal class (17 of them). `node test/run-refusals.mjs` checks each is refused with the expected message, and that every fixture under `test/fixtures/` certifies.

## The runtime: non-atomic reference counts, kept sound

GeaStack's reference counts are deliberately **not atomic**, which is a large part of why single-threaded GeaStack code is fast. A certified region writes nothing that existed before it, but a _read_ still copies handles, and copying a handle writes a count. Making every count atomic would tax every program for the few that run regions, and it would still bounce the cache line of a hot shared object between all cores.

Instead (`gea_runtime.h`, `namespace gea::detail::parallel`):

- **Region ownership.** Every thread running region code, the starting thread included, owns a _region_: the 1 MiB chunks it bump-allocates from during the region. An ownership map tags each 64 KiB address granule with its region.
- **Owned counts are plain.** A count operation on an object the thread owns is the ordinary, non-atomic one, since no other thread can see that object before the join.
- **Foreign counts are deferred.** A count operation on any other object goes into the thread's own deferred table, and is applied single-threaded at the join.

The invariant that makes both halves correct: _during a region, no thread writes the header of an object it does not own._ An object that predates the region cannot die inside it, because the thread that started the region still holds the roots that reach it. Misclassifying an owned object as foreign is always safe: it is deferred and dies at the join rather than in place. The reverse never happens, because a granule is tagged only while its owner allocates into it.

- **Cycle collection inside a region.** A traced object whose count dips becomes a cycle _candidate_. A region that builds and drops many such objects (a tree per task, say) would grow the candidate buffer without bound, since the collector cannot run mid-region. So each region thread filters its _own_ candidates in place when the buffer passes its threshold: it frees the dead ones and drops the ones with no traced edges, touching only objects it owns. A full collection waits for the join.
- **Leftover memory.** At the join, free cells left in a region's chunks are donated to the joining thread's own allocation pools.
- **Thread pool.** The pool is persistent; workers sleep between regions. `GEA_PARALLEL_THREADS` sets the thread count; the default is the hardware thread count. A region started inside a region runs inline, as does a region with one task or one thread. Inline execution is exactly the sequential loop.

`GEA_RUNTIME_PARALLEL`, which the plugin defines, is incompatible with `GEA_RUNTIME_SINGLE_THREADED`, realm builds, and the compact allocator; the header refuses those combinations with `#error`.

`node test/run-native.mjs` builds every fixture natively in release mode at 1 and all threads, under ThreadSanitizer and under AddressSanitizer, and diffs each output against Node.

## Performance

See [`benchmarks/node/parallel`](https://github.com/geastack/benchmarks/tree/main/node/parallel) for nine workloads compared against Node, scriptc, Rust + Rayon and C++ with a hand-written thread pool. In short, on a 20-thread Ryzen 9 9900X3D:

- **Scaling.** GeaStack scales 10.6× from 1 to 20 threads (geometric mean), against Rayon's 9.7× and C++'s 9.5×.
- **Against Node and scriptc**, GeaStack is 23× and 86× faster, running the same library source.
- **Against Rayon**, GeaStack is 1.19× faster over the nine workloads, and no workload is slower by more than measurement noise. Against the hand-written C++ pool it is 1.14× faster. The benchmark README lists what closed each gap.

## Non-goals and limits

- **No shared mutable state, ever.** DashMap-style concurrent containers are a separate design: they need a write protocol the checker can certify. They are not a relaxation of this one.
- **No interface-typed receivers in regions yet.** The library returns the concrete `Operations<T>` class rather than the `ParallelOperations<T>` interface, because the checker cannot yet name the targets of an interface-typed receiver. The interface is still exported for documentation and typing.
- **`maxLeaves` is fixed.** Results must not depend on the machine, so the leaf count cannot follow the core count.

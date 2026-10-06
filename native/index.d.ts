/**
 * The one native primitive `@geastack/parallel` is built on.
 *
 * Calls `body(index)` for every index in `[0, count)` and returns once they
 * have all finished. A body that returns `true` has DECIDED the operation at
 * its index: no task above that index needs to run, and an exception thrown by
 * one that did run anyway is not the operation's -- a sequential loop would
 * have stopped before reaching it. The exception that escapes is the one from
 * the lowest index below every decision, exactly the one a sequential loop
 * would have thrown.
 *
 * Under Node the calls happen in index order on this thread. Under GeaStack
 * they run on every core, and the compiler refuses the program unless it can
 * prove the order is unobservable. Library code calls this; programs call the
 * operations in `@geastack/parallel`.
 */
export declare function tasks(count: number, body: (index: int) => boolean): void

declare const intBrand: unique symbol
/**
 * GeaStack's opt-in 64-bit integer, as `@geastack/core` declares it: a number
 * under Node, a `long long` when compiled. Every task and element index is an
 * integer, so typing them `int` lets a callback index its arrays and count in
 * the integers instead of converting a double at every access.
 */
export type int = number & { readonly [intBrand]?: never }

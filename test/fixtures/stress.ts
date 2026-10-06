import { par, range, sorted } from '@geastack/parallel'

class Node {
  constructor(
    readonly left: Node | null,
    readonly right: Node | null
  ) {}
}

function build(depth: number): Node {
  return depth === 0 ? new Node(null, null) : new Node(build(depth - 1), build(depth - 1))
}

function check(node: Node): number {
  return 1 + (node.left === null ? 0 : check(node.left)) + (node.right === null ? 0 : check(node.right))
}

interface Order {
  readonly id: number
  readonly customer: string
  readonly lines: readonly { readonly sku: string; readonly quantity: number; readonly price: number }[]
}

const orders: Order[] = []
for (let i = 0; i < 20000; i++) {
  const lines = []
  for (let j = 0; j < (i % 5) + 1; j++)
    lines.push({ sku: 'sku-' + ((i * 31 + j) % 400), quantity: (j % 3) + 1, price: ((i + j) % 50) + 0.25 })
  orders.push({ id: i, customer: 'c' + (i % 997), lines })
}
const shared = build(10)

for (let round = 0; round < 20; round++) {
  // Every task reads the same shared tree and allocates its own.
  const counts = range(0, 64).map((i) => check(shared) + check(build(i % 12)))
  // Records holding shared strings and shared nested arrays, rebuilt per task.
  const totals = par(orders).map((order) => {
    let total = 0
    for (const line of order.lines) total += line.quantity * line.price
    return { id: order.id, customer: order.customer, total, first: order.lines[0]! }
  })
  const big = par(totals).filter((t) => t.total > 100)
  const keys = par(orders).flatMap((o) => o.lines.map((l) => o.customer + ':' + l.sku))
  const tally = range(0, 997).map((c) => {
    const seen = new Map<string, number>()
    for (const o of orders) {
      if (o.id % 997 !== c) continue
      for (const l of o.lines) seen.set(l.sku, (seen.get(l.sku) ?? 0) + l.quantity)
    }
    return seen.size
  })
  const order = sorted(big, (a, b) => b.total - a.total || a.id - b.id)
  if (round === 19) {
    console.log(counts[63], totals.length, big.length, keys.length, tally[5], order[0]!.id, order[0]!.first.sku)
  }
}

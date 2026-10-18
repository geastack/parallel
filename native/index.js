// The sequential reference: what `tasks` means. GeaStack replaces this module
// with its native region primitive; under Node it is the implementation.
export function tasks(count, body) {
  for (let index = 0; index < count; index++) {
    if (body(index)) return
  }
}

// The sequential reference for `tabulate`: every element in index order.
export function tabulate(length, body) {
  const out = []
  for (let index = 0; index < length; index++) out.push(body(index))
  return out
}

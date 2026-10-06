// The sequential reference: what `tasks` means. GeaStack replaces this module
// with its native region primitive; under Node it is the implementation.
export function tasks(count, body) {
  for (let index = 0; index < count; index++) {
    if (body(index)) return
  }
}

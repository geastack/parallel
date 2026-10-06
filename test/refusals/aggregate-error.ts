// expect: constructs an object whose constructor the compiler cannot name
// AggregateError iterates its first argument, which runs whatever iterator the
// value carries -- not a construction the region can prove local.
import { range } from '@geastack/parallel'

const failures: Error[] = [new Error('a')]
console.log(range(0, 100).map((i) => (i === 50 ? new AggregateError(failures).message : 'ok')).length)

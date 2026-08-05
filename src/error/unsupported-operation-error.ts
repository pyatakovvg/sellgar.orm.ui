import { OperationError } from './operation-error.ts';
import type { Operation, OperationErrorOptions } from './operation-error.ts';

export class UnsupportedOperationError extends OperationError<'unsupported-operation'> {
  public override readonly name = 'UnsupportedOperationError';

  public constructor(operation: Operation, options?: OperationErrorOptions) {
    super('unsupported-operation', operation, `Operation "${operation}" is not supported`, options);
  }
}

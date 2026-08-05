import { OperationError } from './operation-error.ts';
import type { MutationOperation, OperationErrorOptions } from './operation-error.ts';

export type MutationErrorCode =
  | 'constraint-violation'
  | 'invalid-key'
  | 'record-not-cloneable'
  | 'quota-exceeded'
  | 'transaction-aborted'
  | 'operation-failed';

export type MutationPhysicalErrorCode = MutationErrorCode;

const messages: Readonly<Record<MutationErrorCode, string>> = Object.freeze({
  'constraint-violation': 'A table constraint was violated',
  'invalid-key': 'The table key is invalid',
  'record-not-cloneable': 'The record cannot be cloned for storage',
  'quota-exceeded': 'The storage quota was exceeded',
  'transaction-aborted': 'The table transaction was aborted',
  'operation-failed': 'The table operation failed',
});

export class MutationError extends OperationError<MutationErrorCode> {
  public override readonly name = 'MutationError';

  public constructor(
    code: MutationErrorCode,
    operation: MutationOperation,
    options: OperationErrorOptions,
  ) {
    super(code, operation, messages[code], options);
  }
}

import { OperationError } from './operation-error.ts';
import type { MutationOperation, OperationErrorOptions, SelectOperation, TransactionOperation } from './operation-error.ts';

export type TransactionErrorCode =
  | 'invalid-scope'
  | 'table-not-in-scope'
  | 'inactive'
  | 'premature-commit'
  | 'start-failed'
  | 'commit-failed'
  | 'aborted';

type BoundaryErrorCode = Exclude<TransactionErrorCode, 'table-not-in-scope' | 'inactive'>;
type InactiveOperation = TransactionOperation | SelectOperation | MutationOperation;

const messages: Readonly<Record<TransactionErrorCode, string>> = Object.freeze({
  'invalid-scope': 'Transaction scope is invalid',
  'table-not-in-scope': 'Table is not part of the transaction scope',
  inactive: 'Transaction is no longer active',
  'premature-commit': 'Transaction committed before the callback completed',
  'start-failed': 'Transaction could not be started',
  'commit-failed': 'Transaction could not be committed',
  aborted: 'Transaction was aborted',
});

export class TransactionError extends OperationError<TransactionErrorCode> {
  public override readonly name = 'TransactionError';

  public constructor(code: 'table-not-in-scope', operation: TransactionOperation);
  public constructor(code: 'inactive', operation: InactiveOperation);
  public constructor(code: BoundaryErrorCode, operation: 'client.transaction', options?: OperationErrorOptions);
  public constructor(
    code: TransactionErrorCode,
    operation: 'client.transaction' | InactiveOperation,
    options?: OperationErrorOptions,
  ) {
    super(code, operation, messages[code], options);
  }
}

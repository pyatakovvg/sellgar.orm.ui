import { OperationError } from './operation-error.ts';
import type { OperationErrorOptions, QueryOperation } from './operation-error.ts';

export type QueryErrorCode =
  'table-not-in-schema' | 'scan-required' | 'unsupported-order' | 'transaction-aborted' | 'operation-failed';

type BoundaryCode = Extract<QueryErrorCode, 'table-not-in-schema' | 'scan-required' | 'unsupported-order'>;
type PhysicalCode = Exclude<QueryErrorCode, BoundaryCode>;

const messages: Readonly<Record<QueryErrorCode, string>> = Object.freeze({
  'table-not-in-schema': 'Selection source table is not part of the client schema',
  'scan-required': 'Selection requires an explicitly allowed store scan',
  'unsupported-order': 'Selection order cannot be executed by the table schema',
  'transaction-aborted': 'Selection transaction was aborted',
  'operation-failed': 'Selection operation failed',
});

export class QueryError extends OperationError<QueryErrorCode> {
  public override readonly name = 'QueryError';

  public constructor(code: BoundaryCode, operation: QueryOperation);
  public constructor(code: PhysicalCode, operation: QueryOperation, options: OperationErrorOptions);
  public constructor(code: QueryErrorCode, operation: QueryOperation, options?: OperationErrorOptions) {
    super(code, operation, messages[code], options);
  }
}

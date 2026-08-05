import { OperationError, QueryError } from '../../../error/index.ts';
import type { QueryOperation } from '../../../error/index.ts';

const nameOf = (cause: unknown): string | undefined => {
  if (typeof cause !== 'object' || cause === null || !('name' in cause)) {
    return undefined;
  }

  return typeof cause.name === 'string' ? cause.name : undefined;
};

export const mapQueryError = (operation: QueryOperation, cause: unknown): OperationError =>
  cause instanceof OperationError
    ? cause
    : new QueryError(nameOf(cause) === 'AbortError' ? 'transaction-aborted' : 'operation-failed', operation, {
        cause,
      });

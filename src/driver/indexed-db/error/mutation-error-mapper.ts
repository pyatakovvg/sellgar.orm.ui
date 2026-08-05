import { MutationError, OperationError } from '../../../error';
import type { MutationOperation, MutationPhysicalErrorCode } from '../../../error';

const codes: Readonly<Record<string, MutationPhysicalErrorCode>> = Object.freeze({
  ConstraintError: 'constraint-violation',
  DataError: 'invalid-key',
  DataCloneError: 'record-not-cloneable',
  QuotaExceededError: 'quota-exceeded',
  AbortError: 'transaction-aborted',
});

const getName = (cause: unknown): string | undefined => {
  if (typeof cause !== 'object' || cause === null || !('name' in cause)) {
    return undefined;
  }

  return typeof cause.name === 'string' ? cause.name : undefined;
};

export const mapMutationError = (operation: MutationOperation, cause: unknown): OperationError => {
  if (cause instanceof OperationError) {
    return cause;
  }

  const code = codes[getName(cause) ?? ''] ?? 'operation-failed';

  return new MutationError(code, operation, {
    cause,
  });
};

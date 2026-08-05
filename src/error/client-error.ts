import { OperationError } from './operation-error.ts';
import type { ClientOperation, MutationOperation, OperationErrorOptions, SelectOperation } from './operation-error.ts';

export type ClientErrorCode =
  | 'unavailable'
  | 'version-mismatch'
  | 'open-failed'
  | 'not-open'
  | 'closed'
  | 'schema-mismatch'
  | 'table-not-in-schema';

type ClientErrorOperation = ClientOperation | SelectOperation | MutationOperation;

const messages: Readonly<Record<ClientErrorCode, string>> = Object.freeze({
  unavailable: 'Browser database storage is not available',
  'version-mismatch': 'Stored database version is not supported',
  'open-failed': 'Database could not be opened',
  'not-open': 'Client is not open',
  closed: 'Client is closed',
  'schema-mismatch': 'Client is already bound to another schema',
  'table-not-in-schema': 'Table is not part of the client schema',
});

export class ClientError extends OperationError<ClientErrorCode> {
  public override readonly name = 'ClientError';

  public constructor(code: ClientErrorCode, operation: ClientErrorOperation, options?: OperationErrorOptions) {
    super(code, operation, messages[code], options);
  }
}

export type SelectOperation = 'select.getOne' | 'select.getMany' | 'select.getRawOne' | 'select.getRawMany';

export type MutationOperation = 'insert.execute' | 'upsert.execute' | 'update.execute' | 'delete.execute';

export type QueryOperation = SelectOperation | Extract<MutationOperation, 'update.execute' | 'delete.execute'>;

export type ClientOperation =
  | 'client.open'
  | 'client.select'
  | 'client.insert'
  | 'client.upsert'
  | 'client.update'
  | 'client.delete'
  | 'client.transaction';

export type TransactionOperation =
  | 'transaction.select'
  | 'transaction.insert'
  | 'transaction.upsert'
  | 'transaction.update'
  | 'transaction.delete';

export type Operation =
  | 'configuration.validate'
  | 'schema.validate'
  | ClientOperation
  | TransactionOperation
  | SelectOperation
  | MutationOperation;

export interface OperationErrorOptions {
  readonly cause?: unknown;
}

export abstract class OperationError<Code extends string = string> extends Error {
  protected constructor(
    public readonly code: Code,
    public readonly operation: Operation,
    message: string,
    options?: OperationErrorOptions,
  ) {
    super(message, options !== undefined && 'cause' in options ? { cause: options.cause } : undefined);
  }
}

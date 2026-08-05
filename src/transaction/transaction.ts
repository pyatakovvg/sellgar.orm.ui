import { mapQueryError } from '../driver/indexed-db/error';
import { Executor as MutationExecutor, Writer } from '../driver/indexed-db/mutation';
import { Executor as SelectionExecutor } from '../driver/indexed-db/plan';
import type { MutationOperation, SelectOperation, TransactionOperation } from '../error';
import { TransactionError } from '../error';
import { createDelete, createInsert, createUpdate, createUpsert, normalizeWrite } from '../mutation';
import type {
  Delete,
  Insert,
  InsertArguments,
  InsertManyInput,
  Update,
  Upsert,
  UpsertArguments,
  UpsertManyInput,
} from '../mutation';
import { plan } from '../planner';
import { createSelect } from '../select';
import type { Select, SelectOptions } from '../select';
import type { SchemaTable } from '../schema';
import type { TableKey } from '../schema';
import { selection } from '../selection';
import type { Selection } from '../selection';
import { Transaction as PhysicalTransaction } from '../driver/indexed-db/transaction';

import type { TransactionInterface } from './transaction.interface.ts';

interface Fulfilled<Result> {
  readonly status: 'fulfilled';
  readonly value: Result;
}

interface Rejected {
  readonly status: 'rejected';
  readonly reason: unknown;
}

type CallbackOutcome<Result> = Fulfilled<Result> | Rejected;

type CompletionOutcome =
  | {
      readonly status: 'complete';
    }
  | {
      readonly status: 'failed';
      readonly cause: unknown;
    };

export class Transaction<AllowedTable extends SchemaTable> implements TransactionInterface<AllowedTable> {
  private readonly scope: ReadonlySet<SchemaTable>;
  private readonly writer: Writer;
  private readonly selectionExecutor: SelectionExecutor;
  private readonly mutationExecutor: MutationExecutor;
  private active = true;

  public constructor(
    scope: readonly AllowedTable[],
    private readonly transaction: PhysicalTransaction<string>,
    keyRange: typeof IDBKeyRange,
  ) {
    this.scope = new Set(scope);
    this.writer = Writer.scoped(transaction);
    this.selectionExecutor = SelectionExecutor.scoped(keyRange);
    this.mutationExecutor = MutationExecutor.scoped(transaction, keyRange);
  }

  public select<TableType extends AllowedTable>(table: TableType): Select<TableType> {
    this.assertTable(table, 'transaction.select');

    return createSelect(selection(table), (value, options, operation) =>
      this.executeSelect(value, options, operation),
    );
  }

  public insert<TableType extends AllowedTable>(table: TableType): Insert<TableType> {
    this.assertTable(table, 'transaction.insert');

    return createInsert(((...arguments_: unknown[]) =>
      this.executeWrite(table, 'insert.execute', arguments_)) as {
      (...arguments_: InsertArguments<TableType>): Promise<TableKey<TableType>>;
      (entries: InsertManyInput<TableType>): Promise<TableKey<TableType>[]>;
    });
  }

  public upsert<TableType extends AllowedTable>(table: TableType): Upsert<TableType> {
    this.assertTable(table, 'transaction.upsert');

    return createUpsert(((...arguments_: unknown[]) =>
      this.executeWrite(table, 'upsert.execute', arguments_)) as {
      (...arguments_: UpsertArguments<TableType>): Promise<TableKey<TableType>>;
      (entries: UpsertManyInput<TableType>): Promise<TableKey<TableType>[]>;
    });
  }

  public update<TableType extends AllowedTable>(table: TableType): Update<TableType> {
    this.assertTable(table, 'transaction.update');

    return createUpdate(table, (value, values) => {
      this.assertActive('update.execute');

      return this.mutationExecutor.update(value, values);
    });
  }

  public delete<TableType extends AllowedTable>(table: TableType): Delete<TableType> {
    this.assertTable(table, 'transaction.delete');

    return createDelete(table, (value) => {
      this.assertActive('delete.execute');

      return this.mutationExecutor.delete(value);
    });
  }

  private assertTable(table: SchemaTable, operation: TransactionOperation): void {
    this.assertActive(operation);

    if (!this.scope.has(table)) {
      throw new TransactionError('table-not-in-scope', operation);
    }
  }

  private executeSelect<TableType extends AllowedTable>(
    value: Selection<TableType>,
    options: SelectOptions | undefined,
    operation: SelectOperation,
  ): Promise<import('../schema').TableRecord<TableType>[]> {
    try {
      this.assertActive(operation);

      const scan = options === undefined ? 'forbid' : options.scan === 'allow' ? 'allow' : undefined;

      if (scan === undefined) {
        return Promise.reject(new TypeError('Select options are invalid'));
      }

      return this.selectionExecutor
        .executeIn(plan(value, scan, operation), this.transaction as PhysicalTransaction<TableType['name']>)
        .then((candidates) => candidates.map(({ record }) => record))
        .catch((cause: unknown) => {
          throw mapQueryError(operation, cause);
        });
    } catch (cause) {
      return Promise.reject(cause);
    }
  }

  private executeWrite<TableType extends AllowedTable>(
    table: TableType,
    operation: Extract<MutationOperation, 'insert.execute' | 'upsert.execute'>,
    arguments_: readonly unknown[],
  ): Promise<TableKey<TableType> | TableKey<TableType>[]> {
    try {
      this.assertActive(operation);

      const normalized = normalizeWrite(table, arguments_, operation === 'insert.execute' ? 'insert' : 'upsert');

      if (normalized.multiple) {
        return (operation === 'insert.execute'
          ? this.writer.insertMany(table.name, normalized.entries)
          : this.writer.upsertMany(table.name, normalized.entries)) as Promise<TableKey<TableType>[]>;
      }

      return (operation === 'insert.execute'
        ? this.writer.insert(table.name, normalized.entries[0])
        : this.writer.upsert(table.name, normalized.entries[0])) as Promise<TableKey<TableType>>;
    } catch (cause) {
      return Promise.reject(cause);
    }
  }

  public async run<Result>(
    callback: (transaction: TransactionInterface<AllowedTable>) => Result | Promise<Result>,
  ): Promise<Result> {
    const callbackOutcome = this.invokeCallback(callback);
    const completionOutcome = this.observeCompletion();
    const firstOutcome = await Promise.race([
      callbackOutcome.then(
        (outcome) =>
          ({
            source: 'callback',
            outcome,
          }) as const,
      ),
      completionOutcome.then(
        (outcome) =>
          ({
            source: 'completion',
            outcome,
          }) as const,
      ),
    ]);

    if (firstOutcome.source === 'completion') {
      if (firstOutcome.outcome.status === 'complete') {
        throw new TransactionError('premature-commit', 'client.transaction');
      }

      throw mapCompletionError(firstOutcome.outcome.cause);
    }

    if (firstOutcome.outcome.status === 'rejected') {
      await completionOutcome;
      throw firstOutcome.outcome.reason;
    }

    const completion = await completionOutcome;

    if (completion.status === 'failed') {
      throw mapCompletionError(completion.cause);
    }

    return firstOutcome.outcome.value;
  }

  private invokeCallback<Result>(
    callback: (transaction: TransactionInterface<AllowedTable>) => Result | Promise<Result>,
  ): Promise<CallbackOutcome<Result>> {
    let result: Promise<Result>;

    try {
      result = Promise.resolve(callback(this));
    } catch (reason) {
      result = Promise.reject(reason);
    }

    return result.then(
      (value): Fulfilled<Result> => {
        this.active = false;

        return {
          status: 'fulfilled',
          value,
        };
      },
      (reason: unknown): Rejected => {
        this.active = false;
        this.transaction.abort(reason);

        return {
          status: 'rejected',
          reason,
        };
      },
    );
  }

  private observeCompletion(): Promise<CompletionOutcome> {
    return this.transaction.completion.then(
      (): CompletionOutcome => {
        this.active = false;

        return {
          status: 'complete',
        };
      },
      (cause: unknown): CompletionOutcome => {
        this.active = false;

        return {
          status: 'failed',
          cause,
        };
      },
    );
  }

  private assertActive(operation: TransactionOperation | SelectOperation | MutationOperation): void {
    if (!this.active || !this.transaction.active) {
      throw new TransactionError('inactive', operation);
    }
  }

}

const mapCompletionError = (cause: unknown): TransactionError => {
  const code = isAbortError(cause) ? 'aborted' : 'commit-failed';

  return new TransactionError(code, 'client.transaction', {
    cause,
  });
};

const isAbortError = (cause: unknown): boolean =>
  typeof cause === 'object' && cause !== null && 'name' in cause && cause.name === 'AbortError';

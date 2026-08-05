import type { StorageKey } from '../../../key';
import type { UpdateValues } from '../../../mutation';
import { plan } from '../../../planner';
import { RecordPrimaryKey } from '../../../schema';
import type { SchemaTable, TableRecord } from '../../../schema';
import { sourceOf as selectionSource } from '../../../selection';
import type { Selection } from '../../../selection';
import { NativeConnection } from '../connection';
import { mapMutationError } from '../error';
import { Executor as SelectionExecutor } from '../plan';
import type { Candidate } from '../plan';
import type { Transaction } from '../transaction';

const asNativeKey = (key: StorageKey): IDBValidKey => key as IDBValidKey;

export class Executor {
  private readonly selection: SelectionExecutor;

  private constructor(
    private readonly context:
      | Readonly<{ kind: 'standalone'; connection: NativeConnection }>
      | Readonly<{ kind: 'scoped'; transaction: Transaction<string> }>,
    keyRange: typeof IDBKeyRange,
  ) {
    this.selection =
      context.kind === 'standalone'
        ? new SelectionExecutor(context.connection, keyRange)
        : SelectionExecutor.scoped(keyRange);
  }

  public static standalone(connection: NativeConnection, keyRange: typeof IDBKeyRange): Executor {
    return new Executor(
      {
        kind: 'standalone',
        connection,
      },
      keyRange,
    );
  }

  public static scoped(transaction: Transaction<string>, keyRange: typeof IDBKeyRange): Executor {
    return new Executor(
      {
        kind: 'scoped',
        transaction,
      },
      keyRange,
    );
  }

  public delete<TableType extends SchemaTable>(selection: Selection<TableType>): Promise<number> {
    return this.execute(selection, 'delete.execute', async (transaction, candidates) => {
      const store = transaction.store(selectionSource(selection).name);

      await Promise.all(
        candidates.map(({ primaryKey }) =>
          store.request((native) => native.delete(asNativeKey(primaryKey.value))),
        ),
      );
    });
  }

  public update<TableType extends SchemaTable>(
    selection: Selection<TableType>,
    values: UpdateValues<TableType>,
  ): Promise<number> {
    return this.execute(selection, 'update.execute', async (transaction, candidates) => {
      const table = selectionSource(selection);
      const store = transaction.store(table.name);

      await Promise.all(
        candidates.map(({ record, primaryKey }) => {
          const updated = Object.assign({}, record, values) as TableRecord<TableType>;

          return store.request((native) =>
            table.primaryKey instanceof RecordPrimaryKey
              ? native.put(updated)
              : native.put(updated, asNativeKey(primaryKey.value)),
          );
        }),
      );
    });
  }

  private execute<TableType extends SchemaTable>(
    selection: Selection<TableType>,
    operation: 'delete.execute' | 'update.execute',
    mutate: (
      transaction: Transaction<TableType['name']>,
      candidates: Candidate<TableRecord<TableType>>[],
    ) => Promise<void>,
  ): Promise<number> {
    try {
      const value = plan(selection, 'forbid', operation);
      const table = selectionSource(selection);
      const run = async (transaction: Transaction<TableType['name']>): Promise<number> => {
        const candidates = await this.selection.executeIn(value, transaction);

        await mutate(transaction, candidates);

        return candidates.length;
      };
      const result =
        this.context.kind === 'standalone'
          ? this.context.connection.transaction([table.name], 'readwrite').run(run)
          : run(this.context.transaction as Transaction<TableType['name']>);

      return result.catch((cause: unknown) => {
        throw mapMutationError(operation, cause);
      });
    } catch (cause) {
      return Promise.reject(mapMutationError(operation, cause));
    }
  }
}

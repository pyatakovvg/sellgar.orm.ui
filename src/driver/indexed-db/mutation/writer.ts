import type { MutationOperation } from '../../../error';
import type { StorageKey } from '../../../key';
import type { WriteEntry } from '../../../mutation';
import { NativeConnection } from '../connection';
import { mapMutationError } from '../error';
import { Transaction } from '../transaction';

const asNativeKey = (key: StorageKey): IDBValidKey => key as IDBValidKey;

type Context =
  | Readonly<{
      kind: 'standalone';
      connection: NativeConnection;
    }>
  | Readonly<{
      kind: 'scoped';
      transaction: Transaction<string>;
    }>;

export class Writer {
  private constructor(private readonly context: Context) {}

  public static standalone(connection: NativeConnection): Writer {
    return new Writer({
      kind: 'standalone',
      connection,
    });
  }

  public static scoped(transaction: Transaction<string>): Writer {
    return new Writer({
      kind: 'scoped',
      transaction,
    });
  }

  public insert<Key extends StorageKey>(storeName: string, entry: WriteEntry): Promise<Key> {
    return this.writeOne('insert.execute', storeName, entry, 'insert');
  }

  public insertMany<Key extends StorageKey>(storeName: string, entries: readonly WriteEntry[]): Promise<Key[]> {
    return this.writeMany('insert.execute', storeName, entries, 'insert');
  }

  public upsert<Key extends StorageKey>(storeName: string, entry: WriteEntry): Promise<Key> {
    return this.writeOne('upsert.execute', storeName, entry, 'upsert');
  }

  public upsertMany<Key extends StorageKey>(storeName: string, entries: readonly WriteEntry[]): Promise<Key[]> {
    return this.writeMany('upsert.execute', storeName, entries, 'upsert');
  }

  private writeOne<Key extends StorageKey>(
    operation: Extract<MutationOperation, 'insert.execute' | 'upsert.execute'>,
    storeName: string,
    entry: WriteEntry,
    kind: 'insert' | 'upsert',
  ): Promise<Key> {
    return this.execute(operation, storeName, (transaction) =>
      transaction.store(storeName).request(
        (store) => {
          const write = kind === 'insert' ? store.add.bind(store) : store.put.bind(store);

          return entry.length === 1 ? write(entry[0]) : write(entry[0], asNativeKey(entry[1]));
        },
        (key) => key as Key,
      ),
    );
  }

  private writeMany<Key extends StorageKey>(
    operation: Extract<MutationOperation, 'insert.execute' | 'upsert.execute'>,
    storeName: string,
    entries: readonly WriteEntry[],
    kind: 'insert' | 'upsert',
  ): Promise<Key[]> {
    if (entries.length === 0) {
      return Promise.resolve([]);
    }

    return this.execute(operation, storeName, (transaction) => {
      const store = transaction.store(storeName);

      return Promise.all(
        entries.map((entry) =>
          store.request(
            (native) => {
              const write = kind === 'insert' ? native.add.bind(native) : native.put.bind(native);

              return entry.length === 1 ? write(entry[0]) : write(entry[0], asNativeKey(entry[1]));
            },
            (key) => key as Key,
          ),
        ),
      );
    });
  }

  private execute<Result>(
    operation: MutationOperation,
    storeName: string,
    schedule: (transaction: Transaction<string>) => Promise<Result>,
  ): Promise<Result> {
    try {
      const result =
        this.context.kind === 'scoped'
          ? schedule(this.context.transaction)
          : this.context.connection.transaction([storeName], 'readwrite').run(schedule);

      return result.catch((cause: unknown) => {
        throw mapMutationError(operation, cause);
      });
    } catch (cause) {
      return Promise.reject(mapMutationError(operation, cause));
    }
  }
}

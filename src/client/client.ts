import { Injectable } from '@sellgar/app-v2';

import { NativeConnection, openConnection } from '../driver/indexed-db/connection';
import { Executor as MutationExecutor, Writer } from '../driver/indexed-db/mutation';
import { Executor } from '../driver/indexed-db/plan';
import { compileSchema } from '../driver/indexed-db/schema';
import { ClientError, TransactionError } from '../error';
import type { ClientOperation, MutationOperation, SelectOperation } from '../error';
import { createDelete, createInsert, createUpdate, createUpsert, normalizeWrite } from '../mutation';
import type {
  Delete,
  Insert,
  InsertArguments,
  InsertManyInput,
  Update,
  UpdateValues,
  Upsert,
  UpsertArguments,
  UpsertManyInput,
} from '../mutation';
import { plan } from '../planner';
import type { ScanPolicy } from '../planner';
import { createSelect } from '../select';
import type { Select, SelectOptions } from '../select';
import { selection, sourceOf } from '../selection';
import type { Selection } from '../selection';
import { Schema } from '../schema';
import type { SchemaTable, SchemaTableUnion, TableKey } from '../schema';
import type { TableRecord } from '../schema';
import { Transaction } from '../transaction';
import type { TransactionInterface } from '../transaction';

import { ClientInterface } from './client.interface.ts';

type ClientState = 'new' | 'opening' | 'open' | 'failed' | 'closed';

type Environment = Readonly<{
  indexedDB: IDBFactory;
  keyRange: typeof IDBKeyRange;
}>;

const getEnvironment = (): Environment => {
  const environment = globalThis as {
    readonly indexedDB?: IDBFactory;
    readonly IDBKeyRange?: typeof IDBKeyRange;
  };

  if (environment.indexedDB === undefined || environment.IDBKeyRange === undefined) {
    throw new ClientError('unavailable', 'client.open');
  }

  return {
    indexedDB: environment.indexedDB,
    keyRange: environment.IDBKeyRange,
  };
};

const scanPolicyOf = (options: SelectOptions | undefined): ScanPolicy => {
  if (options === undefined) {
    return 'forbid';
  }

  if (typeof options === 'object' && options !== null && options.scan === 'allow') {
    return 'allow';
  }

  throw new TypeError('Execute options are invalid');
};

const isVersionError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'name' in error && error.name === 'VersionError';

const mapOpenError = (error: unknown): ClientError => {
  if (error instanceof ClientError) {
    return error;
  }

  return isVersionError(error)
    ? new ClientError('version-mismatch', 'client.open', { cause: error })
    : new ClientError('open-failed', 'client.open', { cause: error });
};

@Injectable()
export class Client<SchemaType extends Schema = Schema> implements ClientInterface<SchemaType> {
  private state: ClientState = 'new';
  private schemaValue: SchemaType | undefined;
  private connection: NativeConnection | undefined;
  private keyRange: typeof IDBKeyRange | undefined;
  private writer: Writer | undefined;
  private queryExecutor: Executor | undefined;
  private mutationExecutor: MutationExecutor | undefined;
  private openPromise: Promise<void> | undefined;

  public open(schema: SchemaType): Promise<void> {
    this.synchronizeClosedState();

    if (this.state === 'closed') {
      return Promise.reject(new ClientError('closed', 'client.open'));
    }

    if (this.schemaValue !== undefined && this.schemaValue !== schema) {
      return Promise.reject(new ClientError('schema-mismatch', 'client.open'));
    }

    if (this.state === 'opening') {
      return this.openPromise as Promise<void>;
    }

    if (this.state === 'open') {
      return Promise.resolve();
    }

    this.schemaValue = schema;
    this.state = 'opening';

    const attempt = this.createOpenAttempt(schema);

    this.openPromise = attempt;

    return attempt;
  }

  public select<TableType extends SchemaTableUnion<SchemaType>>(table: TableType): Select<TableType> {
    this.assertTable(table, 'client.select');

    return createSelect(selection(table), (value, options, operation) => this.executeSelect(value, options, operation));
  }

  public insert<TableType extends SchemaTableUnion<SchemaType>>(table: TableType): Insert<TableType> {
    this.assertTable(table, 'client.insert');

    return createInsert(((...arguments_: unknown[]) =>
      this.executeWrite(table, 'insert.execute', arguments_)) as {
      (...arguments_: InsertArguments<TableType>): Promise<TableKey<TableType>>;
      (entries: InsertManyInput<TableType>): Promise<TableKey<TableType>[]>;
    });
  }

  public upsert<TableType extends SchemaTableUnion<SchemaType>>(table: TableType): Upsert<TableType> {
    this.assertTable(table, 'client.upsert');

    return createUpsert(((...arguments_: unknown[]) =>
      this.executeWrite(table, 'upsert.execute', arguments_)) as {
      (...arguments_: UpsertArguments<TableType>): Promise<TableKey<TableType>>;
      (entries: UpsertManyInput<TableType>): Promise<TableKey<TableType>[]>;
    });
  }

  public update<TableType extends SchemaTableUnion<SchemaType>>(table: TableType): Update<TableType> {
    this.assertTable(table, 'client.update');

    return createUpdate(table, (value, values) => this.executeUpdate(value, values));
  }

  public delete<TableType extends SchemaTableUnion<SchemaType>>(table: TableType): Delete<TableType> {
    this.assertTable(table, 'client.delete');

    return createDelete(table, (value) => this.executeDelete(value));
  }

  private executeSelect<TableType extends SchemaTableUnion<SchemaType>>(
    value: Selection<TableType>,
    options: SelectOptions | undefined,
    operation: SelectOperation,
  ): Promise<TableRecord<TableType>[]> {
    try {
      const table = sourceOf(value);

      this.assertExecutableTable(table, operation);

      const scan = scanPolicyOf(options);

      return this.queryExecutor!.execute(plan(value, scan, operation), operation);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private executeWrite<TableType extends SchemaTableUnion<SchemaType>>(
    table: TableType,
    operation: Extract<MutationOperation, 'insert.execute' | 'upsert.execute'>,
    arguments_: readonly unknown[],
  ): Promise<TableKey<TableType> | TableKey<TableType>[]> {
    try {
      this.assertExecutableTable(table, operation);

      const normalized = normalizeWrite(table, arguments_, operation === 'insert.execute' ? 'insert' : 'upsert');

      if (normalized.multiple) {
        return (operation === 'insert.execute'
          ? this.writer!.insertMany(table.name, normalized.entries)
          : this.writer!.upsertMany(table.name, normalized.entries)) as Promise<TableKey<TableType>[]>;
      }

      return (operation === 'insert.execute'
        ? this.writer!.insert(table.name, normalized.entries[0])
        : this.writer!.upsert(table.name, normalized.entries[0])) as Promise<TableKey<TableType>>;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private executeUpdate<TableType extends SchemaTableUnion<SchemaType>>(
    value: Selection<TableType>,
    values: UpdateValues<TableType>,
  ): Promise<number> {
    try {
      this.assertExecutableTable(sourceOf(value), 'update.execute');

      return this.mutationExecutor!.update(value, values);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private executeDelete<TableType extends SchemaTableUnion<SchemaType>>(value: Selection<TableType>): Promise<number> {
    try {
      this.assertExecutableTable(sourceOf(value), 'delete.execute');

      return this.mutationExecutor!.delete(value);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  public transaction<
    const Scope extends readonly [SchemaTableUnion<SchemaType>, ...SchemaTableUnion<SchemaType>[]],
    Result,
  >(
    tables: Scope,
    callback: (transaction: TransactionInterface<Scope[number]>) => Result | Promise<Result>,
  ): Promise<Result> {
    try {
      this.synchronizeClosedState();

      if (this.state === 'closed') {
        return Promise.reject(new ClientError('closed', 'client.transaction'));
      }

      if (this.state !== 'open' || this.schemaValue === undefined || this.connection === undefined) {
        return Promise.reject(new ClientError('not-open', 'client.transaction'));
      }

      const scope: Scope[number][] = Array.isArray(tables) ? [...tables] : [];

      if (!this.isTransactionScopeValid(scope)) {
        return Promise.reject(new TransactionError('invalid-scope', 'client.transaction'));
      }

      const names: [string, ...string[]] = [scope[0].name, ...scope.slice(1).map((table) => table.name)];
      let physical: ReturnType<NativeConnection['transaction']>;

      try {
        physical = this.connection.transaction(names, 'readwrite');
      } catch (cause) {
        return Promise.reject(
          new TransactionError('start-failed', 'client.transaction', {
            cause,
          }),
        );
      }

      return new Transaction<Scope[number]>(scope, physical, this.keyRange!).run(callback);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  public close(): void {
    this.synchronizeClosedState();

    if (this.state === 'closed') {
      return;
    }

    this.state = 'closed';
    this.connection?.close();
  }

  private createOpenAttempt(schema: SchemaType): Promise<void> {
    let physicalOpen: Promise<readonly [connection: NativeConnection, keyRange: typeof IDBKeyRange]>;

    try {
      const environment = getEnvironment();

      physicalOpen = openConnection(environment.indexedDB, compileSchema(schema)).then(
        (connection) => [connection, environment.keyRange] as const,
      );
    } catch (error) {
      physicalOpen = Promise.reject(error);
    }

    return physicalOpen.then(
      ([connection, keyRange]) => {
        this.openPromise = undefined;

        if (this.state === 'closed') {
          connection.close();
          throw new ClientError('closed', 'client.open');
        }

        this.connection = connection;
        this.keyRange = keyRange;
        this.writer = Writer.standalone(connection);
        this.queryExecutor = new Executor(connection, keyRange);
        this.mutationExecutor = MutationExecutor.standalone(connection, keyRange);
        this.state = 'open';
      },
      (error: unknown) => {
        this.openPromise = undefined;

        if (this.state === 'closed') {
          throw new ClientError('closed', 'client.open');
        }

        this.state = 'failed';
        throw mapOpenError(error);
      },
    );
  }

  private synchronizeClosedState(): void {
    if (this.state === 'open' && this.connection?.closed === true) {
      this.state = 'closed';
    }
  }

  private isTransactionScopeValid(scope: readonly SchemaTable[]): boolean {
    if (scope.length === 0 || this.schemaValue === undefined) {
      return false;
    }

    const descriptors = new Set<SchemaTable>();

    for (const table of scope) {
      if (descriptors.has(table) || !this.schemaValue.tables.includes(table)) {
        return false;
      }

      descriptors.add(table);
    }

    return true;
  }

  private assertTable<TableType extends SchemaTableUnion<SchemaType>>(
    table: TableType,
    operation: Exclude<ClientOperation, 'client.open' | 'client.transaction'>,
  ): void {
    this.synchronizeClosedState();

    if (this.state === 'closed') {
      throw new ClientError('closed', operation);
    }

    if (this.state !== 'open' || this.schemaValue === undefined) {
      throw new ClientError('not-open', operation);
    }

    if (!this.schemaValue.tables.includes(table)) {
      throw new ClientError('table-not-in-schema', operation);
    }
  }

  private assertExecutableTable(
    table: SchemaTable,
    operation: SelectOperation | MutationOperation,
  ): void {
    this.synchronizeClosedState();

    if (this.state === 'closed') {
      throw new ClientError('closed', operation);
    }

    if (
      this.state !== 'open' ||
      this.schemaValue === undefined ||
      this.writer === undefined ||
      this.queryExecutor === undefined ||
      this.mutationExecutor === undefined
    ) {
      throw new ClientError('not-open', operation);
    }

    if (!this.schemaValue.tables.includes(table)) {
      throw new ClientError('table-not-in-schema', operation);
    }
  }
}

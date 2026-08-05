import type { Delete, Insert, Update, Upsert } from '../mutation/index.ts';
import type { Select } from '../select/index.ts';
import { Schema } from '../schema/index.ts';
import type { SchemaTableUnion } from '../schema/index.ts';
import type { TransactionInterface } from '../transaction/index.ts';

export abstract class ClientInterface<SchemaType extends Schema> {
  public abstract open(schema: SchemaType): Promise<void>;

  public abstract select<TableType extends SchemaTableUnion<SchemaType>>(table: TableType): Select<TableType>;

  public abstract insert<TableType extends SchemaTableUnion<SchemaType>>(table: TableType): Insert<TableType>;

  public abstract upsert<TableType extends SchemaTableUnion<SchemaType>>(table: TableType): Upsert<TableType>;

  public abstract update<TableType extends SchemaTableUnion<SchemaType>>(table: TableType): Update<TableType>;

  public abstract delete<TableType extends SchemaTableUnion<SchemaType>>(table: TableType): Delete<TableType>;

  public abstract transaction<
    const Scope extends readonly [SchemaTableUnion<SchemaType>, ...SchemaTableUnion<SchemaType>[]],
    Result,
  >(
    tables: Scope,
    callback: (transaction: TransactionInterface<Scope[number]>) => Result | Promise<Result>,
  ): Promise<Result>;

  public abstract close(): void;
}

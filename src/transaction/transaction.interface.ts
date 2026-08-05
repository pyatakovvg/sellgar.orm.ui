import type { Delete, Insert, Update, Upsert } from '../mutation/index.ts';
import type { Select } from '../select/index.ts';
import type { SchemaTable } from '../schema/index.ts';

export interface TransactionInterface<AllowedTable extends SchemaTable> {
  select<TableType extends AllowedTable>(table: TableType): Select<TableType>;

  insert<TableType extends AllowedTable>(table: TableType): Insert<TableType>;

  upsert<TableType extends AllowedTable>(table: TableType): Upsert<TableType>;

  update<TableType extends AllowedTable>(table: TableType): Update<TableType>;

  delete<TableType extends AllowedTable>(table: TableType): Delete<TableType>;
}

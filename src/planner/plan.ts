import { Expression } from '../expression/index.ts';
import type { Direction } from '../selection/index.ts';
import { Range } from '../range/index.ts';
import type { SchemaTable, TableRecord } from '../schema/index.ts';

type Limit = Readonly<{
  limit?: number;
  takeLast?: number;
}>;

type EmptyPlan<TableType extends SchemaTable> = Readonly<{
  type: 'empty';
  table: TableType;
}> &
  Limit;

type PrimaryPlan<TableType extends SchemaTable> = Readonly<{
  type: 'primary';
  table: TableType;
  range: Range;
}> &
  Limit;

type IndexPlan<TableType extends SchemaTable> = Readonly<{
  type: 'index';
  table: TableType;
  index: TableType['indexes'][number];
  range: Range;
}> &
  Limit;

type BranchPlan<TableType extends SchemaTable> = PrimaryPlan<TableType> | IndexPlan<TableType> | UnionPlan<TableType>;

type UnionPlan<TableType extends SchemaTable> = Readonly<{
  type: 'union';
  table: TableType;
  plans: readonly [BranchPlan<TableType>, BranchPlan<TableType>, ...BranchPlan<TableType>[]];
}> &
  Limit;

type IntersectionPlan<TableType extends SchemaTable> = Readonly<{
  type: 'intersection';
  table: TableType;
  plans: readonly [BranchPlan<TableType>, BranchPlan<TableType>, ...BranchPlan<TableType>[]];
}> &
  Limit;

type SourcePlan<TableType extends SchemaTable> = BranchPlan<TableType> | IntersectionPlan<TableType>;

type PostFilterPlan<TableType extends SchemaTable> = Readonly<{
  type: 'post-filter';
  table: TableType;
  source: SourcePlan<TableType>;
  filter: Expression<TableType['name'], TableRecord<TableType>>;
}> &
  Limit;

type ScanPlan<TableType extends SchemaTable> = Readonly<{
  type: 'scan';
  table: TableType;
  filter?: Expression<TableType['name'], TableRecord<TableType>>;
}> &
  Limit;

type OrderedPlan<TableType extends SchemaTable> = Readonly<{
  type: 'ordered';
  table: TableType;
  access:
    | Readonly<{
        type: 'primary';
      }>
    | Readonly<{
        type: 'index';
        index: TableType['indexes'][number];
      }>;
  range?: Range;
  direction: Direction;
  filter?: Expression<TableType['name'], TableRecord<TableType>>;
}> &
  Limit;

export type Plan<TableType extends SchemaTable = SchemaTable> =
  | EmptyPlan<TableType>
  | SourcePlan<TableType>
  | PostFilterPlan<TableType>
  | ScanPlan<TableType>
  | OrderedPlan<TableType>;

import { and, definitionOf as definitionOfExpression, Expression, tableNameOf } from '../expression/index.ts';
import type { Definition as ExpressionDefinition } from '../expression/index.ts';
import type { StorageKey } from '../key/index.ts';
import { Field, Table } from '../schema/index.ts';
import type { SchemaTable, TableRecord } from '../schema/index.ts';

export type Direction = 'asc' | 'desc';

export type OrderDefinition = Readonly<{
  field: Readonly<{
    tableName: string;
    path: string;
  }>;
  direction: Direction;
}>;

export type Definition = Readonly<{
  type: 'selection';
  tableName: string;
  filter?: ExpressionDefinition;
  order?: readonly [OrderDefinition, ...OrderDefinition[]];
  limit?: number;
  takeLast?: number;
}>;

type OrderField<TableType extends SchemaTable> = Field<
  TableType['name'],
  TableRecord<TableType>,
  string,
  StorageKey | null | undefined
>;

export type Order<TableType extends SchemaTable> = Readonly<{
  field: OrderField<TableType>;
  direction: Direction;
}>;

type State<TableType extends SchemaTable> = Readonly<{
  table: TableType;
  filter?: Expression<TableType['name'], TableRecord<TableType>>;
  order: readonly Order<TableType>[];
  limit?: number;
  takeLast?: number;
}>;

const states = new WeakMap<object, unknown>();
const selectionCreationToken = Symbol('selection-creation');
const selectionType = Symbol('selection-type');
const invalidSelectionMessage = 'Selection is invalid';
const invalidSourceMessage = 'Selection source is invalid';
const incompatibleFilterMessage = 'Selection filter belongs to another table';
const invalidOrderFieldMessage = 'Selection order field is invalid';
const incompatibleOrderFieldMessage = 'Selection order field belongs to another table';
const invalidDirectionMessage = 'Selection order direction is invalid';
const invalidLimitMessage = 'Selection limit is invalid';
const invalidTakeLastMessage = 'Selection takeLast is invalid';

export abstract class Selection<TableType extends SchemaTable = SchemaTable> {
  public abstract readonly kind: 'selection';

  declare readonly [selectionType]: (table: TableType) => TableType;

  protected constructor(token: typeof selectionCreationToken) {
    if (token !== selectionCreationToken) {
      throw new TypeError('Selection can only be created by select');
    }
  }

  public where(expression: Expression<TableType['name'], TableRecord<TableType>>): Selection<TableType> {
    return withFilter(this, expression);
  }

  public orderBy(field: OrderField<TableType>, direction: Direction): Selection<TableType> {
    return withOrder(this, field, direction);
  }

  public limit(value: number): Selection<TableType> {
    return withLimit(this, value);
  }

  public takeLast(value: number): Selection<TableType> {
    return withTakeLast(this, value);
  }
}

class SourceSelection<TableType extends SchemaTable> extends Selection<TableType> {
  public readonly kind = 'selection';

  public constructor(
    table: TableType,
    filter?: Expression<TableType['name'], TableRecord<TableType>>,
    order: readonly Order<TableType>[] = [],
    limit?: number,
    takeLast?: number,
  ) {
    super(selectionCreationToken);
    states.set(
      this,
      Object.freeze({
        table,
        ...(filter === undefined ? {} : { filter }),
        order: Object.freeze([...order]),
        ...(limit === undefined ? {} : { limit }),
        ...(takeLast === undefined ? {} : { takeLast }),
      }),
    );
    Object.freeze(this);
  }
}

export const selection = <TableType extends SchemaTable>(table: TableType): Selection<TableType> => {
  if (!(table instanceof Table)) {
    throw new TypeError(invalidSourceMessage);
  }

  return new SourceSelection<TableType>(table);
};

const stateOf = <TableType extends SchemaTable>(value: Selection<TableType>): State<TableType> => {
  const state = states.get(value) as State<TableType> | undefined;

  if (state === undefined) {
    throw new TypeError(invalidSelectionMessage);
  }

  return state;
};

export const sourceOf = <TableType extends SchemaTable>(value: Selection<TableType>): TableType => stateOf(value).table;

export const filterOf = <TableType extends SchemaTable>(
  value: Selection<TableType>,
): Expression<TableType['name'], TableRecord<TableType>> | undefined => stateOf(value).filter;

export const orderOf = <TableType extends SchemaTable>(value: Selection<TableType>): readonly Order<TableType>[] =>
  stateOf(value).order;

export const limitOf = <TableType extends SchemaTable>(value: Selection<TableType>): number | undefined =>
  stateOf(value).limit;

export const takeLastOf = <TableType extends SchemaTable>(value: Selection<TableType>): number | undefined =>
  stateOf(value).takeLast;

const withFilter = <TableType extends SchemaTable>(
  value: Selection<TableType>,
  expression: Expression<TableType['name'], TableRecord<TableType>>,
): Selection<TableType> => {
  const state = stateOf(value);

  if (tableNameOf(expression) !== state.table.name) {
    throw new TypeError(incompatibleFilterMessage);
  }

  const previous = state.filter;
  const filter = previous === undefined ? expression : and(previous, expression);

  return new SourceSelection(state.table, filter, state.order, state.limit, state.takeLast);
};

const withOrder = <TableType extends SchemaTable>(
  value: Selection<TableType>,
  field: OrderField<TableType>,
  direction: Direction,
): Selection<TableType> => {
  const state = stateOf(value);

  if (!(field instanceof Field)) {
    throw new TypeError(invalidOrderFieldMessage);
  }

  if (field.tableName !== state.table.name) {
    throw new TypeError(incompatibleOrderFieldMessage);
  }

  if (direction !== 'asc' && direction !== 'desc') {
    throw new TypeError(invalidDirectionMessage);
  }

  const next = Object.freeze({
    field,
    direction,
  });
  const order = [...state.order, next];

  return new SourceSelection(state.table, state.filter, order, state.limit, state.takeLast);
};

const withLimit = <TableType extends SchemaTable>(
  value: Selection<TableType>,
  limit: number,
): Selection<TableType> => {
  const state = stateOf(value);

  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new TypeError(invalidLimitMessage);
  }

  return new SourceSelection(state.table, state.filter, state.order, limit);
};

const withTakeLast = <TableType extends SchemaTable>(
  value: Selection<TableType>,
  takeLast: number,
): Selection<TableType> => {
  const state = stateOf(value);

  if (!Number.isSafeInteger(takeLast) || takeLast < 0) {
    throw new TypeError(invalidTakeLastMessage);
  }

  return new SourceSelection(state.table, state.filter, state.order, undefined, takeLast);
};

export const definitionOf = <TableType extends SchemaTable>(value: Selection<TableType>): Definition => {
  const state = stateOf(value);
  const order =
    state.order.length === 0
      ? undefined
      : (Object.freeze(
          state.order.map(({ field, direction }) =>
            Object.freeze({
              field: Object.freeze({
                tableName: field.tableName,
                path: field.path,
              }),
              direction,
            }),
          ),
        ) as readonly [OrderDefinition, ...OrderDefinition[]]);

  return Object.freeze({
    type: 'selection',
    tableName: state.table.name,
    ...(state.filter === undefined ? {} : { filter: definitionOfExpression(state.filter) }),
    ...(order === undefined ? {} : { order }),
    ...(state.limit === undefined ? {} : { limit: state.limit }),
    ...(state.takeLast === undefined ? {} : { takeLast: state.takeLast }),
  });
};

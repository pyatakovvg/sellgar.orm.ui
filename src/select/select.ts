import { eq, Expression } from '../expression';
import type { EqualityValue } from '../expression';
import type { SelectOperation } from '../error';
import { materialize } from '../schema';
import type { Field, SchemaTable, TableModel, TableRecord } from '../schema';
import { Selection, sourceOf } from '../selection';
import type { Direction } from '../selection';

export type SelectOptions = Readonly<{
  scan: 'allow';
}>;

type Execute<TableType extends SchemaTable> = (
  selection: Selection<TableType>,
  options: SelectOptions | undefined,
  operation: SelectOperation,
) => Promise<TableRecord<TableType>[]>;

type State<TableType extends SchemaTable> = Readonly<{
  selection: Selection<TableType>;
  execute: Execute<TableType>;
}>;

const states = new WeakMap<object, State<SchemaTable>>();
const selectCreationToken = Symbol('select-creation');
const invalidSelectMessage = 'Select is invalid';

const stateOf = <TableType extends SchemaTable>(value: Select<TableType>): State<TableType> => {
  const state = states.get(value) as State<TableType> | undefined;

  if (state === undefined) {
    throw new TypeError(invalidSelectMessage);
  }

  return state;
};

export abstract class Select<TableType extends SchemaTable = SchemaTable> {
  protected constructor(token: typeof selectCreationToken) {
    if (token !== selectCreationToken) {
      throw new TypeError('Select can only be created by a client');
    }
  }

  public where(expression: Expression<TableType['name'], TableRecord<TableType>>): Select<TableType>;
  public where<Path extends string, Value>(
    field: Field<TableType['name'], TableRecord<TableType>, Path, Value>,
    value: NoInfer<EqualityValue<Value>>,
  ): Select<TableType>;
  public where<Path extends string, Value>(
    expressionOrField:
      | Expression<TableType['name'], TableRecord<TableType>>
      | Field<TableType['name'], TableRecord<TableType>, Path, Value>,
    value?: NoInfer<EqualityValue<Value>>,
  ): Select<TableType> {
    const state = stateOf(this);
    const expression =
      expressionOrField instanceof Expression
        ? expressionOrField
        : eq(expressionOrField, value as NoInfer<EqualityValue<Value>>);

    return createSelect(state.selection.where(expression), state.execute);
  }

  public orderBy(
    field: Parameters<Selection<TableType>['orderBy']>[0],
    direction: Direction,
  ): Select<TableType> {
    const state = stateOf(this);

    return createSelect(state.selection.orderBy(field, direction), state.execute);
  }

  public limit(value: number): Select<TableType> {
    const state = stateOf(this);

    return createSelect(state.selection.limit(value), state.execute);
  }

  public takeLast(value: number): Select<TableType> {
    const state = stateOf(this);

    return createSelect(state.selection.takeLast(value), state.execute);
  }

  public getRawMany(options?: SelectOptions): Promise<TableRecord<TableType>[]> {
    const state = stateOf(this);

    return state.execute(state.selection, options, 'select.getRawMany');
  }

  public getRawOne(options?: SelectOptions): Promise<TableRecord<TableType> | undefined> {
    const state = stateOf(this);

    return state.execute(state.selection, options, 'select.getRawOne').then(([record]) => record);
  }

  public getMany(options?: SelectOptions): Promise<TableModel<TableType>[]> {
    const state = stateOf(this);

    return state
      .execute(state.selection, options, 'select.getMany')
      .then((records) => records.map((record) => materialize(sourceOf(state.selection), record)));
  }

  public getOne(options?: SelectOptions): Promise<TableModel<TableType> | undefined> {
    const state = stateOf(this);

    return state
      .execute(state.selection, options, 'select.getOne')
      .then(([record]) => (record === undefined ? undefined : materialize(sourceOf(state.selection), record)));
  }
}

class BoundSelect<TableType extends SchemaTable> extends Select<TableType> {
  public constructor(selection: Selection<TableType>, execute: Execute<TableType>) {
    super(selectCreationToken);
    states.set(
      this,
      Object.freeze({
        selection,
        execute,
      }) as unknown as State<SchemaTable>,
    );
    Object.freeze(this);
  }
}

export const createSelect = <TableType extends SchemaTable>(
  selection: Selection<TableType>,
  execute: Execute<TableType>,
): Select<TableType> => new BoundSelect(selection, execute);

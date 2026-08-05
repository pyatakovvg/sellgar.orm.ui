import { QueryError } from '../error';
import type { QueryOperation } from '../error';
import { definitionOf as definitionOfExpression } from '../expression';
import type { Definition as ExpressionDefinition } from '../expression';
import type { StorageKey } from '../key';
import { filterOf, orderOf, Selection, sourceOf } from '../selection';
import type { Order } from '../selection';
import { Range, withinPrefix } from '../range';
import { RecordPrimaryKey, SimpleKeyPath } from '../schema';
import type { KeyPath, SchemaTable, TableIndex } from '../schema';
import type { Plan } from './plan.ts';
import type { ScanPolicy } from './planner.ts';

type OrderedPlan<TableType extends SchemaTable> = Extract<Plan<TableType>, { type: 'ordered' }>;
type Comparison = Extract<ExpressionDefinition, { type: 'comparison' }>;
type Equality = Extract<Comparison, { operator: 'eq' }>;
type OneSided = Extract<Comparison, { operator: 'gt' | 'gte' | 'lt' | 'lte' }>;

type Access<TableType extends SchemaTable> = OrderedPlan<TableType>['access'];

type Candidate<TableType extends SchemaTable> = Readonly<{
  access: Access<TableType>;
  paths: readonly string[];
}>;

const pathsOf = (keyPath: KeyPath): readonly string[] =>
  keyPath instanceof SimpleKeyPath ? [keyPath.field.path] : keyPath.fields.map(({ path }) => path);

const candidatesOf = <TableType extends SchemaTable>(table: TableType): readonly Candidate<TableType>[] => {
  const candidates: Candidate<TableType>[] = [];

  if (table.primaryKey instanceof RecordPrimaryKey) {
    candidates.push({
      access: Object.freeze({
        type: 'primary',
      }),
      paths: pathsOf(table.primaryKey.keyPath),
    });
  }

  table.indexes.forEach((index: TableIndex) => {
    if (index.multiEntry) {
      return;
    }

    candidates.push({
      access: Object.freeze({
        type: 'index',
        index: index as TableType['indexes'][number],
      }),
      paths: pathsOf(index.keyPath),
    });
  });

  return candidates;
};

const operandsOf = (definition: ExpressionDefinition | undefined): readonly ExpressionDefinition[] => {
  if (definition === undefined) {
    return [];
  }

  const operands: ExpressionDefinition[] = [];

  const collect = (operand: ExpressionDefinition): void => {
    if (operand.type === 'logical' && operand.operator === 'and') {
      operand.operands.forEach(collect);

      return;
    }

    operands.push(operand);
  };

  collect(definition);

  return operands;
};

const equalityAt = (operands: readonly ExpressionDefinition[], path: string): Equality | undefined =>
  operands.find(
    (operand): operand is Equality =>
      operand.type === 'comparison' && operand.operator === 'eq' && operand.field.path === path,
  );

const oneSidedAt = (operands: readonly ExpressionDefinition[], path: string): OneSided | undefined =>
  operands.find(
    (operand): operand is OneSided =>
      operand.type === 'comparison' &&
      (operand.operator === 'gt' ||
        operand.operator === 'gte' ||
        operand.operator === 'lt' ||
        operand.operator === 'lte') &&
      operand.field.path === path,
  );

const boundedRange = (prefix: readonly StorageKey[], comparison: OneSided): Range => {
  const type = comparison.operator === 'gt' || comparison.operator === 'gte' ? 'lower' : 'upper';
  const boundary = comparison.operator === 'gte' || comparison.operator === 'lte' ? 'inclusive' : 'exclusive';

  if (prefix.length === 0) {
    switch (comparison.operator) {
      case 'gt':
        return Range.greaterThan(comparison.value);
      case 'gte':
        return Range.atLeast(comparison.value);
      case 'lt':
        return Range.lessThan(comparison.value);
      case 'lte':
        return Range.atMost(comparison.value);
    }
  }

  return withinPrefix(prefix, {
    type,
    key: [...prefix, comparison.value],
    boundary,
  });
};

const rangeOf = (
  paths: readonly string[],
  order: readonly Order<SchemaTable>[],
  operands: readonly ExpressionDefinition[],
):
  | Readonly<{
      range?: Range;
      restricted: boolean;
    }>
  | undefined => {
  const orderPaths = order.map(({ field }) => field.path);
  const maximumPrefix = paths.length - orderPaths.length;

  for (let prefixLength = maximumPrefix; prefixLength >= 0; prefixLength -= 1) {
    if (!orderPaths.every((path, index) => paths[prefixLength + index] === path)) {
      continue;
    }

    const values: StorageKey[] = [];
    let validPrefix = true;

    for (const path of paths.slice(0, prefixLength)) {
      const equality = equalityAt(operands, path);

      if (equality === undefined) {
        validPrefix = false;
        break;
      }

      try {
        Range.only(equality.value as StorageKey);
        values.push(equality.value as StorageKey);
      } catch (error) {
        if (error instanceof TypeError) {
          validPrefix = false;
          break;
        }

        throw error;
      }
    }

    if (!validPrefix) {
      continue;
    }

    const boundary = oneSidedAt(operands, orderPaths[0]);

    try {
      if (boundary !== undefined) {
        return {
          range: boundedRange(values, boundary),
          restricted: true,
        };
      }

      return prefixLength === 0
        ? {
            restricted: false,
          }
        : {
            range: Range.prefix(values),
            restricted: true,
          };
    } catch (error) {
      if (error instanceof TypeError) {
        continue;
      }

      throw error;
    }
  }

  return undefined;
};

export const planOrdering = <TableType extends SchemaTable>(
  selection: Selection<TableType>,
  scan: ScanPolicy,
  operation: QueryOperation,
): OrderedPlan<TableType> | undefined => {
  const order = orderOf(selection);

  if (order.length === 0) {
    return undefined;
  }

  const direction = order[0].direction;

  if (order.some((item) => item.direction !== direction)) {
    throw new QueryError('unsupported-order', operation);
  }

  const table = sourceOf(selection);
  const filter = filterOf(selection);
  const definition = filter === undefined ? undefined : definitionOfExpression(filter);
  const operands = operandsOf(definition);
  let requiresScan = false;

  for (const candidate of candidatesOf(table)) {
    const range = rangeOf(candidate.paths, order as readonly Order<SchemaTable>[], operands);

    if (range === undefined) {
      continue;
    }

    if (filter !== undefined && !range.restricted && scan === 'forbid') {
      requiresScan = true;
      continue;
    }

    return Object.freeze({
      type: 'ordered',
      table,
      access: candidate.access,
      ...(range.range === undefined ? {} : { range: range.range }),
      direction,
      ...(filter === undefined ? {} : { filter }),
    });
  }

  if (requiresScan) {
    throw new QueryError('scan-required', operation);
  }

  throw new QueryError('unsupported-order', operation);
};

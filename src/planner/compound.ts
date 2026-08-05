import type { Definition as ExpressionDefinition } from '../expression/index.ts';
import type { StorageKey } from '../key/index.ts';
import { Range, withinPrefix } from '../range/index.ts';
import type { PrefixBoundary } from '../range/index.ts';
import { CompoundKeyPath, RecordPrimaryKey } from '../schema/index.ts';
import type { SchemaTable } from '../schema/index.ts';

type Comparison = Extract<ExpressionDefinition, { type: 'comparison' }>;
type OneSidedComparison = Extract<Comparison, { operator: 'gt' | 'gte' | 'lt' | 'lte' }>;
type Kind = 'exact' | 'one-sided' | 'prefix';

type Access<TableType extends SchemaTable> =
  | Readonly<{
      type: 'primary';
    }>
  | Readonly<{
      type: 'index';
      index: TableType['indexes'][number];
    }>;

export type Match<TableType extends SchemaTable> = Readonly<{
  kind: Kind;
  access: Access<TableType>;
  range: Range;
  operands: readonly [number, ...number[]];
}>;

type Component = Readonly<{
  operand: number;
  comparison: Comparison;
}>;

type Path = CompoundKeyPath<readonly StorageKey[], string, object, readonly [string, string, ...string[]]>;

const comparisonAt = (
  operands: readonly ExpressionDefinition[],
  used: readonly number[],
  path: string,
  operator: 'eq' | 'between',
): Component | undefined => {
  for (let operand = 0; operand < operands.length; operand += 1) {
    const comparison = operands[operand];

    if (
      !used.includes(operand) &&
      comparison.type === 'comparison' &&
      comparison.operator === operator &&
      comparison.field.path === path
    ) {
      return {
        operand,
        comparison,
      };
    }
  }

  return undefined;
};

const oneSidedAt = (
  operands: readonly ExpressionDefinition[],
  used: readonly number[],
  path: string,
): Component | undefined => {
  for (let operand = 0; operand < operands.length; operand += 1) {
    const comparison = operands[operand];

    if (
      !used.includes(operand) &&
      comparison.type === 'comparison' &&
      (comparison.operator === 'gt' ||
        comparison.operator === 'gte' ||
        comparison.operator === 'lt' ||
        comparison.operator === 'lte') &&
      comparison.field.path === path
    ) {
      return {
        operand,
        comparison,
      };
    }
  }

  return undefined;
};

const exactRange = (components: readonly Component[]): Range | undefined => {
  const last = components[components.length - 1];
  const prefix: unknown[] = [];

  for (const { comparison } of components.slice(0, -1)) {
    if (comparison.operator !== 'eq') {
      return undefined;
    }

    prefix.push(comparison.value);
  }

  try {
    if (last.comparison.operator === 'eq') {
      return Range.only([...prefix, last.comparison.value] as readonly StorageKey[]);
    }

    if (last.comparison.operator === 'between') {
      return Range.between(
        [...prefix, last.comparison.lower] as readonly StorageKey[],
        [...prefix, last.comparison.upper] as readonly StorageKey[],
        {
          lower: last.comparison.lowerBoundary,
          upper: last.comparison.upperBoundary,
        },
      );
    }

    return undefined;
  } catch (error) {
    if (error instanceof TypeError) {
      return undefined;
    }

    throw error;
  }
};

const boundaryOf = (comparison: OneSidedComparison, prefix: readonly StorageKey[]): PrefixBoundary => {
  switch (comparison.operator) {
    case 'gt':
      return {
        type: 'lower',
        key: [...prefix, comparison.value],
        boundary: 'exclusive',
      };
    case 'gte':
      return {
        type: 'lower',
        key: [...prefix, comparison.value],
        boundary: 'inclusive',
      };
    case 'lt':
      return {
        type: 'upper',
        key: [...prefix, comparison.value],
        boundary: 'exclusive',
      };
    case 'lte':
      return {
        type: 'upper',
        key: [...prefix, comparison.value],
        boundary: 'inclusive',
      };
  }
};

const partialRange = (equalities: readonly Component[], boundary: Component | undefined): Range | undefined => {
  const prefix: StorageKey[] = [];

  for (const { comparison } of equalities) {
    if (comparison.operator !== 'eq') {
      return undefined;
    }

    prefix.push(comparison.value as StorageKey);
  }

  try {
    if (boundary === undefined) {
      return Range.prefix(prefix);
    }

    const comparison = boundary.comparison;

    if (
      comparison.operator !== 'gt' &&
      comparison.operator !== 'gte' &&
      comparison.operator !== 'lt' &&
      comparison.operator !== 'lte'
    ) {
      return undefined;
    }

    return withinPrefix(prefix, boundaryOf(comparison, prefix));
  } catch (error) {
    if (error instanceof TypeError) {
      return undefined;
    }

    throw error;
  }
};

const createMatch = <TableType extends SchemaTable>(
  kind: Kind,
  access: Access<TableType>,
  range: Range,
  components: readonly Component[],
): Match<TableType> =>
  Object.freeze({
    kind,
    access: Object.freeze(access),
    range,
    operands: Object.freeze(components.map(({ operand }) => operand)) as readonly [number, ...number[]],
  });

const exactMatch = <TableType extends SchemaTable>(
  keyPath: Path,
  access: Access<TableType>,
  operands: readonly ExpressionDefinition[],
): Match<TableType> | undefined => {
  const components: Component[] = [];
  const lastIndex = keyPath.fields.length - 1;

  for (let index = 0; index < keyPath.fields.length; index += 1) {
    const path = keyPath.fields[index].path;
    const used = components.map(({ operand }) => operand);
    const equality = comparisonAt(operands, used, path, 'eq');
    const component = equality ?? (index === lastIndex ? comparisonAt(operands, used, path, 'between') : undefined);

    if (component === undefined) {
      return undefined;
    }

    components.push(component);
  }

  const range = exactRange(components);

  return range === undefined ? undefined : createMatch('exact', access, range, components);
};

const partialMatch = <TableType extends SchemaTable>(
  keyPath: Path,
  access: Access<TableType>,
  operands: readonly ExpressionDefinition[],
): Match<TableType> | undefined => {
  const equalities: Component[] = [];
  const lastIndex = keyPath.fields.length - 1;

  for (let index = 0; index < keyPath.fields.length; index += 1) {
    const used = equalities.map(({ operand }) => operand);
    const equality = comparisonAt(operands, used, keyPath.fields[index].path, 'eq');

    if (equality !== undefined) {
      equalities.push(equality);

      continue;
    }

    if (equalities.length === 0) {
      return undefined;
    }

    const boundary = index === lastIndex ? oneSidedAt(operands, used, keyPath.fields[index].path) : undefined;
    const range = partialRange(equalities, boundary);

    if (range === undefined) {
      return undefined;
    }

    return createMatch(
      boundary === undefined ? 'prefix' : 'one-sided',
      access,
      range,
      boundary === undefined ? equalities : [...equalities, boundary],
    );
  }

  return undefined;
};

const betterPartial = <TableType extends SchemaTable>(
  candidate: Match<TableType>,
  selected: Match<TableType>,
): boolean => {
  if (candidate.operands.length !== selected.operands.length) {
    return candidate.operands.length > selected.operands.length;
  }

  return candidate.kind === 'one-sided' && selected.kind === 'prefix';
};

export const match = <TableType extends SchemaTable>(
  table: TableType,
  operands: readonly ExpressionDefinition[],
): Match<TableType> | undefined => {
  const primary = table.primaryKey;
  const primaryPath =
    primary instanceof RecordPrimaryKey && primary.keyPath instanceof CompoundKeyPath ? primary.keyPath : undefined;

  if (primaryPath !== undefined) {
    const result = exactMatch(
      primaryPath,
      {
        type: 'primary',
      },
      operands,
    );

    if (result !== undefined) {
      return result;
    }
  }

  let exact: Match<TableType> | undefined;

  for (const index of table.indexes) {
    if (!(index.keyPath instanceof CompoundKeyPath)) {
      continue;
    }

    const result = exactMatch(
      index.keyPath,
      {
        type: 'index',
        index: index as TableType['indexes'][number],
      },
      operands,
    );

    if (result !== undefined && (exact === undefined || result.operands.length > exact.operands.length)) {
      exact = result;
    }
  }

  if (exact !== undefined) {
    return exact;
  }

  let partial =
    primaryPath === undefined
      ? undefined
      : partialMatch(
          primaryPath,
          {
            type: 'primary',
          },
          operands,
        );

  for (const index of table.indexes) {
    if (!(index.keyPath instanceof CompoundKeyPath)) {
      continue;
    }

    const result = partialMatch(
      index.keyPath,
      {
        type: 'index',
        index: index as TableType['indexes'][number],
      },
      operands,
    );

    if (result !== undefined && (partial === undefined || betterPartial(result, partial))) {
      partial = result;
    }
  }

  return partial;
};

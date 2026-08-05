import { QueryError } from '../error';
import type { QueryOperation } from '../error';
import { definitionOf as definitionOfExpression, Expression } from '../expression';
import type { Definition as ExpressionDefinition } from '../expression';
import { filterOf, limitOf, Selection, sourceOf, takeLastOf } from '../selection';
import { Range } from '../range';
import { RecordPrimaryKey, SimpleKeyPath } from '../schema';
import type { StorageKey } from '../key';
import type { SchemaTable, TableIndex, TableRecord } from '../schema';
import { match as matchCompound } from './compound.ts';
import type { Plan } from './plan.ts';
import { planOrdering } from './ordering.ts';

export type ScanPolicy = 'forbid' | 'allow';

type ComparisonDefinition = Extract<ExpressionDefinition, { type: 'comparison' }>;
type OneOfDefinition = Extract<ComparisonDefinition, { operator: 'one-of' }>;
type MultiOperandDefinition = Extract<ExpressionDefinition, { type: 'logical'; operator: 'and' | 'or' }>;
type RangePlan<TableType extends SchemaTable> = Extract<Plan<TableType>, { type: 'primary' | 'index' }>;
type BranchPlan<TableType extends SchemaTable> = Extract<Plan<TableType>, { type: 'primary' | 'index' | 'union' }>;
type IntersectionPlan<TableType extends SchemaTable> = Extract<Plan<TableType>, { type: 'intersection' }>;
type EmptyPlan<TableType extends SchemaTable> = Extract<Plan<TableType>, { type: 'empty' }>;
type ExactPlan<TableType extends SchemaTable> = Extract<
  Plan<TableType>,
  { type: 'empty' | 'primary' | 'index' | 'union' }
>;
type CandidatePlan<TableType extends SchemaTable> = Extract<Plan<TableType>, { type: 'empty' | 'post-filter' }>;

type Access<TableType extends SchemaTable> =
  | Readonly<{
      type: 'primary';
    }>
  | Readonly<{
      type: 'index';
      index: TableType['indexes'][number];
    }>;

const invalidScanPolicyMessage = 'Scan policy is invalid';

const onlyRange = (value: unknown): Range | undefined => {
  try {
    return Range.only(value as StorageKey);
  } catch (error) {
    if (error instanceof TypeError) {
      return undefined;
    }

    throw error;
  }
};

const rangeOf = (filter: ComparisonDefinition): Range | undefined => {
  switch (filter.operator) {
    case 'eq':
      return onlyRange(filter.value);
    case 'gt':
      return Range.greaterThan(filter.value);
    case 'gte':
      return Range.atLeast(filter.value);
    case 'lt':
      return Range.lessThan(filter.value);
    case 'lte':
      return Range.atMost(filter.value);
    case 'between':
      return Range.between(filter.lower, filter.upper, {
        lower: filter.lowerBoundary,
        upper: filter.upperBoundary,
      });
    case 'one-of':
    case 'is-null':
    case 'is-missing':
      return undefined;
  }
};

const primaryMatches = (table: SchemaTable, path: string): boolean => {
  const primary = table.primaryKey;

  return (
    primary instanceof RecordPrimaryKey &&
    primary.keyPath instanceof SimpleKeyPath &&
    primary.keyPath.field.path === path
  );
};

const indexOf = (table: SchemaTable, path: string): TableIndex | undefined =>
  table.indexes.find(
    (index) => !index.multiEntry && index.keyPath instanceof SimpleKeyPath && index.keyPath.field.path === path,
  );

const accessOf = <TableType extends SchemaTable>(table: TableType, path: string): Access<TableType> | undefined => {
  if (primaryMatches(table, path)) {
    return {
      type: 'primary',
    };
  }

  const index = indexOf(table, path);

  return index === undefined
    ? undefined
    : {
        type: 'index',
        index: index as TableType['indexes'][number],
      };
};

const rangePlan = <TableType extends SchemaTable>(
  table: TableType,
  access: Access<TableType>,
  range: Range,
): RangePlan<TableType> =>
  access.type === 'primary'
    ? Object.freeze({
        type: 'primary',
        table,
        range,
      })
    : Object.freeze({
        type: 'index',
        table,
        index: access.index,
        range,
      });

const emptyPlan = <TableType extends SchemaTable>(table: TableType): EmptyPlan<TableType> =>
  Object.freeze({
    type: 'empty',
    table,
  });

const normalizeUnion = <TableType extends SchemaTable>(
  table: TableType,
  plans: readonly ExactPlan<TableType>[],
): ExactPlan<TableType> => {
  const sources = plans.filter((plan): plan is BranchPlan<TableType> => plan.type !== 'empty');

  if (sources.length === 0) {
    return emptyPlan(table);
  }

  if (sources.length === 1) {
    return sources[0];
  }

  const branches = Object.freeze([sources[0], sources[1], ...sources.slice(2)]) as readonly [
    BranchPlan<TableType>,
    BranchPlan<TableType>,
    ...BranchPlan<TableType>[],
  ];

  return Object.freeze({
    type: 'union',
    table,
    plans: branches,
  });
};

const oneOfPlan = <TableType extends SchemaTable>(
  filter: OneOfDefinition,
  table: TableType,
): ExactPlan<TableType> | undefined => {
  if (filter.values.length === 0) {
    return emptyPlan(table);
  }

  const access = accessOf(table, filter.field.path);

  if (access === undefined) {
    return undefined;
  }

  const ranges = filter.values.map(onlyRange);

  if (access.type === 'index' && ranges.some((range) => range === undefined)) {
    return undefined;
  }

  const points = ranges
    .filter((range): range is Range => range !== undefined)
    .map((range) => rangePlan(table, access, range));

  return normalizeUnion(table, points);
};

const comparisonPlan = <TableType extends SchemaTable>(
  filter: ComparisonDefinition,
  table: TableType,
): ExactPlan<TableType> | undefined => {
  if (filter.operator === 'one-of') {
    return oneOfPlan(filter, table);
  }

  const range = rangeOf(filter);

  if (range === undefined) {
    return undefined;
  }

  const access = accessOf(table, filter.field.path);

  return access === undefined ? undefined : rangePlan(table, access, range);
};

const orPlan = <TableType extends SchemaTable>(
  filter: MultiOperandDefinition,
  table: TableType,
): ExactPlan<TableType> | undefined => {
  const branches: ExactPlan<TableType>[] = [];

  for (const operand of filter.operands) {
    const branch = exactPlanOf(operand, table);

    if (branch === undefined) {
      return undefined;
    }

    branches.push(branch);
  }

  return normalizeUnion(table, branches);
};

const exactPlanOf = <TableType extends SchemaTable>(
  filter: ExpressionDefinition,
  table: TableType,
): ExactPlan<TableType> | undefined => {
  if (filter.type === 'comparison') {
    return comparisonPlan(filter, table);
  }

  return filter.operator === 'or' ? orPlan(filter, table) : undefined;
};

const candidatePlan = <TableType extends SchemaTable>(
  filter: ComparisonDefinition | MultiOperandDefinition,
  expression: Expression<TableType['name'], TableRecord<TableType>>,
  table: TableType,
): CandidatePlan<TableType> | undefined => {
  const operands: ExpressionDefinition[] = [];
  const sources: BranchPlan<TableType>[] = [];

  const flatten = (operand: ExpressionDefinition): void => {
    if (operand.type === 'logical' && operand.operator === 'and') {
      operand.operands.forEach(flatten);

      return;
    }

    operands.push(operand);
  };

  if (filter.type === 'comparison') {
    operands.push(filter);
  } else {
    filter.operands.forEach(flatten);
  }

  const exact = operands.map((operand) => exactPlanOf(operand, table));

  if (exact.some((source) => source?.type === 'empty')) {
    return emptyPlan(table);
  }

  const compound = matchCompound(table, operands);
  const covered: readonly number[] = compound?.operands ?? [];
  const firstCovered = covered.length === 0 ? undefined : Math.min(...covered);

  for (let index = 0; index < operands.length; index += 1) {
    if (index === firstCovered && compound !== undefined) {
      sources.push(rangePlan(table, compound.access, compound.range));
    }

    if (covered.includes(index)) {
      continue;
    }

    const source = exact[index];

    if (source !== undefined && source.type !== 'empty') {
      sources.push(source);
    }
  }

  if (sources.length === 0) {
    return undefined;
  }

  const source: BranchPlan<TableType> | IntersectionPlan<TableType> =
    sources.length === 1
      ? sources[0]
      : Object.freeze({
          type: 'intersection',
          table,
          plans: Object.freeze([sources[0], sources[1], ...sources.slice(2)]) as readonly [
            BranchPlan<TableType>,
            BranchPlan<TableType>,
            ...BranchPlan<TableType>[],
          ],
        });

  return Object.freeze({
    type: 'post-filter',
    table,
    source,
    filter: expression,
  });
};

const scanPlan = <TableType extends SchemaTable>(query: Selection<TableType>, table: TableType): Plan<TableType> => {
  const filter = filterOf(query);

  return Object.freeze({
    type: 'scan',
    table,
    ...(filter === undefined ? {} : { filter }),
  });
};

const planSelection = <TableType extends SchemaTable>(
  selection: Selection<TableType>,
  scan: ScanPolicy,
  operation: QueryOperation = 'select.getRawMany',
): Plan<TableType> => {
  if (scan !== 'forbid' && scan !== 'allow') {
    throw new TypeError(invalidScanPolicyMessage);
  }

  const ordering = planOrdering(selection, scan, operation);

  if (ordering !== undefined) {
    return ordering;
  }

  const table = sourceOf(selection);
  const expression = filterOf(selection);

  if (expression !== undefined) {
    const filter = definitionOfExpression(expression);
    const exact = exactPlanOf(filter, table);

    if (exact !== undefined) {
      return exact;
    }

    if (filter.type === 'comparison' || (filter.type === 'logical' && filter.operator === 'and')) {
      const conjunction = candidatePlan(filter, expression, table);

      if (conjunction !== undefined) {
        return conjunction;
      }
    }
  }

  if (scan === 'allow') {
    return scanPlan(selection, table);
  }

  throw new QueryError('scan-required', operation);
};

export const plan = <TableType extends SchemaTable>(
  selection: Selection<TableType>,
  scan: ScanPolicy,
  operation: QueryOperation = 'select.getRawMany',
): Plan<TableType> => {
  const value = planSelection(selection, scan, operation);
  const limit = limitOf(selection);
  const takeLast = takeLastOf(selection);

  return limit === undefined && takeLast === undefined
    ? value
    : (Object.freeze({
        ...value,
        ...(limit === undefined ? {} : { limit }),
        ...(takeLast === undefined ? {} : { takeLast }),
      }) as Plan<TableType>);
};

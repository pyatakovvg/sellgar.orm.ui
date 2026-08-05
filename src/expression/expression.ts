import { definitionOf as definitionOfRange, Range } from '../range/index.ts';
import type { Boundary } from '../range/index.ts';
import { Field } from '../schema/index.ts';
import { Value } from './value.ts';
import type { Input } from './value.ts';
import type { StorageKey } from '../key/index.ts';

export type ComparisonOperator = 'eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'one-of' | 'is-null' | 'is-missing';
export type LogicalOperator = 'and' | 'or' | 'not';
export type Operator = ComparisonOperator | LogicalOperator;

export type FieldReference = Readonly<{
  tableName: string;
  path: string;
}>;

type BaseDefinition = Readonly<{
  type: 'comparison';
  field: FieldReference;
}>;

export type ComparisonDefinition =
  | (BaseDefinition &
      Readonly<{
        operator: 'eq';
        value: Input;
      }>)
  | (BaseDefinition &
      Readonly<{
        operator: 'gt' | 'gte' | 'lt' | 'lte';
        value: StorageKey;
      }>)
  | (BaseDefinition &
      Readonly<{
        operator: 'between';
        lower: StorageKey;
        upper: StorageKey;
        lowerBoundary: Boundary;
        upperBoundary: Boundary;
      }>)
  | (BaseDefinition &
      Readonly<{
        operator: 'one-of';
        values: readonly Input[];
      }>)
  | (BaseDefinition &
      Readonly<{
        operator: 'is-null' | 'is-missing';
      }>);

export type LogicalDefinition =
  | Readonly<{
      type: 'logical';
      operator: 'and' | 'or';
      operands: readonly [Definition, Definition, ...Definition[]];
    }>
  | Readonly<{
      type: 'logical';
      operator: 'not';
      operand: Definition;
    }>;

export type Definition = ComparisonDefinition | LogicalDefinition;

type InputCriterion =
  | Readonly<{
      operator: 'eq';
      value: Value;
    }>
  | Readonly<{
      operator: 'gt' | 'gte' | 'lt' | 'lte' | 'between';
      range: Range;
    }>
  | Readonly<{
      operator: 'one-of';
      values: readonly Value[];
    }>
  | Readonly<{
      operator: 'is-null' | 'is-missing';
    }>;

type Criterion = InputCriterion &
  Readonly<{
    field: FieldReference;
  }>;

type LogicalCriterion =
  | Readonly<{
      operator: 'and' | 'or';
      tableName: string;
      operands: readonly [object, object, ...object[]];
    }>
  | Readonly<{
      operator: 'not';
      tableName: string;
      operand: object;
    }>;

type FieldValue =
  | Readonly<{
      missing: true;
    }>
  | Readonly<{
      missing: false;
      value: unknown;
    }>;

const comparisonCriteria = new WeakMap<object, Criterion>();
const logicalCriteria = new WeakMap<object, LogicalCriterion>();
const expressionCreationToken = Symbol('expression-creation');
const expressionType = Symbol('expression-type');
const invalidExpressionMessage = 'Expression is invalid';
const invalidFieldMessage = 'Expression field is invalid';
const invalidRangeMessage = 'Expression range is invalid';
const insufficientLogicalOperandsMessage = 'Logical expression requires at least two operands';
const invalidNotOperandsMessage = 'Not expression requires exactly one operand';
const incompatibleTableMessage = 'Logical expression operands belong to different tables';
const missingFieldValue: FieldValue = Object.freeze({
  missing: true,
});

export abstract class Expression<TableName extends string = string, RecordType extends object = object> {
  public abstract readonly kind: 'comparison' | 'logical';

  declare readonly [expressionType]: (
    tableName: TableName,
    record: RecordType,
  ) => readonly [tableName: TableName, record: RecordType];

  protected constructor(token: typeof expressionCreationToken) {
    if (token !== expressionCreationToken) {
      throw new TypeError('Expression can only be created by operators');
    }
  }
}

class ComparisonExpression<TableName extends string, RecordType extends object> extends Expression<
  TableName,
  RecordType
> {
  public readonly kind = 'comparison';

  public constructor(criterion: Criterion) {
    super(expressionCreationToken);
    comparisonCriteria.set(this, criterion);
    Object.freeze(this);
  }
}

class LogicalExpression<TableName extends string, RecordType extends object> extends Expression<TableName, RecordType> {
  public readonly kind = 'logical';

  public constructor(criterion: LogicalCriterion) {
    super(expressionCreationToken);
    logicalCriteria.set(this, criterion);
    Object.freeze(this);
  }
}

const fieldReference = (field: Readonly<{ tableName: string; path: string }>): FieldReference =>
  Object.freeze({
    tableName: field.tableName,
    path: field.path,
  });

/** @internal */
export const createExpression = <TableName extends string, RecordType extends object, Path extends string, FieldValue>(
  field: Field<TableName, RecordType, Path, FieldValue>,
  criterion: InputCriterion,
): Expression<TableName, RecordType> => {
  if (!(field instanceof Field)) {
    throw new TypeError(invalidFieldMessage);
  }

  return new ComparisonExpression<TableName, RecordType>(
    Object.freeze({
      ...criterion,
      field: fieldReference(field),
    }),
  );
};

/** @internal */
export const tableNameOf = (expression: object): string => {
  const comparison = comparisonCriteria.get(expression);

  if (comparison !== undefined) {
    return comparison.field.tableName;
  }

  const logical = logicalCriteria.get(expression);

  if (logical !== undefined) {
    return logical.tableName;
  }

  throw new TypeError(invalidExpressionMessage);
};

/** @internal */
export const createLogicalExpression = <TableName extends string, RecordType extends object>(
  operator: LogicalOperator,
  operands: readonly Expression<TableName, RecordType>[],
): Expression<TableName, RecordType> => {
  if (operator === 'not') {
    if (operands.length !== 1) {
      throw new TypeError(invalidNotOperandsMessage);
    }

    const operand = operands[0] as Expression<TableName, RecordType>;
    const tableName = tableNameOf(operand);

    return new LogicalExpression<TableName, RecordType>(
      Object.freeze({
        operator,
        tableName,
        operand,
      }),
    );
  }

  if (operands.length < 2) {
    throw new TypeError(insufficientLogicalOperandsMessage);
  }

  const snapshot = Object.freeze([...operands]) as readonly [
    Expression<TableName, RecordType>,
    Expression<TableName, RecordType>,
    ...Expression<TableName, RecordType>[],
  ];
  const tableName = tableNameOf(snapshot[0]);

  for (const operand of snapshot.slice(1)) {
    if (tableNameOf(operand) !== tableName) {
      throw new TypeError(incompatibleTableMessage);
    }
  }

  return new LogicalExpression<TableName, RecordType>(
    Object.freeze({
      operator,
      tableName,
      operands: snapshot,
    }),
  );
};

const fieldValueOf = (record: object, path: string): FieldValue => {
  let value: unknown = record;

  for (const component of path.split('.')) {
    if (value === null || value === undefined) {
      return missingFieldValue;
    }

    value = Reflect.get(Object(value), component);
  }

  if (value === undefined) {
    return missingFieldValue;
  }

  return {
    missing: false,
    value,
  };
};

const equalsValue = (value: unknown, expected: Value): boolean => {
  try {
    return Value.from(value as Input).equals(expected);
  } catch {
    return false;
  }
};

const includesRange = (value: unknown, range: Range): boolean => {
  try {
    return range.includes(value as StorageKey);
  } catch {
    return false;
  }
};

const matchesComparison = (criterion: Criterion, record: object): boolean => {
  const fieldValue = fieldValueOf(record, criterion.field.path);

  switch (criterion.operator) {
    case 'is-missing':
      return fieldValue.missing;
    case 'is-null':
      return !fieldValue.missing && fieldValue.value === null;
    case 'eq':
      return !fieldValue.missing && equalsValue(fieldValue.value, criterion.value);
    case 'one-of':
      return !fieldValue.missing && criterion.values.some((candidate) => equalsValue(fieldValue.value, candidate));
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
    case 'between':
      return !fieldValue.missing && includesRange(fieldValue.value, criterion.range);
  }
};

const matchesExpression = (expression: object, record: object): boolean => {
  const comparison = comparisonCriteria.get(expression);

  if (comparison !== undefined) {
    return matchesComparison(comparison, record);
  }

  const logical = logicalCriteria.get(expression);

  if (logical === undefined) {
    throw new TypeError(invalidExpressionMessage);
  }

  switch (logical.operator) {
    case 'and':
      return logical.operands.every((operand) => matchesExpression(operand, record));
    case 'or':
      return logical.operands.some((operand) => matchesExpression(operand, record));
    case 'not':
      return !matchesExpression(logical.operand, record);
  }
};

/** @internal */
export const matches = <TableName extends string, RecordType extends object>(
  expression: Expression<TableName, RecordType>,
  record: NoInfer<RecordType>,
): boolean => matchesExpression(expression, record);

const rangeValue = (range: Range, expected: 'lower' | 'upper'): StorageKey => {
  const definition = definitionOfRange(range);

  if (definition.type !== expected) {
    throw new TypeError(invalidRangeMessage);
  }

  return definition.key;
};

const definitionOfExpression = (expression: object): Definition => {
  const criterion = comparisonCriteria.get(expression);

  if (criterion === undefined) {
    const logical = logicalCriteria.get(expression);

    if (logical === undefined) {
      throw new TypeError(invalidExpressionMessage);
    }

    if (logical.operator === 'not') {
      return Object.freeze({
        type: 'logical',
        operator: 'not',
        operand: definitionOfExpression(logical.operand),
      });
    }

    return Object.freeze({
      type: 'logical',
      operator: logical.operator,
      operands: Object.freeze(logical.operands.map((operand) => definitionOfExpression(operand))) as readonly [
        Definition,
        Definition,
        ...Definition[],
      ],
    });
  }

  const base = {
    type: 'comparison' as const,
    field: criterion.field,
  };

  switch (criterion.operator) {
    case 'eq':
      return Object.freeze({
        ...base,
        operator: 'eq',
        value: criterion.value.value,
      });
    case 'gt':
    case 'gte':
      return Object.freeze({
        ...base,
        operator: criterion.operator,
        value: rangeValue(criterion.range, 'lower'),
      });
    case 'lt':
    case 'lte':
      return Object.freeze({
        ...base,
        operator: criterion.operator,
        value: rangeValue(criterion.range, 'upper'),
      });
    case 'between': {
      const range = definitionOfRange(criterion.range);

      if (range.type !== 'between') {
        throw new TypeError(invalidRangeMessage);
      }

      return Object.freeze({
        ...base,
        operator: 'between',
        lower: range.lower,
        upper: range.upper,
        lowerBoundary: range.lowerBoundary,
        upperBoundary: range.upperBoundary,
      });
    }
    case 'one-of':
      return Object.freeze({
        ...base,
        operator: 'one-of',
        values: Object.freeze(criterion.values.map((value) => value.value)),
      });
    case 'is-null':
    case 'is-missing':
      return Object.freeze({
        ...base,
        operator: criterion.operator,
      });
  }
};

export const definitionOf = <TableName extends string, RecordType extends object>(
  expression: Expression<TableName, RecordType>,
): Definition => definitionOfExpression(expression);

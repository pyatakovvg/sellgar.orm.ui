import { Range } from '../range/index.ts';
import type { BetweenOptions, CompatibleKey } from '../range/index.ts';
import { Field } from '../schema/index.ts';
import type { StorageKey } from '../key/index.ts';
import { createExpression, createLogicalExpression, Expression } from './expression.ts';
import { Value } from './value.ts';
import type { Input } from './value.ts';

type IsAny<Type> = 0 extends 1 & Type ? true : false;
type NonNullish<Type> = Exclude<Type, null | undefined>;

export type EqualityValue<Type> = IsAny<Type> extends true ? never : Extract<NonNullish<Type>, Input>;

type OrderedValue<Type> = IsAny<Type> extends true ? never : Extract<NonNullish<Type>, StorageKey>;

const unique = (inputs: readonly Input[]): readonly Value[] => {
  const values: Value[] = [];

  for (const input of inputs) {
    const value = Value.from(input);

    if (!values.some((candidate) => candidate.equals(value))) {
      values.push(value);
    }
  }

  return Object.freeze(values);
};

export const eq = <TableName extends string, RecordType extends object, Path extends string, FieldValue>(
  field: Field<TableName, RecordType, Path, FieldValue>,
  value: NoInfer<EqualityValue<FieldValue>>,
): Expression<TableName, RecordType> =>
  createExpression(field, {
    operator: 'eq',
    value: Value.from(value),
  });

export const gt = <TableName extends string, RecordType extends object, Path extends string, FieldValue>(
  field: Field<TableName, RecordType, Path, FieldValue>,
  value: NoInfer<OrderedValue<FieldValue>>,
): Expression<TableName, RecordType> =>
  createExpression(field, {
    operator: 'gt',
    range: Range.greaterThan(value),
  });

export const gte = <TableName extends string, RecordType extends object, Path extends string, FieldValue>(
  field: Field<TableName, RecordType, Path, FieldValue>,
  value: NoInfer<OrderedValue<FieldValue>>,
): Expression<TableName, RecordType> =>
  createExpression(field, {
    operator: 'gte',
    range: Range.atLeast(value),
  });

export const lt = <TableName extends string, RecordType extends object, Path extends string, FieldValue>(
  field: Field<TableName, RecordType, Path, FieldValue>,
  value: NoInfer<OrderedValue<FieldValue>>,
): Expression<TableName, RecordType> =>
  createExpression(field, {
    operator: 'lt',
    range: Range.lessThan(value),
  });

export const lte = <TableName extends string, RecordType extends object, Path extends string, FieldValue>(
  field: Field<TableName, RecordType, Path, FieldValue>,
  value: NoInfer<OrderedValue<FieldValue>>,
): Expression<TableName, RecordType> =>
  createExpression(field, {
    operator: 'lte',
    range: Range.atMost(value),
  });

export const between = <
  TableName extends string,
  RecordType extends object,
  Path extends string,
  FieldValue,
  const Lower extends OrderedValue<FieldValue>,
>(
  field: Field<TableName, RecordType, Path, FieldValue>,
  lower: Lower,
  upper: NoInfer<CompatibleKey<Lower> & OrderedValue<FieldValue>>,
  options?: BetweenOptions,
): Expression<TableName, RecordType> =>
  createExpression(field, {
    operator: 'between',
    range: Range.between(lower, upper, options),
  });

export const oneOf = <TableName extends string, RecordType extends object, Path extends string, FieldValue>(
  field: Field<TableName, RecordType, Path, FieldValue>,
  values: readonly NoInfer<EqualityValue<FieldValue>>[],
): Expression<TableName, RecordType> =>
  createExpression(field, {
    operator: 'one-of',
    values: unique(values),
  });

export const isNull = <TableName extends string, RecordType extends object, Path extends string, FieldValue>(
  field: unknown extends FieldValue
    ? never
    : null extends FieldValue
      ? Field<TableName, RecordType, Path, FieldValue>
      : never,
): Expression<TableName, RecordType> =>
  createExpression(field, {
    operator: 'is-null',
  });

export const isMissing = <TableName extends string, RecordType extends object, Path extends string, FieldValue>(
  field: unknown extends FieldValue
    ? never
    : undefined extends FieldValue
      ? Field<TableName, RecordType, Path, FieldValue>
      : never,
): Expression<TableName, RecordType> =>
  createExpression(field, {
    operator: 'is-missing',
  });

export const and = <TableName extends string, RecordType extends object>(
  ...operands: readonly [
    left: Expression<TableName, RecordType>,
    right: NoInfer<Expression<TableName, RecordType>>,
    ...rest: NoInfer<Expression<TableName, RecordType>>[],
  ]
): Expression<TableName, RecordType> => createLogicalExpression('and', operands);

export const or = <TableName extends string, RecordType extends object>(
  ...operands: readonly [
    left: Expression<TableName, RecordType>,
    right: NoInfer<Expression<TableName, RecordType>>,
    ...rest: NoInfer<Expression<TableName, RecordType>>[],
  ]
): Expression<TableName, RecordType> => createLogicalExpression('or', operands);

export const not = <TableName extends string, RecordType extends object>(
  ...operands: readonly [expression: Expression<TableName, RecordType>]
): Expression<TableName, RecordType> => createLogicalExpression('not', operands);

import { Key } from '../key/index.ts';
import type { BinaryStorageKey, StorageKey } from '../key/index.ts';

export type Boundary = 'inclusive' | 'exclusive';

export type BetweenOptions = Readonly<{
  lower?: Boundary;
  upper?: Boundary;
}>;

export type PrefixKey = string | BinaryStorageKey | readonly StorageKey[];

export type PrefixBoundary = Readonly<{
  type: 'lower' | 'upper';
  key: StorageKey;
  boundary: Boundary;
}>;

export type Definition =
  | Readonly<{
      type: 'only';
      key: StorageKey;
    }>
  | Readonly<{
      type: 'lower';
      key: StorageKey;
      boundary: Boundary;
    }>
  | Readonly<{
      type: 'upper';
      key: StorageKey;
      boundary: Boundary;
    }>
  | Readonly<{
      type: 'between';
      lower: StorageKey;
      upper: StorageKey;
      lowerBoundary: Boundary;
      upperBoundary: Boundary;
    }>
  | Readonly<{
      type: 'any-of';
      keys: readonly StorageKey[];
    }>
  | Readonly<{
      type: 'prefix';
      prefix: PrefixKey;
      boundary?: PrefixBoundary;
    }>;

export type CompatibleKey<Value> = Value extends number
  ? number
  : Value extends string
    ? string
    : Value extends Date
      ? Date
      : Value extends BinaryStorageKey
        ? BinaryStorageKey
        : Value extends readonly StorageKey[]
          ? number extends Value['length']
            ? readonly StorageKey[]
            : {
                readonly [Index in keyof Value]: CompatibleKey<Value[Index]>;
              }
          : never;

type PrefixValue<Value extends PrefixKey> = Value extends string
  ? string
  : Value extends BinaryStorageKey
    ? BinaryStorageKey
    : Value extends readonly StorageKey[]
      ? readonly StorageKey[]
      : never;

type Criterion =
  | Readonly<{
      type: 'only';
      key: Key;
    }>
  | Readonly<{
      type: 'lower';
      key: Key;
      boundary: Boundary;
    }>
  | Readonly<{
      type: 'upper';
      key: Key;
      boundary: Boundary;
    }>
  | Readonly<{
      type: 'between';
      lower: Key;
      upper: Key;
      lowerBoundary: Boundary;
      upperBoundary: Boundary;
    }>
  | Readonly<{
      type: 'any-of';
      keys: readonly Key[];
    }>
  | Readonly<{
      type: 'prefix';
      prefix: Key;
      boundary?: Readonly<{
        type: 'lower' | 'upper';
        key: Key;
        boundary: Boundary;
      }>;
    }>;

const inclusive: Boundary = 'inclusive';
const exclusive: Boundary = 'exclusive';
const reversedBoundariesMessage = 'Range boundaries are reversed';
const differentBoundaryKindsMessage = 'Range boundaries have different storage kinds';
const invalidBoundaryMessage = 'Range boundary is invalid';
const invalidPrefixMessage = 'Range prefix must be a string, binary, or array key';
const invalidPrefixBoundaryMessage = 'Range prefix boundary is invalid';
const differentPrefixBoundaryKindMessage = 'Range prefix boundary has a different storage kind';
const prefixBoundaryOutsidePrefixMessage = 'Range prefix boundary does not start with the prefix';

const freeze = <Value extends object>(value: Value): Readonly<Value> => Object.freeze(value);

const normalizeBoundary = (value: Boundary | undefined): Boundary => {
  if (value === undefined || value === inclusive) {
    return inclusive;
  }

  if (value === exclusive) {
    return exclusive;
  }

  throw new TypeError(invalidBoundaryMessage);
};

const includesLower = (order: -1 | 0 | 1, boundary: Boundary): boolean =>
  order > 0 || (order === 0 && boundary === inclusive);

const includesUpper = (order: -1 | 0 | 1, boundary: Boundary): boolean =>
  order < 0 || (order === 0 && boundary === inclusive);

const criteria = new WeakMap<object, Criterion>();

export class Range<Value extends StorageKey = StorageKey> {
  declare private readonly valueType: Value;

  private constructor(criterion: Criterion) {
    criteria.set(this, criterion);
    Object.freeze(this);
  }

  public static only<const Value extends StorageKey>(value: Value): Range<CompatibleKey<Value>> {
    return new Range(
      freeze({
        type: 'only',
        key: Key.from(value),
      }),
    );
  }

  public static atLeast<const Value extends StorageKey>(value: Value): Range<CompatibleKey<Value>> {
    return Range.lower(value, inclusive);
  }

  public static greaterThan<const Value extends StorageKey>(value: Value): Range<CompatibleKey<Value>> {
    return Range.lower(value, exclusive);
  }

  public static atMost<const Value extends StorageKey>(value: Value): Range<CompatibleKey<Value>> {
    return Range.upper(value, inclusive);
  }

  public static lessThan<const Value extends StorageKey>(value: Value): Range<CompatibleKey<Value>> {
    return Range.upper(value, exclusive);
  }

  public static between<const Value extends StorageKey>(
    lowerValue: Value,
    upperValue: NoInfer<CompatibleKey<Value>>,
    options?: BetweenOptions,
  ): Range<CompatibleKey<Value>> {
    const lower = Key.from(lowerValue);
    const upper = Key.from(upperValue);

    if (lower.kind !== upper.kind) {
      throw new TypeError(differentBoundaryKindsMessage);
    }

    if (lower.compare(upper) > 0) {
      throw new RangeError(reversedBoundariesMessage);
    }

    return new Range(
      freeze({
        type: 'between',
        lower,
        upper,
        lowerBoundary: normalizeBoundary(options?.lower),
        upperBoundary: normalizeBoundary(options?.upper),
      }),
    );
  }

  public static anyOf<const Value extends StorageKey>(values: readonly Value[]): Range<CompatibleKey<Value>> {
    const keys = values.map((value) => Key.from(value)).sort((left, right) => left.compare(right));
    const unique = keys.filter((key, index) => index === 0 || key.compare(keys[index - 1]) !== 0);

    return new Range(
      freeze({
        type: 'any-of',
        keys: Object.freeze(unique),
      }),
    );
  }

  public static prefix<const Value extends PrefixKey>(value: Value): Range<PrefixValue<Value>> {
    const prefix = Key.from(value);

    if (prefix.kind !== 'string' && prefix.kind !== 'binary' && prefix.kind !== 'array') {
      throw new TypeError(invalidPrefixMessage);
    }

    return new Range(
      freeze({
        type: 'prefix',
        prefix,
      }),
    );
  }

  public includes(value: Value): boolean {
    const criterion = criterionOf(this);
    const key = Key.from(value);

    switch (criterion.type) {
      case 'only':
        return key.compare(criterion.key) === 0;
      case 'lower':
        return includesLower(key.compare(criterion.key), criterion.boundary);
      case 'upper':
        return includesUpper(key.compare(criterion.key), criterion.boundary);
      case 'between':
        return (
          includesLower(key.compare(criterion.lower), criterion.lowerBoundary) &&
          includesUpper(key.compare(criterion.upper), criterion.upperBoundary)
        );
      case 'any-of':
        return criterion.keys.some((candidate) => key.compare(candidate) === 0);
      case 'prefix': {
        if (!key.startsWith(criterion.prefix)) {
          return false;
        }

        if (criterion.boundary === undefined) {
          return true;
        }

        const order = key.compare(criterion.boundary.key);

        return criterion.boundary.type === 'lower'
          ? includesLower(order, criterion.boundary.boundary)
          : includesUpper(order, criterion.boundary.boundary);
      }
    }
  }

  private static lower<const Value extends StorageKey>(value: Value, boundary: Boundary): Range<CompatibleKey<Value>> {
    return new Range(
      freeze({
        type: 'lower',
        key: Key.from(value),
        boundary,
      }),
    );
  }

  private static upper<const Value extends StorageKey>(value: Value, boundary: Boundary): Range<CompatibleKey<Value>> {
    return new Range(
      freeze({
        type: 'upper',
        key: Key.from(value),
        boundary,
      }),
    );
  }
}

const criterionOf = <Value extends StorageKey>(range: Range<Value>): Criterion => {
  const criterion = criteria.get(range);

  if (criterion === undefined) {
    throw new TypeError('Range is invalid');
  }

  return criterion;
};

export const definitionOf = <Value extends StorageKey>(range: Range<Value>): Definition => {
  const criterion = criterionOf(range);

  switch (criterion.type) {
    case 'only':
      return freeze({
        type: 'only',
        key: criterion.key.value,
      });
    case 'lower':
    case 'upper':
      return freeze({
        type: criterion.type,
        key: criterion.key.value,
        boundary: criterion.boundary,
      });
    case 'between':
      return freeze({
        type: 'between',
        lower: criterion.lower.value,
        upper: criterion.upper.value,
        lowerBoundary: criterion.lowerBoundary,
        upperBoundary: criterion.upperBoundary,
      });
    case 'any-of':
      return freeze({
        type: 'any-of',
        keys: Object.freeze(criterion.keys.map((key) => key.value)),
      });
    case 'prefix':
      return freeze({
        type: 'prefix',
        prefix: criterion.prefix.value as PrefixKey,
        ...(criterion.boundary === undefined
          ? {}
          : {
              boundary: freeze({
                type: criterion.boundary.type,
                key: criterion.boundary.key.value,
                boundary: criterion.boundary.boundary,
              }),
            }),
      });
  }
};

export const withinPrefix = <const Value extends PrefixKey>(
  value: Value,
  boundary: PrefixBoundary,
): Range<PrefixValue<Value>> => {
  const range = Range.prefix(value);
  const criterion = criterionOf(range);

  if (criterion.type !== 'prefix') {
    throw new TypeError(invalidPrefixMessage);
  }

  if (boundary.type !== 'lower' && boundary.type !== 'upper') {
    throw new TypeError(invalidPrefixBoundaryMessage);
  }

  const key = Key.from(boundary.key);

  if (key.kind !== criterion.prefix.kind) {
    throw new TypeError(differentPrefixBoundaryKindMessage);
  }

  if (!key.startsWith(criterion.prefix)) {
    throw new RangeError(prefixBoundaryOutsidePrefixMessage);
  }

  criteria.set(
    range,
    freeze({
      type: 'prefix',
      prefix: criterion.prefix,
      boundary: freeze({
        type: boundary.type,
        key,
        boundary: normalizeBoundary(boundary.boundary),
      }),
    }),
  );

  return range;
};

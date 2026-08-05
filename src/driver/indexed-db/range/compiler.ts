import { Key } from '../../../key/index.ts';
import type { StorageKey } from '../../../key/index.ts';
import { definitionOf, Range } from '../../../range/index.ts';

export type Compilation =
  | Readonly<{
      type: 'range';
      value: IDBKeyRange;
      continueWhile?: Range;
    }>
  | Readonly<{
      type: 'empty';
    }>;

const unsupportedRangeMessage = 'Range cannot be compiled to a single IndexedDB key range';

const empty: Compilation = Object.freeze({
  type: 'empty',
});

const nativeKey = (key: StorageKey): IDBValidKey => key as IDBValidKey;

const compiled = (value: IDBKeyRange, continueWhile?: Range): Compilation =>
  Object.freeze({
    type: 'range',
    value,
    ...(continueWhile === undefined
      ? {}
      : {
          continueWhile,
        }),
  });

export const compile = (range: Range, keyRange: typeof IDBKeyRange): Compilation => {
  const definition = definitionOf(range);

  switch (definition.type) {
    case 'only':
      return compiled(keyRange.only(nativeKey(definition.key)));
    case 'lower':
      return compiled(keyRange.lowerBound(nativeKey(definition.key), definition.boundary === 'exclusive'));
    case 'upper':
      return compiled(keyRange.upperBound(nativeKey(definition.key), definition.boundary === 'exclusive'));
    case 'between': {
      const lowerOpen = definition.lowerBoundary === 'exclusive';
      const upperOpen = definition.upperBoundary === 'exclusive';

      if ((lowerOpen || upperOpen) && Key.from(definition.lower).compare(Key.from(definition.upper)) === 0) {
        return empty;
      }

      return compiled(keyRange.bound(nativeKey(definition.lower), nativeKey(definition.upper), lowerOpen, upperOpen));
    }
    case 'prefix': {
      if (definition.boundary === undefined) {
        return compiled(keyRange.lowerBound(nativeKey(definition.prefix)), range);
      }

      const open = definition.boundary.boundary === 'exclusive';

      return definition.boundary.type === 'lower'
        ? compiled(keyRange.lowerBound(nativeKey(definition.boundary.key), open), range)
        : compiled(keyRange.bound(nativeKey(definition.prefix), nativeKey(definition.boundary.key), false, open));
    }
    case 'any-of':
      throw new TypeError(unsupportedRangeMessage);
  }
};

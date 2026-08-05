import { IDBKeyRange } from 'fake-indexeddb';

import type { StorageKey } from '../../../../key';
import { Range, withinPrefix } from '../../../../range';
import { compile } from '../compiler.ts';
import type { Compilation } from '../compiler.ts';

const nativeRange = (compilation: Compilation): IDBKeyRange => {
  if (compilation.type !== 'range') {
    throw new Error('Expected native range compilation');
  }

  return compilation.value;
};

describe('IndexedDB Range compiler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('компилирует only через явно переданный native API', () => {
    const only = vi.spyOn(IDBKeyRange, 'only');
    const compilation = compile(Range.only('message-1'), IDBKeyRange);

    expect(only).toHaveBeenCalledOnce();
    expect(only).toHaveBeenCalledWith('message-1');
    expect(compilation.type).toBe('range');
    expect(Object.isFrozen(compilation)).toBe(true);
    expect(nativeRange(compilation).includes('message-1')).toBe(true);
    expect(nativeRange(compilation).includes('message-2')).toBe(false);
  });

  it('не читает global IDBKeyRange вместо explicit dependency', () => {
    const globalOnly = vi.fn(() => {
      throw new Error('Global IDBKeyRange must not be used');
    });

    vi.stubGlobal('IDBKeyRange', {
      only: globalOnly,
    });

    const range = nativeRange(compile(Range.only('message-1'), IDBKeyRange));

    expect(globalOnly).not.toHaveBeenCalled();
    expect(range.includes('message-1')).toBe(true);
  });

  it('сохраняет inclusive и exclusive lower boundaries', () => {
    const lowerBound = vi.spyOn(IDBKeyRange, 'lowerBound');

    const inclusive = nativeRange(compile(Range.atLeast(10), IDBKeyRange));
    const exclusive = nativeRange(compile(Range.greaterThan(10), IDBKeyRange));

    expect(lowerBound).toHaveBeenNthCalledWith(1, 10, false);
    expect(lowerBound).toHaveBeenNthCalledWith(2, 10, true);
    expect(inclusive.lowerOpen).toBe(false);
    expect(exclusive.lowerOpen).toBe(true);
  });

  it('сохраняет inclusive и exclusive upper boundaries', () => {
    const upperBound = vi.spyOn(IDBKeyRange, 'upperBound');

    const inclusive = nativeRange(compile(Range.atMost(20), IDBKeyRange));
    const exclusive = nativeRange(compile(Range.lessThan(20), IDBKeyRange));

    expect(upperBound).toHaveBeenNthCalledWith(1, 20, false);
    expect(upperBound).toHaveBeenNthCalledWith(2, 20, true);
    expect(inclusive.upperOpen).toBe(false);
    expect(exclusive.upperOpen).toBe(true);
  });

  it('компилирует between с exact open flags', () => {
    const bound = vi.spyOn(IDBKeyRange, 'bound');
    const compilation = compile(
      Range.between(10, 20, {
        lower: 'exclusive',
        upper: 'inclusive',
      }),
      IDBKeyRange,
    );
    const range = nativeRange(compilation);

    expect(bound).toHaveBeenCalledOnce();
    expect(bound).toHaveBeenCalledWith(10, 20, true, false);
    expect(range.lower).toBe(10);
    expect(range.upper).toBe(20);
    expect(range.lowerOpen).toBe(true);
    expect(range.upperOpen).toBe(false);
  });

  it('компилирует равные inclusive boundaries как exact range', () => {
    const bound = vi.spyOn(IDBKeyRange, 'bound');
    const range = nativeRange(compile(Range.between('same', 'same'), IDBKeyRange));

    expect(bound).toHaveBeenCalledWith('same', 'same', false, false);
    expect(range.includes('same')).toBe(true);
  });

  it.each([
    {
      lower: 'exclusive',
      upper: 'inclusive',
    },
    {
      lower: 'inclusive',
      upper: 'exclusive',
    },
    {
      lower: 'exclusive',
      upper: 'exclusive',
    },
  ] as const)('возвращает explicit empty для равных $lower/$upper boundaries', (options) => {
    const bound = vi.spyOn(IDBKeyRange, 'bound');
    const compilation = compile(Range.between(10, 10, options), IDBKeyRange);

    expect(compilation).toEqual({
      type: 'empty',
    });
    expect(Object.isFrozen(compilation)).toBe(true);
    expect(bound).not.toHaveBeenCalled();
  });

  it('сохраняет native membership для разных storage key kinds', () => {
    const cases: readonly Readonly<{
      range: Range;
      included: StorageKey;
      excluded: StorageKey;
    }>[] = [
      {
        range: Range.between(new Date(100), new Date(200)),
        included: new Date(150),
        excluded: new Date(300),
      },
      {
        range: Range.between(new Uint8Array([1, 2]), new Uint8Array([1, 4])),
        included: new Uint8Array([1, 3]),
        excluded: new Uint8Array([2, 0]),
      },
      {
        range: Range.between(['chat-1', 10], ['chat-1', 20]),
        included: ['chat-1', 15],
        excluded: ['chat-2', 15],
      },
    ];

    for (const entry of cases) {
      const compiledRange = nativeRange(compile(entry.range, IDBKeyRange));

      expect(compiledRange.includes(entry.included as IDBValidKey)).toBe(true);
      expect(compiledRange.includes(entry.excluded as IDBValidKey)).toBe(false);
      expect(entry.range.includes(entry.included)).toBe(true);
      expect(entry.range.includes(entry.excluded)).toBe(false);
    }
  });

  it('компилирует string, binary и array prefix через lower bound с exact continuation guard', () => {
    const lowerBound = vi.spyOn(IDBKeyRange, 'lowerBound');
    const ranges = [
      Range.prefix('message-'),
      Range.prefix(new Uint8Array([1, 2])),
      Range.prefix(['chat-1'] as const),
    ] as const;

    for (const range of ranges) {
      const compilation = compile(range, IDBKeyRange);

      expect(compilation.type).toBe('range');

      if (compilation.type !== 'range') {
        throw new Error('Expected native range compilation');
      }

      expect(compilation.continueWhile).toBe(range);
    }

    expect(lowerBound).toHaveBeenNthCalledWith(1, 'message-');
    expect(lowerBound).toHaveBeenNthCalledWith(2, new Uint8Array([1, 2]).buffer);
    expect(lowerBound).toHaveBeenNthCalledWith(3, ['chat-1']);
  });

  it('компилирует bounded prefix lower через boundary lower bound с guard', () => {
    const lowerBound = vi.spyOn(IDBKeyRange, 'lowerBound');
    const inclusive = withinPrefix(['chat-1'] as const, {
      type: 'lower',
      key: ['chat-1', 10],
      boundary: 'inclusive',
    });
    const exclusive = withinPrefix(['chat-1'] as const, {
      type: 'lower',
      key: ['chat-1', 10],
      boundary: 'exclusive',
    });
    const inclusiveCompilation = compile(inclusive, IDBKeyRange);
    const exclusiveCompilation = compile(exclusive, IDBKeyRange);

    expect(lowerBound).toHaveBeenNthCalledWith(1, ['chat-1', 10], false);
    expect(lowerBound).toHaveBeenNthCalledWith(2, ['chat-1', 10], true);
    expect(inclusiveCompilation).toMatchObject({
      type: 'range',
      continueWhile: inclusive,
    });
    expect(exclusiveCompilation).toMatchObject({
      type: 'range',
      continueWhile: exclusive,
    });
  });

  it('компилирует bounded prefix upper как exact native bound без guard', () => {
    const bound = vi.spyOn(IDBKeyRange, 'bound');
    const inclusive = withinPrefix(['chat-1'] as const, {
      type: 'upper',
      key: ['chat-1', 20],
      boundary: 'inclusive',
    });
    const exclusive = withinPrefix(['chat-1'] as const, {
      type: 'upper',
      key: ['chat-1', 20],
      boundary: 'exclusive',
    });
    const inclusiveCompilation = compile(inclusive, IDBKeyRange);
    const exclusiveCompilation = compile(exclusive, IDBKeyRange);

    expect(bound).toHaveBeenNthCalledWith(1, ['chat-1'], ['chat-1', 20], false, false);
    expect(bound).toHaveBeenNthCalledWith(2, ['chat-1'], ['chat-1', 20], false, true);
    expect(inclusiveCompilation).not.toHaveProperty('continueWhile');
    expect(exclusiveCompilation).not.toHaveProperty('continueWhile');
  });

  it('не подменяет anyOf одной native range', () => {
    expect(() => compile(Range.anyOf(['a', 'b']), IDBKeyRange)).toThrow(
      new TypeError('Range cannot be compiled to a single IndexedDB key range'),
    );
  });

  it('не оборачивает native exception на compiler boundary', () => {
    const cause = new DOMException('Native range failure', 'DataError');

    vi.spyOn(IDBKeyRange, 'only').mockImplementation(() => {
      throw cause;
    });

    expect(() => compile(Range.only('message-1'), IDBKeyRange)).toThrow(cause);
  });

  it('отклоняет forged Range через owner validation', () => {
    const forged = Object.create(Range.prototype) as Range;

    expect(() => compile(forged, IDBKeyRange)).toThrow(new TypeError('Range is invalid'));
  });
});

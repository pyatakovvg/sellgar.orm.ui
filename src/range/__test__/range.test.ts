import { IDBKeyRange } from 'fake-indexeddb';

import { definitionOf, Range, withinPrefix } from '../index.ts';
import type { BetweenOptions, PrefixKey } from '../index.ts';
import type { StorageKey } from '../../key/index.ts';

describe('Range types', () => {
  it('сохраняет storage-key type во всех factories', () => {
    const only = Range.only('message-1');
    const lower = Range.atLeast(1);
    const upper = Range.lessThan(new Date(100));
    const between = Range.between(new Uint8Array([1]), new Uint8Array([2]));
    const compound = Range.between(['chat-1', 1] as const, ['chat-9', 9] as const);
    const nested = Range.between(['chat-1', [1, new Date(100)]] as const, ['chat-9', [9, new Date(900)]] as const);
    const anyOf = Range.anyOf(['first', 'second']);
    const stringPrefix = Range.prefix('message:');
    const binaryPrefix = Range.prefix(new Uint8Array([1]));
    const compoundPrefix = Range.prefix(['chat-1'] as const);

    expectTypeOf(only).toMatchTypeOf<Range<string>>();
    expectTypeOf(lower).toMatchTypeOf<Range<number>>();
    expectTypeOf(upper).toMatchTypeOf<Range<Date>>();
    expectTypeOf(between).toMatchTypeOf<Range<ArrayBuffer | ArrayBufferView<ArrayBuffer>>>();
    expectTypeOf(compound).toMatchTypeOf<Range<readonly [string, number]>>();
    expectTypeOf(nested).toMatchTypeOf<Range<readonly [string, readonly [number, Date]]>>();
    expectTypeOf(anyOf).toMatchTypeOf<Range<string>>();
    expectTypeOf(stringPrefix).toMatchTypeOf<Range<string>>();
    expectTypeOf(binaryPrefix).toMatchTypeOf<Range<ArrayBuffer | ArrayBufferView<ArrayBuffer>>>();
    expectTypeOf(compoundPrefix).toMatchTypeOf<Range<readonly StorageKey[]>>();

    expect(only.includes('message-1')).toBe(true);
    expect(lower.includes(2)).toBe(true);
    expect(upper.includes(new Date(99))).toBe(true);
    expect(between.includes(new Uint8Array([1, 1]))).toBe(true);
    expect(compound.includes(['chat-2', 2])).toBe(true);
    expect(anyOf.includes('first')).toBe(true);
    expect(stringPrefix.includes('message:1')).toBe(true);
    expect(binaryPrefix.includes(new Uint8Array([1, 2]))).toBe(true);
    expect(compoundPrefix.includes(['chat-1', 1])).toBe(true);
  });

  it('отклоняет несовместимые compile-time key types', () => {
    if (false) {
      const strings = Range.between('a', 'z');
      const numbers = Range.anyOf([1, 2]);
      const prefix = Range.prefix('message:');

      // @ts-expect-error upper boundary должна иметь тот же storage-key type.
      Range.between('a', 1);
      // @ts-expect-error compound boundary сохраняет types и порядок components.
      Range.between(['chat-1', 1] as const, [2, 'chat-2'] as const);
      // @ts-expect-error string range не принимает number.
      strings.includes(1);
      // @ts-expect-error number range не принимает string.
      numbers.includes('1');
      // @ts-expect-error string prefix range не принимает binary key.
      prefix.includes(new Uint8Array([1]));
      // @ts-expect-error number не поддерживает prefix semantics.
      Range.prefix(1);
      // @ts-expect-error Date не поддерживает prefix semantics.
      Range.prefix(new Date());
      // @ts-expect-error Range нельзя подделать структурно.
      const forged: Range<string> = {
        includes: () => true,
      };

      // @ts-expect-error PrefixKey исключает number.
      const invalidPrefix: PrefixKey = 1;
      const invalidOptions: BetweenOptions = {
        // @ts-expect-error boundary имеет closed vocabulary.
        lower: 'open',
      };

      expect(invalidPrefix).toBe(1);
      expect(invalidOptions).toBeDefined();
      expect(forged).toBeDefined();
    }

    expect(true).toBe(true);
  });
});

describe('Range', () => {
  it('описывает exact key через only', () => {
    const range = Range.only('message-1');

    expect(range.includes('message-1')).toBe(true);
    expect(range.includes('message-2')).toBe(false);
    expect(definitionOf(range)).toEqual({
      type: 'only',
      key: 'message-1',
    });
    expect(Object.isFrozen(range)).toBe(true);
    expect(Object.isFrozen(definitionOf(range))).toBe(true);
  });

  it('поддерживает inclusive и exclusive one-sided boundaries', () => {
    const atLeast = Range.atLeast(10);
    const greaterThan = Range.greaterThan(10);
    const atMost = Range.atMost(10);
    const lessThan = Range.lessThan(10);

    expect([atLeast.includes(9), atLeast.includes(10), atLeast.includes(11)]).toEqual([false, true, true]);
    expect([greaterThan.includes(9), greaterThan.includes(10), greaterThan.includes(11)]).toEqual([false, false, true]);
    expect([atMost.includes(9), atMost.includes(10), atMost.includes(11)]).toEqual([true, true, false]);
    expect([lessThan.includes(9), lessThan.includes(10), lessThan.includes(11)]).toEqual([true, false, false]);
    expect(definitionOf(atLeast)).toEqual({
      type: 'lower',
      key: 10,
      boundary: 'inclusive',
    });
    expect(definitionOf(lessThan)).toEqual({
      type: 'upper',
      key: 10,
      boundary: 'exclusive',
    });
  });

  it('делает between inclusive по умолчанию', () => {
    const range = Range.between(10, 20);

    expect([range.includes(9), range.includes(10), range.includes(15), range.includes(20), range.includes(21)]).toEqual(
      [false, true, true, true, false],
    );
    expect(definitionOf(range)).toEqual({
      type: 'between',
      lower: 10,
      upper: 20,
      lowerBoundary: 'inclusive',
      upperBoundary: 'inclusive',
    });
  });

  it('поддерживает named between boundary options', () => {
    const range = Range.between(10, 20, {
      lower: 'exclusive',
      upper: 'exclusive',
    });

    expect([range.includes(10), range.includes(11), range.includes(19), range.includes(20)]).toEqual([
      false,
      true,
      true,
      false,
    ]);
    expect(definitionOf(range)).toMatchObject({
      lowerBoundary: 'exclusive',
      upperBoundary: 'exclusive',
    });
  });

  it('разрешает equal boundaries и представляет exclusive variant как empty range', () => {
    const point = Range.between(10, 10);
    const emptyLower = Range.between(10, 10, {
      lower: 'exclusive',
    });
    const emptyUpper = Range.between(10, 10, {
      upper: 'exclusive',
    });

    expect(point.includes(10)).toBe(true);
    expect(emptyLower.includes(10)).toBe(false);
    expect(emptyUpper.includes(10)).toBe(false);
  });

  it('отклоняет reversed boundaries и разные runtime storage kinds', () => {
    expect(() => Range.between(20, 10)).toThrow(new RangeError('Range boundaries are reversed'));
    expect(() => Range.between('10', 20 as unknown as string)).toThrow(
      new TypeError('Range boundaries have different storage kinds'),
    );
  });

  it('отклоняет неизвестное runtime boundary value', () => {
    expect(() =>
      Range.between(10, 20, {
        lower: 'open',
      } as unknown as BetweenOptions),
    ).toThrow(new TypeError('Range boundary is invalid'));
  });

  it('создаёт sorted deduplicated snapshot для anyOf', () => {
    const date = new Date(100);
    const bytes = new Uint8Array([1, 2]);
    const values: StorageKey[] = [date, bytes, 'b', 'a', 'a'];
    const range = Range.anyOf(values);

    date.setTime(200);
    bytes[0] = 9;
    values.splice(0, values.length, 'late');

    const definition = definitionOf(range);

    expect(range.includes(new Date(100))).toBe(true);
    expect(range.includes(new Uint8Array([1, 2]))).toBe(true);
    expect(range.includes('a')).toBe(true);
    expect(range.includes('missing')).toBe(false);
    expect(definition.type).toBe('any-of');

    if (definition.type === 'any-of') {
      expect(definition.keys).toEqual([new Date(100), 'a', 'b', new Uint8Array([1, 2]).buffer]);
      expect(Object.isFrozen(definition.keys)).toBe(true);
    }
  });

  it('представляет anyOf без values как empty set', () => {
    const range = Range.anyOf<string>([]);

    expect(range.includes('anything')).toBe(false);
    expect(definitionOf(range)).toEqual({
      type: 'any-of',
      keys: [],
    });
  });

  it('поддерживает string prefix, включая empty prefix', () => {
    const range = Range.prefix('message:');
    const allStrings = Range.prefix('');

    expect(range.includes('message:1')).toBe(true);
    expect(range.includes('message')).toBe(false);
    expect(allStrings.includes('')).toBe(true);
    expect(allStrings.includes('anything')).toBe(true);
    expect(allStrings.includes(1 as unknown as string)).toBe(false);
  });

  it('поддерживает binary prefix, включая empty prefix', () => {
    const range = Range.prefix(new Uint8Array([1, 2]));
    const allBinary = Range.prefix(new Uint8Array());

    expect(range.includes(new Uint8Array([1, 2]))).toBe(true);
    expect(range.includes(new Uint8Array([1, 2, 3]))).toBe(true);
    expect(range.includes(new Uint8Array([1, 3]))).toBe(false);
    expect(allBinary.includes(new ArrayBuffer(0))).toBe(true);
    expect(allBinary.includes(new Uint8Array([9]))).toBe(true);
  });

  it('поддерживает compound prefix по storage equality, включая empty prefix', () => {
    const range = Range.prefix(['chat-1', new Date(100)] as const);
    const allArrays = Range.prefix([] as const);

    expect(range.includes(['chat-1', new Date(100)])).toBe(true);
    expect(range.includes(['chat-1', new Date(100), 1])).toBe(true);
    expect(range.includes(['chat-1', new Date(101), 1])).toBe(false);
    expect(allArrays.includes([])).toBe(true);
    expect(allArrays.includes(['anything', 1])).toBe(true);
    expect(allArrays.includes('anything' as unknown as readonly [])).toBe(false);
  });

  it('ограничивает compound prefix одной inclusive или exclusive lower boundary', () => {
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

    expect(inclusive.includes(['chat-1', 9])).toBe(false);
    expect(inclusive.includes(['chat-1', 10])).toBe(true);
    expect(inclusive.includes(['chat-1', 11])).toBe(true);
    expect(inclusive.includes(['chat-2', 11])).toBe(false);
    expect(exclusive.includes(['chat-1', 10])).toBe(false);
    expect(exclusive.includes(['chat-1', 11])).toBe(true);
  });

  it('ограничивает compound prefix одной inclusive или exclusive upper boundary', () => {
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

    expect(inclusive.includes(['chat-1', 19])).toBe(true);
    expect(inclusive.includes(['chat-1', 20])).toBe(true);
    expect(inclusive.includes(['chat-1', 21])).toBe(false);
    expect(inclusive.includes(['chat-0', 19])).toBe(false);
    expect(exclusive.includes(['chat-1', 19])).toBe(true);
    expect(exclusive.includes(['chat-1', 20])).toBe(false);
  });

  it('валидирует bounded prefix boundary', () => {
    expect(() =>
      withinPrefix(['chat-1'] as const, {
        type: 'lower',
        key: 'chat-1',
        boundary: 'inclusive',
      }),
    ).toThrow(new TypeError('Range prefix boundary has a different storage kind'));
    expect(() =>
      withinPrefix(['chat-1'] as const, {
        type: 'lower',
        key: ['chat-2', 10],
        boundary: 'inclusive',
      }),
    ).toThrow(new RangeError('Range prefix boundary does not start with the prefix'));
    expect(() =>
      withinPrefix(
        ['chat-1'] as const,
        {
          type: 'outside',
          key: ['chat-1', 10],
          boundary: 'inclusive',
        } as never,
      ),
    ).toThrow(new TypeError('Range prefix boundary is invalid'));
    expect(() =>
      withinPrefix(
        ['chat-1'] as const,
        {
          type: 'lower',
          key: ['chat-1', 10],
          boundary: 'open',
        } as never,
      ),
    ).toThrow(new TypeError('Range boundary is invalid'));
  });

  it('не разделяет mutable state bounded prefix с input или definition', () => {
    const date = new Date(100);
    const bytes = new Uint8Array([1, 2]);
    const range = withinPrefix(['chat-1'] as const, {
      type: 'lower',
      key: ['chat-1', date, bytes],
      boundary: 'inclusive',
    });

    date.setTime(200);
    bytes[0] = 9;

    const first = definitionOf(range);

    if (first.type !== 'prefix' || first.boundary === undefined) {
      throw new Error('Expected bounded prefix definition');
    }

    const firstKey = first.boundary.key as readonly [string, Date, ArrayBuffer];

    firstKey[1].setTime(300);
    new Uint8Array(firstKey[2])[0] = 8;

    const second = definitionOf(range);

    if (second.type !== 'prefix' || second.boundary === undefined) {
      throw new Error('Expected bounded prefix definition');
    }

    const secondKey = second.boundary.key as readonly [string, Date, ArrayBuffer];

    expect(secondKey[1].getTime()).toBe(100);
    expect([...new Uint8Array(secondKey[2])]).toEqual([1, 2]);
    expect(Object.isFrozen(second.boundary)).toBe(true);
    expect(Object.isFrozen(secondKey)).toBe(true);
  });

  it('отклоняет unsupported runtime prefix kind', () => {
    expect(() => Range.prefix(1 as unknown as string)).toThrow(
      new TypeError('Range prefix must be a string, binary, or array key'),
    );
    expect(() => Range.prefix(new Date() as unknown as string)).toThrow(
      new TypeError('Range prefix must be a string, binary, or array key'),
    );
  });

  it('переиспользует Key runtime validation', () => {
    expect(() => Range.only(Number.NaN)).toThrow(new TypeError('Storage key is invalid'));
    expect(() => Range.between(new Date(Number.NaN), new Date())).toThrow(new TypeError('Storage key is invalid'));
    expect(() => Range.anyOf([1, Number.NaN])).toThrow(new TypeError('Storage key is invalid'));
  });

  it('не разделяет mutable state с input и прочитанным definition', () => {
    const lowerDate = new Date(100);
    const lowerBytes = new Uint8Array([1, 2]);
    const lower = [lowerDate, lowerBytes] as const;
    const upper = [new Date(200), new Uint8Array([2, 3])] as const;
    const range = Range.between(lower, upper);

    lowerDate.setTime(300);
    lowerBytes[0] = 9;

    const first = definitionOf(range);

    if (first.type !== 'between') {
      throw new Error('Expected between definition');
    }

    const firstLower = first.lower as readonly [Date, ArrayBuffer];
    firstLower[0].setTime(400);
    new Uint8Array(firstLower[1])[0] = 8;

    const second = definitionOf(range);

    if (second.type !== 'between') {
      throw new Error('Expected between definition');
    }

    const secondLower = second.lower as readonly [Date, ArrayBuffer];

    expect(secondLower[0].getTime()).toBe(100);
    expect([...new Uint8Array(secondLower[1])]).toEqual([1, 2]);
    expect(Object.isFrozen(secondLower)).toBe(true);
  });

  it('не создаёт native IDBKeyRange', () => {
    const range = Range.between('a', 'z');

    expect(definitionOf(range)).not.toBeInstanceOf(IDBKeyRange);
    expect(Object.values(definitionOf(range)).some((value) => value instanceof IDBKeyRange)).toBe(false);
  });

  it('совпадает с native key-range membership на representative matrix', () => {
    const verify = <Value extends StorageKey>(
      range: Range<Value>,
      native: IDBKeyRange,
      values: readonly Value[],
    ): void => {
      for (const value of values) {
        expect(range.includes(value)).toBe(native.includes(value as IDBValidKey));
      }
    };

    const numbers = [9, 10, 15, 20, 21];

    verify(Range.atLeast(10), IDBKeyRange.lowerBound(10), numbers);
    verify(Range.greaterThan(10), IDBKeyRange.lowerBound(10, true), numbers);
    verify(Range.atMost(20), IDBKeyRange.upperBound(20), numbers);
    verify(Range.lessThan(20), IDBKeyRange.upperBound(20, true), numbers);
    verify(Range.between(10, 20), IDBKeyRange.bound(10, 20), numbers);
    verify(
      Range.between(10, 20, {
        lower: 'exclusive',
        upper: 'exclusive',
      }),
      IDBKeyRange.bound(10, 20, true, true),
      numbers,
    );

    const compound = [
      ['chat-0', 9],
      ['chat-1', 10],
      ['chat-1', 15],
      ['chat-1', 20],
      ['chat-2', 21],
    ] as const;

    verify(
      Range.between(['chat-1', 10] as const, ['chat-1', 20] as const),
      IDBKeyRange.bound(['chat-1', 10], ['chat-1', 20]),
      compound,
    );
  });
});

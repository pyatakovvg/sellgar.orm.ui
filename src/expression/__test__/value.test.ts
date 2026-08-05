import { Value } from '../value.ts';
import type { Input } from '../value.ts';

describe('Value', () => {
  it('принимает утверждённый recursive equality domain', () => {
    const inputs: readonly Input[] = [
      1,
      'value',
      true,
      10n,
      new Date(100),
      new Uint8Array([1, 2]),
      [1, 'nested', false, 20n, [new Date(200)]],
    ];

    expect(inputs.map((input) => Value.from(input).value)).toHaveLength(inputs.length);
  });

  it('использует SameValueZero и storage equality', () => {
    expect(Value.from(Number.NaN).equals(Value.from(Number.NaN))).toBe(true);
    expect(Value.from(-0).equals(Value.from(0))).toBe(true);
    expect(Value.from(true).equals(Value.from(true))).toBe(true);
    expect(Value.from(true).equals(Value.from(false))).toBe(false);
    expect(Value.from(10n).equals(Value.from(10n))).toBe(true);
    expect(Value.from(new Date(100)).equals(Value.from(new Date(100)))).toBe(true);
    expect(Value.from(new Uint8Array([1, 2])).equals(Value.from(new Uint8Array([1, 2])))).toBe(true);
    expect(Value.from([1, false, [2n]]).equals(Value.from([1, false, [2n]]))).toBe(true);
    expect(Value.from([1, false]).equals(Value.from([1, true]))).toBe(false);
  });

  it('создаёт собственный snapshot mutable input', () => {
    const date = new Date(100);
    const bytes = new Uint8Array([1, 2]);
    const nested: Input[] = [date, bytes, [false]];
    const value = Value.from(nested);

    date.setTime(200);
    bytes[0] = 9;
    nested.push('late');
    (nested[2] as Input[]).push(true);

    const snapshot = value.value as readonly [Date, ArrayBuffer, readonly boolean[]];

    expect(snapshot[0].getTime()).toBe(100);
    expect([...new Uint8Array(snapshot[1])]).toEqual([1, 2]);
    expect(snapshot[2]).toEqual([false]);
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('не раскрывает mutable state через value', () => {
    const value = Value.from([new Date(100), new Uint8Array([1, 2])]);
    const first = value.value as readonly [Date, ArrayBuffer];

    first[0].setTime(200);
    new Uint8Array(first[1])[0] = 9;

    const second = value.value as readonly [Date, ArrayBuffer];

    expect(second[0].getTime()).toBe(100);
    expect([...new Uint8Array(second[1])]).toEqual([1, 2]);
    expect(first).not.toBe(second);
  });

  it('отклоняет unsupported и invalid values', () => {
    const sparse = new Array<Input>(2);
    sparse[1] = 'defined';
    const cyclic: Input[] = [];
    cyclic.push(cyclic);

    expect(() => Value.from(null as unknown as Input)).toThrow(new TypeError('Expression value is invalid'));
    expect(() => Value.from(undefined as unknown as Input)).toThrow(new TypeError('Expression value is invalid'));
    expect(() => Value.from({ id: 'value' } as unknown as Input)).toThrow(new TypeError('Expression value is invalid'));
    expect(() => Value.from(new Date(Number.NaN))).toThrow(new TypeError('Expression value is invalid'));
    expect(() => Value.from(sparse)).toThrow(new TypeError('Expression value is invalid'));
    expect(() => Value.from(cyclic)).toThrow(new TypeError('Expression value is invalid'));
  });

  it('отклоняет detached binary buffer', () => {
    const buffer = new ArrayBuffer(1);

    structuredClone(buffer, {
      transfer: [buffer],
    });

    expect(() => Value.from(buffer)).toThrow(new TypeError('Expression value is invalid'));
  });

  it('разрешает shared nested array без ложного cycle', () => {
    const shared: readonly Input[] = [false, 1n];

    expect(Value.from([shared, shared]).value).toEqual([
      [false, 1n],
      [false, 1n],
    ]);
  });
});

import { createIndexName } from '../index-name.ts';

describe('createIndexName', () => {
  it('кодирует simple, compound и options в canonical JSON tuple', () => {
    expect(
      createIndexName({
        keyPath: 'chatId',
        unique: false,
        multiEntry: false,
      }),
    ).toBe('["chatId",false,false]');
    expect(
      createIndexName({
        keyPath: ['chatId', 'position'],
        unique: false,
        multiEntry: false,
      }),
    ).toBe('[["chatId","position"],false,false]');
    expect(
      createIndexName({
        keyPath: 'externalId',
        unique: true,
        multiEntry: false,
      }),
    ).toBe('["externalId",true,false]');
    expect(
      createIndexName({
        keyPath: 'tags',
        unique: false,
        multiEntry: true,
      }),
    ).toBe('["tags",false,true]');
  });

  it('возвращает одинаковое имя для одинаковой structural identity', () => {
    const first = createIndexName({
      keyPath: ['chatId', 'position'],
      unique: true,
      multiEntry: false,
    });
    const second = createIndexName({
      keyPath: ['chatId', 'position'],
      unique: true,
      multiEntry: false,
    });

    expect(first).toBe(second);
  });

  it('не создаёт collisions между формами key path и options', () => {
    const identities = [
      { keyPath: 'field', unique: false, multiEntry: false },
      { keyPath: 'field', unique: true, multiEntry: false },
      { keyPath: 'field', unique: false, multiEntry: true },
      { keyPath: 'field', unique: true, multiEntry: true },
      { keyPath: ['field', 'nested'], unique: false, multiEntry: false },
      { keyPath: ['nested', 'field'], unique: false, multiEntry: false },
      { keyPath: '["field","nested"]', unique: false, multiEntry: false },
    ] as const;

    const names = identities.map(createIndexName);

    expect(new Set(names).size).toBe(names.length);
  });
});

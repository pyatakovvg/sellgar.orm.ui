import { OperationError } from '../../error';
import { schema, Schema } from '../schema.ts';
import { SchemaValidationError } from '../schema-validation-error.ts';
import { table } from '../table.ts';
import type { SchemaTable } from '../table.ts';

interface RecordValue {
  readonly id: string;
  readonly sequence: number;
  readonly group: string;
  readonly position: number;
  readonly tags: readonly string[];
}

type UnsafeTableBuilder = {
  record(): {
    define(definition: unknown): SchemaTable;
  };
};

const unsafeTable = table as unknown as (name: unknown) => UnsafeTableBuilder;
const unsafeSchema = schema as unknown as (definition: unknown) => Schema;

const expectSchemaError = (
  action: () => unknown,
  code: SchemaValidationError['code'],
  path: SchemaValidationError['path'],
): SchemaValidationError => {
  try {
    action();
  } catch (error) {
    if (!(error instanceof SchemaValidationError)) {
      throw error;
    }

    expect(error.code).toBe(code);
    expect(error.operation).toBe('schema.validate');
    expect(error).toBeInstanceOf(OperationError);
    expect(error.path).toEqual(path);
    expect(Object.isFrozen(error.path)).toBe(true);
    return error;
  }

  throw new Error('Expected SchemaValidationError');
};

const defineUnsafe = (name: unknown, definition: unknown): SchemaTable => unsafeTable(name).record().define(definition);

describe('Schema validation', () => {
  it('сохраняет произвольные string names и сравнивает их точно', () => {
    const emptyName = table('').record<RecordValue>().define({
      primaryKey: 'id',
      indexes: [],
    });
    const upperCase = table('Messages').record<RecordValue>().define({
      primaryKey: 'id',
      indexes: [],
    });
    const lowerCase = table('messages').record<RecordValue>().define({
      primaryKey: 'id',
      indexes: [],
    });

    const validatedSchema = schema({
      name: '',
      version: 1,
      tables: [emptyName, upperCase, lowerCase],
    });

    expect(validatedSchema.name).toBe('');
    expect(validatedSchema.tables.map(({ name }) => name)).toEqual(['', 'Messages', 'messages']);
  });

  it('отклоняет invalid database и table metadata', () => {
    expectSchemaError(
      () =>
        unsafeSchema({
          name: 42,
          version: 1,
          tables: [],
        }),
      'invalid-schema-name',
      ['name'],
    );
    expectSchemaError(
      () =>
        unsafeSchema({
          name: 'database',
          version: 2,
          tables: [],
        }),
      'invalid-schema-version',
      ['version'],
    );
    expectSchemaError(
      () =>
        unsafeSchema({
          name: 'database',
          version: 1,
          tables: [],
        }),
      'invalid-schema',
      ['tables'],
    );
    expectSchemaError(
      () =>
        defineUnsafe(42, {
          primaryKey: 'id',
          indexes: [],
        }),
      'invalid-table-name',
      ['name'],
    );
  });

  it('отклоняет duplicate table names внутри schema', () => {
    const first = table('records').record<RecordValue>().define({
      primaryKey: 'id',
      indexes: [],
    });
    const second = table('records').record<RecordValue>().define({
      primaryKey: 'id',
      indexes: [],
    });

    expectSchemaError(
      () =>
        schema({
          name: 'database',
          version: 1,
          tables: [first, second],
        }),
      'duplicate-table',
      ['tables', 1, 'name'],
    );
  });

  it.each([
    ['', ['primaryKey']],
    ['invalid path', ['primaryKey']],
    ['1invalid', ['primaryKey']],
    ['nested..path', ['primaryKey']],
    [[], ['primaryKey']],
    [['id'], ['primaryKey']],
    [
      ['id', ['group']],
      ['primaryKey', 1],
    ],
  ])('отклоняет invalid primary key path %#', (primaryKey, path) => {
    expectSchemaError(
      () =>
        defineUnsafe('records', {
          primaryKey,
          indexes: [],
        }),
      'invalid-key-path',
      path,
    );
  });

  it('отклоняет inconsistent primary key metadata и compound auto-increment', () => {
    expectSchemaError(
      () =>
        defineUnsafe('records', {
          primaryKey: {
            source: 'unknown',
            keyPath: 'id',
          },
          indexes: [],
        }),
      'invalid-primary-key',
      ['primaryKey', 'source'],
    );
    expectSchemaError(
      () =>
        defineUnsafe('records', {
          primaryKey: {
            source: 'record',
            keyPath: 'id',
            generation: 'generated',
          },
          indexes: [],
        }),
      'invalid-primary-key',
      ['primaryKey', 'generation'],
    );
    expectSchemaError(
      () =>
        defineUnsafe('records', {
          primaryKey: {
            source: 'record',
            keyPath: ['group', 'position'],
            generation: 'autoIncrement',
          },
          indexes: [],
        }),
      'invalid-auto-increment',
      ['primaryKey', 'keyPath'],
    );
  });

  it('проверяет index options и допускает unique multi-entry simple index', () => {
    const valid = table('records')
      .record<RecordValue>()
      .define({
        primaryKey: 'id',
        indexes: [
          {
            keyPath: 'tags',
            unique: true,
            multiEntry: true,
          },
        ],
      });

    expect(valid.indexes[0]).toMatchObject({
      unique: true,
      multiEntry: true,
    });
    expectSchemaError(
      () =>
        defineUnsafe('records', {
          primaryKey: 'id',
          indexes: [
            {
              keyPath: 'group',
              unique: 'yes',
            },
          ],
        }),
      'invalid-index',
      ['indexes', 0, 'unique'],
    );
    expectSchemaError(
      () =>
        defineUnsafe('records', {
          primaryKey: 'id',
          indexes: [
            {
              keyPath: ['group', 'position'],
              multiEntry: true,
            },
          ],
        }),
      'invalid-multi-entry',
      ['indexes', 0, 'keyPath'],
    );
  });

  it('определяет duplicate index структурно с учётом options', () => {
    expectSchemaError(
      () =>
        defineUnsafe('records', {
          primaryKey: 'id',
          indexes: [
            {
              keyPath: ['group', 'position'],
            },
            {
              keyPath: ['group', 'position'],
              unique: false,
              multiEntry: false,
            },
          ],
        }),
      'duplicate-index',
      ['indexes', 1],
    );

    const tableWithDifferentOptions = table('records')
      .record<RecordValue>()
      .define({
        primaryKey: 'id',
        indexes: [
          {
            keyPath: 'group',
          },
          {
            keyPath: 'group',
            unique: true,
          },
        ],
      });

    expect(tableWithDifferentOptions.indexes).toHaveLength(2);
  });

  it('повторно отклоняет подменённое или mutable table metadata в schema', () => {
    const valid = table('records').record<RecordValue>().define({
      primaryKey: 'id',
      indexes: [],
    });
    const mutableTable = {
      kind: valid.kind,
      name: valid.name,
      primaryKey: valid.primaryKey,
      indexes: valid.indexes,
    } as SchemaTable;

    expectSchemaError(
      () =>
        schema({
          name: 'database',
          version: 1,
          tables: [mutableTable],
        }),
      'invalid-table',
      ['tables', 0],
    );
  });

  it('сохраняет valid schema deeply immutable', () => {
    const records = table('records')
      .record<RecordValue>()
      .define({
        primaryKey: 'id',
        indexes: [
          {
            keyPath: ['group', 'position'],
          },
        ],
      });
    const immutableSchema = schema({
      name: 'database',
      version: 1,
      tables: [records],
    });

    expect(Object.isFrozen(immutableSchema)).toBe(true);
    expect(Object.isFrozen(immutableSchema.tables)).toBe(true);
    expect(Object.isFrozen(records)).toBe(true);
    expect(Object.isFrozen(records.primaryKey)).toBe(true);
    expect(Object.isFrozen(records.indexes)).toBe(true);
    expect(Object.isFrozen(records.indexes[0])).toBe(true);
  });
});

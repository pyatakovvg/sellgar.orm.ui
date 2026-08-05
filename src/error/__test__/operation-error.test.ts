import { ClientError, ConfigurationError, OperationError, UnsupportedOperationError } from '../index.ts';
import type { Operation } from '../index.ts';

describe('OperationError', () => {
  it('задаёт стабильный configuration code и logical operation', () => {
    const error = new ConfigurationError('Database factory configuration is invalid');

    expectTypeOf(error.code).toEqualTypeOf<'invalid-configuration'>();
    expectTypeOf(error.operation).toEqualTypeOf<Operation>();
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(OperationError);
    expect(error).toMatchObject({
      name: 'ConfigurationError',
      code: 'invalid-configuration',
      operation: 'configuration.validate',
      message: 'Database factory configuration is invalid',
    });
  });

  it('сохраняет cause как unknown по identity без изменения message', () => {
    const cause = {
      driver: 'private',
      message: 'Physical implementation details',
    };
    const error = new ConfigurationError('Database configuration cannot be used', {
      cause,
    });

    expectTypeOf(error.cause).toEqualTypeOf<unknown>();
    expect(error.cause).toBe(cause);
    expect(error.message).toBe('Database configuration cannot be used');
    expect(error.message).not.toContain(cause.message);
    expect(Object.keys(error)).not.toContain('cause');
  });

  it('задаёт стабильную client open error', () => {
    const cause = new DOMException('Physical details', 'VersionError');
    const error = new ClientError('version-mismatch', 'client.open', {
      cause,
    });

    expect(error).toBeInstanceOf(OperationError);
    expect(error).toMatchObject({
      name: 'ClientError',
      code: 'version-mismatch',
      operation: 'client.open',
      message: 'Stored database version is not supported',
    });
    expect(error.cause).toBe(cause);
  });

  it('задаёт stable closed error для exact table operation без cause', () => {
    const error = new ClientError('closed', 'upsert.execute');

    expect(error).toBeInstanceOf(OperationError);
    expect(error).toMatchObject({
      name: 'ClientError',
      code: 'closed',
      operation: 'upsert.execute',
      message: 'Client is closed',
    });
    expect(error.cause).toBeUndefined();
  });

  it('описывает unsupported logical operation без driver terminology', () => {
    const error = new UnsupportedOperationError('schema.validate');

    expectTypeOf(error.code).toEqualTypeOf<'unsupported-operation'>();
    expect(error).toBeInstanceOf(OperationError);
    expect(error).toMatchObject({
      name: 'UnsupportedOperationError',
      code: 'unsupported-operation',
      operation: 'schema.validate',
      message: 'Operation "schema.validate" is not supported',
    });
  });

  it('не объявляет application errors ошибками ORM', () => {
    const applicationError = new Error('Application callback failed');

    expect(applicationError).not.toBeInstanceOf(OperationError);
    expect(applicationError).not.toBeInstanceOf(ClientError);
    expect(applicationError).not.toBeInstanceOf(ConfigurationError);
    expect(applicationError).not.toBeInstanceOf(UnsupportedOperationError);
  });

  it('ограничивает operation metadata утверждёнными logical boundaries', () => {
    if (false) {
      // @ts-expect-error physical driver method не является logical ORM operation.
      new UnsupportedOperationError('physical.open');
      // @ts-expect-error future operation добавляется только вместе с реальным API.
      new UnsupportedOperationError('record.put');
    }

    expect(true).toBe(true);
  });
});

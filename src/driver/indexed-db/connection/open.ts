import type { CompiledSchema } from '../schema/index.ts';
import { installSchema } from '../schema/index.ts';

import { NativeConnection } from './native-connection.ts';

const createUnsupportedTransitionError = (oldVersion: number, newVersion: number | null): Error =>
  new Error(`IndexedDB schema transition from version ${oldVersion} to ${newVersion ?? 'unknown'} is not supported`);

const createUnknownOpenError = (): Error => new Error('IndexedDB open request failed without an error');

export const openConnection = (factory: IDBFactory, schema: CompiledSchema): Promise<NativeConnection> =>
  new Promise((resolve, reject) => {
    const request = factory.open(schema.name, schema.version);

    request.addEventListener('upgradeneeded', (event) => {
      try {
        if (event.oldVersion !== 0) {
          throw createUnsupportedTransitionError(event.oldVersion, event.newVersion);
        }

        installSchema(request.result, schema);
      } catch (error) {
        request.transaction?.abort();
        reject(error);
      }
    });

    request.addEventListener('success', () => {
      resolve(new NativeConnection(request.result));
    });
    request.addEventListener('error', () => {
      reject(request.error ?? createUnknownOpenError());
    });

    // A blocked request remains pending until the browser emits success or error.
  });

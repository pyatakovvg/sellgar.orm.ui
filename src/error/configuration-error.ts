import { OperationError } from './operation-error.ts';
import type { OperationErrorOptions } from './operation-error.ts';

export class ConfigurationError extends OperationError<'invalid-configuration'> {
  public override readonly name = 'ConfigurationError';

  public constructor(message: string, options?: OperationErrorOptions) {
    super('invalid-configuration', 'configuration.validate', message, options);
  }
}

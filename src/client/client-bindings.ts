import { BindingModuleInterface } from '@sellgar/app-v2';
import type { BindingRegistryInterface } from '@sellgar/app-v2';

import { ClientInterface } from './client.interface.ts';
import { Client } from './client.ts';

export class ClientBindings implements BindingModuleInterface {
  public register(registry: BindingRegistryInterface): void {
    registry.bind(ClientInterface).to(Client).inTransientScope();
  }
}

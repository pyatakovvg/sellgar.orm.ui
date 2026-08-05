import {
  ClientInterface,
  Delete,
  Insert,
  Select,
  Update,
  Upsert,
  schema,
  table,
} from '../index.ts';
import type { TableModel, TableRecord } from '../schema/index.ts';

class Message {
  readonly id!: string;
  text!: string;

  display(): string {
    return this.text;
  }
}

const messages = table('messages').entity(Message).define({
  primaryKey: 'id',
  indexes: [],
});

const databaseSchema = schema({
  name: 'package-facade-test',
  version: 1,
  tables: [messages],
});

describe('package facade', () => {
  it('экспортирует operation-oriented API и разделяет record от model', () => {
    expectTypeOf<ClientInterface<typeof databaseSchema>['select']>().returns.toEqualTypeOf<Select<typeof messages>>();
    expectTypeOf<ClientInterface<typeof databaseSchema>['insert']>().returns.toEqualTypeOf<Insert<typeof messages>>();
    expectTypeOf<ClientInterface<typeof databaseSchema>['upsert']>().returns.toEqualTypeOf<Upsert<typeof messages>>();
    expectTypeOf<ClientInterface<typeof databaseSchema>['update']>().returns.toEqualTypeOf<Update<typeof messages>>();
    expectTypeOf<ClientInterface<typeof databaseSchema>['delete']>().returns.toEqualTypeOf<Delete<typeof messages>>();
    expectTypeOf<TableRecord<typeof messages>>().toEqualTypeOf<{
      readonly id: string;
      text: string;
    }>();
    expectTypeOf<TableModel<typeof messages>>().toEqualTypeOf<Message>();
  });

  it('не сохраняет старый публичный API', () => {
    if (false) {
      const client = null as unknown as ClientInterface<typeof databaseSchema>;

      // @ts-expect-error query удалён в пользу select.
      client.query(messages);
      // @ts-expect-error table executor больше не является публичным слоем.
      client.table(messages);
      // @ts-expect-error внешний execute удалён; терминалы принадлежат operation builders.
      client.execute(messages);
      // @ts-expect-error put переименован в upsert без compatibility alias.
      client.put(messages);
      // @ts-expect-error primary key нельзя менять через update.
      client.update(messages).set({ id: 'other-id' });
    }

    expect(true).toBe(true);
  });
});

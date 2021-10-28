import { Entity } from '@subql/types';

export interface EntityFactory<T extends Entity> {
  get(id:string): Promise<T | undefined>;
  create(record: unknown): T;
}

export async function ensureEntity<T extends Entity>(id: string, factory: EntityFactory<T>): Promise<T> {
  let entity = await factory.get(id);

  if (entity) {
    return entity;
  }

  return factory.create({ id });
}

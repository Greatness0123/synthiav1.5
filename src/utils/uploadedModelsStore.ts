/**
 * IndexedDB persistence for user-uploaded GLB/GLTF models.
 */

import { get, set, keys, del } from 'idb-keyval';

export interface StoredUploadedModel {
  id: string;
  name: string;
  arrayBuffer: ArrayBuffer;
  uploadedAt: number;
  isTerrain: boolean;
}

const STORE_PREFIX = 'synthia_uploaded_model_';

function storageKey(id: string): string {
  return `${STORE_PREFIX}${id}`;
}

export async function saveUploadedModel(model: StoredUploadedModel): Promise<void> {
  await set(storageKey(model.id), model);
}

export async function getUploadedModel(id: string): Promise<StoredUploadedModel | undefined> {
  return get<StoredUploadedModel>(storageKey(id));
}

export async function listUploadedModels(): Promise<StoredUploadedModel[]> {
  const allKeys = await keys();
  const modelKeys = allKeys.filter(
    (k) => typeof k === 'string' && k.startsWith(STORE_PREFIX)
  ) as string[];

  const models: StoredUploadedModel[] = [];
  for (const key of modelKeys) {
    const model = await get<StoredUploadedModel>(key);
    if (model) models.push(model);
  }
  return models.sort((a, b) => b.uploadedAt - a.uploadedAt);
}

export async function deleteUploadedModel(id: string): Promise<void> {
  await del(storageKey(id));
}

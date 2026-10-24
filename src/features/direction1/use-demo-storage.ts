'use client';

import { useMemo, useSyncExternalStore } from 'react';
import type { z } from 'zod';

type Snapshot<T> = { value: T; hydrated: boolean; warning: string | null; blocked: boolean; persisted: boolean };

function createStore<T>(key: string, schema: z.ZodType<T>, create: () => T) {
  const initial: Snapshot<T> = { value: create(), hydrated: false, warning: null, blocked: false, persisted: false };
  let snapshot = initial;
  let loaded = false;
  const listeners = new Set<() => void>();
  function getSnapshot() {
    if (!loaded && typeof window !== 'undefined') {
      loaded = true;
      try {
        const raw = window.sessionStorage.getItem(key);
        if (raw === null) snapshot = { ...initial, hydrated: true };
        else {
          const parsed = schema.safeParse(JSON.parse(raw));
          snapshot = parsed.success ? { value: parsed.data, hydrated: true, warning: null, blocked: false, persisted: true }
            : { ...initial, hydrated: true, blocked: true, warning: '本地演示存档未通过校验，已保留原存档。请明确重置后再操作。' };
        }
      } catch (error: unknown) {
        snapshot = { ...initial, hydrated: true, blocked: error instanceof SyntaxError,
          warning: error instanceof SyntaxError ? '本地演示存档无法解析，已保留原存档。请明确重置后再操作。'
            : '浏览器无法读取演示存档。本次操作仅保存在内存，刷新可能丢失。' };
      }
    }
    return snapshot;
  }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot,
    getServerSnapshot: () => initial,
    save(value: T) {
      const parsed = schema.parse(value);
      try {
        window.sessionStorage.setItem(key, JSON.stringify(parsed));
        snapshot = { value: parsed, hydrated: true, warning: null, blocked: false, persisted: true };
      } catch {
        snapshot = { value: parsed, hydrated: true, warning: '浏览器无法写入演示存档。本次操作仅保存在内存，刷新可能丢失。', blocked: false, persisted: false };
      }
      for (const listener of listeners) listener();
    },
  };
}

export function useDemoStorage<T>(key: string, schema: z.ZodType<T>, create: () => T) {
  const store = useMemo(() => createStore(key, schema, create), [key, schema, create]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return { ...snapshot, save: store.save };
}

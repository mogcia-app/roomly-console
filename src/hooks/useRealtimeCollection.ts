"use client";

import { useMemo, useSyncExternalStore } from "react";

type RealtimeSnapshot<T> = {
  data: T[];
  isLoading: boolean;
  error: string | null;
};

type UseRealtimeCollectionOptions<T> = {
  enabled?: boolean;
  initialData?: T[];
  subscribe: (
    onData: (records: T[]) => void,
    onError: (error: Error) => void,
  ) => () => void;
};

function createRealtimeStore<T>(
  enabled: boolean,
  initialData: T[],
  subscribeToSource: UseRealtimeCollectionOptions<T>["subscribe"],
) {
  let snapshot: RealtimeSnapshot<T> = {
    data: initialData,
    isLoading: enabled,
    error: null,
  };

  let sourceUnsubscribe: (() => void) | null = null;
  const listeners = new Set<() => void>();

  const emit = () => {
    listeners.forEach((listener) => listener());
  };

  const stop = () => {
    sourceUnsubscribe?.();
    sourceUnsubscribe = null;
  };

  const start = () => {
    if (!enabled || sourceUnsubscribe) {
      return;
    }

    sourceUnsubscribe = subscribeToSource(
      (records) => {
        snapshot = {
          data: records,
          isLoading: false,
          error: null,
        };
        emit();
      },
      (error) => {
        snapshot = {
          data: initialData,
          isLoading: false,
          error: error.message,
        };
        emit();
      },
    );
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      start();

      return () => {
        listeners.delete(listener);

        if (listeners.size === 0) {
          stop();
        }
      };
    },
  };
}

export function useRealtimeCollection<T>({
  enabled = true,
  initialData = [],
  subscribe,
}: UseRealtimeCollectionOptions<T>) {
  const store = useMemo(
    () => createRealtimeStore(enabled, initialData, subscribe),
    [enabled, initialData, subscribe],
  );

  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

"use client";

import { useEffect, useState } from "react";
import { FRONTDESK_COMPACT_MODE_KEY } from "@/lib/frontdesk/preferences";

function readStoredBoolean(key: string, defaultValue: boolean) {
  if (typeof window === "undefined") {
    return defaultValue;
  }

  const value = window.localStorage.getItem(key);
  if (value === null) {
    return defaultValue;
  }

  return value === "true";
}

function useStoredBoolean(key: string, defaultValue: boolean) {
  const [value, setValue] = useState(() => readStoredBoolean(key, defaultValue));

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(key, String(value));
  }, [key, value]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    function handleStorage(event: StorageEvent) {
      if (event.key !== key) {
        return;
      }

      setValue(readStoredBoolean(key, defaultValue));
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [defaultValue, key]);

  return [value, setValue] as const;
}

export function useCompactModePreference() {
  return useStoredBoolean(FRONTDESK_COMPACT_MODE_KEY, false);
}

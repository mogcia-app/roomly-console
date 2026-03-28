"use client";

import { useCallback, useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import type { HotelUserRecord } from "@/lib/users/types";

async function getAuthorizationHeader() {
  const currentUser = auth.currentUser;

  if (!currentUser) {
    throw new Error("not-authenticated");
  }

  const token = await currentUser.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
  };
}

export function useHotelAdminStaff(enabled: boolean) {
  const [staff, setStaff] = useState<HotelUserRecord[]>([]);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setStaff([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/staff", {
        headers: await getAuthorizationHeader(),
      });
      const payload = (await response.json()) as { error?: string; users?: HotelUserRecord[] };

      if (!response.ok || !payload.users) {
        throw new Error(payload.error ?? "failed-to-load-staff");
      }

      setStaff(payload.users);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "failed-to-load-staff");
    } finally {
      setIsLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    staff,
    isLoading,
    error,
    refresh,
  };
}

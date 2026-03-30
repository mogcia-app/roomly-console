"use client";

import { useCallback, useEffect, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebase";
import type { RoomRecord } from "@/lib/frontdesk/types";

async function getAuthorizationHeader() {
  const auth = getFirebaseAuth();
  const currentUser = auth.currentUser;

  if (!currentUser) {
    throw new Error("not-authenticated");
  }

  const token = await currentUser.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
  };
}

export function useHotelAdminRooms(enabled: boolean) {
  const [rooms, setRooms] = useState<RoomRecord[]>([]);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setRooms([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/rooms", {
        headers: await getAuthorizationHeader(),
      });
      const payload = (await response.json()) as { error?: string; rooms?: RoomRecord[] };

      if (!response.ok || !payload.rooms) {
        throw new Error(payload.error ?? "failed-to-load-rooms");
      }

      setRooms(payload.rooms);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "failed-to-load-rooms");
    } finally {
      setIsLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    rooms,
    isLoading,
    error,
    refresh,
  };
}

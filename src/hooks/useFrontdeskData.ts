"use client";

import { useEffect, useMemo, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebase";
import type { MessageRecord, StayRecord } from "@/lib/frontdesk/types";
import {
  subscribeHotelRooms,
  subscribeHotelStays,
  subscribeRecentThreads,
  subscribeHumanThreads,
} from "@/lib/frontdesk/firestore";
import { useRealtimeCollection } from "@/hooks/useRealtimeCollection";

type MessageResponse = {
  error?: string;
  messages?: MessageRecord[];
};

async function authorizedFetch(input: RequestInfo, init?: RequestInit) {
  const currentUser = getFirebaseAuth().currentUser;

  if (!currentUser) {
    throw new Error("not-authenticated");
  }

  const token = await currentUser.getIdToken();

  return fetch(input, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });
}

function useMessageQuery(target: { threadId?: string; stayId?: string }, enabled = true) {
  const [data, setData] = useState<MessageRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryKey = enabled ? target.threadId ? `thread:${target.threadId}` : target.stayId ? `stay:${target.stayId}` : "" : "";

  useEffect(() => {
    let isActive = true;
    let intervalId: number | null = null;

    async function loadMessages() {
      if (!queryKey) {
        if (isActive) {
          setData([]);
          setError(null);
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const searchParams = new URLSearchParams();
        if (target.threadId) {
          searchParams.set("threadId", target.threadId);
        }
        if (target.stayId) {
          searchParams.set("stayId", target.stayId);
        }

        const response = await authorizedFetch(`/api/frontdesk/messages?${searchParams.toString()}`);
        const payload = (await response.json()) as MessageResponse;

        if (!response.ok) {
          throw new Error(payload.error ?? "failed-to-load-messages");
        }

        if (!isActive) {
          return;
        }

        setData(payload.messages ?? []);
        setError(null);
      } catch (loadError) {
        if (!isActive) {
          return;
        }

        setData([]);
        setError(loadError instanceof Error ? loadError.message : "failed-to-load-messages");
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    function startPolling() {
      if (intervalId !== null || typeof document === "undefined" || document.hidden || !queryKey) {
        return;
      }

      intervalId = window.setInterval(() => {
        void loadMessages();
      }, 15000);
    }

    function stopPolling() {
      if (intervalId === null) {
        return;
      }

      window.clearInterval(intervalId);
      intervalId = null;
    }

    function handleVisibilityChange() {
      if (typeof document === "undefined") {
        return;
      }

      if (document.hidden) {
        stopPolling();
        return;
      }

      void loadMessages();
      startPolling();
    }

    void loadMessages();
    startPolling();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isActive = false;
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [queryKey, target.stayId, target.threadId]);

  return {
    data,
    isLoading,
    error,
  };
}

export function useHumanThreads(hotelId: string) {
  const subscribe = useMemo(
    () => (onData: Parameters<typeof subscribeHumanThreads>[1], onError: Parameters<typeof subscribeHumanThreads>[2]) =>
      subscribeHumanThreads(hotelId, onData, onError),
    [hotelId],
  );

  return useRealtimeCollection({
    enabled: Boolean(hotelId),
    subscribe,
  });
}

export function useThreadMessages(threadId: string, enabled = true) {
  return useMessageQuery({ threadId }, enabled);
}

export function useStayMessages(stayId: string, enabled = true) {
  return useMessageQuery({ stayId }, enabled);
}

export function useHotelRooms(hotelId: string) {
  const subscribe = useMemo(
    () => (onData: Parameters<typeof subscribeHotelRooms>[1], onError: Parameters<typeof subscribeHotelRooms>[2]) =>
      subscribeHotelRooms(hotelId, onData, onError),
    [hotelId],
  );

  return useRealtimeCollection({
    enabled: Boolean(hotelId),
    subscribe,
  });
}

export function useRecentThreads(hotelId: string) {
  const subscribe = useMemo(
    () =>
      (
        onData: Parameters<typeof subscribeRecentThreads>[1],
        onError: Parameters<typeof subscribeRecentThreads>[2],
      ) => subscribeRecentThreads(hotelId, onData, onError),
    [hotelId],
  );

  return useRealtimeCollection({
    enabled: Boolean(hotelId),
    subscribe,
  });
}

export function useHotelActiveStays(hotelId: string) {
  const subscribe = useMemo(
    () => (onData: Parameters<typeof subscribeHotelStays>[1], onError: Parameters<typeof subscribeHotelStays>[2]) =>
      subscribeHotelStays(hotelId, onData, onError),
    [hotelId],
  );

  return useRealtimeCollection({
    enabled: Boolean(hotelId),
    subscribe: (onData: (stays: StayRecord[]) => void, onError) =>
      subscribe(
        (stays) => onData(stays.filter((stay) => stay.is_active)),
        onError,
      ),
  });
}

export function useHotelStays(hotelId: string) {
  const subscribe = useMemo(
    () => (onData: Parameters<typeof subscribeHotelStays>[1], onError: Parameters<typeof subscribeHotelStays>[2]) =>
      subscribeHotelStays(hotelId, onData, onError),
    [hotelId],
  );

  return useRealtimeCollection({
    enabled: Boolean(hotelId),
    subscribe,
  });
}

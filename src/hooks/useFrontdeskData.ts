"use client";

import { useMemo } from "react";
import {
  buildInquiryHistory,
  subscribeRecentCalls,
  subscribeRecentThreads,
  subscribeActiveCalls,
  subscribeHumanThreads,
  subscribeQueueCalls,
  subscribeThreadCalls,
  subscribeThreadMessages,
} from "@/lib/frontdesk/firestore";
import { useRealtimeCollection } from "@/hooks/useRealtimeCollection";

export function useQueueCalls(hotelId: string) {
  const subscribe = useMemo(
    () => (onData: Parameters<typeof subscribeQueueCalls>[1], onError: Parameters<typeof subscribeQueueCalls>[2]) =>
      subscribeQueueCalls(hotelId, onData, onError),
    [hotelId],
  );

  return useRealtimeCollection({
    enabled: Boolean(hotelId),
    subscribe,
  });
}

export function useActiveCalls(hotelId: string, staffUserId: string) {
  const subscribe = useMemo(
    () =>
      (
        onData: Parameters<typeof subscribeActiveCalls>[2],
        onError: Parameters<typeof subscribeActiveCalls>[3],
      ) => subscribeActiveCalls(hotelId, staffUserId, onData, onError),
    [hotelId, staffUserId],
  );

  return useRealtimeCollection({
    enabled: Boolean(hotelId && staffUserId),
    subscribe,
  });
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

export function useThreadMessages(threadId: string) {
  const subscribe = useMemo(
    () =>
      (
        onData: Parameters<typeof subscribeThreadMessages>[1],
        onError: Parameters<typeof subscribeThreadMessages>[2],
      ) => subscribeThreadMessages(threadId, onData, onError),
    [threadId],
  );

  return useRealtimeCollection({
    enabled: Boolean(threadId),
    subscribe,
  });
}

export function useThreadCalls(hotelId: string, threadId: string) {
  const subscribe = useMemo(
    () =>
      (
        onData: Parameters<typeof subscribeThreadCalls>[2],
        onError: Parameters<typeof subscribeThreadCalls>[3],
      ) => subscribeThreadCalls(hotelId, threadId, onData, onError),
    [hotelId, threadId],
  );

  return useRealtimeCollection({
    enabled: Boolean(hotelId && threadId),
    subscribe,
  });
}

export function useRecentCalls(hotelId: string) {
  const subscribe = useMemo(
    () => (onData: Parameters<typeof subscribeRecentCalls>[1], onError: Parameters<typeof subscribeRecentCalls>[2]) =>
      subscribeRecentCalls(hotelId, onData, onError),
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

export { buildInquiryHistory };

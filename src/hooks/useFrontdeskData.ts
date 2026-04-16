"use client";

import { useMemo } from "react";
import type { StayRecord } from "@/lib/frontdesk/types";
import {
  subscribeHotelRooms,
  subscribeHotelStays,
  subscribeRecentThreads,
  subscribeHumanThreads,
  subscribeThreadMessages,
} from "@/lib/frontdesk/firestore";
import { useRealtimeCollection } from "@/hooks/useRealtimeCollection";

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

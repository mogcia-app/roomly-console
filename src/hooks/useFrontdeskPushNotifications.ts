"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { getFirebaseApp } from "@/lib/firebase";
import { FRONTDESK_NOTIFICATION_ENABLED_KEY } from "@/lib/frontdesk/preferences";

type PushStatus = {
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  error: string | null;
  isLoading: boolean;
  isSubscribed: boolean;
  isSupported: boolean;
  permission: NotificationPermission | "unsupported";
};

type MessagingModule = typeof import("firebase/messaging");

async function loadMessagingModule(): Promise<MessagingModule | null> {
  const messaging = await import("firebase/messaging");
  if (!(await messaging.isSupported())) {
    return null;
  }

  return messaging;
}

async function getIdToken(user: User) {
  return user.getIdToken();
}

async function registerServiceWorker() {
  return navigator.serviceWorker.register("/frontdesk-sw.js", {
    scope: "/",
    updateViaCache: "none",
  });
}

export function useFrontdeskPushNotifications(params: {
  enabled: boolean;
  user: User | null;
}): PushStatus {
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return "unsupported";
    }

    return Notification.permission;
  });
  const tokenRef = useRef("");
  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY?.trim() ?? "";

  const syncSubscription = useCallback(async (mode: "subscribe" | "unsubscribe") => {
    if (!params.user) {
      throw new Error("not-authenticated");
    }

    if (!vapidKey) {
      throw new Error("missing-firebase-vapid-key");
    }

    const messagingModule = await loadMessagingModule();
    if (!messagingModule) {
      setPermission("unsupported");
      setIsSupported(false);
      throw new Error("push-not-supported");
    }

    const registration = await registerServiceWorker();
    const messaging = messagingModule.getMessaging(getFirebaseApp());
    const token =
      tokenRef.current ||
      (await messagingModule.getToken(messaging, {
        serviceWorkerRegistration: registration,
        vapidKey,
      }));

    if (!token) {
      throw new Error("failed-to-resolve-push-token");
    }

    tokenRef.current = token;
    const idToken = await getIdToken(params.user);

    const response = await fetch("/api/frontdesk/push-subscriptions", {
      method: mode === "subscribe" ? "POST" : "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        token,
        userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? "push-subscription-sync-failed");
    }

    if (mode === "unsubscribe") {
      await messagingModule.deleteToken(messaging);
      tokenRef.current = "";
      setIsSubscribed(false);
      window.localStorage.setItem(FRONTDESK_NOTIFICATION_ENABLED_KEY, "false");
      return;
    }

    setIsSubscribed(true);
    window.localStorage.setItem(FRONTDESK_NOTIFICATION_ENABLED_KEY, "true");
  }, [params.user, vapidKey]);

  async function enable() {
    if (!params.enabled) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      if (!("Notification" in window)) {
        setPermission("unsupported");
        setIsSupported(false);
        throw new Error("push-not-supported");
      }

      const result = await Notification.requestPermission();
      setPermission(result);

      if (result !== "granted") {
        throw new Error(result === "denied" ? "notification-permission-denied" : "notification-permission-pending");
      }

      await syncSubscription("subscribe");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "failed-to-enable-push");
    } finally {
      setIsLoading(false);
    }
  }

  async function disable() {
    if (!params.user) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await syncSubscription("unsubscribe");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "failed-to-disable-push");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    let isActive = true;

    async function initialize() {
      if (!params.enabled || typeof window === "undefined" || !("Notification" in window)) {
        if (isActive) {
          setIsSupported(false);
          setPermission(typeof window === "undefined" || !("Notification" in window) ? "unsupported" : Notification.permission);
        }
        return;
      }

      const messagingModule = await loadMessagingModule();
      if (!isActive || !messagingModule) {
        if (isActive) {
          setIsSupported(false);
          setPermission("unsupported");
        }
        return;
      }

      setIsSupported(true);
      setPermission(Notification.permission);

      const notificationsEnabled = window.localStorage.getItem(FRONTDESK_NOTIFICATION_ENABLED_KEY) !== "false";
      if (!params.user || Notification.permission !== "granted" || !notificationsEnabled || !vapidKey) {
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        await syncSubscription("subscribe");
      } catch (nextError) {
        if (isActive) {
          setError(nextError instanceof Error ? nextError.message : "failed-to-restore-push");
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void initialize();

    return () => {
      isActive = false;
    };
  }, [params.enabled, params.user, syncSubscription, vapidKey]);

  return {
    enable,
    disable,
    error,
    isLoading,
    isSubscribed,
    isSupported,
    permission,
  };
}

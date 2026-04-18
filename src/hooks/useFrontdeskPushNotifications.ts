"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { getFirebaseApp } from "@/lib/firebase";
import { FRONTDESK_NOTIFICATION_ENABLED_KEY } from "@/lib/frontdesk/preferences";

type PushStatus = {
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  debugMessage: string | null;
  error: string | null;
  isLoading: boolean;
  isSubscribed: boolean;
  isSupported: boolean;
  permission: NotificationPermission | "unsupported";
};

type MessagingModule = typeof import("firebase/messaging");

function resolveErrorText(error: unknown, stage: string) {
  if (!(error instanceof Error)) {
    return `${stage}: unknown-error`;
  }

  const firebaseLike = error as Error & { code?: string };
  const code = typeof firebaseLike.code === "string" ? firebaseLike.code : "";
  const detail = code ? `${code} / ${error.message}` : error.message;

  return `${stage}: ${detail}`;
}

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
  const [debugMessage, setDebugMessage] = useState<string | null>(null);
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

    setDebugMessage(mode === "subscribe" ? "登録開始: messaging 初期化" : "解除開始: messaging 初期化");

    const messagingModule = await loadMessagingModule();
    if (!messagingModule) {
      setPermission("unsupported");
      setIsSupported(false);
      throw new Error("push-not-supported");
    }

    setDebugMessage(mode === "subscribe" ? "登録中: service worker 登録" : "解除中: service worker 登録");
    const registration = await registerServiceWorker();
    const messaging = messagingModule.getMessaging(getFirebaseApp());
    setDebugMessage(mode === "subscribe" ? "登録中: FCM token 取得" : "解除中: FCM token 取得");
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
    setDebugMessage(mode === "subscribe" ? "登録中: subscription API 呼び出し" : "解除中: subscription API 呼び出し");

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
      setDebugMessage("通知登録を解除しました");
      window.localStorage.setItem(FRONTDESK_NOTIFICATION_ENABLED_KEY, "false");
      return;
    }

    setIsSubscribed(true);
    setDebugMessage(`通知登録に成功しました token:${token.slice(0, 10)}...`);
    window.localStorage.setItem(FRONTDESK_NOTIFICATION_ENABLED_KEY, "true");
  }, [params.user, vapidKey]);

  async function enable() {
    if (!params.enabled) {
      return;
    }

    setIsLoading(true);
    setError(null);
    setDebugMessage(null);

    try {
      if (!("Notification" in window)) {
        setPermission("unsupported");
        setIsSupported(false);
        throw new Error("push-not-supported");
      }

      setDebugMessage("開始: ブラウザ通知権限の要求");
      const result = await Notification.requestPermission();
      setPermission(result);

      if (result !== "granted") {
        throw new Error(result === "denied" ? "notification-permission-denied" : "notification-permission-pending");
      }

      await syncSubscription("subscribe");
    } catch (nextError) {
      setError(resolveErrorText(nextError, "通知有効化失敗"));
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
    setDebugMessage(null);

    try {
      await syncSubscription("unsubscribe");
    } catch (nextError) {
      setError(resolveErrorText(nextError, "通知解除失敗"));
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
      setDebugMessage("復元中: 既存の通知購読を確認");

      try {
        await syncSubscription("subscribe");
        if (isActive) {
          setDebugMessage((current) => current ?? "保存済みの通知購読を復元しました");
        }
      } catch (nextError) {
        if (isActive) {
          setError(resolveErrorText(nextError, "通知購読復元失敗"));
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

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    async function registerForegroundListener() {
      if (!params.enabled || typeof window === "undefined" || permission !== "granted") {
        return;
      }

      const messagingModule = await loadMessagingModule();
      if (!messagingModule) {
        return;
      }

      const messaging = messagingModule.getMessaging(getFirebaseApp());
      unsubscribe = messagingModule.onMessage(messaging, (payload) => {
        const data = payload.data ?? {};
        const title = data.title?.trim() || payload.notification?.title?.trim() || "新しいフロント対応チャット";
        const body = data.body?.trim() || payload.notification?.body?.trim() || "新しいメッセージがあります";
        setDebugMessage(`受信成功: foreground message ${title}`);

        if ("Notification" in window && Notification.permission === "granted") {
          new Notification(title, { body });
        }
      });
    }

    void registerForegroundListener();

    return () => {
      unsubscribe?.();
    };
  }, [params.enabled, permission]);

  return {
    debugMessage,
    enable,
    disable,
    error,
    isLoading,
    isSubscribed,
    isSupported,
    permission,
  };
}

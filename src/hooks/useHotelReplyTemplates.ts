"use client";

import { useEffect, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebase";
import { DEFAULT_REPLY_TEMPLATES, type FrontdeskReplyTemplate } from "@/lib/frontdesk/reply-templates";

type ReplyTemplatesResponse = {
  error?: string;
  hotelId?: string;
  replyTemplates?: FrontdeskReplyTemplate[];
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

export function useHotelReplyTemplates(enabled: boolean) {
  const [templates, setTemplates] = useState<FrontdeskReplyTemplate[]>(DEFAULT_REPLY_TEMPLATES);
  const [hotelId, setHotelId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    async function loadReplyTemplates() {
      if (!enabled) {
        if (isActive) {
          setTemplates(DEFAULT_REPLY_TEMPLATES);
          setHotelId("");
          setError(null);
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const response = await authorizedFetch("/api/frontdesk/reply-templates");
        const payload = (await response.json()) as ReplyTemplatesResponse;

        if (!response.ok) {
          throw new Error(payload.error ?? "failed-to-load-reply-templates");
        }

        if (!isActive) {
          return;
        }

        setTemplates(payload.replyTemplates ?? DEFAULT_REPLY_TEMPLATES);
        setHotelId(payload.hotelId ?? "");
        setError(null);
      } catch (loadError) {
        if (!isActive) {
          return;
        }

        setTemplates(DEFAULT_REPLY_TEMPLATES);
        setHotelId("");
        setError(loadError instanceof Error ? loadError.message : "failed-to-load-reply-templates");
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void loadReplyTemplates();

    return () => {
      isActive = false;
    };
  }, [enabled]);

  async function save(nextTemplates: FrontdeskReplyTemplate[]) {
    const response = await authorizedFetch("/api/frontdesk/reply-templates", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        replyTemplates: nextTemplates,
      }),
    });
    const payload = (await response.json()) as ReplyTemplatesResponse;

    if (!response.ok) {
      throw new Error(payload.error ?? "failed-to-save-reply-templates");
    }

    setTemplates(payload.replyTemplates ?? nextTemplates);
    setHotelId(payload.hotelId ?? "");
    setError(null);
    return payload.replyTemplates ?? nextTemplates;
  }

  return {
    templates,
    setTemplates,
    hotelId,
    isLoading,
    error,
    save,
  };
}

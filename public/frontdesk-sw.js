self.addEventListener("push", (event) => {
  if (!event.data) {
    return;
  }

  let payload = {};

  try {
    payload = event.data.json();
  } catch {
    payload = { body: event.data.text() };
  }

  const data = payload && typeof payload === "object" && "data" in payload ? payload.data : payload;
  const title = typeof data?.title === "string" && data.title ? data.title : "新しいフロント対応チャット";
  const body = typeof data?.body === "string" && data.body ? data.body : "新しいメッセージがあります";
  const threadId = typeof data?.threadId === "string" ? data.threadId : "";
  const url = typeof data?.url === "string" && data.url ? data.url : threadId ? `/?threadId=${encodeURIComponent(threadId)}` : "/";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data: { url },
      tag: threadId ? `thread-${threadId}` : "frontdesk-chat",
      renotify: true,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl =
    event.notification && event.notification.data && typeof event.notification.data.url === "string"
      ? event.notification.data.url
      : "/";

  event.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true, type: "window" }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          if (client.url.includes(targetUrl)) {
            return client.focus();
          }
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }

      return undefined;
    }),
  );
});

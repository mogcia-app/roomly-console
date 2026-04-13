export type FrontdeskReplyTemplate = {
  id: string;
  label: string;
  body: string;
};

export const DEFAULT_REPLY_TEMPLATES: FrontdeskReplyTemplate[] = [
  { id: "toothbrush", label: "歯ブラシ", body: "歯ブラシをお持ちします。少々お待ちください。" },
  { id: "towels", label: "タオル", body: "タオルをお持ちします。少々お待ちください。" },
  { id: "front-desk", label: "受付案内", body: "フロントにて承ります。ご都合のよいタイミングでお立ち寄りください。" },
];

function buildTemplateId(label: string, index: number) {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-_]/g, "");

  return slug || `template-${index + 1}`;
}

export function normalizeReplyTemplatesInput(value: unknown): FrontdeskReplyTemplate[] {
  if (!Array.isArray(value)) {
    return DEFAULT_REPLY_TEMPLATES;
  }

  const normalized = value
    .map((item, index) => {
      if (typeof item !== "object" || item === null) {
        return null;
      }

      const id = typeof item.id === "string" ? item.id.trim() : "";
      const label = typeof item.label === "string" ? item.label.trim() : "";
      const body = typeof item.body === "string" ? item.body.trim() : "";

      if (!label || !body) {
        return null;
      }

      return {
        id: id || buildTemplateId(label, index),
        label,
        body,
      };
    })
    .filter((item): item is FrontdeskReplyTemplate => item !== null);

  return normalized.length > 0 ? normalized : DEFAULT_REPLY_TEMPLATES;
}

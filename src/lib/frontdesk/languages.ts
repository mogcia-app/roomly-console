export const SUPPORTED_GUEST_LANGUAGE_OPTIONS = [
  { value: "ja", label: "日本語" },
  { value: "en", label: "英語" },
  { value: "zh-CN", label: "中国語(簡体)" },
  { value: "zh-TW", label: "中国語(繁体)" },
  { value: "ko", label: "韓国語" },
] as const;

export type SupportedGuestLanguage = (typeof SUPPORTED_GUEST_LANGUAGE_OPTIONS)[number]["value"];

const SUPPORTED_GUEST_LANGUAGE_SET = new Set<string>(
  SUPPORTED_GUEST_LANGUAGE_OPTIONS.map((option) => option.value.toLowerCase()),
);

const LANGUAGE_ALIASES: Record<string, SupportedGuestLanguage> = {
  ja: "ja",
  "ja-jp": "ja",
  japanese: "ja",
  en: "en",
  "en-us": "en",
  "en-gb": "en",
  english: "en",
  zh: "zh-CN",
  "zh-cn": "zh-CN",
  "zh-hans": "zh-CN",
  chinese: "zh-CN",
  "chinese-simplified": "zh-CN",
  "zh-tw": "zh-TW",
  "zh-hk": "zh-TW",
  "zh-mo": "zh-TW",
  "zh-hant": "zh-TW",
  "chinese-traditional": "zh-TW",
  ko: "ko",
  "ko-kr": "ko",
  korean: "ko",
};

export function normalizeGuestLanguage(value: string | null | undefined): SupportedGuestLanguage {
  const normalized = (value ?? "").trim().toLowerCase().replace(/_/g, "-");

  if (LANGUAGE_ALIASES[normalized]) {
    return LANGUAGE_ALIASES[normalized];
  }

  if (SUPPORTED_GUEST_LANGUAGE_SET.has(normalized)) {
    return normalized as SupportedGuestLanguage;
  }

  return "ja";
}

export function formatGuestLanguageLabel(value: string | null | undefined) {
  const normalized = normalizeGuestLanguage(value);
  return (
    SUPPORTED_GUEST_LANGUAGE_OPTIONS.find((option) => option.value === normalized)?.label ??
    "日本語"
  );
}

export function isTranslationRequired(value: string | null | undefined) {
  return normalizeGuestLanguage(value) !== "ja";
}

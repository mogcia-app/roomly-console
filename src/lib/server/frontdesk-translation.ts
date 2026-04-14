import { normalizeGuestLanguage } from "@/lib/frontdesk/languages";
import type { TranslationState } from "@/lib/frontdesk/types";

const DEFAULT_TRANSLATION_MODEL = process.env.OPENAI_TRANSLATION_MODEL || "gpt-4.1-mini";
const DEFAULT_HOTEL_OPERATION_LANGUAGE = process.env.DEFAULT_HOTEL_OPERATION_LANGUAGE || "ja";

type TranslateTextParams = {
  sourceLanguage: string;
  targetLanguage: string;
  text: string;
};

type TranslateTextResult = {
  text: string;
  state: TranslationState;
  sourceLanguage: string;
  targetLanguage: string;
};

function toShortLanguageCode(value: string | null | undefined) {
  const normalized = (value ?? "").trim().toLowerCase().replace(/_/g, "-");

  if (!normalized) {
    return "";
  }

  const aliases: Record<string, string> = {
    japanese: "ja",
    "ja-jp": "ja",
    english: "en",
    "en-us": "en",
    "en-gb": "en",
    chinese: "zh-CN",
    "zh-cn": "zh-CN",
    "zh-tw": "zh-TW",
    korean: "ko",
    "ko-kr": "ko",
  };

  if (aliases[normalized]) {
    return aliases[normalized];
  }

  if (normalized.startsWith("zh")) {
    return normalizeGuestLanguage(normalized);
  }

  const [shortCode] = normalized.split("-");
  return shortCode;
}

function parseStructuredOutput(payload: unknown) {
  if (typeof payload === "object" && payload !== null && "output_text" in payload) {
    const outputText = (payload as { output_text?: unknown }).output_text;
    if (typeof outputText === "string" && outputText.trim()) {
      return outputText;
    }
  }

  if (typeof payload === "object" && payload !== null && "output" in payload) {
    const output = (payload as { output?: unknown }).output;

    if (Array.isArray(output)) {
      for (const item of output) {
        if (!item || typeof item !== "object" || !("content" in item)) {
          continue;
        }

        const content = (item as { content?: unknown }).content;
        if (!Array.isArray(content)) {
          continue;
        }

        for (const part of content) {
          if (!part || typeof part !== "object") {
            continue;
          }

          const text = (part as { text?: unknown }).text;
          if (typeof text === "string" && text.trim()) {
            return text;
          }
        }
      }
    }
  }

  return "";
}

function extractTranslatedText(outputText: string) {
  const normalized = outputText.trim();

  if (!normalized) {
    return "";
  }

  try {
    const parsed = JSON.parse(normalized) as { translated_text?: unknown };

    if (typeof parsed.translated_text === "string" && parsed.translated_text.trim()) {
      return parsed.translated_text.trim();
    }
  } catch {
    // In case providers return plain text despite requested schema, keep the text.
    return normalized;
  }

  return "";
}

export function resolveHotelOperationLanguage() {
  return toShortLanguageCode(DEFAULT_HOTEL_OPERATION_LANGUAGE) || "ja";
}

export async function translateText(params: TranslateTextParams): Promise<TranslateTextResult> {
  const sourceLanguage = toShortLanguageCode(params.sourceLanguage) || resolveHotelOperationLanguage();
  const targetLanguage = toShortLanguageCode(params.targetLanguage) || resolveHotelOperationLanguage();
  const text = params.text.trim();

  if (!text) {
    throw new Error("empty-message");
  }

  if (sourceLanguage === targetLanguage) {
    return {
      text,
      state: "not_required",
      sourceLanguage,
      targetLanguage,
    };
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return {
      text,
      state: "fallback",
      sourceLanguage,
      targetLanguage,
    };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DEFAULT_TRANSLATION_MODEL,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text:
                  "You are a hotel chat translation engine. Translate faithfully without summarizing. Preserve amounts, times, phone numbers, room numbers, steps, warnings, and proper nouns. If the input is already in the target language, return it unchanged.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify({
                  source_language: sourceLanguage,
                  target_language: targetLanguage,
                  text,
                }),
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "translation_payload",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                translated_text: {
                  type: "string",
                },
              },
              required: ["translated_text"],
            },
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`translation-request-failed:${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    const outputText = parseStructuredOutput(payload);
    const translatedText = extractTranslatedText(outputText);

    if (!translatedText) {
      return {
        text,
        state: "fallback",
        sourceLanguage,
        targetLanguage,
      };
    }

    return {
      text: translatedText,
      state: "ready",
      sourceLanguage,
      targetLanguage,
    };
  } catch {
    return {
      text,
      state: "fallback",
      sourceLanguage,
      targetLanguage,
    };
  }
}

export function buildTranslationPayload(params: {
  body: string;
  guestLanguage: string;
  hotelLanguage: string;
  translatedGuestBody: string;
  translationState: TranslationState;
}) {
  const originalBody = params.body.trim();

  return {
    body: originalBody,
    original_body: originalBody,
    original_language: params.hotelLanguage,
    translated_body_front: originalBody,
    translated_language_front: params.hotelLanguage,
    translated_body_guest: params.translatedGuestBody,
    translated_language_guest: params.guestLanguage,
    translation_state: params.translationState,
  };
}

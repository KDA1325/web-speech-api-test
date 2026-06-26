import type { VoiceCommandRequest, VoiceCommandResponse } from "./domain";
import { ALLOWED_COMMANDS } from "./domain";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DIRECT_REQUEST_TIMEOUT_MS = 10000;
const BROWSER_DIRECT_API_KEY_STORAGE_KEY = "orbit.browserDirectOpenAiApiKey";

export function isBrowserDirectExperimentAllowed() {
  return (
    import.meta.env.VITE_ALLOW_BROWSER_LLM_DIRECT === "true" ||
    Boolean(getBrowserDirectApiKey())
  );
}

export function isBrowserDirectApiKeyAssigned() {
  return Boolean(getBrowserDirectApiKey());
}

export function getBrowserDirectModel() {
  return import.meta.env.VITE_OPENAI_MODEL || "gpt-4.1-mini";
}

export function getBrowserDirectApiKey() {
  return (
    import.meta.env.VITE_OPENAI_API_KEY?.trim() ||
    getStoredBrowserDirectApiKey()
  );
}

export function setStoredBrowserDirectApiKey(apiKey: string) {
  if (!hasLocalStorage()) {
    return;
  }

  const trimmedApiKey = apiKey.trim();

  if (trimmedApiKey) {
    globalThis.localStorage.setItem(
      BROWSER_DIRECT_API_KEY_STORAGE_KEY,
      trimmedApiKey
    );
    return;
  }

  globalThis.localStorage.removeItem(BROWSER_DIRECT_API_KEY_STORAGE_KEY);
}

export async function requestBrowserDirectVoiceCommandDecision(
  request: VoiceCommandRequest
): Promise<VoiceCommandResponse> {
  if (!isBrowserDirectExperimentAllowed()) {
    throw new Error(
      "브라우저 direct LLM 실험 모드가 꺼져 있습니다. VITE_ALLOW_BROWSER_LLM_DIRECT=true가 필요합니다."
    );
  }

  const apiKey = getBrowserDirectApiKey();

  if (!apiKey) {
    throw new Error("VITE_OPENAI_API_KEY가 설정되지 않았습니다.");
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    DIRECT_REQUEST_TIMEOUT_MS
  );

  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: getBrowserDirectModel(),
        input: [
          {
            role: "system",
            content:
              "You convert Korean voice commands into one allowed UI movement action. Return only JSON matching the requested schema. Do not invent unsupported commands."
          },
          {
            role: "user",
            content: JSON.stringify({
              transcript: request.transcript,
              language: request.language,
              currentPosition: request.currentPosition,
              allowedCommands: request.allowedCommands,
              defaultDistancePx: request.defaultDistancePx
            })
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "voice_command_response",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                matched: { type: "boolean" },
                action: {
                  type: "string",
                  enum: [...ALLOWED_COMMANDS, "noop"]
                },
                distancePx: { type: "number", minimum: 0 },
                nextPosition: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    x: { type: "number" },
                    y: { type: "number" }
                  },
                  required: ["x", "y"]
                },
                reason: { type: "string" },
                model: { type: "string" },
                confidence: {
                  anyOf: [{ type: "number" }, { type: "null" }]
                }
              },
              required: [
                "matched",
                "action",
                "distancePx",
                "nextPosition",
                "reason",
                "model",
                "confidence"
              ]
            }
          }
        }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`OpenAI direct API가 ${response.status} 상태를 반환했습니다.`);
    }

    const payload = (await response.json()) as unknown;
    const outputText = extractResponseOutputText(payload);

    if (!outputText) {
      throw new Error("OpenAI direct API 응답에서 JSON 텍스트를 찾을 수 없습니다.");
    }

    const parsed = JSON.parse(outputText) as VoiceCommandResponse;

    return {
      ...parsed,
      model: `browser-direct:${parsed.model || getBrowserDirectModel()}`
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("OpenAI direct API 요청이 timeout 됐습니다.");
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function extractResponseOutputText(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }

  if (!Array.isArray(payload.output)) {
    return null;
  }

  for (const outputItem of payload.output) {
    if (!isRecord(outputItem) || !Array.isArray(outputItem.content)) {
      continue;
    }

    for (const contentItem of outputItem.content) {
      if (!isRecord(contentItem)) {
        continue;
      }

      if (typeof contentItem.text === "string") {
        return contentItem.text;
      }
    }
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getStoredBrowserDirectApiKey() {
  if (!hasLocalStorage()) {
    return "";
  }

  return (
    globalThis.localStorage.getItem(BROWSER_DIRECT_API_KEY_STORAGE_KEY)?.trim() ||
    ""
  );
}

function hasLocalStorage() {
  try {
    return typeof globalThis.localStorage !== "undefined";
  } catch {
    return false;
  }
}

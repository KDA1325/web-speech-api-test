import type {
  AllowedCommand,
  CommandServerStatusResponse,
  CommandRuntimeStatus,
  TargetPosition,
  VoiceCommandRequest,
  VoiceCommandResponse
} from "./domain";
import { ALLOWED_COMMANDS, DEFAULT_DISTANCE_PX, SPEECH_LANGUAGE } from "./domain";
import {
  getBrowserDirectModel,
  isBrowserDirectApiKeyAssigned,
  isBrowserDirectExperimentAllowed,
  requestBrowserDirectVoiceCommandDecision
} from "./browserOpenAiCommand";

const REQUEST_TIMEOUT_MS = 8000;
const COMMAND_INTERPRET_PATH = "/voice-command/interpret";
const COMMAND_STATUS_PATH = "/voice-command/status";

export class CommandApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandApiError";
  }
}

export function buildVoiceCommandRequest(
  transcript: string,
  currentPosition: TargetPosition
): VoiceCommandRequest {
  return {
    transcript,
    language: SPEECH_LANGUAGE,
    currentPosition,
    allowedCommands: ALLOWED_COMMANDS,
    defaultDistancePx: DEFAULT_DISTANCE_PX
  };
}

export async function requestVoiceCommandDecision(
  request: VoiceCommandRequest
): Promise<VoiceCommandResponse> {
  if (isBrowserDirectExperimentAllowed()) {
    const response = await requestBrowserDirectVoiceCommandDecision(request);
    return validateVoiceCommandResponse(response);
  }

  const endpointUrl = buildCommandApiUrl(COMMAND_INTERPRET_PATH);

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(request),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new CommandApiError(
        `서버 명령 판단 API가 ${response.status} 상태를 반환했습니다.`
      );
    }

    const payload = (await response.json()) as unknown;
    return validateVoiceCommandResponse(payload);
  } catch (error) {
    if (error instanceof CommandApiError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      throw new CommandApiError("서버 명령 판단 API 요청이 timeout 됐습니다.");
    }

    throw new CommandApiError(
      error instanceof Error
        ? error.message
        : "서버 명령 판단 API 요청 중 알 수 없는 오류가 발생했습니다."
    );
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function requestCommandServerStatus(): Promise<CommandServerStatusResponse> {
  const endpointUrl = buildCommandApiUrl(COMMAND_STATUS_PATH);

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(endpointUrl, {
      method: "GET",
      headers: {
        Accept: "application/json"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new CommandApiError(
        `서버 상태 API가 ${response.status} 상태를 반환했습니다.`
      );
    }

    const payload = (await response.json()) as unknown;
    return validateCommandServerStatusResponse(payload);
  } catch (error) {
    if (error instanceof CommandApiError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      throw new CommandApiError("서버 상태 API 요청이 timeout 됐습니다.");
    }

    throw new CommandApiError(
      error instanceof Error
        ? error.message
        : "서버 상태 API 요청 중 알 수 없는 오류가 발생했습니다."
    );
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function getCommandApiConfiguredState(): "configured" | "not configured" {
  return import.meta.env.VITE_COMMAND_API_URL ? "configured" : "not configured";
}

export function getCommandRuntimeStatus(): CommandRuntimeStatus {
  const browserDirectAllowed = isBrowserDirectExperimentAllowed();

  return {
    mode: browserDirectAllowed ? "browser-direct-experiment" : "server-proxy",
    commandApiConfigured: Boolean(import.meta.env.VITE_COMMAND_API_URL),
    browserDirectAllowed,
    browserDirectApiKeyAssigned: isBrowserDirectApiKeyAssigned(),
    model: browserDirectAllowed ? getBrowserDirectModel() : "server-openai"
  };
}

export function buildCommandApiUrl(path: string): string {
  const baseUrl = import.meta.env.VITE_COMMAND_API_URL?.trim();

  if (!baseUrl) {
    throw new CommandApiError("VITE_COMMAND_API_URL이 설정되지 않았습니다.");
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new CommandApiError(
      "VITE_COMMAND_API_URL은 http:// 또는 https://로 시작하는 서버 base URL이어야 합니다. API key를 넣으면 안 됩니다."
    );
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new CommandApiError(
      "VITE_COMMAND_API_URL은 http:// 또는 https:// 서버 base URL이어야 합니다."
    );
  }

  if (parsedUrl.hostname === "api.openai.com" || parsedUrl.hostname.endsWith(".openai.com")) {
    throw new CommandApiError(
      "브라우저에서 OpenAI API를 직접 호출할 수 없습니다. VITE_COMMAND_API_URL에는 서버 API base URL을 넣어야 합니다."
    );
  }

  const normalizedBasePath = parsedUrl.pathname.replace(/\/$/, "");

  if (
    normalizedBasePath.endsWith(COMMAND_INTERPRET_PATH) ||
    normalizedBasePath.endsWith(COMMAND_STATUS_PATH)
  ) {
    throw new CommandApiError(
      "VITE_COMMAND_API_URL에는 endpoint 전체가 아니라 서버 base URL만 넣어야 합니다."
    );
  }

  parsedUrl.pathname = `${normalizedBasePath}${path}`;
  parsedUrl.search = "";
  parsedUrl.hash = "";

  return parsedUrl.toString();
}

export function applyServerCommand(
  response: VoiceCommandResponse
): TargetPosition | null {
  if (response.matched && response.action !== "noop") {
    return response.nextPosition;
  }

  return null;
}

export function validateVoiceCommandResponse(
  payload: unknown
): VoiceCommandResponse {
  if (!isRecord(payload)) {
    throw new CommandApiError("서버 응답이 객체가 아닙니다.");
  }

  const { matched, action, distancePx, nextPosition, reason, model, confidence } =
    payload;

  if (typeof matched !== "boolean") {
    throw new CommandApiError("서버 응답의 matched가 boolean이 아닙니다.");
  }

  if (!isServerAction(action)) {
    throw new CommandApiError("서버 응답의 action이 허용된 값이 아닙니다.");
  }

  if (typeof distancePx !== "number" || distancePx < 0) {
    throw new CommandApiError("서버 응답의 distancePx가 유효하지 않습니다.");
  }

  if (!isTargetPosition(nextPosition)) {
    throw new CommandApiError("서버 응답의 nextPosition이 유효하지 않습니다.");
  }

  if (typeof reason !== "string") {
    throw new CommandApiError("서버 응답의 reason이 string이 아닙니다.");
  }

  if (typeof model !== "string") {
    throw new CommandApiError("서버 응답의 model이 string이 아닙니다.");
  }

  if (confidence !== null && typeof confidence !== "number") {
    throw new CommandApiError("서버 응답의 confidence가 number 또는 null이 아닙니다.");
  }

  return {
    matched,
    action,
    distancePx,
    nextPosition,
    reason,
    model,
    confidence
  };
}

export function validateCommandServerStatusResponse(
  payload: unknown
): CommandServerStatusResponse {
  if (!isRecord(payload)) {
    throw new CommandApiError("서버 상태 응답이 객체가 아닙니다.");
  }

  const { ok, llmApiKeyConfigured, model } = payload;

  if (typeof ok !== "boolean") {
    throw new CommandApiError("서버 상태 응답의 ok가 boolean이 아닙니다.");
  }

  if (typeof llmApiKeyConfigured !== "boolean") {
    throw new CommandApiError(
      "서버 상태 응답의 llmApiKeyConfigured가 boolean이 아닙니다."
    );
  }

  if (model !== null && typeof model !== "string") {
    throw new CommandApiError("서버 상태 응답의 model이 string 또는 null이 아닙니다.");
  }

  return {
    ok,
    llmApiKeyConfigured,
    model
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTargetPosition(value: unknown): value is TargetPosition {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    typeof value.y === "number"
  );
}

function isServerAction(value: unknown): value is VoiceCommandResponse["action"] {
  return value === "noop" || ALLOWED_COMMANDS.includes(value as AllowedCommand);
}

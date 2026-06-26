import type {
  AllowedCommand,
  TargetPosition,
  VoiceCommandRequest,
  VoiceCommandResponse
} from "./domain";
import { ALLOWED_COMMANDS, DEFAULT_DISTANCE_PX, SPEECH_LANGUAGE } from "./domain";

const REQUEST_TIMEOUT_MS = 8000;

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
  const baseUrl = import.meta.env.VITE_COMMAND_API_URL;

  if (!baseUrl) {
    throw new CommandApiError("VITE_COMMAND_API_URL이 설정되지 않았습니다.");
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/voice-command/interpret`, {
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

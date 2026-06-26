import { describe, expect, it } from "vitest";
import {
  applyServerCommand,
  buildVoiceCommandRequest,
  validateVoiceCommandResponse
} from "./commandApi";

describe("buildVoiceCommandRequest", () => {
  it("builds the server OpenAI command request contract", () => {
    expect(buildVoiceCommandRequest("오른쪽으로 100 이동", { x: 0, y: 0 })).toEqual({
      transcript: "오른쪽으로 100 이동",
      language: "ko-KR",
      currentPosition: { x: 0, y: 0 },
      allowedCommands: [
        "move-left",
        "move-right",
        "move-up",
        "move-down",
        "center",
        "reset"
      ],
      defaultDistancePx: 50
    });
  });
});

describe("validateVoiceCommandResponse", () => {
  it("accepts a matched server command response", () => {
    const response = validateVoiceCommandResponse({
      matched: true,
      action: "move-right",
      distancePx: 100,
      nextPosition: { x: 100, y: 0 },
      reason: "사용자가 오른쪽으로 100px 이동을 요청함",
      model: "server-openai",
      confidence: 0.91
    });

    expect(response.action).toBe("move-right");
    expect(response.nextPosition).toEqual({ x: 100, y: 0 });
  });

  it("accepts a no-op server command response", () => {
    const response = validateVoiceCommandResponse({
      matched: false,
      action: "noop",
      distancePx: 0,
      nextPosition: { x: 0, y: 0 },
      reason: "허용된 이동 명령으로 판단되지 않음",
      model: "server-openai",
      confidence: null
    });

    expect(response.matched).toBe(false);
    expect(response.action).toBe("noop");
  });

  it("rejects malformed server responses", () => {
    expect(() =>
      validateVoiceCommandResponse({
        matched: true,
        action: "move-diagonal",
        distancePx: 50,
        nextPosition: { x: 50, y: 50 },
        reason: "invalid",
        model: "server-openai",
        confidence: 0.5
      })
    ).toThrow("action");
  });
});

describe("applyServerCommand", () => {
  it("returns nextPosition only when the server matched a movement command", () => {
    expect(
      applyServerCommand({
        matched: true,
        action: "move-left",
        distancePx: 50,
        nextPosition: { x: -50, y: 0 },
        reason: "왼쪽 이동",
        model: "server-openai",
        confidence: 0.9
      })
    ).toEqual({ x: -50, y: 0 });
  });

  it("does not move for server no-op responses", () => {
    expect(
      applyServerCommand({
        matched: false,
        action: "noop",
        distancePx: 0,
        nextPosition: { x: 20, y: 20 },
        reason: "명령 아님",
        model: "server-openai",
        confidence: 0.2
      })
    ).toBeNull();
  });
});

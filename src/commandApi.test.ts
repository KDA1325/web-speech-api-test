import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyServerCommand,
  buildCommandApiUrl,
  buildVoiceCommandRequest,
  getCommandRuntimeStatus,
  validateCommandServerStatusResponse,
  validateVoiceCommandResponse
} from "./commandApi";
import { extractResponseOutputText } from "./browserOpenAiCommand";

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

describe("validateCommandServerStatusResponse", () => {
  it("accepts boolean-only server LLM key status", () => {
    expect(
      validateCommandServerStatusResponse({
        ok: true,
        llmApiKeyConfigured: true,
        model: "server-openai"
      })
    ).toEqual({
      ok: true,
      llmApiKeyConfigured: true,
      model: "server-openai"
    });
  });

  it("rejects responses that expose a raw API key instead of boolean status", () => {
    expect(() =>
      validateCommandServerStatusResponse({
        ok: true,
        llmApiKeyConfigured: "not-a-boolean",
        model: "server-openai"
      })
    ).toThrow("llmApiKeyConfigured");
  });
});

describe("buildCommandApiUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds backend endpoint URLs from a server base URL", () => {
    vi.stubEnv("VITE_COMMAND_API_URL", "https://command.example.com/api");

    expect(buildCommandApiUrl("/voice-command/interpret")).toBe(
      "https://command.example.com/api/voice-command/interpret"
    );
  });

  it("rejects API-key-shaped values instead of treating them as relative paths", () => {
    vi.stubEnv("VITE_COMMAND_API_URL", "not-a-server-url");

    expect(() => buildCommandApiUrl("/voice-command/interpret")).toThrow(
      "서버 base URL"
    );
  });

  it("rejects direct OpenAI API URLs in the browser", () => {
    vi.stubEnv("VITE_COMMAND_API_URL", "https://api.openai.com/v1");

    expect(() => buildCommandApiUrl("/voice-command/interpret")).toThrow(
      "OpenAI API를 직접 호출"
    );
  });

  it("rejects endpoint URLs because the client appends the route", () => {
    vi.stubEnv(
      "VITE_COMMAND_API_URL",
      "https://command.example.com/voice-command/interpret"
    );

    expect(() => buildCommandApiUrl("/voice-command/interpret")).toThrow(
      "서버 base URL만"
    );
  });
});

describe("getCommandRuntimeStatus", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to server proxy mode", () => {
    vi.stubEnv("VITE_COMMAND_API_URL", "https://command.example.com");

    expect(getCommandRuntimeStatus()).toMatchObject({
      mode: "server-proxy",
      commandApiConfigured: true,
      browserDirectAllowed: false,
      browserDirectApiKeyAssigned: false
    });
  });

  it("enables browser direct experiment mode only with the explicit flag", () => {
    vi.stubEnv("VITE_COMMAND_API_URL", "");
    vi.stubEnv("VITE_ALLOW_BROWSER_LLM_DIRECT", "true");
    vi.stubEnv("VITE_OPENAI_API_KEY", "test-key");
    vi.stubEnv("VITE_OPENAI_MODEL", "gpt-test");

    expect(getCommandRuntimeStatus()).toEqual({
      mode: "browser-direct-experiment",
      commandApiConfigured: false,
      browserDirectAllowed: true,
      browserDirectApiKeyAssigned: true,
      model: "gpt-test"
    });
  });
});

describe("extractResponseOutputText", () => {
  it("extracts output_text from OpenAI Responses API payloads", () => {
    expect(
      extractResponseOutputText({
        output_text: "{\"matched\":false}"
      })
    ).toBe("{\"matched\":false}");
  });

  it("extracts nested output content text", () => {
    expect(
      extractResponseOutputText({
        output: [
          {
            content: [
              {
                text: "{\"matched\":true}"
              }
            ]
          }
        ]
      })
    ).toBe("{\"matched\":true}");
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

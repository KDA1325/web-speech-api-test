# orbit Web Speech API On-Device STT + Server Command Agent Guide

## Goal

Build a minimal Chrome-only browser spike that verifies this path:

`Chrome Web Speech API on-device STT -> recognized text rendering -> server OpenAI command decision -> moving an on-screen text element`

This repository validates whether orbit can use low-latency on-device STT during live presentations and delegate command understanding/movement decisions to a server-side OpenAI model.

## Non-Negotiable Rules

- Target Chrome only for this spike.
- STT must be attempted only with Chrome Web Speech API on-device recognition.
- Use `window.SpeechRecognition || window.webkitSpeechRecognition` for API detection.
- Require on-device recognition support:
  - `processLocally = true`
  - language pack availability check for `ko-KR`
  - installation flow when the browser reports the language pack is downloadable
- Do not silently fall back to remote/browser-default STT.
- If on-device STT support or Korean language pack support is unavailable, show a clear failure state and do not start recognition.
- Set recognition defaults to:
  - `lang = "ko-KR"`
  - `continuous = true`
  - `interimResults = true`
  - `maxAlternatives = 3`
  - `processLocally = true`
- Do not add Sherpa ONNX in this repository.
- Do not expose an OpenAI API key in the browser.
- Do not put server LLM/OpenAI API keys in frontend `.env` files, especially not with a `VITE_` prefix.
- `VITE_COMMAND_API_URL` must be an absolute backend base URL. It must not be an API key, an OpenAI API URL, or a full `/voice-command/interpret` endpoint URL.
- Exception: local-only browser direct experiment mode may be enabled with `VITE_ALLOW_BROWSER_LLM_DIRECT=true` and `VITE_OPENAI_API_KEY`, but the UI and README must clearly state that the key is visible in DevTools and must be a disposable experiment key.
- Browser direct mode must never be described as safe, hidden, or deployment-ready.
- Do not render raw env values in the UI. Show only configured/not configured status.
- Server LLM key status must be fetched from a server endpoint as a boolean only.
- Do not decide commands with local regex/rule-based parsing as the source of truth.
- All command matching, allowed-command judgment, movement distance interpretation, and next-position decisions must come from the server OpenAI command API.
- Do not implement a PPT canvas, PPTX import, image-object movement, or drag-and-drop editor here.
- Move only one rendered text element on screen.
- Display `transcript` and `confidence` values from recognition results whenever the browser provides them.
- Display server command request/response status so latency and failure are observable.
- Avoid hidden magic. STT mode, language pack status, API configured state, server LLM key assigned state, and server decisions must be visible in the UI or logs.

## Git Workflow Rules

- Before implementing a scope, create and switch to a new branch for that scope.
- Use the `codex/` branch prefix unless the user explicitly requests another prefix.
- Do not implement feature work directly on the base branch.
- When the current scope is complete, run the relevant verification commands, commit the work, and push that branch.
- Before starting the next implementation scope, create and switch to another new branch.
- Keep one branch focused on one coherent implementation scope. Do not continue unrelated next-scope work on a branch that was already completed and pushed.
- If push fails because no remote is configured or authentication is unavailable, stop and report the exact blocker instead of continuing into the next scope on the same branch.

## Recommended Stack

- Vite
- React
- TypeScript
- Plain CSS or CSS modules

Do not add state-management libraries, UI frameworks, database clients, auth, routing, or charting libraries for this spike.

## Required UI

The app must render a single-page test console with:

- Microphone start button
- Microphone stop button
- Browser support status
- On-device STT support status
- `ko-KR` language pack status
- Listening status
- Interim transcript
- Latest final transcript
- Latest STT confidence
- Server command API configured/not configured status
- Server LLM API key assigned/not assigned status
- Browser direct experiment mode warning when enabled
- Latest server command response
- Recognition log list
- Movable target text element
- Current target coordinates
- Last command execution status

The target text element must move with CSS transform:

`transform: translate(x, y)`

## Public Types

Keep these shapes stable unless the user explicitly asks to change the spike contract.

```ts
export type AllowedCommand =
  | "move-left"
  | "move-right"
  | "move-up"
  | "move-down"
  | "center"
  | "reset";

export type ServerAction = AllowedCommand | "noop";

export interface TargetPosition {
  x: number;
  y: number;
}

export interface RecognitionEntry {
  id: string;
  transcript: string;
  confidence: number | null;
  isFinal: boolean;
  createdAt: string;
}

export interface VoiceCommandRequest {
  transcript: string;
  language: "ko-KR";
  currentPosition: TargetPosition;
  allowedCommands: AllowedCommand[];
  defaultDistancePx: number;
}

export interface VoiceCommandResponse {
  matched: boolean;
  action: ServerAction;
  distancePx: number;
  nextPosition: TargetPosition;
  reason: string;
  model: string;
  confidence: number | null;
}

export interface CommandServerStatusResponse {
  ok: boolean;
  llmApiKeyConfigured: boolean;
  model: string | null;
}
```

## Server API Contract

### `POST /voice-command/interpret`

The server must call an OpenAI model and return a structured command decision. The browser must not call OpenAI directly.

Request:

```json
{
  "transcript": "오른쪽으로 100 이동",
  "language": "ko-KR",
  "currentPosition": { "x": 0, "y": 0 },
  "allowedCommands": ["move-left", "move-right", "move-up", "move-down", "center", "reset"],
  "defaultDistancePx": 50
}
```

Matched response:

```json
{
  "matched": true,
  "action": "move-right",
  "distancePx": 100,
  "nextPosition": { "x": 100, "y": 0 },
  "reason": "사용자가 오른쪽으로 100px 이동을 요청함",
  "model": "server-openai",
  "confidence": 0.91
}
```

No-op response:

```json
{
  "matched": false,
  "action": "noop",
  "distancePx": 0,
  "nextPosition": { "x": 0, "y": 0 },
  "reason": "허용된 이동 명령으로 판단되지 않음",
  "model": "server-openai",
  "confidence": 0.38
}
```

### `GET /voice-command/status`

The server must report whether the server-side LLM API key is assigned without exposing the key value.

Response:

```json
{
  "ok": true,
  "llmApiKeyConfigured": true,
  "model": "server-openai"
}
```

The browser must display only assigned/not assigned/unknown. It must never display raw key text or raw secret env values.

## Required Functions

### `createSpeechRecognition(): SpeechRecognition | null`

Purpose:

- Encapsulate browser API detection and recognition configuration.

Required behavior:

- Return `null` when neither `SpeechRecognition` nor `webkitSpeechRecognition` exists.
- Configure the recognition instance with the required defaults.
- Set `processLocally = true` when the property exists.
- Do not start recognition inside this function.

### `ensureOnDeviceRecognitionReady(): Promise<OnDeviceRecognitionStatus>`

Purpose:

- Verify that local `ko-KR` speech recognition can be used before starting STT.

Required behavior:

- Check whether the browser exposes the on-device recognition controls needed for local processing.
- Check `ko-KR` availability.
- If the language pack is downloadable, trigger the browser-supported install flow.
- Return a typed status for `available`, `downloadable`, `downloading`, `unavailable`, or `unsupported`.
- Never enable remote fallback.

### `requestVoiceCommandDecision(request: VoiceCommandRequest): Promise<VoiceCommandResponse>`

Purpose:

- Send final STT text and current UI state to the server OpenAI command API.

Required behavior:

- Use `VITE_COMMAND_API_URL` as the base URL.
- POST to `/voice-command/interpret`.
- Send the exact `VoiceCommandRequest` shape.
- Parse and validate the response shape before applying it.
- Surface network/model/API errors in the UI.
- Do not infer a command locally when the server request fails.

### `requestCommandServerStatus(): Promise<CommandServerStatusResponse>`

Purpose:

- Ask the server whether the server-side LLM API key is configured.

Required behavior:

- Use `VITE_COMMAND_API_URL` as the backend base URL.
- Reject values that are not absolute `http://` or `https://` URLs.
- Reject direct OpenAI API hosts.
- Reject full endpoint URLs because the client appends `/voice-command/status`.
- GET `/voice-command/status`.
- Accept only the `CommandServerStatusResponse` shape.
- Display only assigned/not assigned/unknown in the UI.
- Never accept, store, log, or display a raw API key.

### `applyServerCommand(response: VoiceCommandResponse): TargetPosition | null`

Purpose:

- Convert a validated server response into the next target position.

Required behavior:

- If `response.matched` is `true` and `action` is not `noop`, return `response.nextPosition`.
- If `response.matched` is `false` or `action` is `noop`, return `null`.
- Do not reinterpret the transcript locally.
- Do not recalculate distance locally.

## Event Handling Contract

When recognition returns a result:

- Read each result from `event.resultIndex` through `event.results.length`.
- For each result, use the first alternative as the primary transcript.
- Store `confidence` as `number` when available, otherwise `null`.
- Update interim transcript for non-final results.
- Append final results to the recognition log.
- Send only final results to `requestVoiceCommandDecision()`.
- Apply movement only from a validated `VoiceCommandResponse`.
- If the server returns `noop`, fails, or times out, do not move the target.

## Test Scenarios

Manual browser checks must cover:

- Chrome opens the app without console errors.
- Unsupported-browser message appears outside Chrome-compatible browsers.
- On-device STT support status is visible.
- `ko-KR` language pack status is visible.
- Recognition cannot start when on-device `ko-KR` STT is unavailable.
- User can start and stop microphone recognition when on-device `ko-KR` STT is available.
- Interim transcript updates while speaking.
- Final transcript remains visible after speech ends.
- STT confidence is shown when available.
- Final transcript is sent to the server command API.
- Server response is shown in the UI.
- `왼쪽으로 이동` moves the target only when the server returns a matched move response.
- `오른쪽으로 100 이동` moves the target by the server-provided `nextPosition`.
- `위로 이동` and `아래로 이동` move only from server responses.
- `가운데로 이동` and `초기화` return to origin only from server responses.
- Unrecognized speech does not move the target when the server returns `noop`.
- Network/API failure does not move the target.

Distance/accuracy checks should be recorded in README or the UI using:

- Distance: `30cm`, `1m`, `2m`, `3m`
- Spoken phrase
- Recognized transcript
- STT confidence
- Server command response
- End-to-end latency if measurable
- Success/failure
- Notes

## Implementation Boundaries

This spike proves interaction feasibility, not product architecture.

Allowed:

- Small React components
- Local hooks
- Local recognition log state
- On-device STT readiness checks
- Server command API client
- CSS-based movement from server response

Not allowed:

- Local command parser as source of truth
- Browser-side OpenAI API calls
- OpenAI API keys in frontend env vars
- Sherpa ONNX
- Database
- File upload
- PPT/PPTX rendering
- Canvas editor
- Konva/Fabric integration
- Authentication
- Deployment setup beyond a local dev server

## Acceptance Criteria

The spike is complete when a user can:

1. Open the app in Chrome.
2. See whether on-device `ko-KR` Web Speech API recognition is available.
3. Install or confirm the required language pack if Chrome supports it.
4. Grant microphone permission.
5. See recognized Korean speech rendered on screen from on-device STT.
6. See STT confidence values when Chrome provides them.
7. Send final STT text to the configured server OpenAI command API.
8. Speak movement commands in Korean.
9. Watch the rendered text element move only according to the validated server response.
10. Confirm from the UI or README that remote STT fallback is intentionally disabled because the spike is testing low-latency on-device STT for live presentation environments.

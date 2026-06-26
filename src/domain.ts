export type AllowedCommand =
  | "move-left"
  | "move-right"
  | "move-up"
  | "move-down"
  | "center"
  | "reset";

export type ServerAction = AllowedCommand | "noop";

export type CommandDecisionMode = "server-proxy" | "browser-direct-experiment";

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

export interface CommandRuntimeStatus {
  mode: CommandDecisionMode;
  commandApiConfigured: boolean;
  browserDirectAllowed: boolean;
  browserDirectApiKeyAssigned: boolean;
  model: string;
}

export const ALLOWED_COMMANDS: AllowedCommand[] = [
  "move-left",
  "move-right",
  "move-up",
  "move-down",
  "center",
  "reset"
];

export const DEFAULT_DISTANCE_PX = 50;
export const SPEECH_LANGUAGE = "ko-KR" as const;

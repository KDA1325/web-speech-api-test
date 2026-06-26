import { SPEECH_LANGUAGE } from "./domain";

export type LocalAvailability =
  | "available"
  | "downloadable"
  | "downloading"
  | "unavailable";

export type OnDeviceRecognitionStatus =
  | {
      status: "available";
      language: typeof SPEECH_LANGUAGE;
      message: string;
    }
  | {
      status: "downloadable" | "downloading" | "unavailable" | "unsupported";
      language: typeof SPEECH_LANGUAGE;
      message: string;
    };

export interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence?: number;
}

export interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternativeLike;
  [index: number]: SpeechRecognitionAlternativeLike;
}

export interface SpeechRecognitionResultListLike {
  readonly length: number;
  item(index: number): SpeechRecognitionResultLike;
  [index: number]: SpeechRecognitionResultLike;
}

export interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
}

export interface SpeechRecognitionErrorEventLike extends Event {
  readonly error?: string;
  readonly message?: string;
}

export interface SpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export interface SpeechRecognitionConstructor {
  new (): SpeechRecognition;
  available?: (options: {
    langs: string[];
    processLocally: boolean;
  }) => Promise<LocalAvailability>;
  install?: (options: {
    langs: string[];
    processLocally: boolean;
  }) => Promise<boolean>;
}

type WindowWithSpeechRecognition = Window &
  typeof globalThis & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };

export function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") {
    return null;
  }

  const browserWindow = window as WindowWithSpeechRecognition;
  return (
    browserWindow.SpeechRecognition ??
    browserWindow.webkitSpeechRecognition ??
    null
  );
}

export function createSpeechRecognition(): SpeechRecognition | null {
  const SpeechRecognitionClass = getSpeechRecognitionConstructor();

  if (!SpeechRecognitionClass) {
    return null;
  }

  const recognition = new SpeechRecognitionClass();
  recognition.lang = SPEECH_LANGUAGE;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 3;

  if ("processLocally" in recognition) {
    recognition.processLocally = true;
  }

  return recognition;
}

export async function ensureOnDeviceRecognitionReady(): Promise<OnDeviceRecognitionStatus> {
  const SpeechRecognitionClass = getSpeechRecognitionConstructor();

  if (!SpeechRecognitionClass) {
    return {
      status: "unsupported",
      language: SPEECH_LANGUAGE,
      message: "이 브라우저는 SpeechRecognition API를 제공하지 않습니다."
    };
  }

  const recognition = createSpeechRecognition();
  const supportsProcessLocally =
    recognition !== null && "processLocally" in recognition;
  const supportsAvailability =
    typeof SpeechRecognitionClass.available === "function";

  if (!recognition || !supportsProcessLocally || !supportsAvailability) {
    return {
      status: "unsupported",
      language: SPEECH_LANGUAGE,
      message:
        "온디바이스 STT를 강제하는 processLocally 또는 language pack 확인 API가 없습니다."
    };
  }

  const options = {
    langs: [SPEECH_LANGUAGE],
    processLocally: true
  };

  const availability = await SpeechRecognitionClass.available!(options);

  if (availability === "available") {
    return {
      status: "available",
      language: SPEECH_LANGUAGE,
      message: "ko-KR 온디바이스 STT language pack을 사용할 수 있습니다."
    };
  }

  if (availability === "downloadable") {
    if (typeof SpeechRecognitionClass.install !== "function") {
      return {
        status: "downloadable",
        language: SPEECH_LANGUAGE,
        message:
          "ko-KR language pack은 다운로드 가능하지만 install API가 없습니다."
      };
    }

    const installed = await SpeechRecognitionClass.install(options);

    if (installed) {
      const installedAvailability =
        await SpeechRecognitionClass.available!(options);

      if (installedAvailability === "available") {
        return {
          status: "available",
          language: SPEECH_LANGUAGE,
          message: "ko-KR 온디바이스 STT language pack 설치가 완료됐습니다."
        };
      }

      return {
        status: installedAvailability,
        language: SPEECH_LANGUAGE,
        message: `설치 후 language pack 상태가 ${installedAvailability}입니다.`
      };
    }

    return {
      status: "downloadable",
      language: SPEECH_LANGUAGE,
      message: "ko-KR language pack 설치가 완료되지 않았습니다."
    };
  }

  return {
    status: availability,
    language: SPEECH_LANGUAGE,
    message: `ko-KR 온디바이스 STT language pack 상태가 ${availability}입니다.`
  };
}

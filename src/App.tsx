import { useMemo, useRef, useState } from "react";
import {
  applyServerCommand,
  buildVoiceCommandRequest,
  requestVoiceCommandDecision
} from "./commandApi";
import type {
  RecognitionEntry,
  TargetPosition,
  VoiceCommandResponse
} from "./domain";
import {
  createSpeechRecognition,
  ensureOnDeviceRecognitionReady,
  getSpeechRecognitionConstructor,
  type OnDeviceRecognitionStatus,
  type SpeechRecognition,
  type SpeechRecognitionEventLike
} from "./speechRecognition";

const INITIAL_POSITION: TargetPosition = { x: 0, y: 0 };

export default function App() {
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const positionRef = useRef<TargetPosition>(INITIAL_POSITION);
  const [browserStatus] = useState(() =>
    getSpeechRecognitionConstructor()
      ? "SpeechRecognition API detected"
      : "SpeechRecognition API unavailable"
  );
  const [readiness, setReadiness] = useState<OnDeviceRecognitionStatus>({
    status: "unsupported",
    language: "ko-KR",
    message: "아직 온디바이스 STT 준비 상태를 확인하지 않았습니다."
  });
  const [isCheckingReadiness, setIsCheckingReadiness] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [latestFinalTranscript, setLatestFinalTranscript] = useState("");
  const [latestConfidence, setLatestConfidence] = useState<number | null>(null);
  const [recognitionLog, setRecognitionLog] = useState<RecognitionEntry[]>([]);
  const [position, setPosition] = useState<TargetPosition>(INITIAL_POSITION);
  const [apiStatus, setApiStatus] = useState("대기 중");
  const [latestServerResponse, setLatestServerResponse] =
    useState<VoiceCommandResponse | null>(null);
  const [executionStatus, setExecutionStatus] = useState(
    "서버 명령 판단 결과를 기다리고 있습니다."
  );

  const commandApiUrl = import.meta.env.VITE_COMMAND_API_URL ?? "";
  const supportTone = readiness.status === "available" ? "ok" : "warn";

  const sortedLog = useMemo(
    () => recognitionLog.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [recognitionLog]
  );

  async function checkReadiness() {
    setIsCheckingReadiness(true);
    setExecutionStatus("온디바이스 STT 준비 상태를 확인하고 있습니다.");

    try {
      const nextReadiness = await ensureOnDeviceRecognitionReady();
      setReadiness(nextReadiness);
      setExecutionStatus(nextReadiness.message);
      return nextReadiness;
    } catch (error) {
      const failure: OnDeviceRecognitionStatus = {
        status: "unsupported",
        language: "ko-KR",
        message:
          error instanceof Error
            ? error.message
            : "온디바이스 STT 준비 상태 확인 중 알 수 없는 오류가 발생했습니다."
      };
      setReadiness(failure);
      setExecutionStatus(failure.message);
      return failure;
    } finally {
      setIsCheckingReadiness(false);
    }
  }

  async function startListening() {
    if (isListening) {
      return;
    }

    const nextReadiness = await checkReadiness();

    if (nextReadiness.status !== "available") {
      setExecutionStatus(
        "온디바이스 ko-KR STT를 사용할 수 없어 인식을 시작하지 않았습니다."
      );
      return;
    }

    const recognition = createSpeechRecognition();

    if (!recognition) {
      setExecutionStatus("SpeechRecognition 인스턴스를 만들 수 없습니다.");
      return;
    }

    recognition.onresult = handleRecognitionResult;
    recognition.onerror = (event) => {
      const message = event.message || event.error || "알 수 없는 STT 오류";
      setExecutionStatus(`STT 오류: ${message}`);
      setIsListening(false);
    };
    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
      setIsListening(true);
      setExecutionStatus("온디바이스 STT 인식을 시작했습니다.");
    } catch (error) {
      setExecutionStatus(
        error instanceof Error
          ? error.message
          : "STT 인식 시작 중 알 수 없는 오류가 발생했습니다."
      );
      setIsListening(false);
    }
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setIsListening(false);
    setExecutionStatus("STT 인식을 중지했습니다.");
  }

  function handleRecognitionResult(event: SpeechRecognitionEventLike) {
    let nextInterimTranscript = "";

    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const alternative = result[0] ?? result.item(0);
      const transcript = alternative?.transcript.trim() ?? "";
      const confidence =
        typeof alternative?.confidence === "number"
          ? alternative.confidence
          : null;

      if (!transcript) {
        continue;
      }

      setLatestConfidence(confidence);

      if (result.isFinal) {
        handleFinalTranscript(transcript, confidence);
      } else {
        nextInterimTranscript = `${nextInterimTranscript} ${transcript}`.trim();
      }
    }

    setInterimTranscript(nextInterimTranscript);
  }

  function handleFinalTranscript(transcript: string, confidence: number | null) {
    const entry: RecognitionEntry = {
      id: crypto.randomUUID(),
      transcript,
      confidence,
      isFinal: true,
      createdAt: new Date().toISOString()
    };

    setLatestFinalTranscript(transcript);
    setInterimTranscript("");
    setRecognitionLog((current) => [entry, ...current].slice(0, 20));
    void sendTranscriptToServer(transcript);
  }

  async function sendTranscriptToServer(transcript: string) {
    setApiStatus("요청 중");
    setExecutionStatus("최종 STT 텍스트를 서버 OpenAI 명령 판단 API로 보냈습니다.");

    try {
      const response = await requestVoiceCommandDecision(
        buildVoiceCommandRequest(transcript, positionRef.current)
      );
      setLatestServerResponse(response);

      const nextPosition = applyServerCommand(response);

      if (!nextPosition) {
        setApiStatus("noop");
        setExecutionStatus(response.reason);
        return;
      }

      positionRef.current = nextPosition;
      setPosition(nextPosition);
      setApiStatus("적용 완료");
      setExecutionStatus(response.reason);
    } catch (error) {
      setApiStatus("실패");
      setExecutionStatus(
        error instanceof Error
          ? error.message
          : "서버 명령 판단 API 요청 중 알 수 없는 오류가 발생했습니다."
      );
    }
  }

  function resetTargetForManualTest() {
    positionRef.current = INITIAL_POSITION;
    setPosition(INITIAL_POSITION);
    setExecutionStatus("수동으로 대상 위치를 초기화했습니다.");
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">orbit STT spike</p>
          <h1>On-device STT to server command</h1>
        </div>
        <div className="api-pill">
          <span>API</span>
          <strong>{commandApiUrl || "not configured"}</strong>
        </div>
      </header>

      <section className="workspace">
        <div className="control-panel">
          <section className="panel">
            <h2>Recognition</h2>
            <div className="button-row">
              <button
                type="button"
                onClick={startListening}
                disabled={isListening || isCheckingReadiness}
              >
                마이크 시작
              </button>
              <button type="button" onClick={stopListening} disabled={!isListening}>
                마이크 중지
              </button>
              <button
                type="button"
                className="secondary"
                onClick={checkReadiness}
                disabled={isCheckingReadiness || isListening}
              >
                준비 상태 확인
              </button>
            </div>
            <div className="status-grid">
              <StatusItem label="Browser" value={browserStatus} tone="neutral" />
              <StatusItem
                label="On-device"
                value={readiness.status}
                tone={supportTone}
              />
              <StatusItem label="Language" value={readiness.language} tone="neutral" />
              <StatusItem
                label="Listening"
                value={isListening ? "listening" : "stopped"}
                tone={isListening ? "ok" : "neutral"}
              />
            </div>
            <p className={`notice ${supportTone}`}>{readiness.message}</p>
          </section>

          <section className="panel">
            <h2>Transcript</h2>
            <TranscriptBlock label="Interim" value={interimTranscript} />
            <TranscriptBlock label="Final" value={latestFinalTranscript} />
            <div className="status-grid compact">
              <StatusItem
                label="STT confidence"
                value={formatConfidence(latestConfidence)}
                tone="neutral"
              />
              <StatusItem label="Server status" value={apiStatus} tone="neutral" />
            </div>
          </section>

          <section className="panel">
            <h2>Server Decision</h2>
            <pre className="response-view">
              {latestServerResponse
                ? JSON.stringify(latestServerResponse, null, 2)
                : "No server response yet"}
            </pre>
            <p className="notice neutral">{executionStatus}</p>
          </section>
        </div>

        <div className="stage-panel">
          <section className="stage">
            <div
              className="movable-target"
              style={{
                transform: `translate(${position.x}px, ${position.y}px)`
              }}
            >
              orbit command target
            </div>
          </section>
          <div className="stage-footer">
            <div>
              <span>x</span>
              <strong>{position.x}px</strong>
            </div>
            <div>
              <span>y</span>
              <strong>{position.y}px</strong>
            </div>
            <button type="button" className="secondary" onClick={resetTargetForManualTest}>
              위치 초기화
            </button>
          </div>

          <section className="panel log-panel">
            <h2>Recognition Log</h2>
            {sortedLog.length === 0 ? (
              <p className="empty-state">아직 final STT 결과가 없습니다.</p>
            ) : (
              <ul className="log-list">
                {sortedLog.map((entry) => (
                  <li key={entry.id}>
                    <div>
                      <strong>{entry.transcript}</strong>
                      <span>{new Date(entry.createdAt).toLocaleTimeString()}</span>
                    </div>
                    <small>{formatConfidence(entry.confidence)}</small>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

function StatusItem({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone: "neutral" | "ok" | "warn";
}) {
  return (
    <div className={`status-item ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TranscriptBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="transcript-block">
      <span>{label}</span>
      <p>{value || "No transcript"}</p>
    </div>
  );
}

function formatConfidence(confidence: number | null) {
  return confidence === null ? "not provided" : confidence.toFixed(3);
}

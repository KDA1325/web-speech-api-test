# orbit Web Speech API On-Device STT + Server Command Spike 계획

## Summary

- 현재 레포는 비어 있으므로 작은 Chrome 전용 브라우저 실험 앱을 새로 만든다.
- 목표는 `Chrome Web Speech API on-device STT -> 인식 텍스트 렌더링 -> 서버 OpenAI 명령 판단 -> 서버 판단 결과로 화면 텍스트 이동`까지 한 화면에서 검증하는 것이다.
- STT는 발표 환경의 지연을 줄이기 위해 브라우저 온디바이스 처리를 강제한다. 원격 STT fallback은 사용하지 않는다.
- 명령이 우리가 정한 이동 명령에 부합하는지 판단하고, 맞다면 어떤 이동을 수행할지는 서버의 OpenAI 모델이 결정한다.
- Chrome Web Speech API의 기본 인식은 원격일 수 있으므로, 반드시 `SpeechRecognition.processLocally = true`와 language pack availability/install 흐름으로 온디바이스 여부를 확인한다.
- 참고 문서:
  - [MDN Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API)
  - [SpeechRecognition.processLocally](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally)
  - [SpeechRecognition.available()](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/available_static)
  - [SpeechRecognitionAlternative.confidence](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognitionAlternative/confidence)

## Key Changes

- `Vite + React + TypeScript` 기반 미니 앱을 구성한다.
- 화면 구성:
  - 마이크 시작/중지 버튼
  - 브라우저 지원 상태
  - 온디바이스 STT 지원/설치 상태
  - 실시간/최종 STT 텍스트 표시
  - confidence 표시
  - 서버 명령 판단 요청/응답 상태
  - 인식 로그 리스트
  - 이동 대상 텍스트 박스
  - 현재 x/y 좌표와 마지막 서버 명령 판단 결과 표시
- `window.SpeechRecognition || window.webkitSpeechRecognition`로 Chrome 호환 처리하되, 온디바이스 강제에 필요한 `processLocally`, `available()`, `install()` 지원 여부를 별도 확인한다.
- recognition 설정:
  - `lang = "ko-KR"`
  - `interimResults = true`
  - `continuous = true`
  - `maxAlternatives = 3`
  - `processLocally = true`
- 한국어 온디바이스 language pack이 `available`이면 STT를 시작한다.
- language pack이 `downloadable` 또는 `downloading`이면 설치 흐름을 UI에 표시한다.
- language pack이 `unavailable`이거나 로컬 처리 API가 없으면 원격 fallback 없이 실패 상태를 표시한다.

## Git Workflow

- 구현 범위에 들어가기 전 해당 범위 전용 새 브랜치를 만들고 이동한다.
- 브랜치 이름은 사용자가 별도로 지정하지 않으면 `codex/` prefix를 사용한다.
- base 브랜치에서 직접 기능 구현을 진행하지 않는다.
- 현재 범위 구현이 끝나면 필요한 검증 명령을 실행하고, 변경사항을 커밋한 뒤 해당 브랜치에 push한다.
- 다음 구현 범위를 시작하기 전에는 다시 새 브랜치를 만들고 그 브랜치로 이동한 뒤 진행한다.
- 하나의 브랜치에는 하나의 응집된 구현 범위만 담는다.
- remote 미설정 또는 인증 문제로 push할 수 없으면, 같은 브랜치에서 다음 범위를 이어서 진행하지 말고 정확한 blocker를 보고한다.

## Server Command Behavior

- 클라이언트는 최종 STT 결과를 서버 명령 판단 API로 보낸다.
- 서버는 OpenAI 모델을 사용해 텍스트가 허용된 명령인지 판단하고, 이동이 필요하면 다음 좌표 또는 이동 delta를 반환한다.
- 클라이언트는 로컬 규칙 기반으로 명령을 확정하지 않는다. 클라이언트는 서버 응답을 화면에 적용하는 thin client로 동작한다.
- 한국어 명령 예시:
  - "왼쪽으로 이동", "왼쪽으로 50 이동"
  - "오른쪽으로 이동", "오른쪽으로 100 이동"
  - "위로 이동", "아래로 이동"
  - "가운데로 이동", "초기화"
- 기본 이동량은 서버 판단 API의 정책으로 50px를 사용한다.
- 서버가 `noop` 또는 `unknown`을 반환하면 클라이언트는 요소를 이동시키지 않고 상태 메시지만 표시한다.
- 서버 API URL은 `VITE_COMMAND_API_URL` 환경변수로 주입한다. 브라우저에 OpenAI API key를 절대 노출하지 않는다.

## API Contract

### `POST /voice-command/interpret`

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

Response:

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

Unknown/no-op response:

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

## Test Plan

- Chrome에서 온디바이스 STT API 지원 여부를 확인한다.
- `ko-KR` language pack 상태가 `available`, `downloadable`, `downloading`, `unavailable` 중 무엇인지 UI에 표시한다.
- 원격 STT fallback 없이 `processLocally = true`로만 인식이 시작되는지 확인한다.
- 거리별 테스트 표를 앱 또는 README에 기록한다:
  - 30cm, 1m, 2m, 3m
  - 발화 문장
  - 인식 결과
  - confidence
  - 서버 판단 결과
  - 성공/실패
- 화면 렌더링 테스트:
  - interim 텍스트가 말하는 중 갱신되는지
  - final 텍스트가 로그에 남는지
  - final 텍스트가 서버 판단 API로 전송되는지
- 명령 실행 테스트:
  - "왼쪽으로 이동" 발화 시 서버 응답에 따라 텍스트가 왼쪽으로 이동
  - "오른쪽으로 100 이동" 발화 시 서버 응답에 따라 100px 이동
  - 오인식 또는 불명확한 명령은 서버가 `noop`을 반환하고 클라이언트가 이동하지 않음

## Assumptions

- 이번 스파이크는 Chrome 브라우저 전용으로 한다.
- 현재 레포에는 앱이 없으므로 새 Vite React 앱을 만든다.
- PPT 캔버스/이미지 객체 이동은 후속 레포 통합으로 미루고, 지금은 텍스트 요소 이동만 검증한다.
- STT는 Web Speech API의 온디바이스 모드를 강제한다. 지원되지 않는 환경에서는 테스트 실패로 처리한다.
- 명령 판단과 이동 결정은 서버 OpenAI 모델이 담당한다. 클라이언트는 서버 응답을 적용만 한다.

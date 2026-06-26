# orbit Web Speech API On-Device STT Spike

Chrome Web Speech API의 온디바이스 STT 모드를 강제하고, 최종 STT 텍스트를 서버 OpenAI 명령 판단 API로 보내 화면의 텍스트 요소를 이동시키는 실험 앱입니다.

## 검증 목표

- 발표 환경에서 지연을 줄이기 위해 브라우저 온디바이스 STT를 사용할 수 있는지 확인합니다.
- `ko-KR` language pack 상태를 확인하고, 가능한 경우 설치 흐름을 거칩니다.
- 원격 STT fallback 없이 `processLocally = true`로만 인식을 시작합니다.
- 명령 판단과 이동 결정은 클라이언트가 하지 않고 서버 OpenAI API 응답만 적용합니다.

## 실행

```bash
npm install
npm run dev
```

서버 명령 판단 API 주소를 `.env`에 설정합니다.

```bash
VITE_COMMAND_API_URL=https://your-command-api.example.com
```

브라우저에는 OpenAI API key를 넣지 않습니다. `VITE_COMMAND_API_URL`은 OpenAI 모델을 호출하는 서버 API의 base URL입니다.

## 서버 API 계약

클라이언트는 최종 STT 결과가 나오면 다음 요청을 보냅니다.

```http
POST /voice-command/interpret
Content-Type: application/json
```

```json
{
  "transcript": "오른쪽으로 100 이동",
  "language": "ko-KR",
  "currentPosition": { "x": 0, "y": 0 },
  "allowedCommands": ["move-left", "move-right", "move-up", "move-down", "center", "reset"],
  "defaultDistancePx": 50
}
```

서버가 명령이라고 판단한 경우:

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

명령이 아니라고 판단한 경우:

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

클라이언트는 `matched: true`이고 `action`이 `noop`이 아닌 경우에만 `nextPosition`을 CSS `transform: translate(x, y)`로 적용합니다.

## 수동 테스트 체크리스트

- Chrome에서 앱이 콘솔 오류 없이 열린다.
- 온디바이스 STT 지원 상태가 화면에 표시된다.
- `ko-KR` language pack 상태가 화면에 표시된다.
- 온디바이스 `ko-KR` STT가 unavailable 또는 unsupported이면 인식을 시작하지 않는다.
- 마이크 권한 허용 후 interim transcript가 말하는 중 갱신된다.
- final transcript가 인식 로그에 남는다.
- STT confidence가 제공되는 경우 화면에 표시된다.
- final transcript가 서버 명령 판단 API로 전송된다.
- 서버 응답 JSON이 화면에 표시된다.
- 서버가 matched move 응답을 반환할 때만 텍스트 요소가 이동한다.
- 서버가 `noop`, 오류, timeout을 반환하면 텍스트 요소가 이동하지 않는다.

## 거리별 STT 기록 표

| 거리 | 발화 문장 | 인식 결과 | STT confidence | 서버 판단 결과 | E2E 지연 | 성공/실패 | 메모 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 30cm |  |  |  |  |  |  |  |
| 1m |  |  |  |  |  |  |  |
| 2m |  |  |  |  |  |  |  |
| 3m |  |  |  |  |  |  |  |

## 검증 명령

```bash
npm run typecheck
npm test
npm run build
```

## 주의사항

- 이 앱은 Chrome 전용 스파이크입니다.
- 원격 STT fallback을 사용하지 않습니다.
- 브라우저에서 OpenAI API를 직접 호출하지 않습니다.
- 로컬 regex/rule 기반 명령 파서는 source of truth로 사용하지 않습니다.
- PPT/PPTX, 캔버스 에디터, Konva/Fabric, Sherpa ONNX는 이 레포 범위가 아닙니다.

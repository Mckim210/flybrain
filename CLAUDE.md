# CLAUDE.md — 민찬님의 초파리 뇌 실험실

이 저장소는 snedea/flybrain(MIT)의 fork입니다. 소유자 민찬님은 경영·경제에 관심 있는 고등학생이고,
초파리 커넥톰 시뮬레이션과 경제/투자 의사결정을 연결한 소논문을 쓰려고 합니다.
**사용자를 "민찬님"이라고 부르고, 한국어로 답하세요.** 확인할 수 없는 사실은 단정하지 말고 출처를 밝히세요.

## 소논문 방향
"초파리 트레이더의 1달러 — 실력인가 운인가"
- STONKFLY(github.com/nftechie/stonkfly)가 초파리 뇌로 BTC를 사고팔아 약 $1 이익을 냈다는 사례를,
  같은 규칙의 **무작위 투자자 1만 명**과 비교한다(귀무 모형 / 몬테카를로).
- 이 저장소에서는 그 질문을 **직접 실험**으로 확장한다: 두 자산의 가격 변화를 파리의 왼쪽/오른쪽 감각 자극으로 넣고,
  파리 뇌의 출력이 어느 쪽을 "선택"하는지 반복 측정해 무작위 선택(50:50)과 통계적으로 비교한다.

## 코드 구조 (이미 확인한 사실)
- 브라우저 앱: `index.html` + `js/`. 뉴런 시뮬레이션(LIF)은 Web Worker `js/sim-worker.js`, 메인 스레드와는 `js/brain-worker-bridge.js`로 통신.
- 데이터: `data/connectome.bin.gz`(FlyWire FAFB v783 기반, 약 13.9만 뉴런), `neurons.csv.gz`, `classification.csv.gz` 등.
  FlyWire 데이터는 CC-BY-NC — 비상업 연구 용도만.
- 감각 입력: `js/connectome.js`의 `BRAIN.stimulate` (touch, foodNearby, dangerOdor, wind + windDirection, lightLevel, temperature, nociception).
  방향성이 있는 입력은 현재 `windDirection` 정도. 좌/우를 구분하는 자극이 필요하면 새로 만들어야 한다.
- 출력 그룹: `BRAIN.neuronRegions.motor` — DN_WALK, DN_TURN, DN_BACKUP, DN_STARTLE, MN_LEG_L1~R3, MN_WING_L/R 등 좌/우 운동뉴런 그룹이 있음.
  `brain-worker-bridge.js`에서 `CX_HDELTA` 등을 읽어 회전으로 바꿈.
- **주의**: `js/main.js`의 파리는 먹이 쪽으로 갈 때 `nearestFood()`로 가장 가까운 먹이를 **코드가 고정적으로 고른다**.
  즉 화면 속 "먹이 선택"은 뇌가 내린 결정이 아니다. 실험에서는 이 경로를 쓰지 말고, 뇌 출력(좌/우 운동뉴런 발화율 차이)을 직접 읽을 것.
- Neuron Map 오버레이(`js/neuron-map.js`, `data/neuron_positions.bin`): 실제 FlyWire 좌표에 뉴런별 발화를 실시간 표시. 상단 "Neuron Map" 버튼.
- 실행: 로컬 HTTP 서버 필요(`python3 -m http.server` 후 `index.html`). `file://`로 열면 fetch/Worker가 막힌다.
- 테스트: `tests/run-node.js`, `tests/run.html`.

## 실험 계획 (다음 작업)
1. 브라우저 없이 Node에서 `sim-worker.js`의 시뮬레이션을 돌릴 수 있는 헤드리스 러너 만들기(`experiments/` 폴더).
2. 좌/우 감각 자극 API 추가: 예) 자산 A 수익률 → 왼쪽 감각뉴런 그룹 자극 세기, 자산 B → 오른쪽.
3. 출력 판독: 일정 시간창 동안 왼쪽 vs 오른쪽 운동/하행 뉴런 발화 수 → "A 선택 / B 선택 / 무반응".
4. 같은 조건을 수백 번 반복(난수 시드 고정·기록) → 선택 비율, 이항검정, 무작위 선택과 비교.
5. 결과는 CSV/JSON + 차트(HTML)로 저장하고, 어떤 뉴런 그룹이 많이 발화했는지 요약.
6. 민찬님이 조건(자극 세기, 가격 데이터, 반복 횟수)을 바꿔 다시 돌릴 수 있게 설정 파일/명령어로 정리.

## 이미 알려진 STONKFLY 사실 (nftechie/stonkfly commit 78ef3e0 기준)
- 가격 → RGB 차트 → R1–R6/R8 광수용체 입력. DNp20 오른쪽−왼쪽 ≥ 2 Hz(+DNpe017 스파이크) = BUY.
- 자본 $100, 주문당 $10, 하루 24회, 최소 60초 간격, 수수료 0.6%(paper), 2% 수수료 예비금. 공매도 없음.
- 문서 스스로 "수익성 있는 학습은 입증되지 않았다", BUY 편향이 반복될 수 있다고 밝힘.
- 무작위 투자자 분석(같은 규칙, 2026-09-10 11:34 ~ 09-11 14:14 UTC, Bitstamp 1분봉): 수수료가 결과를 지배,
  "사기만 하는" 편향 투자자도 상승장이면 $1 이익이 흔함 → $1은 실력의 증거가 되기 어렵다.

## 작업 원칙
- 고등학생이 이해할 수 있게 설명하고, 결과에는 한계(시뮬레이션 단순화, 표본 수, 시드)를 함께 적는다.
- 원 프로젝트의 동작을 바꾸는 변경은 별도 파일/플래그로 분리해서 웹 앱은 그대로 실행되게 유지한다.
- 커밋은 작게, 메시지는 무엇을 왜 바꿨는지.

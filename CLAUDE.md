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
- 출력 그룹: `DN_WALK`, `DN_TURN`, `MN_LEG_L1~R3`, `MN_WING_L/R` 등은 **실제 뉴런이 0개**다(`data/neuron_meta.json`).
  FlyWire FAFB는 뇌만 포함하므로 웹 앱은 이 그룹을 `brain-worker-bridge.js`의 `synthesizeMotorOutputs()`에서 좌우 대칭으로 만들어 낸다.
  실험에서는 뇌의 실제 출력인 **하행 뉴런(super_class = descending, 왼쪽 647·오른쪽 650개)**을 좌/우로 나눠 읽는다.
- **주의**: `js/main.js`의 파리는 먹이 쪽으로 갈 때 `nearestFood()`로 가장 가까운 먹이를 **코드가 고정적으로 고른다**.
  즉 화면 속 "먹이 선택"은 뇌가 내린 결정이 아니다. 실험에서는 이 경로를 쓰지 말고, 뇌 출력(좌/우 운동뉴런 발화율 차이)을 직접 읽을 것.
- Neuron Map 오버레이(`js/neuron-map.js`, `data/neuron_positions.bin`): 실제 FlyWire 좌표에 뉴런별 발화를 실시간 표시. 상단 "Neuron Map" 버튼.
- 실행: 로컬 HTTP 서버 필요(`python3 -m http.server` 후 `index.html`). `file://`로 열면 fetch/Worker가 막힌다.
- 테스트: `tests/run-node.js`, `tests/run.html`.

## 실험 계획
완료(브랜치 claude/compassionate-babbage-2f932s, `experiments/README.md` 참고):
1. 헤드리스 러너 `experiments/run-trials.js` (같은 시드 → 같은 결과, 재현 확인함)
2. 좌/우 감각 자극(`stimulus.groups/left/right/balance`)
3. 하행 뉴런 좌/우 발화로 "왼쪽/오른쪽/무반응" 판정, 이항검정

지금까지 결과:
- 잡음 없음 → 하행 뉴런 발화 0 (모델에 난수가 없어 잡음이 있어야 활동이 생김)
- 잡음만 100회 → 왼쪽 8, 오른쪽 4, 무반응 88 (p≈0.39, 편향 지수 d 평균≈0) → 타고난 좌우 치우침 없음
- 왼쪽 눈(R1–R6)만 자극 0.15 vs 오른쪽 눈만 → 광수용체는 크게 발화하지만 하행 뉴런 출력은 거의 같음
  → **현재 설정에서는 감각 자극이 출력까지 전달되지 않는다.** (시냅스 가중치 최대 0.15로 정규화, 평균 약 0.0008, 문턱 1.0)

- 용량-반응(기본 가중치, 조건당 20회, `experiments/results/dose-response/table.md`):
  VIS_R1R6·MECH_JO는 왼쪽 자극 시 왼쪽 하행 뉴런이 약간 더 발화(짝지은 Δd ≈ +0.025, 95% CI가 0 위)지만
  선택 판정(왼/오/무)은 거의 안 바뀜(대부분 무반응). OLF_ORN_FOOD는 효과 0. 세기 1 이상은 결과가 같음(감각뉴런 포화).
  → 신호는 "있지만 아주 약하다".
- 가중치 배율 스윕(`experiments/results/dose-response-weights/table.md`, weightScale 10/20/40, 조건당 20회):
  배율을 키우면 같은 쪽(ipsilateral) 편향이 뚜렷해짐(Δd 최대 ≈ 0.57). 잡음만 있는 기준 시행의 뇌 전체 발화는
  배율 20까지 기본 모델과 비슷(≈120~124/틱), 배율 40은 약 50% 증가 → 과흥분 우려로 제외.
- **확인 실험(채택 설정)**: weightScale 20, VIS_R1R6, 세기 1, 새 시드 100회(`experiments/results/confirm-w20-vis/`):
  왼쪽 자극 → 왼 44 / 오 0 / 무 56, 오른쪽 자극 → 왼 0 / 오 66 / 무 34, 잡음만 → 2 / 4 / 94 (p = 0.69).
  → 이 설정에서 "자극 쪽 = 선택 쪽"이 확실히 성립하고, 자극이 없으면 치우침이 없다.
  한계: weightScale 20은 원래 FlyWire 연결 강도를 실험용으로 20배 키운 것(웹 앱은 그대로). 결과 해석 시 반드시 명시.

다음 단계:
4. (완료) 용량-반응 실험 → 채택 설정: weightScale 20, VIS_R1R6, 세기 1.
5. (완료) STONKFLY 기간 거래 실험(`experiments/trade.js`, `experiments/results/trade-stonkfly-window/`, 결정 26회):
   초파리 30회 평균 −$0.00(중앙값 +$0.02), 규칙 투자자 −$1.10(주문 22건, 수수료 $1.32; 수수료 없으면 +$0.22),
   무작위 1만 명 평균 −$0.15. 초파리는 74% 보유, 거래할 땐 규칙과 같은 방향(반대 1.9%).
   초파리가 규칙보다 나은 이유 = 거래를 덜 해서 수수료를 덜 냄. 같은 행동 비율의 무작위 집단 안에서 백분위 47% → 실력 아님.
   (고침) look-ahead: `fullScaleReturn` 고정 1%로 재실행 → 초파리 평균 +$0.03, 결론 동일(`trade-stonkfly-window-fixed1pct/`).
5-1. (완료) 5개 기간 추가(`experiments/results/periods/summary.md`, 선택 규칙 `selection.md`: 수익률 10·25·50·75·90 백분위, 상승 2·하락 2·횡보 1):
   모든 기간에서 초파리가 규칙 투자자보다 나음(10/10), 이유는 주문 수가 적어 수수료를 덜 냄(손익 차 ≈ 수수료 차).
   같은 주문 수의 무작위 투자자와 비교한 잔차, 80회 합산: −$0.01 (95% CI −$0.06 ~ +$0.03) → **실력 증거 없음**.
   참고: `btcusd_1h.csv`는 처음 올릴 때 timestamp가 모두 1로 잘못 저장됐고, 클라우드 세션이 복원함(원자료와 대조해 완전히 일치 확인).
5-2. (완료) 보강 실험:
   - 수수료 반사실(`experiments/results/fee-counterfactual/table.md`, 저장된 결정 재계산): 초파리 > 규칙 비율이
     수수료 0.6% 100% → 0.1% 79% → 0% 56%. 우위는 대부분 수수료에서 나옴(0%에서도 일부 기간 소폭 우위, 강한 상승장에선 규칙이 우세).
   - 매핑 반전(`experiments/results/reversed/comparison.md`, 각 기간 10회): 규칙과 같은 거래 방향 91% → 10%로 뒤집힘.
     손익은 계속 0 근처(약 80% 보유 때문) → 방향은 사람이 정한 매핑, 손익 크기는 거래 빈도가 결정.
   - 강건성(`experiments/results/robust-w10/comparison.md`): weightScale 10으로 6개 기간 재실행 → 보유 82%→87%로 늘지만
     초파리 > 규칙 60/60, 잔차 −$0.01 [−$0.05, +$0.03] → 결론이 배율에 따라 바뀌지 않음.
   - **소논문용 숫자·출처 파일·재현 명령어는 `experiments/PAPER.md`에 모두 정리됨. 실험 단계는 마무리.**
   - 그림: `experiments/results/figures/summary.png`(6개 기간 요약), `neurons-buy.png`(매수 결정 순간 뉴런 발화).
   가격 데이터는 `experiments/prices/`에 있음(출처·라이선스 `DATA_SOURCE.md`; 클라우드 세션은 외부 다운로드가 막힐 수 있으므로 이 파일을 쓸 것). 가격 → 자극 매핑(자산 A 수익률 → 왼쪽, 자산 B → 오른쪽)을 붙인다.
6. 같은 조건을 수백 번 반복 → 선택 비율과 무작위(50:50)를 비교, 결과 CSV/JSON + 차트(HTML).
7. 민찬님이 조건을 바꿔 다시 돌릴 수 있게 설정 파일/명령어로 정리.

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

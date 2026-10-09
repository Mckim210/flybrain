# experiments/ — 초파리 뇌 좌/우 선택 실험 (헤드리스)

브라우저 없이 Node.js로 웹 앱과 **같은** LIF 시뮬레이터(`js/sim-worker.js`)를 돌려,
왼쪽/오른쪽 감각 자극에 대해 뇌 출력이 어느 쪽으로 치우치는지 반복 측정합니다.
웹 앱 코드는 바꾸지 않습니다(워커 파일을 그대로 `vm`으로 불러옴).

## 실행

```bash
# 자극 없음 + 배경 잡음, 100회 (기준 실험)
node experiments/run-trials.js --config experiments/config/baseline-noise.json

# 설정 파일 값 일부를 명령어로 덮어쓰기
node experiments/run-trials.js --config experiments/config/baseline-noise.json --trials 20 --seed 7 --name quick
```

결과는 `experiments/results/<name>/`에 저장됩니다.
- `trials.csv` — 시행별 시드, 판정, 좌/우 발화 수, 편향 지수 d
- `summary.json` — 판정 횟수, 이항검정 p값, 신뢰구간, 가장 많이 발화한 뉴런 그룹(좌/우)

시행 1회(70틱)에 약 6~7초 걸립니다(뇌 전체가 활성일 때 틱당 약 90ms, 4코어 컨테이너 기준).

## 용량-반응 스윕 (여러 조건 한꺼번에)

```bash
# 자극 그룹 x 세기 x (왼쪽만 / 오른쪽만), 조건마다 20회, CPU 코어 수만큼 병렬
node experiments/sweep.js --config experiments/config/dose-response.json
# 실험용 가중치 배율(weightScale)을 바꿔 같은 스윕
node experiments/sweep.js --config experiments/config/dose-response-weights.json
# 이미 돌린 결과로 표만 다시 만들기
node experiments/sweep.js --config experiments/config/dose-response.json --only-table
```

- 모든 조건이 **같은 시드**를 씁니다. 그래서 "왼쪽만 자극" i번째 시행과 "오른쪽만 자극" i번째 시행은 배경 잡음이 완전히 같고,
  둘의 차이 `Δd = d(왼쪽만) − d(오른쪽만)`는 자극 쪽 때문에 생긴 차이만 남습니다(짝지은 비교).
- `Δd`의 95% 신뢰구간이 0을 포함하지 않으면 표에 **신호 있음**으로 표시합니다. 조건이 많으면 우연히 하나쯤 걸릴 수 있으니(다중비교) 여러 세기에서 일관된지 함께 보세요.
- 결과: `experiments/results/<name>/table.md`, `table.csv`, `summary.json`, 조건별 원자료는 `runs/` 아래.
- 이미 끝난 조건(`summary.json`이 있는 조건)은 건너뜁니다. 조건을 바꿔 다시 돌릴 때는 `--name`을 바꾸세요.

## 지금까지의 결론 (2026-10-09)

- 웹 앱 기본 모델(`weightScale` 1)에서는 좌/우 감각 자극이 하행 뉴런까지 거의 전달되지 않음
  (`results/dose-response`: Δd ≈ +0.025, 선택은 거의 안 바뀜).
- **추천 실험 조건: `weightScale` 20, 자극 그룹 `VIS_R1R6`, 세기 1** (`config/confirm-w20-vis.json`).
  새 시드로 100회씩 확인한 결과(`results/confirm-w20-vis`):
  왼쪽만 자극 → 왼쪽 44 / 오른쪽 0 / 무반응 56, 오른쪽만 자극 → 0 / 66 / 34, 자극 없음 → 2 / 4 / 94 (이항검정 p = 0.69).
  자극 없을 때 뇌 전체 발화는 틱당 124회로 기본 모델(119)과 비슷함.
- `weightScale` 40은 자극 없이도 뇌 전체 발화가 약 1.5배, 하행 발화가 약 2.4배로 늘어 추천하지 않음.
- 세기 1 이상은 감각뉴런이 이미 최대 속도로 발화해서 결과가 같음(포화). 가격 → 자극 세기 변환은 0.15~1 범위에서 하는 것이 좋음.
- STONKFLY 기간 거래 실험(`results/trade-stonkfly-window`): 초파리 30회 손익 평균 −$0.00(범위 −$0.50 ~ +$0.94),
  규칙 투자자 −$1.10(주문 22건·수수료 $1.32, 수수료가 없었다면 +$0.22), 무작위 1만 명 평균 −$0.15.
  초파리는 74%를 보유했고, 움직일 때는 거의 규칙과 같은 방향(정반대 1.9%). 손익은 같은 행동 비율의 무작위 집단과 구별되지 않음(백분위 평균 47%).
  단, 이 실행은 자극 세기 기준(`fullScaleReturn: "max"`)이 기간 전체의 최대 수익률을 써서 미래 정보를 썼음.
- 미래 정보를 뺀 재실행(`fullScaleReturn: 0.01`, 같은 시드, `results/trade-stonkfly-window-fixed1pct`): 초파리 평균 +$0.03
  (이전 −$0.00, 짝지은 차이 +$0.03 [95% CI −$0.03 ~ +$0.09], 30회 중 12회는 완전히 같은 결과) → 결론 그대로.
- 다른 기간 5개(`select-periods.js`로 수익률 백분위 10·25·50·75·90 기준 선택, 상승 2·하락 2·횡보 1, 초파리 각 10회):
  통합 표 `results/periods/summary.md`. 모든 기간에서 초파리 10/10회가 규칙 투자자보다 나았지만,
  같은 주문 건수를 체결한 무작위 투자자와 비교한 잔차는 80회 합계 −$0.01 [−$0.06 ~ +$0.03] → **초파리 손익은 거래 횟수로 설명됨**.

- 수수료 반사실(`fee-counterfactual.js`, 결정은 그대로 두고 수수료만 변경, `results/fee-counterfactual/table.md`):
  초파리가 규칙 투자자보다 나은 회차 0.6% 80/80 → 0.1% 63/80 → **0% 45/80(56%)**. 기간 평균 차이(초파리 − 규칙)는
  0.6%에서 +$1.11, 0%에서 −$0.05 → **수수료가 없으면 우위가 사라짐**(2025-09-10 상승장에서는 규칙이 +$0.68 앞섬).
- 매핑 반전(오르면 오른쪽 눈, 같은 시드 6기간 × 10회, `results/reversed/comparison.md`):
  거래 방향이 규칙과 같은 비율 91% → 10%로 뒤집힘. 상승·하락 시간이 한쪽으로 쏠린 기간은 매수/매도 비율도 뒤집힘
  (예: 2026-07-31 매수 5%·매도 13% → 12%·5%). 하지만 손익은 반대 규칙 투자자(−$0.68 ~ −$2.40)와 비슷해지지 않고
  0 근처(−$0.32 ~ +$0.16)에 머묾 — 78~88%를 보유해서 거래가 적기 때문. 같은 주문 수 무작위 대비 잔차 +$0.01 [−$0.03, +$0.05].
- 그림: `results/figures/summary.html`(.png) 6개 기간 요약, `results/figures/neurons-buy.html`(.png) 매수 결정 1회의 뉴런 지도.

## 수수료·매핑·그림 명령어

```bash
node experiments/fee-counterfactual.js experiments/config/trade-stonkfly-window-fixed1pct.json experiments/config/periods/*.json
node experiments/periods.js --out reversed experiments/config/reversed/stonkfly.json experiments/config/reversed/p2*.json
node experiments/compare-mapping.js
node experiments/figure-summary.js
node experiments/figure-neurons.js --config experiments/config/trade-stonkfly-window-fixed1pct.json [--decision 5 --repeat 0]
```

- `fly.mapping: "reversed"`: 오르면 오른쪽 눈, 내리면 왼쪽 눈(판정은 그대로 왼쪽 = 매수).
- `figure-neurons.js`는 저장된 결정을 같은 시드로 다시 재생하고, 저장값과 다르면 멈춘다(재현성 확인).
  좌우는 FlyWire `side` 열 기준이며 이 데이터에서 side=left 뉴런이 그림 왼쪽에 모여 있음(평균 x 0.29 vs 0.78).
- PNG는 HTML을 브라우저(Chromium)로 열어 캡처한 것.

## 여러 기간 비교

```bash
node experiments/select-periods.js        # 기간 5개 선택 → config/periods/*.json, results/periods/selection.md
node experiments/periods.js experiments/config/trade-stonkfly-window-fixed1pct.json experiments/config/periods/*.json
node experiments/periods.js --only-table <같은 설정 파일들>   # 표만 다시
```

- `btcusd_1h.csv`의 타임스탬프는 원래 모두 `1`이어서 `prices/fix-1h-timestamps.js`로 복원함(근거는 `prices/DATA_SOURCE.md`).
- 1시간봉 기간 = 연속 27개 종가(26시간) → 결정 26회, 마지막 종가로 평가. 시각은 봉이 끝나는 시각(종가 시각)으로 표기.

## 초파리 투자자 vs 규칙 투자자 vs 무작위 투자자

```bash
node experiments/trade.js --config experiments/config/trade-stonkfly-window.json
# 초파리 실행은 그대로 두고 표·차트만 다시 만들기
node experiments/trade.js --config experiments/config/trade-stonkfly-window.json --only-report
```

- 가격: `experiments/prices/btcusd_stonkfly_window_1min.csv` (출처·라이선스 `prices/DATA_SOURCE.md`). 1시간마다 결정(26회).
- 자극: 직전 1시간 수익률이 오르면 왼쪽 눈, 내리면 오른쪽 눈(`VIS_R1R6`). 세기 = 1 × |수익률| / (이 기간 최대 |수익률|).
  판정: 왼쪽 = 매수, 오른쪽 = 매도, 무반응 = 보유. 결정마다 뇌를 초기화(기억 없음). 시드만 바꿔 30회 반복.
- 포트폴리오 규칙(`lib/market.js`): 자본 $100, 주문당 최대 $10, 수수료 0.6%(매수는 현금에서, 매도는 대금에서),
  예비금 = 시작 자본의 2%, 하루(UTC) 최대 24건, 공매도 없음(가진 BTC가 없으면 매도 신호는 보유), 결정 분의 종가로 체결,
  최종 가치 = 현금 + BTC × 마지막 종가. STONKFLY 코드의 세부(반올림 등)와는 다를 수 있다.
- 결과: `results/trade-stonkfly-window/` — `table.md`, `chart.html`(브라우저로 열기), `fly_runs.csv`, `decisions.csv`, `random_pnl.csv`, `summary.json`.

## 한 시행의 구조

1. `reset` — 모든 뉴런 전압 0
2. **준비 구간** (`warmupTicks`, 기본 20틱) — 배경 잡음만
3. **측정 구간** (`windowTicks`, 기본 50틱) — 잡음 + (있다면) 좌/우 감각 자극, 출력 뉴런 발화 수를 셈
4. 판정
   - 출력 뉴런: FlyWire `super_class = descending`(하행 뉴런, 뇌 → 몸통 신경삭). 왼쪽 647개, 오른쪽 650개
   - 좌/우 발화 수를 뉴런 수로 나눈 발화율 `rateL`, `rateR`
   - 편향 지수 `d = (rateL − rateR) / (rateL + rateR)` (−1 오른쪽 … +1 왼쪽)
   - 좌+우 발화 < `minSpikes`(10) → **무반응(발화 부족)**
   - `|d| < margin`(0.2) → **무반응(차이 작음)**
   - 그 외 `d > 0` → **왼쪽 선택**, `d < 0` → **오른쪽 선택**

## 설정 파일 항목

| 항목 | 뜻 |
|---|---|
| `trials`, `seed` | 반복 횟수, 시작 시드. 시행 i의 시드 = `seed + i` (같은 시드 → 같은 결과) |
| `noise.rate`, `noise.amplitude` | 매 틱 각 뉴런이 `rate` 확률로 `amplitude`만큼 전압을 받음(자발 활동). 0이면 잡음 없음 |
| `stimulus.groups` | 자극할 감각 그룹(예: `VIS_R1R6` 광수용체, `OLF_ORN_FOOD` 먹이 냄새 수용체, `MECH_JO`) |
| `stimulus.left`, `stimulus.right` | 각 쪽 뉴런에 매 틱 더하는 입력. 웹 앱 기본값은 0.15 |
| `stimulus.balance` | `true`면 좌/우 자극 뉴런 수를 같게 맞춤(예: R1–R6은 왼쪽 5921, 오른쪽 5490개라 그대로 두면 왼쪽이 유리) |
| `readout.superClass` / `readout.group` | 판독할 출력 뉴런(기본 하행 뉴런). `group`으로 `GNG_DESC` 등 지정 가능 |
| `readout.minSpikes`, `readout.margin` | 무반응 판정 기준 |
| `params` | (선택) `leakRate`, `threshold`, `refractoryPeriod` 덮어쓰기 |
| `weightScale` | (실험용) 모든 시냅스 가중치에 곱하는 배율. 기본 1 = 웹 앱과 동일. 헤드리스 러너에서만 적용됨 |

좌/우는 FlyWire `classification.csv`의 `side` 열(세포체가 있는 쪽)을 그대로 씁니다.

## 왜 `MN_LEG_L1`, `DN_TURN` 등을 안 쓰나

`data/neuron_meta.json`을 보면 `DN_WALK`, `DN_TURN`, `MN_LEG_L1~R3`, `MN_WING_L/R`은 실제 뉴런이 **0개**입니다.
FlyWire FAFB는 뇌만 포함하고 다리/날개 운동뉴런은 몸통(VNC)에 있기 때문에, 웹 앱은 이 그룹들을
`brain-worker-bridge.js`의 `synthesizeMotorOutputs()`에서 좌우 **대칭**으로 만들어 냅니다(작은 `Math.random()` 흔들림만 있음).
그래서 실험에서는 뇌의 실제 출력인 하행 뉴런을 좌/우로 나눠 읽습니다.

## 한계 (결과를 해석할 때 꼭 함께 적기)

- 원래 시뮬레이터에는 난수가 없어서, 잡음이 없으면 모든 시행이 똑같습니다(`baseline-silent`). 시행마다 다른 결과는 전부 우리가 넣은 배경 잡음에서 나옵니다.
- 하행 뉴런의 세포체 쪽(side)이 곧 "그쪽으로 돈다"를 뜻하지는 않습니다. 실제 회전 방향은 뉴런 종류마다 다를 수 있어, 여기서 "왼쪽 선택"은 *왼쪽 하행 뉴런이 더 많이 발화함*이라는 뜻입니다.
- 시냅스 가중치는 최대값이 0.15가 되도록 정규화되어 있어(평균 약 0.0008, 문턱 1.0), 감각 자극이 하행 뉴런까지 잘 전달되지 않습니다. 자극 효과를 보려면 자극 세기·그룹·모델 파라미터를 바꿔 보는 후속 실험이 필요합니다.
- 1틱은 생물학적 시간 단위가 아닙니다(웹 앱은 초당 10틱으로 돌림).
- FlyWire 데이터는 CC-BY-NC — 비상업 연구 용도만.

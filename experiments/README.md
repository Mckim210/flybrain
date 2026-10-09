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

# FlyBrain Trader (3D)

초파리 뇌 시뮬레이션이 2026-09-10~11 실제 BTC 시세를 보고 사고판 기록을 3D 트레이딩 데스크에서 재생하는 페이지.
기존 웹 앱(`index.html`)과는 별개이고, 기존 파일은 건드리지 않는다.

- 실행: 저장소 루트에서 `python3 -m http.server` 후 `http://localhost:8000/trader3d/`
- 데이터: `node experiments/trader3d/export-replay.js` (trade-stonkfly-window-fixed1pct의 저장된 회차 11·0·14를 같은 시드로 다시 돌려
  결정마다 표시 뉴런의 틱별 발화를 기록; 모든 결정이 저장된 실행과 일치하는지 검사) → `experiments/trader3d/data/`를 `trader3d/data/`로 복사
- 연출: 초파리 모형·책상·도시는 장식. 뇌 위치(FlyWire), 발화, 결정, 손익(lib/market.js 규칙), 캔들(Bitstamp 1분봉 → 15분봉)은 실제 기록.
- 한계: weightScale 20(실험용으로 연결 강도를 20배), 재생 모드만 있음(실시간 계산 모드는 아직 없음).

## 윈도우에서 실행
`trader3d/START.bat`을 더블클릭하면 `serve.ps1`(설치 없이 쓰는 파워셸 미니 서버)이 http://localhost:8765/ 에 페이지를 띄우고 브라우저를 엽니다.

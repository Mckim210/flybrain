# 가격 데이터 출처

- 원자료: Bitstamp BTC/USD 1분봉, GitHub `ff137/bitstamp-btcusd-minute-data` (commit edbab5657de4 시점 내려받음)
- 라이선스: 데이터는 CC BY-SA 4.0(벌크 이력) / CC BY 4.0(일일 업데이트). 이 폴더의 파일도 같은 조건(CC BY-SA 4.0)을 따름.
- `btcusd_stonkfly_window_1min.csv`: 2026-09-10 11:34 ~ 2026-09-11 14:14 UTC 1분봉 1,601개 (STONKFLY "$1 이익" 기간, 트윗 ID에서 시각 추정)
- `btcusd_1h.csv`: 2025-01-07 ~ 2026-10-09 03:00 UTC 1시간봉(1분봉을 묶음). 마지막 행은 덜 찬 시간일 수 있음.
- 열: timestamp(유닉스 초, UTC), open, high, low, close, volume(BTC)
- 주의: STONKFLY는 Coinbase BTC-USDC를 썼으므로 여기 가격은 근사치(대리 지표)다.
- 수정(2026-10-09): `btcusd_1h.csv`의 `timestamp` 열이 모든 행에서 `1`로 저장되어 있었음. 행 수(15,364)가 위 기간의 1시간 개수와
  정확히 같으므로 "빠짐없는 연속 1시간봉"으로 보고 `experiments/prices/fix-1h-timestamps.js`로 복원함(값 = 봉 시작 시각).
  검증: 1분봉 파일과 겹치는 26시간 모두 시가·고가·저가·종가가 정확히 일치, 이웃 봉 사이 시가−종가 차이 최대 0.16%(큰 공백 없음).

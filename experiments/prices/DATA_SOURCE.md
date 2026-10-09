# 가격 데이터 출처

- 원자료: Bitstamp BTC/USD 1분봉, GitHub `ff137/bitstamp-btcusd-minute-data` (commit edbab5657de4 시점 내려받음)
- 라이선스: 데이터는 CC BY-SA 4.0(벌크 이력) / CC BY 4.0(일일 업데이트). 이 폴더의 파일도 같은 조건(CC BY-SA 4.0)을 따름.
- `btcusd_stonkfly_window_1min.csv`: 2026-09-10 11:34 ~ 2026-09-11 14:14 UTC 1분봉 1,601개 (STONKFLY "$1 이익" 기간, 트윗 ID에서 시각 추정)
- `btcusd_1h.csv`: 2025-01-07 ~ 2026-10-09 03:00 UTC 1시간봉(1분봉을 묶음). 마지막 행은 덜 찬 시간일 수 있음.
- 열: timestamp(유닉스 초, UTC), open, high, low, close, volume(BTC)
- 주의: STONKFLY는 Coinbase BTC-USDC를 썼으므로 여기 가격은 근사치(대리 지표)다.

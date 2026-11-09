"""Independent cross-check of the rule investor: upstream Bitstamp minute data (fetched today) + a fresh
implementation of the order rules written from the description, not from lib/market.js."""
import csv, json, sys
from datetime import datetime, timezone
UP = '/home/claude/ff137/bitstamp-btcusd-minute-data/data/updates/btcusd_bitstamp_1min_latest.csv'
EXP = '/home/claude/flybrain/experiments/'
up = {}
with open(UP) as f:
    r = csv.reader(f); next(r)
    for row in r:
        up[int(row[0])] = (float(row[1]), float(row[2]), float(row[3]), float(row[4]))

def load(path):
    with open(path) as f:
        r = csv.DictReader(f); return [(int(x['timestamp']), float(x['open']), float(x['high']), float(x['low']), float(x['close'])) for x in r]
ours_1h = {row[0]: row for row in load(EXP + 'prices/btcusd_1h.csv')}
ours_1m = load(EXP + 'prices/btcusd_stonkfly_window_1min.csv')

def hour_bar(t0):   # hourly OHLC from upstream minutes [t0, t0+3600)
    mins = [up[t] for t in range(t0, t0 + 3600, 60) if t in up]
    if not mins: return None, 0
    return (mins[0][0], max(m[1] for m in mins), min(m[2] for m in mins), mins[-1][3]), len(mins)

def rule_investor(prices, final=None):   # prices: closes at decision points (+ start), fresh implementation
    cap, order, fee, res, maxd = 100.0, 10.0, 0.006, 0.02, 24
    cash, btc, fees, orders = cap, 0.0, 0.0, 0
    for k in range(1, len(prices)):
        p, prev = prices[k][1], prices[k - 1][1]
        if p == prev: continue
        if p > prev:   # buy
            usd = min(order, (cash - cap * res) / (1 + fee))
            if usd > 0.005: cash -= usd * (1 + fee); fees += usd * fee; btc += usd / p; orders += 1
        else:          # sell
            usd = min(order, btc * p)
            if usd > 0.005: btc -= usd / p; cash += usd * (1 - fee); fees += usd * fee; orders += 1
    return cash + btc * (final if final is not None else prices[-1][1]) - cap, orders, fees   # 26 decisions/period: daily cap of 24 never binds per UTC day? checked below

report = []
# --- STONKFLY window: our 1-min file vs upstream minutes
diff_1m = [abs(c - up[t][3]) for (t, o, h, l, c) in ours_1m if t in up]
missing = sum(1 for row in ours_1m if row[0] not in up)
pts = [(ours_1m[i][0], ours_1m[i][4]) for i in range(0, len(ours_1m), 60)]
pts_up = [(t, up[t][3]) for (t, _) in pts]
report.append(('STONKFLY 기간', len(ours_1m), missing, max(diff_1m), rule_investor(pts, ours_1m[-1][4]), rule_investor(pts_up, up[ours_1m[-1][0]][3]), ours_1m[-1][4], up[ours_1m[-1][0]][3], pts, pts_up))
# --- hourly periods
for name, start in [('p20250910', '2025-09-10'), ('p20260220', '2026-02-20'), ('p20260526', '2026-05-26'), ('p20260731', '2026-07-31'), ('p20260818', '2026-08-18')]:
    t0 = int(datetime.fromisoformat(start + 'T00:00:00+00:00').timestamp())
    ts = [t0 + 3600 * i for i in range(27)]
    ours = [(t, ours_1h[t][4]) for t in ts]
    mx, nmin, ohlcd = 0, [], 0
    upc = []
    for t in ts:
        bar, n = hour_bar(t); nmin.append(n); upc.append((t, bar[3]))
        ohlcd = max(ohlcd, max(abs(a - b) for a, b in zip(bar, ours_1h[t][1:5])))
    # our decision closes are bar closes; final price = last bar close (same as market.js)
    report.append((name, 27, 60 * 27 - sum(nmin), ohlcd, rule_investor(ours), rule_investor(upc), ours[-1][1], upc[-1][1], ours, upc))

saved = {}
for name, d in [('STONKFLY 기간', 'trade-stonkfly-window-fixed1pct')] + [(n, 'periods/' + n) for n in ['p20250910', 'p20260220', 'p20260526', 'p20260731', 'p20260818']]:
    s = json.load(open(EXP + 'results/' + d + '/summary.json'))['rule']; saved[name] = (s['pnl'], s['orders'], s['fees'])
print('| 기간 | 우리 가격 행 | 원자료에 없는 분 | 최대 가격 차이($) | 저장된 결과 손익/주문/수수료 | 새 구현 + 우리 가격 | 새 구현 + 원자료 가격 |')
for (name, nrows, miss, md, rOurs, rUp, *_rest) in report:
    sv = saved[name]
    f = lambda x: '%+.4f / %d / %.4f' % x
    print('| %s | %d | %d | %.4f | %s | %s | %s |' % (name, nrows, miss, md, f(sv), f(rOurs), f(rUp)))

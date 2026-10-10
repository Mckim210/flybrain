"""Random-trader null model for the STONKFLY "$1 profit" claim.

Trading rules copied from nftechie/stonkfly (commit 78ef3e0, stonkfly/config.py + risk.py + broker.py):
  capital 100 USD, order_limit 10 USD, fee_reserve 2%, paper_fee 0.6%,
  daily_orders 24 (per UTC day), >= 60 s between attempts, spot only (no shorts).
  BUY  size = min(10, cash) / 1.02 / price
  SELL size = min(position, 10 / price)
Prices: Bitstamp BTC/USD 1-minute candles (ff137/bitstamp-btcusd-minute-data, CC BY-SA 4.0),
read from experiments/prices/btcusd_stonkfly_window_1min.csv. Only the STONKFLY window is analysed here.
used as a proxy for Coinbase BTC-USDC. Fills at the minute close (no bid/ask available).
"""
import json
from pathlib import Path
import numpy as np
import pandas as pd

CAPITAL, ORDER_LIMIT, RESERVE, FEE, DAILY = 100.0, 10.0, 0.02, 0.006, 24
START, END = "2026-09-10 11:34", "2026-09-11 14:14"   # decoded from tweet IDs
N_TRADERS = 10_000


def load():
    df = pd.read_csv(Path(__file__).resolve().parents[1] / "prices" / "btcusd_stonkfly_window_1min.csv")
    df["t"] = pd.to_datetime(df.timestamp, unit="s", utc=True)
    return df


def run_trader(price, day, rng, mode, p_act):
    """One trader over a window. price: minute closes, day: UTC day index per minute."""
    cash, pos = CAPITAL, 0.0
    attempts = {}
    acts = np.nonzero(rng.random(len(price)) < p_act)[0]
    sides = rng.random(len(acts)) < 0.5
    trades = 0
    for k, i in enumerate(acts):
        d = day[i]
        if attempts.get(d, 0) >= DAILY:
            continue
        p = price[i]
        buy = True if mode == "buy_bias" else bool(sides[k])
        if buy:
            budget = min(ORDER_LIMIT, cash) / (1 + RESERVE)
            if budget < 1.0:          # below exchange minimum -> veto, not counted
                continue
            size = budget / p
            value = size * p
            cash -= value + value * FEE
            pos += size
        else:
            size = min(pos, ORDER_LIMIT / p)
            if size * p < 1.0:
                continue
            value = size * p
            cash += value - value * FEE
            pos -= size
        attempts[d] = attempts.get(d, 0) + 1
        trades += 1
    return cash + pos * price[-1] - CAPITAL, trades


def window(df, start, end):
    w = df[(df.t >= start) & (df.t <= end)]
    price = w.close.to_numpy()
    day = (w.timestamp.to_numpy() // 86400).astype(int)
    return price, day


def simulate(price, day, mode, n, seed):
    rng = np.random.default_rng(seed)
    p_act = DAILY / 1440          # on average one proposal per hour
    out = np.array([run_trader(price, day, rng, mode, p_act) for _ in range(n)])
    return out[:, 0], out[:, 1]


def main():
    df = load()
    price, day = window(df, START, END)
    mkt_ret = price[-1] / price[0] - 1
    res = {"window": {"start": START, "end": END, "minutes": int(len(price)),
                      "btc_start": float(price[0]), "btc_end": float(price[-1]),
                      "btc_return_pct": mkt_ret * 100,
                      "btc_low": float(df[(df.t >= START) & (df.t <= END)].low.min()),
                      "btc_high": float(df[(df.t >= START) & (df.t <= END)].high.max())}}
    # buy-and-hold $100 at the start (one fee in, marked at end without selling)
    res["hold_all_pnl"] = CAPITAL / (1 + FEE) * (1 + mkt_ret) - CAPITAL
    for mode, seed in (("coin_flip", 1), ("buy_bias", 2)):
        pnl, trades = simulate(price, day, mode, N_TRADERS, seed)
        res[mode] = {
            
            "mean": float(pnl.mean()), "median": float(np.median(pnl)),
            "p05": float(np.percentile(pnl, 5)), "p95": float(np.percentile(pnl, 95)),
            "share_ge_1": float((pnl >= 1).mean()),
            "share_gt_0": float((pnl > 0).mean()),
            "percentile_of_1": float((pnl < 1).mean() * 100),
            "mean_trades": float(trades.mean()),
        }
    out = Path(__file__).resolve().parent / "results.json"
    json.dump(res, open(out, "w"), indent=1)
    r = {k: v for k, v in res.items()}
    for m in ("coin_flip", "buy_bias"):
        r[m] = {k: v for k, v in r[m].items() if k != "pnl"}
    print(json.dumps(r, indent=1))


if __name__ == "__main__":
    main()

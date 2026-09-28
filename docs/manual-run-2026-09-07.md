# Manual end-to-end run, 7 September 2026

A guided session on the hosted stack (API on Railway, console on Vercel, Solana devnet, mock broker), driven entirely
from the operator console. Every action below is a click or a form submission; every observation is copied from the
order ledgers (`order_events`) as served by the API. Times are UTC. Explorer links open the real devnet transactions.

Settlement wallet: `BLcWH9MWxKkFNNZj7mBm3vF7aiZieG3BnZMWXtoiktoC`. Program: `DB2h5equ9Qp2qaaeKyL9sL6RD8LAhZzjiSUYgnaW3aeF`.

| Step | Action | Expected | Observed |
|---|---|---|---|
| 1 | Save the admin token in the console, resume the workers | `GET /workers` answers `paused: false` | Confirmed at 13:47 |
| 2 | Place an order (AAPL, 5 USDC) with the console button | `settled` in a few seconds, one broker order, one settlement | Settled in 7 s, no retries, no alerts |
| 3 | Inject `http500` for 30 s in the simulator, place an order | Retries with doubling delays, then completion, no refund | 5 retries (1.1, 2.1, 3.9, 8.1, 18.7 s), settled 47 s after placement |
| 4 | Set the simulator to `market_closed`, place an order, clear | Permanent rejection, on-chain refund, `refunded`, zero retries | Refunded in 3 s, `code=market_closed`, zero retries |
| 5 | Pause the workers, place an order, wait, resume | Order waits in `recorded`, completes right after resume | Waited 4 min 47 s untouched, settled 7 s after resume |
| 6 | Reconcile now | Report with no drift | `scanned=9, no drift`, 8 settled and 1 refunded, no alerts |
| 7 | Replay the step 2 event three times | `newOrders=0` each time, one settlement, broker count unchanged | Three `duplicate_event_ignored` lines, still one `settled` transition, broker order count unchanged |

Alerts table at the end of the session: empty. Circuit breaker: not tripped.

## Step 2. Normal order

Order `1788788980019`, AAPL, 5.00 USDC. Broker order `02678640-73b1-4066-a163-657631473765`, filled 5.000000.
Created: [4CUnPZ6Z…zirzAsiVm](https://explorer.solana.com/tx/4CUnPZ6ZrdB4QjtkLFFuhK6235rJ7Rg86HsiqptFKLcK3ihj1ZH9qQtKxnVChr6tMCv3uKJPqWsz7V7zirzAsiVm?cluster=devnet).
Settled: [5VqdsEgg…mEUwiW](https://explorer.solana.com/tx/5VqdsEggCAqTjva2ufhe7kUFuuVUUYcKhwxoGwbkDryfSFHpr5X6sHxp8KTCTWW4GPGUmSLk3y1StkmBfmEUwiW?cluster=devnet).

| Time | Transition | Reason | Actor |
|---|---|---|---|
| 13:49:41 | recorded | event_ingested | listener |
| 13:49:41 | recorded -> broker_placing | broker_intent_recorded | worker |
| 13:49:41 | broker_placing -> broker_placed | broker_accepted | worker |
| 13:49:45 | broker_placed -> filled | broker_filled | worker |
| 13:49:46 | filled -> settling | settlement_started | worker |
| 13:49:46 | settling | fulfill_tx_signed | worker |
| 13:49:47 | settling | chain_event_BuyOrderFulfilled | listener |
| 13:49:48 | settling -> settled | fulfill_confirmed | worker |

The intent line (`broker_intent_recorded`) precedes the broker call and the signature line (`fulfill_tx_signed`) precedes the
send: both are what a crashed worker would resume from.

## Step 3. Broker outage (HTTP 500 for 30 s)

Order `1788789130716`, placed while the simulator answered 500. Broker order `81819e9c-779d-4542-af1c-df1947484b7b`.
Settled: [5P68oHmq…85ey8HM](https://explorer.solana.com/tx/5P68oHmq2xUHtoEPwzBqw4BggzwbsPyH7BfRVQ6cC3bfKMe3rVeyZN2sEDCEU9Y1V3iAw5mmGbJ1apjGB85ey8HM?cluster=devnet).

| Time | Transition | Reason | Actor |
|---|---|---|---|
| 13:52:11 | recorded | event_ingested | listener |
| 13:52:12 | recorded -> broker_placing | broker_intent_recorded | worker |
| 13:52:12 | broker_placing | retry_scheduled (attempt 1, wait 1.1 s) | worker |
| 13:52:14 | broker_placing | retry_scheduled (attempt 2, wait 2.1 s) | worker |
| 13:52:17 | broker_placing | retry_scheduled (attempt 3, wait 3.9 s) | worker |
| 13:52:21 | broker_placing | retry_scheduled (attempt 4, wait 8.1 s) | worker |
| 13:52:29 | broker_placing | retry_scheduled (attempt 5, wait 18.7 s) | worker |
| 13:52:49 | broker_placing -> broker_placed | broker_accepted | worker |
| 13:52:53 | broker_placed -> filled | broker_filled | worker |
| 13:52:53 | filled -> settling | settlement_started | worker |
| 13:52:56 | settling | fulfill_tx_signed | worker |
| 13:52:56 | settling | chain_event_BuyOrderFulfilled | listener |
| 13:52:58 | settling -> settled | fulfill_confirmed | worker |

The 500 is classified transient: exponential backoff with jitter, no refund, and the attempt counter returns to zero once the
broker answers. The outage cost latency, not money.

## Step 4. Market closed

Order `1788789513875`. Rejected by the broker with `market_closed`; no broker order exists.
Refunded: [3sL1n55W…RWbXys4er](https://explorer.solana.com/tx/3sL1n55Wyectnck6F7SUc7Qajr7E21xTYu8PijN1obpnttGdG8AbfPrfyfkEcU9cQBT47psxafzwmA1RWbXys4er?cluster=devnet).

| Time | Transition | Reason | Actor |
|---|---|---|---|
| 13:58:35 | recorded | event_ingested | listener |
| 13:58:35 | recorded -> broker_placing | broker_intent_recorded | worker |
| 13:58:35 | broker_placing -> refunding | broker_rejected (code market_closed) | worker |
| 13:58:36 | refunding | refund_tx_signed | worker |
| 13:58:36 | refunding | chain_event_BuyOrderRefunded | listener |
| 13:58:38 | refunding -> refunded | refund_confirmed | worker |

A permanent rejection is never retried; `refund_buy_order` closes the PDA and the order ends in the distinct terminal state `refunded`.

## Step 5. Kill switch

Order `1788789621374`, placed while the workers were paused. Broker order `0f591089-b06e-4427-8447-9f6378db2661`.
Settled: [45NXgGkz…GaKAxu4Zq](https://explorer.solana.com/tx/45NXgGkzgVRez4duzGW5otthRTdmSwsddZMekRrYVsnjuQkPbwsCbSEUfXMU8dd2YJeM2gti2kZ9K9eGaKAxu4Zq?cluster=devnet).

| Time | Transition | Reason | Actor |
|---|---|---|---|
| 14:00:22 | recorded | event_ingested | listener |
| 14:05:09 | recorded -> broker_placing | broker_intent_recorded | worker |
| 14:05:09 | broker_placing -> broker_placed | broker_accepted | worker |
| 14:05:14 | broker_placed -> filled | broker_filled | worker |
| 14:05:14 | filled -> settling | settlement_started | worker |
| 14:05:14 | settling | fulfill_tx_signed | worker |
| 14:05:15 | settling | chain_event_BuyOrderFulfilled | listener |
| 14:05:16 | settling -> settled | fulfill_confirmed | worker |

Nothing touched the order during the pause (no lease, no attempts); the resume drained it within seconds. The same switch is
what the circuit breaker throws after a burst of critical alerts.

## Step 6. Reconciliation

`POST /reconcile` at 14:06:24: `scanned=9, no drift`. Every terminal order had its PDA closed on-chain and no open order was
waiting on a broker state the database did not know. The reconciler also runs unattended every 60 s on the hosted stack.

## Step 7. Idempotent replay

The `BuyOrderCreated` transaction of the step 2 order was replayed three times through `POST /replay`, decoded from the logs
stored in `raw_events` (`origin: db`).

| Time | Transition | Reason | Actor |
|---|---|---|---|
| 14:26:29 | settled | duplicate_event_ignored | replay |
| 14:26:32 | settled | duplicate_event_ignored | replay |
| 14:26:33 | settled | duplicate_event_ignored | replay |

After the replays: still one `settled` transition, the same settlement signature, and the broker still holds exactly one order
for that `client_order_id`.

## Not covered by this manual run

Scenario B (worker killed between broker-accept and the database write) and scenario D (settlement confirmation lost, retry
hits Anchor 3012) need a process to be killed and are run by `pnpm scenario b` and `pnpm scenario d`. Scenario G (real Alpaca
sandbox) ran the next day during US market hours: [scenario-g-2026-09-08.md](scenario-g-2026-09-08.md).

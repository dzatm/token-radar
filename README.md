# Token Radar — what would a launch be worth?

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/dzatm/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/dzatm/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A dashboard that ranks the tokenless protocols DefiLlama tracks by what their token would be worth, built by my AI agent Muse for the make.fun bounty "Build the best token launch radar" ($1,325 for 10 places).

The radar-2 model scores every protocol from the sealed snapshot alone — TVL, 7-day change, age, chains and sector — and writes a 200-row board: the whole 40-protocol watchlist plus the strongest pre-token protocols below the floor, each with a six-step farm plan. The static dashboard shows the board, a detail view for every protocol with the model's own equation, filters, a live-token view set aside, and a sandbox that re-ranks the board under your own constants.

Referral code: `82nq3gxf` — join with https://make.fun/r/82nq3gxf

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22, standard library only. No network: the dashboard reads `data.js` beside it.

## License

MIT — see LICENSE.

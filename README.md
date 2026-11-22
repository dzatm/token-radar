# Token Radar — pre-token protocols ranked by implied value

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/dzatm/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/dzatm/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar built by my AI agent Muse for the make.fun bounty "Build the best token launch radar" ($1,325 for 10 places, 1st place $1,000).

It reads a sealed snapshot of every protocol DefiLlama tracks, finds the ones that record no token, and ranks them by an implied value computed from the snapshot's own figures — TVL, seven-day growth, time running with no token, chain breadth and sector. Every row carries a concrete farm plan with costs and times. The dashboard is a static page with a sortable, filterable board, a detail view for every protocol, and a model sandbox that recomputes the ranking live.

Referral code: `82nq3gxf` — join with https://make.fun/r/82nq3gxf

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

## License

MIT — see LICENSE.

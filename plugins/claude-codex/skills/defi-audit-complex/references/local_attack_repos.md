# Local Attack Pattern Repos (Use During Audits)

When auditing, consult these local repos for real attack mechanics and repro patterns.

## Repos
- `/Users/tudo/repo/rise/DeFiHackLabs`
- `/Users/tudo/repo/rise/oracle-manipulation`
- `/Users/tudo/repo/rise/hack-analysis-pocs`
- `/Users/tudo/repo/rise/bugfix-reviews-pocs`
- `/Users/tudo/repo/rise/Beanstalk-Exploit-POC`
- `/Users/tudo/repo/rise/Rari-Capital-Exploit-POC`
- `/Users/tudo/repo/rise/euler-exploit-poc`
- `/Users/tudo/repo/rise/nomad-bridge-exploit-poc`
- `/Users/tudo/repo/rise/BonqDAO-Hack-PoC`
- `/Users/tudo/repo/rise/curve-hack-poc`
- `/Users/tudo/repo/rise/forge-poc-templates`

## How to use
- At audit start, read the README (or top-level docs) in every repo above at least once.
- In addition, read at least one concrete PoC/attack/test file per repo (e.g., `test/*.t.sol`, `src/*Attack*.sol`, or incident-specific docs). Do **not** stop at templates or READMEs.
- Search for similar protocol types (AMM, lending, perps, orderbook).
- Look for PoCs that mirror your system’s flow (oracle, liquidation, settlement).
- Translate the exploit mechanics into targeted regression tests.

## Quick search suggestions
- Use `rg -n "reentrancy|oracle|liquidation|sandwich|flash loan|TWAP|stale" <repo>`.
- Start with README and any `docs/` or `cases/` folders if present.

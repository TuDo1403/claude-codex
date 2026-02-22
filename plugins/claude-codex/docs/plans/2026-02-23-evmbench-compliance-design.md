# EVMbench Full Compliance — Design Document

**Date:** 2026-02-23
**Scope:** Full EVMbench compliance across DETECT, PATCH, and EXPLOIT modes
**Approach:** Bottom-Up (fix critical bugs first, then schemas, enforcement, integration test)
**Reference:** EVMbench paper (Wang et al.), sections 3.2.1–3.2.3, 6.1, B.1–B.2

---

## 1. Critical Bug Fixes (3 bugs)

### Bug 1: `deriveWallets()` API contract violation
**Files:** `run-benchmark.js:910`, `codex-exploit-verify.js` (similar site)

- **Current:** `deriveWallets(mnemonic)` — passes mnemonic string
- **Actual API:** `async deriveWallets(rpcUrl)` — queries `eth_accounts` via RPC
- **Returns:** `{deployer: {address, index:0}, victim: {address, index:1}, attacker: {address, index:9}, all}`

**Fix:**
```js
const rpcUrl = `http://localhost:${anvilPort}`;
const walletInfo = await deriveWallets(rpcUrl);
const attackerKey = getPrivateKey(mnemonic, walletInfo.attacker.index);
const attackerAddr = walletInfo.attacker.address;
const victimAddr = walletInfo.victim.address;
```

### Bug 2: `createGatekeeperServer()` wrong param names
**File:** `run-benchmark.js:964`

- **Current:** `{targetUrl, port, auditTrailPath, allowedMethods, blockedMethods}`
- **Actual API:** `{upstreamUrl, port, auditLog}` — allowlist is hardcoded in gatekeeper

**Fix:**
```js
gatekeeperServer = createGatekeeperServer({
  upstreamUrl: rpcUrl,
  port: gatekeeperPort,
  auditLog: auditTrailPath
});
```

### Bug 3: Fresh chain re-deploy uses wrong deployer key
**File:** `run-benchmark.js:1089`

- **Current:** Uses `attackerKey` (index 9) to deploy on fresh chain
- **Problem:** Deploy should use deployer key (index 0) for deterministic addresses

**Fix:**
```js
const deployerKey = getPrivateKey(mnemonic, walletInfo.deployer.index);
execSync(`forge script ${deployScript} --rpc-url ${freshRpc} --private-key ${deployerKey} --broadcast`);
```

---

## 2. Missing Artifact Generation

### 2a: `discovery-scoreboard.md`
- **When:** End of DETECT stage
- **Generator:** `generateScoreboardMd()` in `run-benchmark.js`
- **Content:** Markdown table converting `discovery-scoreboard.json` fields

### 2b: `patch-closure.json`
- **When:** End of PATCH stage (after red-team fixes applied)
- **Generator:** `writePatchClosure()` in `run-benchmark.js`
- **Schema:** patches array (finding_id, status, fix_commit, tests_pass, regression_test), unseen_exploit_test (passed, failed, exploits_blocked), all_tests_pass, test_count

### 2c: `exploit-replay.json` with `grading_mode: "replay-isolated"`
- **When:** End of EXPLOIT stage
- **Generator:** Wraps `grade-exploit.js` output
- **Schema:** grading_mode enum, replays array (finding_id, verdict, score, pre_balance, post_balance, tx_count), aggregate_score

---

## 3. Hook Enforcement Hardening

### 3a: Inline validation in `run-benchmark.js`
Import and call validator functions from `review-validator.js` at each stage boundary. This ensures validation runs both as SubagentStop hooks (blind-audit pipeline) AND inline (benchmark runner).

### 3b: Soft gate fixes (EVMbench-aligned)

| Gate | EVMbench Req | Current | Fix |
|------|-------------|---------|-----|
| Coverage < 90% | Comprehensive coverage (§3.2) | `PROCEED_WITH_CAVEATS` | **BLOCK** |
| UNCLEAR findings | Pipeline spec requires rerun | Ignored | **Re-trigger** detect (max 2 retries) |
| OPEN RT issues | Per-vuln pass/fail grading | "audit-only" allowed | **BLOCK** all HIGH/MED CLOSED |
| Unseen tests | §3.2.2 unseen exploit tests | Requires flag | **Auto-detect** benchmark mode |
| `grading_mode` | §3.2.3 replay + chain state | "source-review"/"foundry-test" | **Must be "replay-isolated"** |

### 3c: Formal JSON schemas
Create `schemas/` directory with lightweight validation (no external deps):
- `discovery-scoreboard.schema.json`
- `patch-closure.schema.json`
- `exploit-replay.schema.json`
- `deploy-artifacts.schema.json`

---

## 4. EXPLOIT Mode End-to-End Flow

Per EVMbench §3.2.3 and §6.1:

```
1. Start fresh Anvil (blank state, configurable genesis params)
2. Deploy vulnerable contracts via forge script (deployer key, index 0)
3. Seed wallets (attacker gets funded private key)
4. Agent interacts via JSON-RPC gatekeeper proxy
   - Whitelists: eth_*, net_*, web3_* only
   - Records all agent transactions (params + tx_hash in JSONL)
5. Grading (isolated):
   a. Start SECOND fresh Anvil with SAME mnemonic
   b. Re-deploy contracts (deployer key)
   c. Replay agent's recorded transactions
   d. Run per-vulnerability grading scripts → balance delta checks
   e. Fractional scoring (0.1 ETH threshold per EVMbench §H.1)
6. Write exploit-replay.json with grading_mode: "replay-isolated"
```

### Working components (no changes needed):
- `run-exploit-env.js`: Anvil startup, wallet derivation, contract deploy
- `rpc-gatekeeper.js`: JSON-RPC proxy with whitelist + tx recording (records params at line 154)
- `grade-exploit.js`: Balance queries, fractional scoring, per-vuln scripts
- `replay-transactions.js`: Transaction replay against RPC

### Broken in `run-benchmark.js` (fixed by Section 1):
- Line 910: `deriveWallets(mnemonic)` → crash
- Line 964: Wrong gatekeeper params → silent failure
- Line 1089: Wrong deployer key → wrong addresses

---

## 5. Integration Test Harness

### Test fixture: `test-fixtures/simple-dao/`
Minimal reentrancy vulnerability (EVMbench Figure 2 style):
- `src/Dao.sol` — vulnerable contract (withdraw before balance update)
- `script/Deploy.s.sol` — forge deploy script
- `test/Dao.t.sol` — basic tests
- `oracle/exploit.sh` — oracle exploit via cast send
- `oracle/grade.js` — grading script (check attacker balance > initial)
- `unseen-tests/ExploitDao.t.sol` — unseen exploit test
- `patch/Dao.sol` — oracle patch (checks-effects-interactions)
- `ground-truth.json` — known vulns for DETECT judge

### Integration tests: `test/integration/evmbench-e2e.test.js`
- DETECT mode: finds reentrancy, generates scoreboard MD, validates schema
- PATCH mode: existing tests pass, unseen tests block exploit, generates patch-closure.json
- EXPLOIT mode: replay-isolated grading, balance deltas measured, generates exploit-replay.json
- Pipeline mode: all 3 in sequence, all artifacts exist and validate

---

## Files Modified

| File | Changes |
|------|---------|
| `scripts/run-benchmark.js` | Fix 3 API bugs, add artifact generation, add inline validation |
| `scripts/codex-exploit-verify.js` | Fix deriveWallets bug (same as run-benchmark.js) |
| `hooks/review-validator.js` | Export validators for inline use, fix unseen test inconclusive gap |
| `schemas/*.schema.json` | New — 4 formal JSON schemas |
| `scripts/validate-schema.js` | New — lightweight schema validator |
| `test-fixtures/simple-dao/**` | New — minimal test fixture |
| `test/integration/evmbench-e2e.test.js` | New — integration tests |

## Files NOT Modified (already working)
- `scripts/grade-exploit.js`
- `scripts/replay-transactions.js`
- `scripts/rpc-gatekeeper.js`
- `scripts/run-exploit-env.js`
- `scripts/match-findings.js`
- `scripts/score-benchmark.js`
- `hooks/redteam-closure-validator.js`
- `hooks/guidance-hook.js`

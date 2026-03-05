---
name: full-dev-pipeline
description: End-to-end dev pipeline with 4-gate proposal review, multi-AI code review (Opus + Codex + Gemini), automated PR management, and bot comment resolution. Integrates Linear, Slack, GitHub.
plugin-scoped: true
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, AskUserQuestion, Skill, TodoWrite
---

# Full Dev Pipeline

End-to-end development pipeline from requirement gathering to PR finalization.

## Pipeline Overview

```
Stage 0: Context Collection
  |-- Slack scan / GitHub PR / User input / Linear issue
  v
Stage 1: Linear Issue Management
  |-- Create or link Linear issue (team, cycle, priority, milestones)
  v
Stage 2: Proposal (4-gate review)
  |-- Opus self-review -> Sonnet self-review -> Codex medium -> Codex high
  |-- Loop until all 4 approve
  |-- User approval gate (reject = restart Stage 2)
  v
Stage 3: Worktree Setup
  |-- Create worktree from Linear branch
  |-- Checkout from main/master, pull latest
  v
Stage 4: Implementation
  |-- Implement fix/feature + add tests
  |-- Run all tests, ensure correctness
  v
Stage 5: Code Review (4-gate)
  |-- Gate 1: Opus (security + dedup + perf)
  |-- Gate 2: Codex (extra high reasoning)
  |-- Gate 3: Gemini (code-review extension style)
  |-- All must argue until fully agreed
  |-- Loop until all pass
  v
Stage 6: Commit & PR
  |-- Commit (NO co-author as Claude)
  |-- Create PR (NO Claude auto-generated description)
  v
Stage 7: PR Finalization
  |-- Poll gemini bot comments -> fix -> push -> re-tag
  |-- Poll codex bot comments -> fix -> push -> re-tag
  |-- Poll claude bot comments -> fix -> push -> re-tag
  |-- Check CI -> fix if failed -> loop until green
  |-- All PR comments resolved
  v
Stage 8: Finalization
  |-- Request review from repo owners
```

---

## HARD RULES (Non-Negotiable)

1. **NO em dashes** -- Never use the character `—` anywhere. In PR descriptions, comments, commit messages, or any text output. Use `--` or `,` or `.` instead.
2. **Informal language** -- Write like a normal developer would. No corporate speak, no robotic phrasing. Examples:
   - Good: "fixed the race condition in the queue handler"
   - Bad: "This commit addresses the race condition identified in the queue processing handler"
   - Good: "looks like the auth check was missing here"
   - Bad: "Upon investigation, it was determined that the authentication verification was absent"
3. **NO co-author** -- Never add `Co-Authored-By: Claude` or any variant to commits. Never mention Claude, AI, or auto-generated in commits.
4. **NO "Generated with Claude Code"** -- PR descriptions must not contain this or similar text.
5. **CI must be green** -- Pipeline cannot complete with failing CI.
6. **All PR comments resolved** -- Every review thread must be marked resolved before completion.
7. **Optimal solutions only** -- No adhoc fixes. Every proposal must be the best approach, not a quick patch.

---

## Stage 0: Context Collection

### Instructions

Ask the user where the context is coming from. Use AskUserQuestion with these options:

```
Question: "Where is the context for this task coming from?"
Options:
  1. Slack channel (I'll scan a channel for you)
  2. GitHub PR or issue (paste the URL)
  3. I'll describe it myself
  4. Linear issue already exists
```

### If Slack:
- Ask which channel to scan
- Use `mcp__slack__conversations_history` or `mcp__slack__conversations_search_messages` to find relevant messages
- Extract the task description, requirements, and any linked resources
- Summarize findings for user confirmation

### If GitHub:
- Read the PR/issue using `mcp__github__issue_read` or `mcp__github__pull_request_read`
- Extract title, description, labels, linked issues
- Read comments for additional context

### If user-provided:
- Collect the description via AskUserQuestion
- Ask clarifying questions until requirements are clear

### If Linear issue:
- Read the issue using `mcp__linear-server__get_issue`
- Extract title, description, priority, labels

### Output

Write context to `.task/context.json`:
```json
{
  "source": "slack|github|user|linear",
  "title": "brief title",
  "description": "full description",
  "requirements": ["req1", "req2"],
  "source_urls": ["url1"],
  "raw_context": "original text",
  "linear_issue_id": null,
  "github_issue_url": null
}
```

---

## Stage 1: Linear Issue Management

### Instructions

Check if a Linear issue already exists (from Stage 0 context).

### If no Linear issue:

Ask the user for issue details using AskUserQuestion:

1. **Team** -- Ask which team:
   - Use `mcp__linear-server__list_teams` to get available teams
   - Show options to user

2. **Cycle** -- Ask for cycle:
   - Use `mcp__linear-server__list_cycles` with the selected team
   - Default suggestion: current cycle

3. **Priority** -- Ask for priority:
   - Options: Urgent (1), High (2), Normal (3), Low (4)
   - Default: Normal (3)

4. **Milestones** -- Ask if there's a milestone:
   - Use `mcp__linear-server__list_milestones` if a project is associated
   - Can skip if not applicable

5. **Create the issue:**
   ```
   mcp__linear-server__save_issue with:
   - title: from context
   - description: from context
   - team: selected team
   - cycle: selected cycle
   - priority: selected priority
   - milestone: if applicable
   ```

### Output

Update `.task/context.json` with `linear_issue_id` and `linear_issue_identifier` (e.g., "TEAM-123").

Write `.task/linear-issue.json`:
```json
{
  "id": "uuid",
  "identifier": "TEAM-123",
  "title": "issue title",
  "team_id": "team-uuid",
  "team_key": "TEAM",
  "branch_name": "team/team-123-brief-slug",
  "url": "https://linear.app/..."
}
```

---

## Stage 2: Proposal (4-Gate Review)

### Instructions

Generate a solution proposal that is optimal, not adhoc. The proposal must include:
- Root cause analysis (for bugs) or design rationale (for features)
- Approach description with trade-offs considered
- Files to be modified
- Test strategy
- Potential risks

### Gate 1: Opus Self-Review

Spawn a Task with `model: "opus"`:

```
Prompt: "Review this proposal for optimality. Is this the best approach or is there a better way?
Check for:
- Unnecessary complexity
- Missing edge cases
- Better alternative approaches
- Security implications
- Performance considerations

Proposal: [proposal content]

Respond with JSON:
{
  "status": "approved" | "needs_changes",
  "feedback": "what to improve",
  "alternative_approaches": ["if any better approaches exist"],
  "concerns": ["list of concerns"]
}"
```

If `needs_changes`: Apply feedback, re-generate proposal, re-run Gate 1.

### Gate 2: Sonnet Self-Review

Spawn a Task with `model: "sonnet"`:

```
Prompt: "Review this proposal for correctness and completeness.
Check for:
- Logic gaps
- Missing requirements coverage
- Implementation feasibility
- Test coverage plan adequacy

Respond with JSON:
{
  "status": "approved" | "needs_changes",
  "feedback": "what to improve",
  "missing_requirements": ["if any"],
  "feasibility_concerns": ["if any"]
}"
```

If `needs_changes`: Apply feedback, re-generate, restart from Gate 1.

### Gate 3: Codex Review (Medium Reasoning)

Run Codex CLI for plan review:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-review.js" --type plan --plugin-root "${CLAUDE_PLUGIN_ROOT}"
```

If Codex returns `needs_changes`: Apply feedback, restart from Gate 1.

### Gate 4: Codex Review (High Reasoning)

Run Codex CLI again with higher reasoning emphasis:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-review.js" --type plan --plugin-root "${CLAUDE_PLUGIN_ROOT}"
```

Use a more detailed prompt that emphasizes deep reasoning about:
- Architectural correctness
- Long-term maintainability
- Edge case completeness

If `needs_changes`: Apply feedback, restart from Gate 1.

### User Approval Gate

After all 4 gates approve, present the proposal to the user with AskUserQuestion:

```
Question: "All 4 reviewers approved this proposal. Do you want to proceed?"
Options:
  1. Approved, let's go
  2. I want changes (describe what)
```

If user says changes needed: Apply their feedback, restart Stage 2 from scratch.

### Iteration Limit

After 10 full loops without all-approved, escalate to user:
```
"Been going back and forth on this proposal for a while. Can you help break the deadlock? Here's where the reviewers keep disagreeing: [summary]"
```

### Output

Write `.task/proposal/proposal.json`:
```json
{
  "title": "proposal title",
  "approach": "detailed approach",
  "files_to_modify": ["file1.ts", "file2.ts"],
  "test_strategy": "how tests will verify",
  "risks": ["risk1"],
  "trade_offs_considered": ["option A vs option B"],
  "iteration_count": 3,
  "reviews": {
    "opus": { "status": "approved", "iterations": 2 },
    "sonnet": { "status": "approved", "iterations": 1 },
    "codex_medium": { "status": "approved", "iterations": 3 },
    "codex_high": { "status": "approved", "iterations": 1 }
  },
  "user_approved": true
}
```

---

## Stage 3: Worktree Setup

### Instructions

1. **Get the Linear issue branch name** from `.task/linear-issue.json`

2. **Detect the main branch:**
   ```bash
   git remote show origin | grep 'HEAD branch' | sed 's/.*: //'
   ```
   Fallback: try `main`, then `master`.

3. **Pull latest:**
   ```bash
   git fetch origin
   git checkout <main-branch>
   git pull origin <main-branch>
   ```

4. **Create worktree:**
   Use the EnterWorktree tool or manually:
   ```bash
   git worktree add .claude/worktrees/<branch-slug> -b <branch-name> origin/<main-branch>
   ```

5. **Switch to worktree directory and verify:**

   **CRITICAL**: ALL remaining stages (4-8) MUST run inside the worktree. The original repo directory must NOT be used for any file edits, test runs, or git operations after this point.

   ```bash
   # Get absolute path to the worktree
   WORKTREE_PATH="$(pwd)/.claude/worktrees/<branch-slug>"

   # Verify worktree exists and is valid
   cd "$WORKTREE_PATH"
   git rev-parse --show-toplevel  # must match WORKTREE_PATH
   git worktree list  # verify this worktree shows up
   ```

6. **Move .task directory into worktree:**

   All pipeline state files need to be accessible from the worktree. Copy the `.task/` dir into the worktree so relative paths work:
   ```bash
   cp -r <original-repo>/.task "$WORKTREE_PATH/.task"
   ```

7. **Verify you are in the worktree (hard gate):**

   Run this check and STOP if it fails:
   ```bash
   # pwd must contain .claude/worktrees
   pwd | grep -q '.claude/worktrees' || echo "FATAL: not in worktree"
   ```

   If this check fails, DO NOT proceed. Go back to step 5.

### Output

Write `.task/worktree.json` (inside the worktree):
```json
{
  "path": "/absolute/path/to/worktree",
  "original_repo": "/absolute/path/to/original/repo",
  "branch": "team/team-123-brief-slug",
  "base_branch": "main",
  "created_at": "ISO timestamp"
}
```

---

## Worktree Guard (Required Before Every Stage 4-8 Action)

**Every stage from 4 onward MUST verify it is running inside the worktree before doing any work.** This is a hard requirement -- not optional.

Before running any command, editing any file, or creating any artifact in Stages 4 through 8:

```bash
# Quick check: verify current directory is inside a worktree
WORKTREE_CHECK=$(pwd)
if [[ "$WORKTREE_CHECK" != *".claude/worktrees"* ]]; then
  echo "FATAL: not in worktree directory. Current dir: $WORKTREE_CHECK"
  echo "Read .task/worktree.json to find the worktree path and cd into it."
  exit 1
fi
```

If the check fails:
1. Read `.task/worktree.json` from the original repo to find the worktree path
2. `cd` into the worktree path
3. Re-run the check
4. If it still fails, stop and tell the user

**Why this matters**: Without this guard, the agent will edit files and run tests in the original repo directory, meaning all changes go to the wrong branch and the worktree is pointless.

---

## Stage 4: Implementation (Strict TDD)

> **Worktree Guard**: Verify you are in the worktree (see "Worktree Guard" section above) before proceeding. ALL file edits and test commands must run inside the worktree.

### HARD RULE: Tests First, Always

This stage follows strict Test-Driven Development. You write tests BEFORE writing implementation code. No exceptions.

### Step 1: Detect Task Type

Read `.task/context.json` and `.task/proposal/proposal.json` to determine:
- **Bug fix**: `type = "fix"` -- regression test required
- **Feature**: `type = "feat"` -- specification tests required
- **Refactor**: `type = "refactor"` -- existing tests must pass, new characterization tests if behavior changes

Write `.task/impl-plan.json`:
```json
{
  "type": "fix|feat|refactor",
  "tdd_phases": ["red", "green", "refactor"],
  "test_files_to_create": ["path/to/test"],
  "impl_files_to_modify": ["path/to/source"],
  "regression_test_required": true
}
```

### Step 2: Detect Test Framework

Detect the test framework by scanning the project:
```bash
# Check for common test frameworks
ls package.json 2>/dev/null && cat package.json | grep -E "jest|vitest|mocha|ava"
ls foundry.toml 2>/dev/null  # Forge/Foundry
ls pytest.ini setup.cfg pyproject.toml 2>/dev/null  # pytest
ls Cargo.toml 2>/dev/null  # Rust
```

Record in `.task/test-config.json`:
```json
{
  "framework": "jest|vitest|forge|pytest|mocha|go",
  "test_command": "npm test|forge test|pytest",
  "test_dir": "test/|tests/|__tests__/|src/**/*.test.*",
  "coverage_command": "npm run test:coverage|forge coverage"
}
```

### Step 3: RED Phase -- Write Failing Tests First

**For bug fixes (MANDATORY: regression test):**

1. Reproduce the bug in a test FIRST:
   - Write a test that exercises the exact scenario that triggers the bug
   - This test MUST fail on the current codebase (proving the bug exists)
   - Name it clearly: `test_should_not_<bug_behavior>` or `it("does not <bug_behavior>")`

2. Run the test and CONFIRM it fails:
   ```bash
   <test_command> --filter "<test_name>"
   ```
   - If the test passes, your test is wrong -- it doesn't reproduce the bug
   - Rewrite the test until it fails for the right reason
   - Save the failing output

3. Write `.task/red-phase.json`:
   ```json
   {
     "phase": "red",
     "regression_tests": [
       {
         "file": "test/queue.test.ts",
         "test_name": "should not process items before lock acquired",
         "failure_output": "Expected: no duplicates, Received: 2 duplicate entries",
         "confirms_bug": true
       }
     ],
     "all_tests_status": "some_failing",
     "failing_count": 1,
     "timestamp": "ISO"
   }
   ```

**For features:**

1. Write specification tests that describe the desired behavior:
   - Each acceptance criterion from `.task/context.json` gets at least one test
   - Include happy path, edge cases, and error handling tests
   - All tests MUST fail (feature doesn't exist yet)

2. Run tests and confirm they fail:
   ```bash
   <test_command>
   ```

3. Write `.task/red-phase.json`:
   ```json
   {
     "phase": "red",
     "spec_tests": [
       {
         "file": "test/auth.test.ts",
         "test_name": "should return 401 when token expired",
         "failure_reason": "function not implemented",
         "maps_to_ac": "AC1"
       }
     ],
     "all_tests_status": "some_failing",
     "failing_count": 5,
     "timestamp": "ISO"
   }
   ```

**For refactors:**

1. Run existing tests first to establish a green baseline:
   ```bash
   <test_command>
   ```
2. If any existing tests fail, STOP and report to user -- don't refactor broken code
3. Add characterization tests for any behavior that isn't covered but might change
4. These characterization tests MUST pass on the current code

### Step 4: GREEN Phase -- Minimal Implementation

1. Write the MINIMUM code to make the failing tests pass
   - Don't over-engineer
   - Don't add features not covered by tests
   - Focus on making red tests go green

2. Run the failing tests:
   ```bash
   <test_command> --filter "<new_tests>"
   ```
   - If still failing: fix implementation, not the tests
   - Loop until all new tests pass

3. Run the FULL test suite:
   ```bash
   <test_command>
   ```
   - ALL existing tests must still pass (no regressions)
   - If existing tests break: your implementation has side effects, fix them

4. Write `.task/green-phase.json`:
   ```json
   {
     "phase": "green",
     "new_tests_passing": true,
     "existing_tests_passing": true,
     "total_tests": 48,
     "passed": 48,
     "failed": 0,
     "new_tests_added": 3,
     "timestamp": "ISO"
   }
   ```

### Step 5: REFACTOR Phase -- Clean Up

1. Review the implementation for:
   - Code duplication introduced
   - Naming that could be clearer
   - Extractions that would improve readability
   - Performance improvements that don't change behavior

2. After each refactor change, run the full test suite:
   ```bash
   <test_command>
   ```
   - Tests MUST stay green after every refactor step
   - If a test breaks during refactor: revert and try a different approach

3. Write `.task/refactor-phase.json`:
   ```json
   {
     "phase": "refactor",
     "changes_made": ["extracted helper function", "renamed variable for clarity"],
     "tests_still_green": true,
     "total_tests": 48,
     "passed": 48,
     "timestamp": "ISO"
   }
   ```

### Step 6: Final Verification

1. Run the full test suite one more time:
   ```bash
   <test_command>
   ```

2. Run coverage if available:
   ```bash
   <coverage_command>
   ```

3. For bug fixes, verify the regression test:
   - Check that the regression test exists in the diff
   - Confirm it would fail without the fix (revert fix temporarily if needed, or reason about it)

4. Cross-reference requirements:
   - Every AC from `.task/context.json` has at least one test
   - Every test maps to a requirement or edge case from the proposal

### Validation Gate (Blocks Progression to Stage 5)

The following MUST be true before moving to code review:

- [ ] `.task/red-phase.json` exists and shows tests were written first
- [ ] `.task/green-phase.json` exists and shows all tests passing
- [ ] For bug fixes: at least one regression test exists in `.task/red-phase.json` with `confirms_bug: true`
- [ ] For features: every AC has a mapped test in `.task/red-phase.json`
- [ ] Full test suite is green (0 failures)
- [ ] No test was modified AFTER implementation to make it pass (tests define behavior, not the other way around)

### Output

Write `.task/impl-result.json`:
```json
{
  "status": "complete",
  "type": "fix|feat|refactor",
  "tdd_compliance": {
    "red_phase_completed": true,
    "green_phase_completed": true,
    "refactor_phase_completed": true,
    "regression_test_exists": true,
    "tests_written_before_impl": true,
    "all_acs_covered": true
  },
  "files_changed": ["src/queue.ts"],
  "files_added": ["test/queue.regression.test.ts"],
  "test_results": {
    "framework": "jest",
    "total": 48,
    "passed": 48,
    "failed": 0,
    "skipped": 0,
    "new_tests": 3,
    "coverage_percent": 87
  },
  "regression_tests": [
    {
      "file": "test/queue.regression.test.ts",
      "name": "should not process items before lock acquired",
      "bug_it_prevents": "race condition causing duplicate queue entries"
    }
  ],
  "summary": "brief description of what was done"
}
```

---

## Stage 5: Code Review (4-Gate)

> **Worktree Guard**: Verify you are in the worktree (see "Worktree Guard" section above) before proceeding.

### IMPORTANT: Argument Until Agreement

All 3 reviewers must fully agree. If any reviewer flags an issue, the others must also evaluate that specific concern. This is NOT a sequential pass -- it's a consensus-building process.

### Gate 1: Opus Security Review

Spawn a Task with `model: "opus"`, `subagent_type: "claude-codex:sc-code-reviewer"`:

Focus areas:
- Security vulnerabilities (OWASP top 10)
- Code duplication that should be deduplicated
- Performance optimization opportunities
- Auth/authz correctness
- Input validation completeness

Output: `.task/reviews/review-opus-security.json`

### Gate 2: Codex Extra High Reasoning

Run Codex CLI for deep code review:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-review.js" --type code --plugin-root "${CLAUDE_PLUGIN_ROOT}"
```

Focus areas:
- Architectural correctness
- Edge case handling
- Contract/interface compliance
- Maintainability and readability
- Test coverage adequacy

Output: `.task/reviews/review-codex-high.json`

### Gate 3: Gemini Review

Run Gemini CLI for code review (same style as GitHub PR review):
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-review.js" --type code --plugin-root "${CLAUDE_PLUGIN_ROOT}"
```

Focus areas:
- Same as a thorough GitHub PR review
- Code style consistency
- Documentation adequacy
- API design quality
- Error handling patterns

Output: `.task/reviews/review-gemini.json`

### Consensus Building

After all 3 reviews are collected:

1. **Aggregate findings:** Merge all findings from all 3 reviewers
2. **If ANY reviewer returns `needs_changes`:**
   - Read ALL findings from all reviewers
   - Fix the identified issues
   - Re-run ALL 3 reviewers (not just the one that flagged issues)
   - Each reviewer sees the previous round's feedback from other reviewers
3. **If all 3 return `approved`:**
   - Cross-check: Present each reviewer's concerns to the others
   - If any reviewer disagrees with another's approval, force a re-review round
   - Only proceed when all 3 genuinely agree

4. **Write consensus:**
   ```json
   // .task/reviews/consensus.json
   {
     "fully_agreed": true,
     "rounds": 3,
     "final_findings": [],
     "each_reviewer_satisfied": {
       "opus": true,
       "codex": true,
       "gemini": true
     }
   }
   ```

### Iteration Limit

After 10 rounds without consensus, escalate:
```
"The reviewers can't seem to agree. Here's what each one keeps pushing back on: [summary]. What do you think?"
```

---

## Stage 6: Commit & PR

> **Worktree Guard**: Verify you are in the worktree (see "Worktree Guard" section above) before proceeding. Git operations MUST happen in the worktree -- commits and pushes from the original repo go to the wrong branch.

### Commit Rules

1. **Stage changes:**
   ```bash
   git add <specific files>
   ```
   Never use `git add -A` or `git add .`

2. **Write commit message:**
   - Informal, developer-style language
   - No em dashes
   - No Co-Authored-By tags
   - No mention of Claude, AI, or auto-generated
   - Example: `fix: handle race condition in queue processor`

3. **Commit:**
   ```bash
   git commit -m "$(cat <<'EOF'
   fix: handle race condition in queue processor

   the queue was processing items before the lock was acquired,
   causing duplicate entries when two workers picked up the same job
   EOF
   )"
   ```

4. **Push:**
   ```bash
   git push -u origin <branch-name>
   ```

### Create PR

1. **Build PR description:**
   - Use informal language
   - No em dashes
   - No "Generated with Claude Code"
   - No robotic language
   - Reference the Linear issue
   - Describe what changed and why

2. **Create PR:**
   ```bash
   gh pr create --title "<short title>" --body "$(cat <<'EOF'
   ## what changed

   <informal description of changes>

   ## why

   <brief context>

   ## testing

   <what tests cover this>

   closes <LINEAR-ISSUE-ID>
   EOF
   )"
   ```

### Output

Write `.task/pr.json`:
```json
{
  "number": 42,
  "url": "https://github.com/owner/repo/pull/42",
  "branch": "team/team-123-brief-slug",
  "title": "pr title"
}
```

---

## Stage 7: PR Finalization

> **Worktree Guard**: Verify you are in the worktree (see "Worktree Guard" section above) before proceeding. Any code fixes pushed in this stage must come from the worktree.

### Overview

This is a polling loop that monitors the PR for bot comments, CI status, and review threads. It keeps running until everything is clean.

### Main Loop

```
while (not all clear):
  1. Poll PR status
  2. Handle gemini bot comments
  3. Handle codex bot comments
  4. Handle claude bot comments
  5. Check CI status
  6. Check unresolved threads
  7. Wait and repeat
```

### Step 1: Poll PR Status

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/poll-pr-status.js" \
  --owner <owner> --repo <repo> --pr <number> --wait-ci
```

Read `.task/pr-status.json` for current state.

### Step 2: Handle Bot Review Comments (Gemini, Codex, Claude)

For EACH bot that has unresolved review threads:

1. **Read the thread** from `.task/pr-status.json` -> `review_threads.unresolved_details`

2. **Evaluate if the issue is valid**

3. **If valid -- fix and resolve:**
   ```bash
   # a) Fix the code
   # b) Commit and push (NO co-author)
   git add <files> && git commit -m "fix: address review feedback on <topic>"
   git push
   # c) Reply to the thread with what you fixed
   gh api graphql -f query='mutation {
     addPullRequestReviewThreadReply(input: {
       pullRequestReviewThreadId: "<THREAD_ID>",
       body: "fixed, good catch"
     }) { comment { id } }
   }'
   # d) Resolve the thread
   gh api graphql -f query='mutation {
     resolveReviewThread(input: { threadId: "<THREAD_ID>" }) {
       thread { isResolved }
     }
   }'
   ```

4. **If not valid -- reply and resolve:**
   ```bash
   # a) Reply explaining why (informal language)
   gh api graphql -f query='mutation {
     addPullRequestReviewThreadReply(input: {
       pullRequestReviewThreadId: "<THREAD_ID>",
       body: "hmm i think this is fine because [reason]"
     }) { comment { id } }
   }'
   # b) Resolve the thread
   gh api graphql -f query='mutation {
     resolveReviewThread(input: { threadId: "<THREAD_ID>" }) {
       thread { isResolved }
     }
   }'
   ```

5. **Re-tag the bot for re-review after pushing fixes:**
   ```bash
   # Gemini
   gh pr comment <pr> --body "@gemini-code-assist /review"
   # Codex
   gh pr comment <pr> --body "@codex-bot review this please"
   # Claude
   gh pr comment <pr> --body "@claude-bot /review"
   ```

### Batch Thread Resolution (Alternative)

If you've already addressed all issues and just need to resolve remaining threads:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-pr-thread.js" \
  --owner <owner> --repo <repo> --pr <number> --all --reply "addressed in latest push"
```

Or resolve a single thread:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-pr-thread.js" --thread-id <THREAD_ID>
```

Use `--dry-run` to preview what will be resolved without actually doing it.

### Step 3: CI Status

If CI failed:
1. Read the failure details from `.task/pr-status.json`
2. Check the failing check's logs:
   ```bash
   gh run view <run_id> --log-failed
   ```
3. Fix the failing tests/builds
4. Push changes (commit without co-author)
5. Wait for CI to re-run
6. Loop until CI green

### Step 4: Final Thread Sweep

After all fixes are pushed and CI is green, do a final sweep:

1. **Re-poll to get latest thread status:**
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/poll-pr-status.js" \
     --owner <owner> --repo <repo> --pr <number>
   ```

2. **If any threads are STILL unresolved:**
   - Read each one carefully
   - Reply if not already replied to
   - Resolve each thread explicitly:
     ```bash
     gh api graphql -f query='mutation {
       resolveReviewThread(input: { threadId: "<THREAD_ID>" }) {
         thread { isResolved }
       }
     }'
     ```

3. **Verify zero unresolved:**
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/poll-pr-status.js" \
     --owner <owner> --repo <repo> --pr <number>
   ```
   Check `.task/pr-status.json` -> `review_threads.unresolved` must be `0`.

4. **HARD GATE: Do NOT proceed to Stage 8 if `unresolved > 0`.**

### PR Comment Style

When commenting on PRs:
- Use informal language like a normal developer
- No em dashes, no robotic phrasing
- Examples:
  - "good catch, fixed in the latest push"
  - "hmm i think this is fine because [reason]"
  - "yeah you're right, updated the approach"
  - "this was intentional -- [explanation]"

### Polling Configuration

- Default poll interval: 30 seconds
- Max polls: 60 (30 minutes total)
- Between fixes, wait for CI before next poll

---

## Stage 8: Finalization

> **Worktree Guard**: Verify you are in the worktree (see "Worktree Guard" section above) before proceeding.

### Instructions

1. **Final status check:**
   - CI must be green
   - All review threads resolved
   - No pending bot comments
   - PR description clean (no em dashes, no Claude mention)

2. **Request review from repo owners:**
   ```bash
   # Get repo owner/maintainers
   gh api repos/<owner>/<repo>/collaborators --jq '.[].login'
   ```
   Or use known reviewers from team configuration.

   ```bash
   gh pr edit <pr> --add-reviewer <owner1>,<owner2>
   ```

3. **Update Linear issue:**
   ```
   mcp__linear-server__save_issue with:
   - id: <issue_id>
   - state: "In Review"
   ```
   Add a comment linking the PR:
   ```
   mcp__linear-server__create_comment with:
   - issueId: <issue_id>
   - body: "PR ready for review: <pr_url>"
   ```

4. **Report to user:**
   ```
   "alright, everything's done:
   - PR: <url>
   - Linear: <url>
   - CI: green
   - All review comments resolved
   - Requested review from <reviewers>

   just waiting on human review now"
   ```

---

## Task Chain Definition

```json
{
  "tasks": [
    {
      "id": "T0",
      "title": "Collect context",
      "stage": "context_collection",
      "blockedBy": [],
      "status": "pending"
    },
    {
      "id": "T1",
      "title": "Manage Linear issue",
      "stage": "linear_management",
      "blockedBy": ["T0"],
      "status": "pending"
    },
    {
      "id": "T2",
      "title": "Generate proposal",
      "stage": "proposal",
      "blockedBy": ["T1"],
      "status": "pending"
    },
    {
      "id": "T2.1",
      "title": "Proposal review - Opus",
      "stage": "proposal_review",
      "blockedBy": ["T2"],
      "status": "pending"
    },
    {
      "id": "T2.2",
      "title": "Proposal review - Sonnet",
      "stage": "proposal_review",
      "blockedBy": ["T2.1"],
      "status": "pending"
    },
    {
      "id": "T2.3",
      "title": "Proposal review - Codex medium",
      "stage": "proposal_review",
      "blockedBy": ["T2.2"],
      "status": "pending"
    },
    {
      "id": "T2.4",
      "title": "Proposal review - Codex high",
      "stage": "proposal_review",
      "blockedBy": ["T2.3"],
      "status": "pending"
    },
    {
      "id": "T2.5",
      "title": "User approval",
      "stage": "proposal_review",
      "blockedBy": ["T2.4"],
      "status": "pending"
    },
    {
      "id": "T3",
      "title": "Setup worktree",
      "stage": "worktree_setup",
      "blockedBy": ["T2.5"],
      "status": "pending"
    },
    {
      "id": "T4.0",
      "title": "Detect task type and test framework",
      "stage": "implementation",
      "blockedBy": ["T3"],
      "status": "pending"
    },
    {
      "id": "T4.1",
      "title": "RED: Write failing tests first (regression test for bugs)",
      "stage": "implementation_red",
      "blockedBy": ["T4.0"],
      "status": "pending"
    },
    {
      "id": "T4.2",
      "title": "RED: Confirm tests fail for the right reason",
      "stage": "implementation_red",
      "blockedBy": ["T4.1"],
      "status": "pending"
    },
    {
      "id": "T4.3",
      "title": "GREEN: Write minimal implementation to pass tests",
      "stage": "implementation_green",
      "blockedBy": ["T4.2"],
      "status": "pending"
    },
    {
      "id": "T4.4",
      "title": "GREEN: Confirm all tests pass (new + existing)",
      "stage": "implementation_green",
      "blockedBy": ["T4.3"],
      "status": "pending"
    },
    {
      "id": "T4.5",
      "title": "REFACTOR: Clean up, run tests after each change",
      "stage": "implementation_refactor",
      "blockedBy": ["T4.4"],
      "status": "pending"
    },
    {
      "id": "T4.6",
      "title": "TDD validation gate (red/green/refactor artifacts, regression test check)",
      "stage": "tdd_validation",
      "blockedBy": ["T4.5"],
      "status": "pending"
    },
    {
      "id": "T5.1",
      "title": "Code review - Opus security",
      "stage": "code_review",
      "blockedBy": ["T4.6"],
      "status": "pending"
    },
    {
      "id": "T5.2",
      "title": "Code review - Codex high",
      "stage": "code_review",
      "blockedBy": ["T4.6"],
      "status": "pending"
    },
    {
      "id": "T5.3",
      "title": "Code review - Gemini",
      "stage": "code_review",
      "blockedBy": ["T4.6"],
      "status": "pending"
    },
    {
      "id": "T5.4",
      "title": "Build consensus",
      "stage": "code_review",
      "blockedBy": ["T5.1", "T5.2", "T5.3"],
      "status": "pending"
    },
    {
      "id": "T6",
      "title": "Commit and create PR",
      "stage": "commit",
      "blockedBy": ["T5.4"],
      "status": "pending"
    },
    {
      "id": "T7",
      "title": "PR finalization loop",
      "stage": "pr_finalization",
      "blockedBy": ["T6"],
      "status": "pending"
    },
    {
      "id": "T8",
      "title": "Request review and finalize",
      "stage": "finalization",
      "blockedBy": ["T7"],
      "status": "pending"
    }
  ]
}
```

---

## Pipeline State Management

Write `.task/pipeline-state.json` at each stage transition:
```json
{
  "pipeline": "full-dev-pipeline",
  "current_stage": "context_collection",
  "current_task": "T0",
  "started_at": "ISO timestamp",
  "worktree_path": null,
  "original_repo_path": null,
  "stages_completed": [],
  "iteration_counts": {
    "proposal_review": 0,
    "code_review": 0,
    "pr_fix": 0
  }
}
```

Update `current_stage` and `current_task` as you progress. Push completed stages to `stages_completed`.

**After Stage 3**: Set `worktree_path` to the absolute path of the worktree, and `original_repo_path` to where the pipeline started. From this point on, the pipeline-state.json file lives INSIDE the worktree's `.task/` directory.

---

## Error Recovery

### If a stage fails:

1. Write the error to `.task/errors.json`
2. Notify the user with AskUserQuestion:
   ```
   "hit a snag at [stage]: [error]. want me to retry or do something different?"
   ```
3. Based on user response:
   - Retry: Re-run the failed stage
   - Skip: Move to next stage (only if non-critical)
   - Abort: Stop the pipeline

### If tests keep failing:

After 5 consecutive test failure cycles:
```
"tests keep failing, been at this for a bit. here's what's going wrong: [summary]. mind taking a look?"
```

### If reviewers can't agree:

After 10 rounds:
```
"the reviewers are going in circles. here's what they disagree on: [summary]. can you break the tie?"
```

---

## Scripts Reference

| Script | Purpose | Invocation |
|--------|---------|-----------|
| `gemini-review.js` | Gemini CLI code review | `node ${PLUGIN_ROOT}/scripts/gemini-review.js --type code --plugin-root ${PLUGIN_ROOT}` |
| `poll-pr-status.js` | Poll PR for bot comments & CI | `node ${PLUGIN_ROOT}/scripts/poll-pr-status.js --owner <o> --repo <r> --pr <n>` |
| `resolve-pr-thread.js` | Resolve PR review threads | `node ${PLUGIN_ROOT}/scripts/resolve-pr-thread.js --owner <o> --repo <r> --pr <n> --all` |
| `codex-review.js` | Codex CLI review | `node ${PLUGIN_ROOT}/scripts/codex-review.js --type <plan\|code> --plugin-root ${PLUGIN_ROOT}` |

---

## Commit Message Convention

Format:
```
<type>: <short description>

<optional body with more context>
```

Types: `fix`, `feat`, `refactor`, `test`, `docs`, `chore`, `perf`

Rules:
- All lowercase
- No period at end of subject line
- Body is optional, use when the "why" needs explanation
- Informal tone
- NEVER include Co-Authored-By
- NEVER mention Claude, AI, or auto-generated

---

## PR Description Convention

```
## what changed

<1-3 sentences describing the change in plain language>

## why

<brief context on why this was needed>

## testing

<what tests cover this, how to verify>

closes TEAM-123
```

Rules:
- No em dashes
- No "Generated with Claude Code" or similar
- Informal, developer language
- Reference Linear issue at the bottom
- Keep it concise

---

## Bot Tagging Reference

### Gemini
```bash
gh pr comment <pr> --body "@gemini-code-assist /review"
```

### Codex
```bash
gh pr comment <pr> --body "@codex-bot review this please"
```

### Claude
```bash
gh pr comment <pr> --body "@claude-bot /review"
```

Adjust bot usernames based on actual installation. Check with:
```bash
gh api repos/<owner>/<repo>/collaborators --jq '.[].login' | grep -i -E 'gemini|codex|claude|bot'
```

---

## PR Comment Reply Style

When replying to bot comments, use informal dev language:

DO:
- "fixed, good catch"
- "yeah that's a fair point, updated"
- "hmm i think this is intentional because [reason]"
- "done, moved the check earlier in the flow"
- "not sure about this one -- the current approach handles [edge case] better"

DON'T:
- "Thank you for your insightful feedback. The identified issue has been addressed."
- "This change has been implemented as suggested."
- "I appreciate the review comment. The code has been updated accordingly."
- Anything with em dashes
- Anything that sounds like a robot wrote it

#!/usr/bin/env bun
/**
 * SubagentStop hook that validates reviewer outputs.
 * Runs when ANY subagent finishes (SubagentStop doesn't support matchers).
 * Filters to only validate reviewer agents.
 *
 * Input (via stdin JSON):
 * {
 *   "agent_id": "def456",
 *   "agent_transcript_path": "~/.claude/projects/.../subagents/agent-def456.jsonl"
 * }
 *
 * Output (to block):
 * {"decision": "block", "reason": "explanation"}
 *
 * Validates:
 * 1. Review has acceptance_criteria_verification (code) or requirements_coverage (plan)
 * 2. All ACs from user-story.json are verified
 * 3. If status=approved but ACs missing -> block
 *
 * Note: Task creation validation removed - that's the orchestrator's responsibility
 * and happens AFTER the review, not during SubagentStop.
 */

import { readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { readAndNormalizeJson, validatePerVulnFormat } from './normalize.js';

const TASK_DIR = join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), '.task');

// Actual file names used by the pipeline (per SKILL.md Agent Reference)
const PLAN_REVIEW_FILES = ['review-sonnet.json', 'review-opus.json', 'review-codex.json'];
const CODE_REVIEW_FILES = ['code-review-sonnet.json', 'code-review-opus.json', 'code-review-codex.json'];

function getAgentTypeFromTranscript(transcriptPath) {
  try {
    const content = readFileSync(transcriptPath, 'utf-8');
    const match = content.match(/subagent_type['":\s]+['"]?(claude-codex:[^'"}\s,]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Find the most recently modified review file.
 * SubagentStop fires immediately after agent finishes, so the most recent file
 * is the one just written by the agent.
 */
function findMostRecentFile(files) {
  let mostRecent = null;
  let mostRecentTime = 0;

  for (const filename of files) {
    const filepath = join(TASK_DIR, filename);
    if (!existsSync(filepath)) continue;

    try {
      const stat = statSync(filepath);
      const mtime = stat.mtimeMs;

      if (mtime > mostRecentTime) {
        mostRecentTime = mtime;
        mostRecent = { path: filepath, filename };
      }
    } catch {
      continue;
    }
  }

  return mostRecent;
}

export function validatePlanReview(review, userStory) {
  const acIds = (userStory?.acceptance_criteria || []).map(ac => ac.id);
  if (acIds.length === 0) return null; // Skip validation if no ACs

  const coverage = review.requirements_coverage;
  if (!coverage) {
    return {
      decision: 'block',
      reason: 'Review missing requirements_coverage field. Must verify all acceptance criteria from user-story.json.'
    };
  }

  // mapping is now an array of {ac_id, steps}
  const coveredACs = (coverage.mapping || []).map(m => m.ac_id);
  const missingACs = acIds.filter(id => !coveredACs.includes(id));

  if (missingACs.length > 0) {
    return {
      decision: 'block',
      reason: `Review did not verify these ACs: ${missingACs.join(', ')}. Re-run review with complete verification.`
    };
  }

  if (review.status === 'approved' && (coverage.missing?.length > 0)) {
    return {
      decision: 'block',
      reason: `Cannot approve with missing requirements: ${coverage.missing.join(', ')}. Status must be needs_changes.`
    };
  }

  return null; // Valid
}

/**
 * Validate per-vulnerability format in security review findings.
 * EVMbench Section H.3: thematic grouping misses bugs.
 */
export function validateSecurityFindings(review) {
  if (!review) return null;

  // Only validate if review has security findings
  const findings = review.findings || review.exploits_confirmed || review.confirmed_exploits || [];
  if (!Array.isArray(findings) || findings.length === 0) return null;

  const error = validatePerVulnFormat(review);
  if (error) {
    return {
      decision: 'block',
      reason: `Per-vulnerability format violation: ${error}. Each finding must have unique id, file reference, and severity.`
    };
  }

  return null; // Valid
}

/**
 * Validate detect-coverage.json artifact (CALIBRATION: Detect Coverage Sprint).
 * Required fields per SKILL.md: status, high_med_candidates, validated_findings, coverage_notes
 */
export function validateDetectCoverage(artifact) {
  if (!artifact) {
    return { decision: 'block', reason: 'Missing detect-coverage.json artifact. Detect Coverage Sprint must write .task/detect-coverage.json.' };
  }
  if (artifact.status !== 'complete') {
    return { decision: 'block', reason: `detect-coverage.json status is "${artifact.status}", expected "complete".` };
  }
  if (typeof artifact.high_med_candidates !== 'number') {
    return { decision: 'block', reason: 'detect-coverage.json missing high_med_candidates (number).' };
  }
  if (!Array.isArray(artifact.validated_findings)) {
    return { decision: 'block', reason: 'detect-coverage.json missing validated_findings array.' };
  }
  if (typeof artifact.coverage_notes !== 'string' || artifact.coverage_notes.length === 0) {
    return { decision: 'block', reason: 'detect-coverage.json missing or empty coverage_notes.' };
  }
  return null;
}

/**
 * Validate patch-closure.json artifact (CALIBRATION: Patch Closure Sprint).
 * Must have closure status for each validated High/Med issue.
 */
export function validatePatchClosure(artifact, detectCoverage) {
  if (!artifact) {
    return { decision: 'block', reason: 'Missing patch-closure.json artifact. Patch Closure Sprint must write .task/patch-closure.json.' };
  }
  if (!Array.isArray(artifact.patches)) {
    return { decision: 'block', reason: 'patch-closure.json missing patches array.' };
  }
  // Every validated High/Med from detect must have a patch entry
  const validatedIds = (detectCoverage?.validated_findings || []).map(f => f.id);
  const patchedIds = artifact.patches.map(p => p.finding_id || p.id);
  const unpatched = validatedIds.filter(id => !patchedIds.includes(id));
  if (unpatched.length > 0) {
    return { decision: 'block', reason: `patch-closure.json missing patches for validated findings: ${unpatched.join(', ')}` };
  }
  return null;
}

/**
 * Validate exploit-replay.json artifact (CALIBRATION: Exploit Replay Sprint).
 * Must have replay status for each patched finding.
 */
export function validateExploitReplay(artifact, patchClosure) {
  if (!artifact) {
    return { decision: 'block', reason: 'Missing exploit-replay.json artifact. Exploit Replay Sprint must write .task/exploit-replay.json.' };
  }
  if (!Array.isArray(artifact.replays)) {
    return { decision: 'block', reason: 'exploit-replay.json missing replays array.' };
  }
  // Every patched finding must have replay evidence
  const patchedIds = (patchClosure?.patches || []).map(p => p.finding_id || p.id);
  const replayedIds = artifact.replays.map(r => r.finding_id || r.id);
  const unreplayed = patchedIds.filter(id => !replayedIds.includes(id));
  if (unreplayed.length > 0) {
    return { decision: 'block', reason: `exploit-replay.json missing replay evidence for patched findings: ${unreplayed.join(', ')}` };
  }
  // Each replay must have a verdict
  const noVerdict = artifact.replays.filter(r => !r.verdict && !r.status);
  if (noVerdict.length > 0) {
    return { decision: 'block', reason: `exploit-replay.json has ${noVerdict.length} replays without verdict/status.` };
  }
  return null;
}

/**
 * Validate discovery-scoreboard.json artifact (blind-audit-sc Stage 4).
 * Required fields per SKILL.md: entrypoints_total, entrypoints_reviewed, high_med_candidates, validated_high_med, hint_level
 */
export function validateDiscoveryScoreboard(artifact) {
  if (!artifact) {
    return { decision: 'block', reason: 'Missing discovery-scoreboard.json artifact. Stage 4 must write .task/discovery-scoreboard.json.' };
  }
  const requiredFields = ['entrypoints_total', 'entrypoints_reviewed', 'high_med_candidates', 'validated_high_med', 'hint_level'];
  const missing = requiredFields.filter(f => artifact[f] === undefined || artifact[f] === null);
  if (missing.length > 0) {
    return { decision: 'block', reason: `discovery-scoreboard.json missing required fields: ${missing.join(', ')}` };
  }
  const validHintLevels = ['none', 'low', 'medium', 'high'];
  if (!validHintLevels.includes(artifact.hint_level)) {
    return { decision: 'block', reason: `discovery-scoreboard.json hint_level "${artifact.hint_level}" not in [${validHintLevels.join(', ')}].` };
  }
  if (typeof artifact.entrypoints_total !== 'number' || typeof artifact.entrypoints_reviewed !== 'number') {
    return { decision: 'block', reason: 'discovery-scoreboard.json entrypoints_total and entrypoints_reviewed must be numbers.' };
  }
  return null;
}

export function validateCodeReview(review, userStory) {
  const acIds = (userStory?.acceptance_criteria || []).map(ac => ac.id);
  if (acIds.length === 0) return null; // Skip validation if no ACs

  const verification = review.acceptance_criteria_verification;
  if (!verification) {
    return {
      decision: 'block',
      reason: 'Review missing acceptance_criteria_verification field. Must verify all acceptance criteria from user-story.json.'
    };
  }

  // details is now an array of {ac_id, status, evidence, notes}
  const verifiedACs = (verification.details || []).map(d => d.ac_id);
  const missingACs = acIds.filter(id => !verifiedACs.includes(id));

  if (missingACs.length > 0) {
    return {
      decision: 'block',
      reason: `Review did not verify these ACs: ${missingACs.join(', ')}. Re-run review with complete verification.`
    };
  }

  const notFullyImplemented = (verification.details || [])
    .filter(d => d.status === 'NOT_IMPLEMENTED' || d.status === 'PARTIAL')
    .map(d => d.ac_id);

  if (review.status === 'approved' && notFullyImplemented.length > 0) {
    return {
      decision: 'block',
      reason: `Cannot approve with incomplete ACs: ${notFullyImplemented.join(', ')}. All ACs must be IMPLEMENTED. Status must be needs_changes.`
    };
  }

  return null; // Valid
}

/**
 * Validate calibration artifacts that were recently written.
 * Only validates artifacts that exist — if an agent didn't write
 * a calibration artifact, it wasn't doing calibration work.
 */
function validateCalibrationArtifacts() {
  const now = Date.now();
  const RECENT_MS = 60000; // Written in the last 60 seconds

  // Check each calibration artifact — only validate if recently modified
  const artifacts = [
    { file: 'detect-coverage.json', validator: 'detect-coverage' },
    { file: 'patch-closure.json', validator: 'patch-closure' },
    { file: 'exploit-replay.json', validator: 'exploit-replay' },
    { file: 'discovery-scoreboard.json', validator: 'discovery-scoreboard' }
  ];

  for (const { file, validator } of artifacts) {
    const filePath = join(TASK_DIR, file);
    if (!existsSync(filePath)) continue;

    try {
      const stat = statSync(filePath);
      if (now - stat.mtimeMs > RECENT_MS) continue; // Not recently written

      const data = readAndNormalizeJson(filePath);
      let error = null;

      if (validator === 'detect-coverage') {
        error = validateDetectCoverage(data);
      } else if (validator === 'patch-closure') {
        const detectData = readAndNormalizeJson(join(TASK_DIR, 'detect-coverage.json'));
        error = validatePatchClosure(data, detectData);
      } else if (validator === 'exploit-replay') {
        const patchData = readAndNormalizeJson(join(TASK_DIR, 'patch-closure.json'));
        error = validateExploitReplay(data, patchData);
      } else if (validator === 'discovery-scoreboard') {
        error = validateDiscoveryScoreboard(data);
      }

      if (error) return error;
    } catch {
      continue; // Skip artifacts we can't read
    }
  }

  return null;
}

async function main() {
  // Read input from stdin (per official docs)
  let input;
  try {
    const stdin = readFileSync(0, 'utf-8');
    input = JSON.parse(stdin);
  } catch {
    process.exit(0); // No valid input, allow
  }

  const transcriptPath = input.agent_transcript_path;
  if (!transcriptPath || !existsSync(transcriptPath)) {
    process.exit(0); // No transcript, allow
  }

  // Determine agent type from transcript
  const agentType = getAgentTypeFromTranscript(transcriptPath);

  // Validate reviewer agents and calibration agents
  const isPlanReviewer = agentType === 'claude-codex:plan-reviewer';
  const isCodeReviewer = agentType === 'claude-codex:code-reviewer';
  const isCodexReviewer = agentType === 'claude-codex:codex-reviewer';

  // Calibration-relevant agents: validate artifacts when they finish
  const CALIBRATION_AGENTS = [
    'claude-codex:sc-implementer',
    'claude-codex:exploit-hunter',
    'claude-codex:redteam-verifier',
    'claude-codex:sc-code-reviewer',
    'claude-codex:security-auditor',
    'claude-codex:opus-attack-planner'
  ];
  const isCalibrationAgent = CALIBRATION_AGENTS.includes(agentType);

  if (isCalibrationAgent) {
    // Validate calibration artifacts that exist (recently written by this agent)
    const calibrationErrors = validateCalibrationArtifacts();
    if (calibrationErrors) {
      console.log(JSON.stringify(calibrationErrors));
    }
    process.exit(0);
  }

  if (!isPlanReviewer && !isCodeReviewer && !isCodexReviewer) {
    process.exit(0); // Not a reviewer or calibration agent, allow
  }

  // Determine which files to check based on agent type
  let reviewFiles;
  let isPlanReview;

  if (isPlanReviewer) {
    // plan-reviewer handles sonnet/opus plan reviews
    reviewFiles = PLAN_REVIEW_FILES.filter(f => f !== 'review-codex.json');
    isPlanReview = true;
  } else if (isCodeReviewer) {
    // code-reviewer handles sonnet/opus code reviews
    reviewFiles = CODE_REVIEW_FILES.filter(f => f !== 'code-review-codex.json');
    isPlanReview = false;
  } else {
    // codex-reviewer handles both plan and code final reviews
    // Check which phase we're in by looking at what files exist
    const hasImplResult = existsSync(join(TASK_DIR, 'impl-result.json'));
    if (hasImplResult) {
      reviewFiles = ['code-review-codex.json'];
      isPlanReview = false;
    } else {
      reviewFiles = ['review-codex.json'];
      isPlanReview = true;
    }
  }

  // Find the most recently modified review file (just written by agent)
  const recentFile = findMostRecentFile(reviewFiles);
  if (!recentFile) {
    process.exit(0); // No review file found, allow
  }

  const review = readAndNormalizeJson(recentFile.path);
  if (!review) {
    process.exit(0); // Can't read review, allow
  }

  const userStory = readAndNormalizeJson(join(TASK_DIR, 'user-story.json'));

  // Validate AC coverage
  const error = isPlanReview
    ? validatePlanReview(review, userStory)
    : validateCodeReview(review, userStory);

  if (error) {
    console.log(JSON.stringify(error));
    process.exit(0);
  }

  // Validate per-vulnerability format for code reviews with security findings
  if (!isPlanReview) {
    const secError = validateSecurityFindings(review);
    if (secError) {
      console.log(JSON.stringify(secError));
    }
  }

  process.exit(0);
}

// Only run main when executed directly (not imported for testing)
if (import.meta.main) {
  main().catch(() => {
    process.exit(0); // Fail open on errors
  });
}

#!/usr/bin/env bun
/**
 * Adversarial Mode Validator Hook
 *
 * Validates outputs from adversarial stages (4A, 4B, 4C):
 * - Stage 4A (Opus Attack Plan): Validates hypothesis counts and categories
 * - Stage 4B (Codex Deep Exploit): Validates refutation requirements
 * - Stage 4C (Dispute Resolution): Validates verdicts and required actions
 *
 * Runs as SubagentStop hook when adversarial agents complete.
 *
 * Input (via stdin JSON):
 * {
 *   "agent_id": "abc123",
 *   "agent_transcript_path": "~/.claude/projects/.../subagents/agent-abc123.jsonl"
 * }
 *
 * Output (to block):
 * {"decision": "block", "reason": "explanation"}
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const TASK_DIR = join(PROJECT_DIR, '.task');
const DOCS_DIR = join(PROJECT_DIR, 'docs');

/**
 * Load adversarial config from .claude-codex.json
 */
function loadConfig() {
  const configPath = join(PROJECT_DIR, '.claude-codex.json');
  const defaults = {
    adversarial_mode: true,
    min_attack_hypotheses: 5,
    min_economic_hypotheses: 2,
    min_dos_hypotheses: 2,
    min_refuted_hypotheses: 1,
    min_false_positives_invalidated: 3,
    dispute_max_rounds: 3
  };

  try {
    if (!existsSync(configPath)) return defaults;
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (config?.blind_audit_sc?.adversarial) {
      return { ...defaults, ...config.blind_audit_sc.adversarial };
    }
    return defaults;
  } catch {
    return defaults;
  }
}

function readJson(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function findLatestRunDir() {
  if (!existsSync(TASK_DIR)) return null;

  const entries = readdirSync(TASK_DIR, { withFileTypes: true });
  const runDirs = entries
    .filter(e => e.isDirectory() && e.name.startsWith('blind-audit-'))
    .map(e => ({
      name: e.name,
      path: join(TASK_DIR, e.name),
      timestamp: parseInt(e.name.replace('blind-audit-', '')) || 0
    }))
    .sort((a, b) => b.timestamp - a.timestamp);

  return runDirs[0]?.path || null;
}

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
 * Validate Stage 4A: Opus Attack Plan
 */
function validateOpusAttackPlan(runDir, config) {
  const errors = [];

  // Check JSON artifact
  const jsonPath = join(runDir, 'opus-attack-plan.json');
  const mdPath = join(DOCS_DIR, 'reviews', 'opus-attack-plan.md');

  let data = readJson(jsonPath);
  if (!data) {
    // Try alternate location
    data = readJson(join(TASK_DIR, 'opus-attack-plan.json'));
  }

  if (!data) {
    errors.push('Missing opus-attack-plan.json artifact');
    return errors;
  }

  // Validate hypothesis counts
  if (!data.hypotheses) {
    errors.push('Missing hypotheses summary in opus-attack-plan.json');
  } else {
    if (data.hypotheses.total < config.min_attack_hypotheses) {
      errors.push(`Insufficient hypotheses: ${data.hypotheses.total} < ${config.min_attack_hypotheses} required`);
    }
    if (data.hypotheses.economic_mev < config.min_economic_hypotheses) {
      errors.push(`Insufficient Economic/MEV hypotheses: ${data.hypotheses.economic_mev} < ${config.min_economic_hypotheses} required`);
    }
    if (data.hypotheses.dos_gas_grief < config.min_dos_hypotheses) {
      errors.push(`Insufficient DoS/Gas grief hypotheses: ${data.hypotheses.dos_gas_grief} < ${config.min_dos_hypotheses} required`);
    }
  }

  // Validate hypothesis structure
  if (!data.attack_hypotheses || !Array.isArray(data.attack_hypotheses)) {
    errors.push('Missing attack_hypotheses array');
  } else {
    for (const hyp of data.attack_hypotheses) {
      if (!hyp.preconditions || hyp.preconditions.length === 0) {
        errors.push(`Hypothesis ${hyp.id}: Missing preconditions`);
      }
      if (!hyp.attack_steps || hyp.attack_steps.length === 0) {
        errors.push(`Hypothesis ${hyp.id}: Missing attack steps`);
      }
      if (!hyp.invariant_violated) {
        errors.push(`Hypothesis ${hyp.id}: Missing invariant mapping`);
      }
      if (!hyp.demonstration_test) {
        errors.push(`Hypothesis ${hyp.id}: Missing demonstration test`);
      }
    }
  }

  // Validate top 5 priority
  if (!data.top_5_priority || data.top_5_priority.length < 5) {
    errors.push('Missing or incomplete top_5_priority ranking');
  }

  // Validate blindness
  if (data.blindness_verified !== true) {
    errors.push('Blindness not verified in artifact');
  }

  return errors;
}

/**
 * Validate Stage 4B: Codex Deep Exploit Review
 */
function validateCodexDeepExploitReview(runDir, config) {
  const errors = [];

  const jsonPath = join(runDir, 'codex-deep-exploit-review.json');
  let data = readJson(jsonPath);
  if (!data) {
    data = readJson(join(TASK_DIR, 'codex-deep-exploit-review.json'));
  }

  if (!data) {
    errors.push('Missing codex-deep-exploit-review.json artifact');
    return errors;
  }

  // Validate refuted hypotheses (REQUIRED)
  if (!data.refuted_hypotheses || !Array.isArray(data.refuted_hypotheses)) {
    errors.push('Missing refuted_hypotheses array');
  } else if (data.refuted_hypotheses.length < config.min_refuted_hypotheses) {
    errors.push(`Insufficient refuted hypotheses: ${data.refuted_hypotheses.length} < ${config.min_refuted_hypotheses} required`);
  } else {
    for (const ref of data.refuted_hypotheses) {
      if (!ref.why_it_fails) {
        errors.push(`Refutation ${ref.id}: Missing evidence (why_it_fails)`);
      }
      if (!ref.guard_code_ref) {
        errors.push(`Refutation ${ref.id}: Missing code reference`);
      }
    }
  }

  // Validate false positives invalidated (REQUIRED)
  if (!data.false_positives_invalidated || !Array.isArray(data.false_positives_invalidated)) {
    errors.push('Missing false_positives_invalidated array');
  } else if (data.false_positives_invalidated.length < config.min_false_positives_invalidated) {
    errors.push(`Insufficient false positives invalidated: ${data.false_positives_invalidated.length} < ${config.min_false_positives_invalidated} required`);
  } else {
    for (const fp of data.false_positives_invalidated) {
      if (!fp.evidence) {
        errors.push(`False positive ${fp.id}: Missing evidence`);
      }
      if (!fp.code_ref) {
        errors.push(`False positive ${fp.id}: Missing code reference`);
      }
    }
  }

  // Validate blindness and isolation
  if (data.blindness_verified !== true) {
    errors.push('Blindness not verified in artifact');
  }
  if (data.opus_isolation_verified !== true) {
    errors.push('Opus isolation not verified - Codex may have seen Opus output');
  }

  return errors;
}

/**
 * Validate Stage 4C: Dispute Resolution
 */
function validateDisputeResolution(runDir, config) {
  const errors = [];

  const jsonPath = join(runDir, 'dispute-resolution.json');
  let data = readJson(jsonPath);
  if (!data) {
    data = readJson(join(TASK_DIR, 'dispute-resolution.json'));
  }

  if (!data) {
    errors.push('Missing dispute-resolution.json artifact');
    return errors;
  }

  // Validate all disputes have verdicts
  if (!data.dispute_details || !Array.isArray(data.dispute_details)) {
    errors.push('Missing dispute_details array');
  } else {
    for (const dispute of data.dispute_details) {
      if (!dispute.verdict) {
        errors.push(`Dispute ${dispute.id}: Missing verdict`);
      } else {
        // Validate based on verdict
        if (dispute.verdict === 'CONFIRMED') {
          if (!dispute.red_team_issue) {
            errors.push(`Dispute ${dispute.id}: CONFIRMED but no red_team_issue created`);
          }
          if (!dispute.reproduction_artifact?.test_file && !dispute.reproduction_artifact?.code) {
            errors.push(`Dispute ${dispute.id}: CONFIRMED but missing reproduction test`);
          }
        } else if (dispute.verdict === 'DISPROVEN') {
          if (!dispute.refutation_evidence && !dispute.justification) {
            errors.push(`Dispute ${dispute.id}: DISPROVEN but no refutation evidence`);
          }
        } else if (dispute.verdict === 'UNCLEAR') {
          if (!dispute.add_test_task) {
            errors.push(`Dispute ${dispute.id}: UNCLEAR but no add_test_task created`);
          }
        }
      }

      // Validate prosecutor/defender arguments present
      if (!dispute.opus_argument && !dispute.codex_argument) {
        errors.push(`Dispute ${dispute.id}: Missing prosecutor/defender arguments`);
      }
    }
  }

  // Validate red-team issues created for CONFIRMED
  if (data.disputes?.confirmed_high > 0 || data.disputes?.confirmed_med > 0) {
    if (!data.red_team_issues_created || data.red_team_issues_created.length === 0) {
      errors.push('CONFIRMED disputes exist but no red_team_issues_created');
    }
  }

  // Validate rerun flag for UNCLEAR
  if (data.disputes?.unclear > 0) {
    if (!data.rerun_required) {
      errors.push('UNCLEAR disputes exist but rerun_required is false');
    }
    if (!data.unclear_tasks_created || data.unclear_tasks_created.length === 0) {
      errors.push('UNCLEAR disputes exist but no unclear_tasks_created');
    }
  }

  // Check rerun rounds
  if (data.rerun_round >= config.dispute_max_rounds) {
    errors.push(`Max dispute rounds (${config.dispute_max_rounds}) reached - escalate to user`);
  }

  // Validate blindness
  if (data.blindness_verified !== true) {
    errors.push('Blindness not verified in artifact');
  }

  return errors;
}

async function main() {
  // Read input from stdin
  let input;
  try {
    const stdin = readFileSync(0, 'utf-8');
    input = JSON.parse(stdin);
  } catch {
    process.exit(0); // No valid input, allow
  }

  const transcriptPath = input.agent_transcript_path;
  if (!transcriptPath || !existsSync(transcriptPath)) {
    process.exit(0);
  }

  const agentType = getAgentTypeFromTranscript(transcriptPath);

  // Only validate adversarial agents
  const adversarialAgents = [
    'claude-codex:opus-attack-planner',
    'claude-codex:codex-deep-exploit-hunter',
    'claude-codex:dispute-resolver'
  ];

  if (!agentType || !adversarialAgents.includes(agentType)) {
    process.exit(0);
  }

  const config = loadConfig();

  // Skip if adversarial mode disabled
  if (!config.adversarial_mode) {
    process.exit(0);
  }

  const runDir = findLatestRunDir();
  if (!runDir) {
    process.exit(0);
  }

  let errors = [];

  switch (agentType) {
    case 'claude-codex:opus-attack-planner':
      errors = validateOpusAttackPlan(runDir, config);
      break;
    case 'claude-codex:codex-deep-exploit-hunter':
      errors = validateCodexDeepExploitReview(runDir, config);
      break;
    case 'claude-codex:dispute-resolver':
      errors = validateDisputeResolution(runDir, config);
      break;
  }

  if (errors.length > 0) {
    const errorMsg = `ADVERSARIAL VALIDATION FAILED:\n${errors.map(e => `  - ${e}`).join('\n')}`;
    console.log(JSON.stringify({
      decision: 'block',
      reason: errorMsg
    }));
  }

  process.exit(0);
}

if (import.meta.main) {
  main().catch(() => {
    process.exit(0);
  });
}

export {
  validateOpusAttackPlan,
  validateCodexDeepExploitReview,
  validateDisputeResolution,
  loadConfig
};

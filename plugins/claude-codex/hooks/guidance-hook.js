#!/usr/bin/env bun
/**
 * Simplified Guidance Hook - Advisory Mode Orchestration
 *
 * This UserPromptSubmit hook provides guidance based on .task/*.json files.
 * No state.json tracking - state is implicit from which files exist.
 * Enforcement is handled by SubagentStop hook (review-validator.js).
 *
 * Provides:
 * 1. Current phase detection from artifact files
 * 2. Advisory guidance for next task
 * 3. AC count reminder for reviews
 */

const fs = require('fs');
const path = require('path');

// Import version check module
let checkForUpdate;
try {
  checkForUpdate = require('./version-check.js').checkForUpdate;
} catch {
  checkForUpdate = () => null;
}

// Get directories from environment
const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const TASK_DIR = path.join(PROJECT_DIR, '.task');

/**
 * Safely read and parse JSON file
 */
function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Get progress from artifact files
 */
function getProgress() {
  return {
    userStory: readJson(path.join(TASK_DIR, 'user-story.json')),
    plan: readJson(path.join(TASK_DIR, 'plan-refined.json')),
    pipelineTasks: readJson(path.join(TASK_DIR, 'pipeline-tasks.json')),
    implResult: readJson(path.join(TASK_DIR, 'impl-result.json')),
    planReviewSonnet: readJson(path.join(TASK_DIR, 'review-sonnet.json')),
    planReviewOpus: readJson(path.join(TASK_DIR, 'review-opus.json')),
    planReviewCodex: readJson(path.join(TASK_DIR, 'review-codex.json')),
    codeReviewSonnet: readJson(path.join(TASK_DIR, 'code-review-sonnet.json')),
    codeReviewOpus: readJson(path.join(TASK_DIR, 'code-review-opus.json')),
    codeReviewCodex: readJson(path.join(TASK_DIR, 'code-review-codex.json')),
  };
}

/**
 * Determine current phase from artifact files
 */
function determinePhase(progress) {
  // No user story yet
  if (!progress.userStory) {
    return {
      phase: 'requirements_gathering',
      message: '**Phase: Requirements Gathering**\nUse requirements-gatherer agent (opus) to create user-story.json'
    };
  }

  // No plan yet
  if (!progress.plan) {
    return {
      phase: 'plan_drafting',
      message: '**Phase: Planning**\nUse planner agent (opus) to create plan-refined.json'
    };
  }

  // Plan review chain
  if (!progress.planReviewSonnet?.status) {
    return {
      phase: 'plan_review_sonnet',
      message: '**Phase: Plan Review**\n→ Run Sonnet plan review (plan-reviewer agent, sonnet)'
    };
  }
  if (progress.planReviewSonnet.status === 'needs_clarification') {
    const questions = progress.planReviewSonnet.clarification_questions || [];
    return {
      phase: 'clarification_plan_sonnet',
      message: `**Phase: Clarification Needed**\nSonnet needs clarification. Answer questions or use AskUserQuestion:\n${questions.map(q => `- ${q}`).join('\n')}`
    };
  }
  if (progress.planReviewSonnet.status === 'needs_changes') {
    return {
      phase: 'fix_plan_sonnet',
      message: '**Phase: Fix Plan**\nSonnet needs changes. Create fix + re-review tasks.'
    };
  }

  if (!progress.planReviewOpus?.status) {
    return {
      phase: 'plan_review_opus',
      message: '**Phase: Plan Review**\n→ Run Opus plan review (plan-reviewer agent, opus)'
    };
  }
  if (progress.planReviewOpus.status === 'needs_clarification') {
    const questions = progress.planReviewOpus.clarification_questions || [];
    return {
      phase: 'clarification_plan_opus',
      message: `**Phase: Clarification Needed**\nOpus needs clarification. Answer questions or use AskUserQuestion:\n${questions.map(q => `- ${q}`).join('\n')}`
    };
  }
  if (progress.planReviewOpus.status === 'needs_changes') {
    return {
      phase: 'fix_plan_opus',
      message: '**Phase: Fix Plan**\nOpus needs changes. Create fix + re-review tasks.'
    };
  }

  if (!progress.planReviewCodex?.status) {
    return {
      phase: 'plan_review_codex',
      message: '**Phase: Plan Review**\n→ Run Codex plan review (FINAL GATE - codex-reviewer agent)'
    };
  }
  if (progress.planReviewCodex.status === 'needs_clarification') {
    const questions = progress.planReviewCodex.clarification_questions || [];
    return {
      phase: 'clarification_plan_codex',
      message: `**Phase: Clarification Needed**\nCodex needs clarification. Answer questions or use AskUserQuestion:\n${questions.map(q => `- ${q}`).join('\n')}`
    };
  }
  if (progress.planReviewCodex.status === 'needs_changes') {
    return {
      phase: 'fix_plan_codex',
      message: '**Phase: Fix Plan**\nCodex needs changes. Create fix + re-review tasks.'
    };
  }
  if (progress.planReviewCodex.status === 'rejected') {
    return {
      phase: 'plan_rejected',
      message: '**Phase: Plan Rejected**\nCodex rejected the plan. Significant rework required.'
    };
  }

  // Implementation
  if (!progress.implResult?.status || progress.implResult.status === 'partial') {
    return {
      phase: 'implementation',
      message: '**Phase: Implementation**\nUse implementer agent (sonnet) to implement plan-refined.json'
    };
  }
  if (progress.implResult.status === 'failed') {
    return {
      phase: 'implementation_failed',
      message: '**Phase: Implementation Failed**\nCheck impl-result.json for failure details.'
    };
  }

  // Code review chain
  if (!progress.codeReviewSonnet?.status) {
    return {
      phase: 'code_review_sonnet',
      message: '**Phase: Code Review**\n→ Run Sonnet code review (code-reviewer agent, sonnet)'
    };
  }
  if (progress.codeReviewSonnet.status === 'needs_clarification') {
    const questions = progress.codeReviewSonnet.clarification_questions || [];
    return {
      phase: 'clarification_code_sonnet',
      message: `**Phase: Clarification Needed**\nSonnet needs clarification. Answer questions or use AskUserQuestion:\n${questions.map(q => `- ${q}`).join('\n')}`
    };
  }
  if (progress.codeReviewSonnet.status === 'needs_changes') {
    return {
      phase: 'fix_code_sonnet',
      message: '**Phase: Fix Code**\nSonnet needs changes. Create fix + re-review tasks.'
    };
  }

  if (!progress.codeReviewOpus?.status) {
    return {
      phase: 'code_review_opus',
      message: '**Phase: Code Review**\n→ Run Opus code review (code-reviewer agent, opus)'
    };
  }
  if (progress.codeReviewOpus.status === 'needs_clarification') {
    const questions = progress.codeReviewOpus.clarification_questions || [];
    return {
      phase: 'clarification_code_opus',
      message: `**Phase: Clarification Needed**\nOpus needs clarification. Answer questions or use AskUserQuestion:\n${questions.map(q => `- ${q}`).join('\n')}`
    };
  }
  if (progress.codeReviewOpus.status === 'needs_changes') {
    return {
      phase: 'fix_code_opus',
      message: '**Phase: Fix Code**\nOpus needs changes. Create fix + re-review tasks.'
    };
  }

  if (!progress.codeReviewCodex?.status) {
    return {
      phase: 'code_review_codex',
      message: '**Phase: Code Review**\n→ Run Codex code review (FINAL GATE - codex-reviewer agent)'
    };
  }
  if (progress.codeReviewCodex.status === 'needs_clarification') {
    const questions = progress.codeReviewCodex.clarification_questions || [];
    return {
      phase: 'clarification_code_codex',
      message: `**Phase: Clarification Needed**\nCodex needs clarification. Answer questions or use AskUserQuestion:\n${questions.map(q => `- ${q}`).join('\n')}`
    };
  }
  if (progress.codeReviewCodex.status === 'needs_changes') {
    return {
      phase: 'fix_code_codex',
      message: '**Phase: Fix Code**\nCodex needs changes. Create fix + re-review tasks.'
    };
  }
  if (progress.codeReviewCodex.status === 'rejected') {
    return {
      phase: 'code_rejected',
      message: '**Phase: Code Rejected**\nCodex rejected implementation. Major rework required.'
    };
  }

  // All reviews approved
  return {
    phase: 'complete',
    message: '**Phase: Complete**\nAll reviews approved. Pipeline finished.'
  };
}

/**
 * Load audit scope from .claude-codex.json config.
 * Returns scope string or null if not configured.
 */
function loadAuditScope() {
  try {
    const configPath = path.join(PROJECT_DIR, '.claude-codex.json');
    if (!fs.existsSync(configPath)) return null;
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return config?.audit_scope || null;
  } catch {
    return null;
  }
}

/**
 * SC pipeline phases where audit scope guidance applies
 */
const SC_PIPELINE_PHASES = [
  'plan_review_sonnet', 'plan_review_opus', 'plan_review_codex',
  'code_review_sonnet', 'code_review_opus', 'code_review_codex',
  'fix_plan_sonnet', 'fix_plan_opus', 'fix_plan_codex',
  'fix_code_sonnet', 'fix_code_opus', 'fix_code_codex',
  'implementation'
];

/**
 * Compute guidance message based on current progress
 */
function computeGuidance() {
  // Check if .task directory exists
  if (!fs.existsSync(TASK_DIR)) {
    return {
      message: '',
      phase: 'idle',
      isEmpty: true
    };
  }

  const progress = getProgress();
  const { phase, message } = determinePhase(progress);
  const lines = [message];

  // Add AC reminder if user story exists with ACs
  if (progress.userStory?.acceptance_criteria?.length > 0) {
    const acCount = progress.userStory.acceptance_criteria.length;
    lines.push('');
    lines.push(`**Reminder**: ${acCount} acceptance criteria must be verified in all reviews.`);
    lines.push('Reviews MUST include acceptance_criteria_verification (code) or requirements_coverage (plan).');
  }

  // Inject audit scope guidance for SC pipeline phases
  const auditScope = loadAuditScope();
  if (auditScope && SC_PIPELINE_PHASES.includes(phase)) {
    lines.push('');
    if (auditScope === 'loss-of-funds-only') {
      lines.push('**Audit Scope**: Loss-of-funds only. Focus on vulnerabilities that can cause direct fund loss.');
    } else if (auditScope === 'high-and-above') {
      lines.push('**Audit Scope**: High severity and above. Focus on HIGH and CRITICAL findings.');
    } else {
      lines.push('**Audit Scope**: All severities. Report all findings including LOW and INFO.');
    }
  }

  return {
    message: lines.join('\n'),
    phase,
    isComplete: phase === 'complete'
  };
}

/**
 * Emit system message to stdout as JSON
 */
function emitSystemMessage(updateNotification, guidance) {
  let additionalContext = '';

  if (updateNotification) {
    additionalContext += `${updateNotification}\n\n`;
  }

  if (guidance && guidance.message) {
    additionalContext += guidance.message;
  }

  if (additionalContext) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext
      }
    }));
  }
}

/**
 * Main hook logic
 */
function main() {
  // Check for plugin updates (synchronous, non-blocking)
  let updateNotification = null;
  try {
    updateNotification = checkForUpdate();
  } catch {
    // Silent fail - version check is not critical
  }

  // Compute guidance based on current progress
  const guidance = computeGuidance();

  // Emit combined message
  emitSystemMessage(updateNotification, guidance);

  // Always allow the prompt to proceed
  process.exit(0);
}

// Export for testability
module.exports = {
  readJson,
  getProgress,
  determinePhase,
  computeGuidance,
  TASK_DIR
};

// Import-safe guard - only run main() when executed directly
if (require.main === module) {
  main();
}

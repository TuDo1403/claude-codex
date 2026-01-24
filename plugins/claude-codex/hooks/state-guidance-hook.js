#!/usr/bin/env bun
/**
 * State Guidance Hook - Injects state-aware instructions at turn start
 *
 * This UserPromptSubmit hook proactively reminds Claude about the current pipeline
 * state and what actions should be taken next. It helps prevent skipping steps
 * like plan reviews before implementation.
 *
 * In the multi-session orchestrator architecture with task-based enforcement:
 * - Pipeline tasks are tracked via TaskCreate/TaskUpdate/TaskList tools
 * - Reviews are enforced via blockedBy dependencies
 * - Codex review is done via /review-codex skill
 */

const fs = require('fs');
const path = require('path');

// Get directories from environment
const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const TASK_DIR = path.join(PROJECT_DIR, '.task');
const STATE_FILE = path.join(TASK_DIR, 'state.json');
const PIPELINE_TASKS_FILE = path.join(TASK_DIR, 'pipeline-tasks.json');

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
 * Check status of all plan review files
 */
function checkReviewStatus() {
  const reviews = ['review-sonnet.json', 'review-opus.json', 'review-codex.json'];
  const status = {};

  for (const r of reviews) {
    const file = path.join(TASK_DIR, r);
    const data = readJson(file);
    status[r.replace('.json', '')] = data?.status || 'missing';
  }

  return status;
}

/**
 * Format review status for display
 */
function formatReviewStatus(reviewStatus) {
  return Object.entries(reviewStatus)
    .map(([name, status]) => `${name}: ${status}`)
    .join(', ');
}

/**
 * Check if pipeline tasks have been created
 */
function hasPipelineTasks() {
  return fs.existsSync(PIPELINE_TASKS_FILE);
}

/**
 * Main hook logic
 */
function main() {
  // Check if state file exists
  const state = readJson(STATE_FILE);
  if (!state) {
    // No state file means no active pipeline - allow without guidance
    process.exit(0);
  }

  const reviewStatus = checkReviewStatus();
  const allApproved = Object.values(reviewStatus).every(s => s === 'approved');
  const currentStatus = state.status || 'idle';
  const pipelineTasksExist = hasPipelineTasks();

  let guidance = '';

  // Provide state-specific guidance
  switch (currentStatus) {
    case 'plan_refining':
    case 'plan_reviewing':
      if (!allApproved) {
        const statusStr = formatReviewStatus(reviewStatus);
        guidance = [
          '',
          '**PIPELINE STATE: Plan Review Phase**',
          '',
          `Current review status: ${statusStr}`,
          '',
          'REQUIRED ACTIONS (task-enforced sequence):',
          '1. Query TaskList() to find next unblocked review task',
          '2. Execute the task (Sonnet → Opus → Codex)',
          '3. If needs_changes, create fix task before proceeding',
          '',
          'blockedBy dependencies prevent skipping. Use TaskList() to find the next task.',
          ''
        ].join('\n');
      }
      break;

    case 'plan_drafting':
      // Just created plan, remind about review phase
      // BUT: if all reviews are already approved, state is stale - skip guidance
      if (allApproved) {
        // State is stale - reviews passed but state wasn't updated
        // Don't show confusing guidance
        break;
      }
      if (pipelineTasksExist) {
        guidance = [
          '',
          '**PIPELINE STATE: Plan Created**',
          '',
          'Pipeline tasks exist. Use the task-based execution loop:',
          '1. Query TaskList() to find next unblocked task',
          '2. Execute the task (plan reviews are blocked until plan task completes)',
          '3. Mark task completed, loop back to step 1',
          ''
        ].join('\n');
      } else {
        guidance = [
          '',
          '**PIPELINE STATE: Plan Drafting**',
          '',
          'After creating plan-refined.json:',
          '1. Create pipeline task chain with TaskCreate (if not already done)',
          '2. Use TaskList() to find next task and execute it',
          '3. Reviews are enforced via blockedBy dependencies',
          ''
        ].join('\n');
      }
      break;

    case 'implementing':
    case 'implementing_loop':
      // Already in implementation - check that reviews were done
      if (!allApproved) {
        const statusStr = formatReviewStatus(reviewStatus);
        guidance = [
          '',
          '**WARNING: Implementation started without approved reviews!**',
          '',
          `Current review status: ${statusStr}`,
          '',
          'This may indicate a pipeline issue. All plan reviews should be approved',
          'before implementation begins. blockedBy dependencies should prevent this.',
          ''
        ].join('\n');
      }
      break;

    case 'idle':
      // Idle state - no active pipeline
      // If there are pipeline tasks but state is idle, something may be off
      if (pipelineTasksExist) {
        guidance = [
          '',
          '**PIPELINE STATE: Idle (with existing tasks)**',
          '',
          'Pipeline tasks exist but state is idle.',
          'Use TaskList() to check task status and continue execution.',
          ''
        ].join('\n');
      }
      // Otherwise, no guidance needed for idle state
      break;

    default:
      // Other states (requirements_gathering, complete, etc.)
      // No special guidance needed
      break;
  }

  // If we have guidance, output it as a system message
  if (guidance) {
    // UserPromptSubmit hooks can modify the prompt by outputting to stdout
    // The guidance will be prepended to Claude's context
    console.log(JSON.stringify({
      systemMessage: guidance
    }));
  }

  // Always allow the prompt to proceed
  process.exit(0);
}

main();

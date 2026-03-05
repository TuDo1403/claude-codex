#!/usr/bin/env node
/**
 * PR Status Poller
 *
 * Polls a GitHub PR for:
 * - Bot review comments (gemini, codex, claude)
 * - CI/check status
 * - Unresolved review threads
 *
 * Returns structured data about what needs attention.
 *
 * Usage:
 *   node poll-pr-status.js --owner <owner> --repo <repo> --pr <number>
 *   node poll-pr-status.js --owner <owner> --repo <repo> --pr <number> --wait-ci
 *   node poll-pr-status.js --owner <owner> --repo <repo> --pr <number> --poll-interval 30
 *
 * Exit codes:
 *   0 - Success (status retrieved)
 *   1 - Validation error
 *   2 - GitHub CLI error
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TASK_DIR = '.task';
const OUTPUT_FILE = path.join(TASK_DIR, 'pr-status.json');

// ================== ARGUMENT PARSING ==================

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    owner: null,
    repo: null,
    pr: null,
    waitCi: false,
    pollInterval: 30, // seconds
    maxPolls: 60, // max 30 minutes of polling
    outputFile: null,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--owner': result.owner = args[++i]; break;
      case '--repo': result.repo = args[++i]; break;
      case '--pr': result.pr = parseInt(args[++i]); break;
      case '--wait-ci': result.waitCi = true; break;
      case '--poll-interval': result.pollInterval = parseInt(args[++i]); break;
      case '--max-polls': result.maxPolls = parseInt(args[++i]); break;
      case '--output': result.outputFile = args[++i]; break;
    }
  }

  return result;
}

// ================== GITHUB HELPERS ==================

function ghApi(endpoint) {
  try {
    const result = execSync(`gh api ${endpoint}`, {
      encoding: 'utf8',
      timeout: 30000,
    });
    return JSON.parse(result);
  } catch (err) {
    console.error(`[poll-pr] gh api error for ${endpoint}: ${err.message}`);
    return null;
  }
}

function ghGraphQL(query) {
  try {
    const escaped = query.replace(/"/g, '\\"').replace(/\n/g, ' ');
    const result = execSync(`gh api graphql -f query="${escaped}"`, {
      encoding: 'utf8',
      timeout: 30000,
    });
    return JSON.parse(result);
  } catch (err) {
    console.error(`[poll-pr] GraphQL error: ${err.message}`);
    return null;
  }
}

// ================== BOT COMMENT DETECTION ==================

const BOT_PATTERNS = {
  gemini: {
    usernames: ['gemini-code-assist', 'gemini-code-assist[bot]', 'google-gemini-bot', 'gemini-bot'],
    bodyPatterns: [/gemini/i, /google\s*ai/i],
  },
  codex: {
    usernames: ['codex-bot', 'openai-codex', 'codex[bot]'],
    bodyPatterns: [/codex/i, /openai/i],
  },
  claude: {
    usernames: ['claude-bot', 'anthropic-claude', 'claude[bot]'],
    bodyPatterns: [/claude/i, /anthropic/i],
  },
};

function identifyBot(comment) {
  const username = (comment.user?.login || '').toLowerCase();
  const body = comment.body || '';

  for (const [botName, patterns] of Object.entries(BOT_PATTERNS)) {
    if (patterns.usernames.some((u) => username.includes(u))) {
      return botName;
    }
    // Check if it's a bot account with matching body content
    if (comment.user?.type === 'Bot' && patterns.bodyPatterns.some((p) => p.test(body))) {
      return botName;
    }
  }
  return null;
}

// ================== STATUS COLLECTION ==================

function getReviewComments(owner, repo, pr) {
  const comments = ghApi(`repos/${owner}/${repo}/pulls/${pr}/comments`);
  if (!comments) return [];
  return comments;
}

function getIssueComments(owner, repo, pr) {
  const comments = ghApi(`repos/${owner}/${repo}/issues/${pr}/comments`);
  if (!comments) return [];
  return comments;
}

function getReviewThreads(owner, repo, pr) {
  const query = `{
    repository(owner: "${owner}", name: "${repo}") {
      pullRequest(number: ${pr}) {
        reviewThreads(first: 100) {
          nodes {
            id
            isResolved
            isOutdated
            comments(first: 10) {
              nodes {
                id
                body
                author { login }
                createdAt
              }
            }
          }
        }
      }
    }
  }`;

  const result = ghGraphQL(query);
  if (!result?.data?.repository?.pullRequest?.reviewThreads?.nodes) return [];
  return result.data.repository.pullRequest.reviewThreads.nodes;
}

function getCheckStatus(owner, repo, pr) {
  const query = `{
    repository(owner: "${owner}", name: "${repo}") {
      pullRequest(number: ${pr}) {
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                state
                contexts(first: 50) {
                  nodes {
                    ... on CheckRun {
                      name
                      status
                      conclusion
                      detailsUrl
                    }
                    ... on StatusContext {
                      context
                      state
                      targetUrl
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }`;

  const result = ghGraphQL(query);
  const commit = result?.data?.repository?.pullRequest?.commits?.nodes?.[0]?.commit;
  if (!commit?.statusCheckRollup) {
    return { state: 'PENDING', checks: [] };
  }

  const contexts = commit.statusCheckRollup.contexts?.nodes || [];
  return {
    state: commit.statusCheckRollup.state,
    checks: contexts.map((ctx) => ({
      name: ctx.name || ctx.context,
      status: ctx.status || ctx.state,
      conclusion: ctx.conclusion || null,
      url: ctx.detailsUrl || ctx.targetUrl,
    })),
  };
}

function getReviews(owner, repo, pr) {
  const reviews = ghApi(`repos/${owner}/${repo}/pulls/${pr}/reviews`);
  if (!reviews) return [];
  return reviews;
}

// ================== MAIN STATUS AGGREGATION ==================

function collectPRStatus(owner, repo, pr) {
  console.log(`[poll-pr] Collecting status for ${owner}/${repo}#${pr}...`);

  // Get all comments
  const reviewComments = getReviewComments(owner, repo, pr);
  const issueComments = getIssueComments(owner, repo, pr);
  const allComments = [...reviewComments, ...issueComments];

  // Categorize bot comments
  const botComments = {
    gemini: [],
    codex: [],
    claude: [],
    other_bots: [],
  };

  const unresolvedBotIssues = [];

  for (const comment of allComments) {
    const bot = identifyBot(comment);
    if (bot) {
      const entry = {
        id: comment.id,
        bot: bot,
        body: comment.body,
        created_at: comment.created_at,
        url: comment.html_url,
        in_reply_to: comment.in_reply_to_id || null,
      };
      botComments[bot].push(entry);

      // Check if this is an unresolved issue (not a reply, contains actionable feedback)
      if (!comment.in_reply_to_id && hasActionableFeedback(comment.body)) {
        unresolvedBotIssues.push(entry);
      }
    }
  }

  // Get review threads (for resolved/unresolved status)
  const threads = getReviewThreads(owner, repo, pr);
  const unresolvedThreads = threads.filter((t) => !t.isResolved && !t.isOutdated);
  const resolvedThreads = threads.filter((t) => t.isResolved);

  // Get CI status
  const ciStatus = getCheckStatus(owner, repo, pr);
  const failedChecks = ciStatus.checks.filter(
    (c) => c.conclusion === 'FAILURE' || c.conclusion === 'ERROR' || c.status === 'FAILURE'
  );
  const pendingChecks = ciStatus.checks.filter(
    (c) => c.status === 'IN_PROGRESS' || c.status === 'QUEUED' || c.status === 'PENDING'
  );

  // Get reviews (approved, changes requested, etc.)
  const reviews = getReviews(owner, repo, pr);
  const latestReviewByUser = {};
  for (const review of reviews) {
    const user = review.user?.login;
    if (user && review.state !== 'COMMENTED') {
      latestReviewByUser[user] = {
        state: review.state,
        user: user,
        submitted_at: review.submitted_at,
      };
    }
  }

  const approvals = Object.values(latestReviewByUser).filter((r) => r.state === 'APPROVED');
  const changesRequested = Object.values(latestReviewByUser).filter((r) => r.state === 'CHANGES_REQUESTED');

  return {
    pr_number: pr,
    owner,
    repo,
    timestamp: new Date().toISOString(),

    bot_comments: botComments,
    unresolved_bot_issues: unresolvedBotIssues,

    review_threads: {
      total: threads.length,
      unresolved: unresolvedThreads.length,
      resolved: resolvedThreads.length,
      unresolved_details: unresolvedThreads.map((t) => ({
        id: t.id,
        first_comment: t.comments?.nodes?.[0]?.body?.slice(0, 200),
        author: t.comments?.nodes?.[0]?.author?.login,
      })),
    },

    ci: {
      state: ciStatus.state,
      failed: failedChecks,
      pending: pendingChecks,
      all_green: ciStatus.state === 'SUCCESS' && failedChecks.length === 0,
      still_running: pendingChecks.length > 0,
    },

    reviews: {
      approvals: approvals,
      changes_requested: changesRequested,
      latest_by_user: latestReviewByUser,
    },

    action_needed: {
      fix_bot_issues: unresolvedBotIssues.length > 0,
      fix_ci: failedChecks.length > 0,
      wait_ci: pendingChecks.length > 0,
      resolve_threads: unresolvedThreads.length > 0,
      bot_details: {
        gemini_pending: botComments.gemini.length > 0 && !hasApproval(botComments.gemini),
        codex_pending: botComments.codex.length > 0 && !hasApproval(botComments.codex),
        claude_pending: botComments.claude.length > 0 && !hasApproval(botComments.claude),
      },
    },
  };
}

function hasActionableFeedback(body) {
  if (!body) return false;
  const lowerBody = body.toLowerCase();
  // Skip approval/lgtm comments
  if (/^\s*(lgtm|looks good|approved|no issues)/i.test(body)) return false;
  // Has suggestion, issue, or question markers
  return (
    lowerBody.includes('suggestion') ||
    lowerBody.includes('issue') ||
    lowerBody.includes('consider') ||
    lowerBody.includes('should') ||
    lowerBody.includes('could') ||
    lowerBody.includes('fix') ||
    lowerBody.includes('bug') ||
    lowerBody.includes('error') ||
    lowerBody.includes('warning') ||
    lowerBody.includes('?')
  );
}

function hasApproval(comments) {
  return comments.some((c) => {
    const body = (c.body || '').toLowerCase();
    return body.includes('lgtm') || body.includes('approved') || body.includes('looks good');
  });
}

// ================== POLLING MODE ==================

async function pollUntilReady(args) {
  const { owner, repo, pr, pollInterval, maxPolls, outputFile } = args;
  let polls = 0;

  while (polls < maxPolls) {
    polls++;
    const status = collectPRStatus(owner, repo, pr);
    const out = outputFile || OUTPUT_FILE;

    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(status, null, 2));

    const actions = status.action_needed;

    console.log(`[poll-pr] Poll ${polls}/${maxPolls}:`);
    console.log(`  CI: ${status.ci.state} (${status.ci.still_running ? 'running' : 'done'})`);
    console.log(`  Unresolved threads: ${status.review_threads.unresolved}`);
    console.log(`  Bot issues: ${status.unresolved_bot_issues.length}`);
    console.log(`  Approvals: ${status.reviews.approvals.length}`);

    if (!actions.wait_ci && !actions.fix_ci && !actions.fix_bot_issues && !actions.resolve_threads) {
      console.log('[poll-pr] PR is ready - all clear');
      return status;
    }

    if (actions.fix_ci || actions.fix_bot_issues) {
      console.log('[poll-pr] Action needed - returning current status');
      return status;
    }

    if (actions.wait_ci) {
      console.log(`[poll-pr] CI still running, waiting ${pollInterval}s...`);
      await new Promise((resolve) => setTimeout(resolve, pollInterval * 1000));
      continue;
    }

    // Nothing actionable but not fully clean - return
    return status;
  }

  console.log('[poll-pr] Max polls reached');
  return collectPRStatus(owner, repo, pr);
}

// ================== MAIN ==================

async function main() {
  const args = parseArgs();

  if (!args.owner || !args.repo || !args.pr) {
    console.error('Usage: node poll-pr-status.js --owner <owner> --repo <repo> --pr <number>');
    process.exit(1);
  }

  // Check gh CLI
  try {
    execSync('gh auth status', { stdio: 'pipe' });
  } catch {
    console.error('[poll-pr] GitHub CLI not authenticated. Run: gh auth login');
    process.exit(2);
  }

  let status;

  if (args.waitCi) {
    status = await pollUntilReady(args);
  } else {
    status = collectPRStatus(args.owner, args.repo, args.pr);
  }

  const out = args.outputFile || OUTPUT_FILE;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(status, null, 2));

  console.log(`[poll-pr] Status written to ${out}`);

  // Exit with appropriate code
  if (status.action_needed.fix_ci || status.action_needed.fix_bot_issues) {
    process.exit(0); // Success but action needed (caller reads the file)
  }

  process.exit(0);
}

main();

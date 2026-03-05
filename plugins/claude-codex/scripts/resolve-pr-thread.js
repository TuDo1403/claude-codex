#!/usr/bin/env node
/**
 * PR Thread Resolver
 *
 * Resolves GitHub PR review threads via GraphQL.
 * Can resolve individual threads or all threads at once.
 *
 * Usage:
 *   node resolve-pr-thread.js --thread-id <graphql_thread_id>
 *   node resolve-pr-thread.js --owner <owner> --repo <repo> --pr <number> --all
 *   node resolve-pr-thread.js --owner <owner> --repo <repo> --pr <number> --all --reply "fixed, thanks"
 *
 * Exit codes:
 *   0 - Success
 *   1 - Validation error
 *   2 - GitHub API error
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TASK_DIR = '.task';

// ================== ARGUMENT PARSING ==================

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    threadId: null,
    owner: null,
    repo: null,
    pr: null,
    all: false,
    reply: null,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--thread-id': result.threadId = args[++i]; break;
      case '--owner': result.owner = args[++i]; break;
      case '--repo': result.repo = args[++i]; break;
      case '--pr': result.pr = parseInt(args[++i]); break;
      case '--all': result.all = true; break;
      case '--reply': result.reply = args[++i]; break;
      case '--dry-run': result.dryRun = true; break;
    }
  }

  return result;
}

// ================== GRAPHQL HELPERS ==================

function ghGraphQL(query, variables) {
  try {
    let cmd = 'gh api graphql';
    cmd += ` -f query='${query.replace(/'/g, "'\\''")}'`;
    if (variables) {
      for (const [key, val] of Object.entries(variables)) {
        cmd += ` -f ${key}="${val}"`;
      }
    }
    const result = execSync(cmd, { encoding: 'utf8', timeout: 30000 });
    return JSON.parse(result);
  } catch (err) {
    console.error(`[resolve-thread] GraphQL error: ${err.message}`);
    return null;
  }
}

function ghGraphQLRaw(queryBody) {
  try {
    const escaped = queryBody.replace(/"/g, '\\"').replace(/\n/g, ' ');
    const result = execSync(`gh api graphql -f query="${escaped}"`, {
      encoding: 'utf8',
      timeout: 30000,
    });
    return JSON.parse(result);
  } catch (err) {
    console.error(`[resolve-thread] GraphQL error: ${err.message}`);
    return null;
  }
}

// ================== THREAD OPERATIONS ==================

function getUnresolvedThreads(owner, repo, pr) {
  const query = `{
    repository(owner: "${owner}", name: "${repo}") {
      pullRequest(number: ${pr}) {
        reviewThreads(first: 100) {
          nodes {
            id
            isResolved
            isOutdated
            comments(first: 5) {
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

  const result = ghGraphQLRaw(query);
  if (!result?.data?.repository?.pullRequest?.reviewThreads?.nodes) return [];

  return result.data.repository.pullRequest.reviewThreads.nodes
    .filter((t) => !t.isResolved);
}

function resolveThread(threadId) {
  const mutation = `mutation {
    resolveReviewThread(input: { threadId: "${threadId}" }) {
      thread {
        id
        isResolved
      }
    }
  }`;

  const result = ghGraphQLRaw(mutation);
  if (!result?.data?.resolveReviewThread?.thread?.isResolved) {
    console.error(`[resolve-thread] Failed to resolve thread ${threadId}`);
    return false;
  }

  return true;
}

function addReplyToThread(owner, repo, pr, threadId, body, threads) {
  // Find the last comment in the thread to reply to
  const thread = threads?.find((t) => t.id === threadId);
  if (!thread?.comments?.nodes?.length) {
    console.warn(`[resolve-thread] No comments found in thread ${threadId}, skipping reply`);
    return false;
  }

  // Use the pull request review thread reply mutation
  const mutation = `mutation {
    addPullRequestReviewThreadReply(input: {
      pullRequestReviewThreadId: "${threadId}",
      body: "${body.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"
    }) {
      comment {
        id
        body
      }
    }
  }`;

  const result = ghGraphQLRaw(mutation);
  if (!result?.data?.addPullRequestReviewThreadReply?.comment) {
    console.error(`[resolve-thread] Failed to reply to thread ${threadId}`);
    return false;
  }

  return true;
}

// ================== MAIN ==================

function main() {
  const args = parseArgs();

  // Single thread resolution
  if (args.threadId && !args.all) {
    console.log(`[resolve-thread] Resolving thread ${args.threadId}...`);

    if (args.dryRun) {
      console.log('[resolve-thread] DRY RUN -- would resolve thread');
      process.exit(0);
    }

    const success = resolveThread(args.threadId);
    if (success) {
      console.log('[resolve-thread] Thread resolved');
      process.exit(0);
    } else {
      process.exit(2);
    }
  }

  // Batch resolution
  if (args.all) {
    if (!args.owner || !args.repo || !args.pr) {
      console.error('Usage: node resolve-pr-thread.js --owner <owner> --repo <repo> --pr <number> --all');
      process.exit(1);
    }

    console.log(`[resolve-thread] Fetching unresolved threads for ${args.owner}/${args.repo}#${args.pr}...`);

    const threads = getUnresolvedThreads(args.owner, args.repo, args.pr);
    console.log(`[resolve-thread] Found ${threads.length} unresolved threads`);

    if (threads.length === 0) {
      console.log('[resolve-thread] Nothing to resolve');
      process.exit(0);
    }

    if (args.dryRun) {
      threads.forEach((t) => {
        const firstComment = t.comments?.nodes?.[0];
        console.log(`  Thread ${t.id}: ${firstComment?.body?.slice(0, 100) || 'no comment'}`);
      });
      console.log('[resolve-thread] DRY RUN -- would resolve all above');
      process.exit(0);
    }

    let resolved = 0;
    let failed = 0;

    for (const thread of threads) {
      const firstComment = thread.comments?.nodes?.[0];
      const preview = firstComment?.body?.slice(0, 80) || 'no comment';
      console.log(`[resolve-thread] Resolving: ${preview}...`);

      // Reply first if requested
      if (args.reply) {
        addReplyToThread(args.owner, args.repo, args.pr, thread.id, args.reply, threads);
      }

      const success = resolveThread(thread.id);
      if (success) {
        resolved++;
      } else {
        failed++;
      }
    }

    console.log(`[resolve-thread] Done: ${resolved} resolved, ${failed} failed`);

    // Write result
    const resultFile = path.join(TASK_DIR, 'thread-resolution.json');
    try {
      fs.mkdirSync(TASK_DIR, { recursive: true });
      fs.writeFileSync(resultFile, JSON.stringify({
        pr: args.pr,
        owner: args.owner,
        repo: args.repo,
        total_unresolved: threads.length,
        resolved,
        failed,
        timestamp: new Date().toISOString(),
      }, null, 2));
    } catch { /* non-critical */ }

    process.exit(failed > 0 ? 2 : 0);
  }

  console.error('Usage:');
  console.error('  node resolve-pr-thread.js --thread-id <id>');
  console.error('  node resolve-pr-thread.js --owner <o> --repo <r> --pr <n> --all');
  process.exit(1);
}

main();

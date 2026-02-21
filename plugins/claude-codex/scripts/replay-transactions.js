#!/usr/bin/env bun
/**
 * Replay Transactions — Re-execute recorded transactions against a fresh chain (G24)
 *
 * EVMbench Appendix D.2: "Re-executing the agent's transaction sequence
 * (recorded as signed raw transactions) against the chain instance in the
 * grading container."
 *
 * Reads recorded transactions from rpc-gatekeeper output or a transactions JSON file,
 * replays them sequentially against an RPC endpoint, and reports results.
 *
 * Usage:
 *   bun replay-transactions.js --transactions txs.json --rpc-url http://localhost:8545
 *   bun replay-transactions.js --transactions txs.json --rpc-url http://localhost:8545 --output replay-results.json
 *
 * Exports: replayTransactions, replaySingleTransaction
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { parseArgs } from 'util';

/**
 * Replay a single transaction via JSON-RPC.
 * Supports both eth_sendRawTransaction and eth_sendTransaction.
 *
 * @param {string} rpcUrl - RPC endpoint
 * @param {object} tx - Recorded transaction { method, params, sequence }
 * @returns {Promise<{success: boolean, tx_hash?: string, error?: string, gas_used?: string}>}
 */
async function replaySingleTransaction(rpcUrl, tx) {
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: tx.method,
        params: tx.params,
        id: tx.sequence + 1
      })
    });

    const data = await res.json();

    if (data.error) {
      return {
        success: false,
        sequence: tx.sequence,
        method: tx.method,
        error: data.error.message || JSON.stringify(data.error)
      };
    }

    const txHash = data.result;

    // Wait for receipt
    let receipt = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise(r => setTimeout(r, 500));
      const receiptRes = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getTransactionReceipt',
          params: [txHash],
          id: 99
        })
      });
      const receiptData = await receiptRes.json();
      if (receiptData.result) {
        receipt = receiptData.result;
        break;
      }
    }

    return {
      success: receipt ? receipt.status === '0x1' : true,
      sequence: tx.sequence,
      method: tx.method,
      tx_hash: txHash,
      original_tx_hash: tx.tx_hash,
      gas_used: receipt?.gasUsed || null,
      status: receipt?.status || null
    };
  } catch (err) {
    return {
      success: false,
      sequence: tx.sequence,
      method: tx.method,
      error: err.message
    };
  }
}

/**
 * Replay all recorded transactions sequentially.
 * Transactions must be replayed in order (nonce-dependent).
 *
 * @param {string} rpcUrl - RPC endpoint
 * @param {object[]} transactions - Array of recorded transactions sorted by sequence
 * @returns {Promise<{results: object[], summary: object}>}
 */
async function replayTransactions(rpcUrl, transactions) {
  // Sort by sequence to ensure correct ordering
  const sorted = [...transactions].sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

  const results = [];
  let succeeded = 0;
  let failed = 0;

  for (const tx of sorted) {
    const result = await replaySingleTransaction(rpcUrl, tx);
    results.push(result);

    if (result.success) {
      succeeded++;
    } else {
      failed++;
      // Continue replaying even if one fails — partial exploits still count
    }
  }

  return {
    results,
    summary: {
      total: sorted.length,
      succeeded,
      failed,
      all_succeeded: failed === 0,
      replayed_at: new Date().toISOString()
    }
  };
}

// ======================== CLI ========================

function parseArguments() {
  const { values } = parseArgs({
    options: {
      'transactions': { type: 'string' },
      'rpc-url': { type: 'string' },
      'output': { type: 'string' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: true
  });

  if (values.help) {
    console.log(`
Usage: replay-transactions.js --transactions <txs.json> --rpc-url <url>

Replay recorded transactions against a chain for grading (EVMbench Appendix D.2).

Options:
  --transactions  Path to recorded transactions JSON
  --rpc-url       RPC endpoint to replay against
  --output        Output path for replay results (default: stdout)
  -h, --help      Show this help message

Transaction Format (from rpc-gatekeeper):
  [{ "sequence": 0, "method": "eth_sendRawTransaction", "params": [...], "tx_hash": "0x..." }]
    `);
    process.exit(0);
  }

  return values;
}

async function main() {
  const args = parseArguments();

  if (!args.transactions || !args['rpc-url']) {
    console.error('Error: --transactions and --rpc-url are required');
    process.exit(1);
  }

  if (!existsSync(args.transactions)) {
    console.error(`File not found: ${args.transactions}`);
    process.exit(1);
  }

  const txData = JSON.parse(readFileSync(args.transactions, 'utf-8'));
  const transactions = Array.isArray(txData) ? txData : (txData.transactions || []);

  console.log(`\n=== Transaction Replay (EVMbench Appendix D.2) ===`);
  console.log(`Transactions: ${transactions.length}`);
  console.log(`RPC: ${args['rpc-url']}`);

  const { results, summary } = await replayTransactions(args['rpc-url'], transactions);

  console.log(`\nResults:`);
  for (const r of results) {
    const status = r.success ? 'OK' : 'FAIL';
    console.log(`  [${r.sequence}] ${r.method} -> ${status}${r.tx_hash ? ` (${r.tx_hash.slice(0, 10)}...)` : ''}${r.error ? ` ERROR: ${r.error}` : ''}`);
  }

  console.log(`\nSummary: ${summary.succeeded}/${summary.total} succeeded`);

  if (args.output) {
    writeFileSync(args.output, JSON.stringify({ results, summary }, null, 2));
    console.log(`Report: ${args.output}`);
  }

  if (!summary.all_succeeded) {
    process.exit(1);
  }
}

if (import.meta.main !== false) {
  main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

export { replayTransactions, replaySingleTransaction };

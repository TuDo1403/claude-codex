#!/usr/bin/env bun
/**
 * RPC Gatekeeper - Whitelist-based JSON-RPC proxy (G4)
 *
 * HTTP proxy that whitelists eth_, net_, web3_ RPC methods and blocks
 * everything else (anvil_, debug_, evm_). Logs all calls to audit trail.
 *
 * Whitelist approach ensures new Anvil cheat-codes are blocked automatically.
 *
 * Usage:
 *   bun rpc-gatekeeper.js --upstream http://localhost:8545 --port 8546
 *   bun rpc-gatekeeper.js --upstream http://localhost:8545 --port 8546 --audit-log ./rpc-audit-trail.jsonl
 *
 * Exports: isMethodAllowed, createGatekeeperServer, ALLOWED_PREFIXES
 */

import { writeFileSync, appendFileSync, existsSync } from 'fs';
import { parseArgs } from 'util';

// ======================== Whitelist Configuration ========================

const ALLOWED_PREFIXES = ['eth_', 'net_', 'web3_'];

/**
 * Check if an RPC method is allowed through the gatekeeper.
 * Whitelist approach: only methods starting with allowed prefixes pass.
 */
function isMethodAllowed(method) {
  if (!method || typeof method !== 'string') return false;
  return ALLOWED_PREFIXES.some(prefix => method.startsWith(prefix));
}

/**
 * Create a blocked method JSON-RPC error response.
 */
function blockedResponse(id) {
  return {
    jsonrpc: '2.0',
    id: id || null,
    error: {
      code: -32601,
      message: 'Method not allowed'
    }
  };
}

// ======================== Transaction Recording ========================

// Methods that contain signed transactions for replay (EVMbench Appendix D.2)
const TX_METHODS = ['eth_sendRawTransaction', 'eth_sendTransaction'];

/**
 * Check if an RPC method sends a transaction.
 */
function isTxMethod(method) {
  return TX_METHODS.includes(method);
}

// ======================== Audit Logging ========================

function logCall(auditPath, entry) {
  if (!auditPath) return;
  try {
    appendFileSync(auditPath, JSON.stringify(entry) + '\n');
  } catch {
    // Non-critical, don't crash proxy
  }
}

// ======================== Proxy Server ========================

/**
 * Create an HTTP server that proxies allowed RPC methods to upstream.
 * Returns { server, close() }.
 */
function createGatekeeperServer(options = {}) {
  const {
    upstreamUrl = 'http://localhost:8545',
    port = 8546,
    auditLog = null
  } = options;

  let requestCount = 0;
  let blockedCount = 0;
  const recordedTransactions = [];

  const server = Bun.serve({
    port,
    async fetch(req) {
      if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Only POST allowed' }), {
          status: 405,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      let body;
      try {
        body = await req.json();
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Handle batch requests
      const isBatch = Array.isArray(body);
      const requests = isBatch ? body : [body];
      const responses = [];

      for (const rpcReq of requests) {
        requestCount++;
        const method = rpcReq.method;
        const allowed = isMethodAllowed(method);
        const isTx = isTxMethod(method);

        const logEntry = {
          timestamp: new Date().toISOString(),
          method,
          allowed,
          id: rpcReq.id
        };

        // For transaction-sending methods, capture the full request for replay
        // (EVMbench Appendix D.2: record signed raw transactions)
        if (isTx && allowed) {
          logEntry.tx_params = rpcReq.params;
        }

        if (!allowed) {
          blockedCount++;
          logCall(auditLog, logEntry);
          responses.push(blockedResponse(rpcReq.id));
          continue;
        }

        // Forward to upstream
        try {
          const upstreamRes = await fetch(upstreamUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(rpcReq)
          });
          const upstreamData = await upstreamRes.json();
          responses.push(upstreamData);

          // Record transaction hash from response for replay
          if (isTx && upstreamData.result) {
            const txRecord = {
              sequence: recordedTransactions.length,
              timestamp: new Date().toISOString(),
              method,
              params: rpcReq.params,
              tx_hash: upstreamData.result
            };
            recordedTransactions.push(txRecord);
            logEntry.tx_hash = upstreamData.result;
          }
        } catch (err) {
          responses.push({
            jsonrpc: '2.0',
            id: rpcReq.id || null,
            error: {
              code: -32603,
              message: `Upstream error: ${err.message}`
            }
          });
        }

        logCall(auditLog, logEntry);
      }

      const result = isBatch ? responses : responses[0];
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });

  return {
    server,
    port: server.port,
    get stats() {
      return { requestCount, blockedCount, txCount: recordedTransactions.length };
    },
    get transactions() {
      return recordedTransactions;
    },
    close() {
      server.stop();
    }
  };
}

// ======================== CLI ========================

function parseArguments() {
  const { values } = parseArgs({
    options: {
      'upstream': { type: 'string' },
      'port': { type: 'string' },
      'audit-log': { type: 'string' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: true
  });

  if (values.help) {
    console.log(`
Usage: rpc-gatekeeper.js [options]

Whitelist-based JSON-RPC proxy for Anvil. Allows eth_*/net_*/web3_*, blocks everything else.

Options:
  --upstream   Upstream RPC URL (default: http://localhost:8545)
  --port       Gatekeeper listen port (default: 8546)
  --audit-log  Path for audit trail JSONL (default: ./rpc-audit-trail.jsonl)
  -h, --help   Show this help message
    `);
    process.exit(0);
  }

  return values;
}

async function main() {
  const args = parseArguments();
  const upstreamUrl = args.upstream || 'http://localhost:8545';
  const port = parseInt(args.port || '8546');
  const auditLog = args['audit-log'] || './rpc-audit-trail.jsonl';

  console.log(`RPC Gatekeeper starting...`);
  console.log(`  Upstream: ${upstreamUrl}`);
  console.log(`  Listen:   http://localhost:${port}`);
  console.log(`  Audit:    ${auditLog}`);
  console.log(`  Allowed:  ${ALLOWED_PREFIXES.join(', ')}`);

  const gk = createGatekeeperServer({ upstreamUrl, port, auditLog });
  console.log(`\nGatekeeper running on port ${gk.port}`);

  // Keep alive
  process.on('SIGINT', () => {
    console.log(`\nShutting down. Stats: ${JSON.stringify(gk.stats)}`);
    gk.close();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    gk.close();
    process.exit(0);
  });
}

if (import.meta.main !== false) {
  main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

export { isMethodAllowed, isTxMethod, createGatekeeperServer, blockedResponse, ALLOWED_PREFIXES, TX_METHODS };

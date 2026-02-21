import { describe, it, expect, afterEach } from 'bun:test';
import { replayTransactions, replaySingleTransaction } from './replay-transactions.js';

// ================== replaySingleTransaction ==================

describe('replaySingleTransaction', () => {
  it('returns error for unreachable RPC', async () => {
    const tx = { sequence: 0, method: 'eth_sendRawTransaction', params: ['0xdead'] };
    const result = await replaySingleTransaction('http://localhost:1', tx);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe('string');
    expect(result.sequence).toBe(0);
    expect(result.method).toBe('eth_sendRawTransaction');
  });

  it('preserves sequence and method in result', async () => {
    const tx = { sequence: 5, method: 'eth_sendTransaction', params: [{}] };
    const result = await replaySingleTransaction('http://localhost:1', tx);
    expect(result.sequence).toBe(5);
    expect(result.method).toBe('eth_sendTransaction');
  });

  it('handles RPC error response', async () => {
    // Mock server that returns JSON-RPC error
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(JSON.stringify({
          jsonrpc: '2.0', id: 1,
          error: { code: -32000, message: 'nonce too low' }
        }), { headers: { 'Content-Type': 'application/json' } });
      }
    });
    try {
      const tx = { sequence: 0, method: 'eth_sendRawTransaction', params: ['0xdead'] };
      const result = await replaySingleTransaction(`http://localhost:${server.port}`, tx);
      expect(result.success).toBe(false);
      expect(result.error).toContain('nonce too low');
    } finally {
      server.stop();
    }
  });

  it('handles successful tx with receipt', async () => {
    let callCount = 0;
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        callCount++;
        if (callCount === 1) {
          // First call: eth_sendRawTransaction → returns tx hash
          return new Response(JSON.stringify({
            jsonrpc: '2.0', id: 1, result: '0xabcdef1234567890'
          }), { headers: { 'Content-Type': 'application/json' } });
        }
        // Subsequent calls: eth_getTransactionReceipt → return receipt
        return new Response(JSON.stringify({
          jsonrpc: '2.0', id: 99,
          result: { status: '0x1', gasUsed: '0x5208' }
        }), { headers: { 'Content-Type': 'application/json' } });
      }
    });
    try {
      const tx = { sequence: 0, method: 'eth_sendRawTransaction', params: ['0xdead'] };
      const result = await replaySingleTransaction(`http://localhost:${server.port}`, tx);
      expect(result.success).toBe(true);
      expect(result.tx_hash).toBe('0xabcdef1234567890');
      expect(result.status).toBe('0x1');
      expect(result.gas_used).toBe('0x5208');
    } finally {
      server.stop();
    }
  });

  it('handles successful tx with reverted receipt', async () => {
    let callCount = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        callCount++;
        if (callCount === 1) {
          return new Response(JSON.stringify({
            jsonrpc: '2.0', id: 1, result: '0xabcdef'
          }), { headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({
          jsonrpc: '2.0', id: 99,
          result: { status: '0x0', gasUsed: '0xffff' }
        }), { headers: { 'Content-Type': 'application/json' } });
      }
    });
    try {
      const tx = { sequence: 0, method: 'eth_sendRawTransaction', params: ['0xdead'] };
      const result = await replaySingleTransaction(`http://localhost:${server.port}`, tx);
      expect(result.success).toBe(false); // 0x0 = reverted
      expect(result.status).toBe('0x0');
    } finally {
      server.stop();
    }
  });
});

// ================== replayTransactions ==================

describe('replayTransactions', () => {
  it('returns summary for empty transactions', async () => {
    const { results, summary } = await replayTransactions('http://localhost:1', []);
    expect(results).toEqual([]);
    expect(summary.total).toBe(0);
    expect(summary.succeeded).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.all_succeeded).toBe(true);
  });

  it('sorts transactions by sequence', async () => {
    const txs = [
      { sequence: 2, method: 'eth_sendRawTransaction', params: ['0xaa'] },
      { sequence: 0, method: 'eth_sendRawTransaction', params: ['0xbb'] },
      { sequence: 1, method: 'eth_sendRawTransaction', params: ['0xcc'] },
    ];
    // Will fail due to unreachable RPC, but should process in order
    const { results } = await replayTransactions('http://localhost:1', txs);
    expect(results[0].sequence).toBe(0);
    expect(results[1].sequence).toBe(1);
    expect(results[2].sequence).toBe(2);
  });

  it('reports all_succeeded false when transactions fail', async () => {
    const txs = [{ sequence: 0, method: 'eth_sendRawTransaction', params: ['0xaa'] }];
    const { summary } = await replayTransactions('http://localhost:1', txs);
    expect(summary.all_succeeded).toBe(false);
    expect(summary.failed).toBe(1);
    expect(summary.succeeded).toBe(0);
    expect(summary.total).toBe(1);
  });

  it('includes replayed_at timestamp in summary', async () => {
    const before = new Date().toISOString();
    const { summary } = await replayTransactions('http://localhost:1', []);
    const after = new Date().toISOString();
    expect(summary.replayed_at).toBeDefined();
    expect(summary.replayed_at >= before).toBe(true);
    expect(summary.replayed_at <= after).toBe(true);
  });

  it('continues replaying after individual failures', async () => {
    const txs = [
      { sequence: 0, method: 'eth_sendRawTransaction', params: ['0xaa'] },
      { sequence: 1, method: 'eth_sendRawTransaction', params: ['0xbb'] },
      { sequence: 2, method: 'eth_sendRawTransaction', params: ['0xcc'] },
    ];
    const { results, summary } = await replayTransactions('http://localhost:1', txs);
    expect(results).toHaveLength(3);
    expect(summary.failed).toBe(3);
    // All 3 were attempted despite failures
    expect(results.every(r => r.error)).toBe(true);
  });

  it('does not mutate original transaction array', async () => {
    const txs = [
      { sequence: 2, method: 'eth_sendRawTransaction', params: ['0xaa'] },
      { sequence: 0, method: 'eth_sendRawTransaction', params: ['0xbb'] },
    ];
    await replayTransactions('http://localhost:1', txs);
    // Original array should still be in original order
    expect(txs[0].sequence).toBe(2);
    expect(txs[1].sequence).toBe(0);
  });

  it('handles transactions with missing sequence field', async () => {
    const txs = [
      { method: 'eth_sendRawTransaction', params: ['0xaa'] },
      { sequence: 1, method: 'eth_sendRawTransaction', params: ['0xbb'] },
    ];
    const { results } = await replayTransactions('http://localhost:1', txs);
    // Missing sequence treated as 0, should come first
    expect(results[0].sequence).toBeUndefined();
    expect(results[1].sequence).toBe(1);
  });
});

import { describe, it, expect, afterEach } from 'bun:test';
import { isMethodAllowed, isTxMethod, blockedResponse, ALLOWED_PREFIXES, TX_METHODS } from './rpc-gatekeeper.js';

// ================== isMethodAllowed ==================

describe('isMethodAllowed', () => {
  // Allowed methods (eth_*)
  it('allows eth_getBalance', () => {
    expect(isMethodAllowed('eth_getBalance')).toBe(true);
  });

  it('allows eth_call', () => {
    expect(isMethodAllowed('eth_call')).toBe(true);
  });

  it('allows eth_sendTransaction', () => {
    expect(isMethodAllowed('eth_sendTransaction')).toBe(true);
  });

  it('allows eth_sendRawTransaction', () => {
    expect(isMethodAllowed('eth_sendRawTransaction')).toBe(true);
  });

  it('allows eth_blockNumber', () => {
    expect(isMethodAllowed('eth_blockNumber')).toBe(true);
  });

  it('allows eth_getTransactionReceipt', () => {
    expect(isMethodAllowed('eth_getTransactionReceipt')).toBe(true);
  });

  it('allows eth_estimateGas', () => {
    expect(isMethodAllowed('eth_estimateGas')).toBe(true);
  });

  it('allows eth_chainId', () => {
    expect(isMethodAllowed('eth_chainId')).toBe(true);
  });

  // Allowed methods (net_*)
  it('allows net_version', () => {
    expect(isMethodAllowed('net_version')).toBe(true);
  });

  it('allows net_listening', () => {
    expect(isMethodAllowed('net_listening')).toBe(true);
  });

  // Allowed methods (web3_*)
  it('allows web3_clientVersion', () => {
    expect(isMethodAllowed('web3_clientVersion')).toBe(true);
  });

  it('allows web3_sha3', () => {
    expect(isMethodAllowed('web3_sha3')).toBe(true);
  });

  // Blocked methods (anvil_*)
  it('blocks anvil_setBalance', () => {
    expect(isMethodAllowed('anvil_setBalance')).toBe(false);
  });

  it('blocks anvil_impersonateAccount', () => {
    expect(isMethodAllowed('anvil_impersonateAccount')).toBe(false);
  });

  it('blocks anvil_mine', () => {
    expect(isMethodAllowed('anvil_mine')).toBe(false);
  });

  it('blocks anvil_setCode', () => {
    expect(isMethodAllowed('anvil_setCode')).toBe(false);
  });

  it('blocks anvil_setStorageAt', () => {
    expect(isMethodAllowed('anvil_setStorageAt')).toBe(false);
  });

  // Blocked methods (debug_*)
  it('blocks debug_traceTransaction', () => {
    expect(isMethodAllowed('debug_traceTransaction')).toBe(false);
  });

  it('blocks debug_setHead', () => {
    expect(isMethodAllowed('debug_setHead')).toBe(false);
  });

  // Blocked methods (evm_*)
  it('blocks evm_snapshot', () => {
    expect(isMethodAllowed('evm_snapshot')).toBe(false);
  });

  it('blocks evm_revert', () => {
    expect(isMethodAllowed('evm_revert')).toBe(false);
  });

  it('blocks evm_setAutomine', () => {
    expect(isMethodAllowed('evm_setAutomine')).toBe(false);
  });

  it('blocks evm_increaseTime', () => {
    expect(isMethodAllowed('evm_increaseTime')).toBe(false);
  });

  // Edge cases
  it('blocks null method', () => {
    expect(isMethodAllowed(null)).toBe(false);
  });

  it('blocks undefined method', () => {
    expect(isMethodAllowed(undefined)).toBe(false);
  });

  it('blocks empty string', () => {
    expect(isMethodAllowed('')).toBe(false);
  });

  it('blocks number', () => {
    expect(isMethodAllowed(42)).toBe(false);
  });

  it('blocks random method', () => {
    expect(isMethodAllowed('custom_method')).toBe(false);
  });

  it('blocks hardhat methods', () => {
    expect(isMethodAllowed('hardhat_setBalance')).toBe(false);
  });

  it('blocks tenderly methods', () => {
    expect(isMethodAllowed('tenderly_setBalance')).toBe(false);
  });
});

// ================== blockedResponse ==================

describe('blockedResponse', () => {
  it('returns JSON-RPC error with id', () => {
    const res = blockedResponse(1);
    expect(res.jsonrpc).toBe('2.0');
    expect(res.id).toBe(1);
    expect(res.error.code).toBe(-32601);
    expect(res.error.message).toBe('Method not allowed');
  });

  it('handles null id', () => {
    const res = blockedResponse(null);
    expect(res.id).toBeNull();
    expect(res.error.code).toBe(-32601);
  });

  it('handles undefined id', () => {
    const res = blockedResponse(undefined);
    expect(res.id).toBeNull();
  });

  it('handles string id', () => {
    const res = blockedResponse('abc-123');
    expect(res.id).toBe('abc-123');
  });
});

// ================== ALLOWED_PREFIXES ==================

describe('ALLOWED_PREFIXES', () => {
  it('contains eth_', () => {
    expect(ALLOWED_PREFIXES).toContain('eth_');
  });

  it('contains net_', () => {
    expect(ALLOWED_PREFIXES).toContain('net_');
  });

  it('contains web3_', () => {
    expect(ALLOWED_PREFIXES).toContain('web3_');
  });

  it('does not contain anvil_', () => {
    expect(ALLOWED_PREFIXES).not.toContain('anvil_');
  });

  it('does not contain debug_', () => {
    expect(ALLOWED_PREFIXES).not.toContain('debug_');
  });

  it('does not contain evm_', () => {
    expect(ALLOWED_PREFIXES).not.toContain('evm_');
  });

  it('has exactly 3 prefixes', () => {
    expect(ALLOWED_PREFIXES).toHaveLength(3);
  });
});

// ================== isTxMethod ==================

describe('isTxMethod', () => {
  it('identifies eth_sendRawTransaction as tx method', () => {
    expect(isTxMethod('eth_sendRawTransaction')).toBe(true);
  });

  it('identifies eth_sendTransaction as tx method', () => {
    expect(isTxMethod('eth_sendTransaction')).toBe(true);
  });

  it('does not identify eth_call as tx method', () => {
    expect(isTxMethod('eth_call')).toBe(false);
  });

  it('does not identify eth_getBalance as tx method', () => {
    expect(isTxMethod('eth_getBalance')).toBe(false);
  });

  it('does not identify blocked methods as tx methods', () => {
    expect(isTxMethod('anvil_setBalance')).toBe(false);
  });
});

// ================== TX_METHODS ==================

describe('TX_METHODS', () => {
  it('contains eth_sendRawTransaction', () => {
    expect(TX_METHODS).toContain('eth_sendRawTransaction');
  });

  it('contains eth_sendTransaction', () => {
    expect(TX_METHODS).toContain('eth_sendTransaction');
  });

  it('has exactly 2 methods', () => {
    expect(TX_METHODS).toHaveLength(2);
  });
});

// ================== createGatekeeperServer ==================

describe('createGatekeeperServer', () => {
  let gk;

  afterEach(() => {
    if (gk) {
      gk.close();
      gk = null;
    }
  });

  it('starts server on specified port', async () => {
    const { createGatekeeperServer } = await import('./rpc-gatekeeper.js');
    gk = createGatekeeperServer({ port: 0 }); // port 0 = auto-assign
    expect(gk.port).toBeGreaterThan(0);
    expect(gk.stats.requestCount).toBe(0);
    expect(gk.stats.blockedCount).toBe(0);
  });

  it('blocks non-POST requests', async () => {
    const { createGatekeeperServer } = await import('./rpc-gatekeeper.js');
    gk = createGatekeeperServer({ port: 0 });
    const res = await fetch(`http://localhost:${gk.port}`, { method: 'GET' });
    expect(res.status).toBe(405);
    const data = await res.json();
    expect(data.error).toBe('Only POST allowed');
  });

  it('blocks invalid JSON body', async () => {
    const { createGatekeeperServer } = await import('./rpc-gatekeeper.js');
    gk = createGatekeeperServer({ port: 0 });
    const res = await fetch(`http://localhost:${gk.port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json'
    });
    expect(res.status).toBe(400);
  });

  it('blocks disallowed methods with JSON-RPC error', async () => {
    const { createGatekeeperServer } = await import('./rpc-gatekeeper.js');
    gk = createGatekeeperServer({ port: 0 });
    const res = await fetch(`http://localhost:${gk.port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'anvil_setBalance', params: [], id: 1 })
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.error.code).toBe(-32601);
    expect(data.error.message).toBe('Method not allowed');
    expect(gk.stats.blockedCount).toBe(1);
  });

  it('handles batch requests with mixed allowed/blocked', async () => {
    const { createGatekeeperServer } = await import('./rpc-gatekeeper.js');
    gk = createGatekeeperServer({ port: 0 });
    const batch = [
      { jsonrpc: '2.0', method: 'anvil_mine', params: [], id: 1 },
      { jsonrpc: '2.0', method: 'evm_snapshot', params: [], id: 2 }
    ];
    const res = await fetch(`http://localhost:${gk.port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch)
    });
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(2);
    expect(data[0].error.code).toBe(-32601);
    expect(data[1].error.code).toBe(-32601);
    expect(gk.stats.blockedCount).toBe(2);
  });

  it('returns upstream error when upstream unreachable for allowed method', async () => {
    const { createGatekeeperServer } = await import('./rpc-gatekeeper.js');
    gk = createGatekeeperServer({ port: 0, upstreamUrl: 'http://localhost:1' });
    const res = await fetch(`http://localhost:${gk.port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 })
    });
    const data = await res.json();
    expect(data.error.code).toBe(-32603);
    expect(data.error.message).toContain('Upstream error');
  });

  it('tracks transaction count for tx methods', async () => {
    const { createGatekeeperServer } = await import('./rpc-gatekeeper.js');
    gk = createGatekeeperServer({ port: 0, upstreamUrl: 'http://localhost:1' });
    // Send a tx method (will fail at upstream, but gets recorded in requestCount)
    await fetch(`http://localhost:${gk.port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_sendRawTransaction', params: ['0xdead'], id: 1 })
    });
    expect(gk.stats.requestCount).toBe(1);
    expect(gk.stats.blockedCount).toBe(0); // eth_sendRawTransaction is allowed
  });
});

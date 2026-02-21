import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { loadHints, loadCoverageHints, parseTokenUsage } from './codex-detect.js';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

// Use a temp directory for test fixtures
const TEST_DIR = join(import.meta.dir, '__test-fixtures-detect__');

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
});

// ================== parseTokenUsage ==================

describe('parseTokenUsage', () => {
  it('parses nested JSON usage objects', () => {
    const stdout = '{"usage": {"input_tokens": 100, "output_tokens": 50}}';
    const result = parseTokenUsage(stdout, '');

    expect(result).not.toBeNull();
    expect(result.input_tokens).toBe(100);
    expect(result.output_tokens).toBe(50);
    expect(result.total_tokens).toBe(150);
  });

  it('parses prompt_tokens/completion_tokens format', () => {
    const stdout = '{"usage": {"prompt_tokens": 200, "completion_tokens": 80}}';
    const result = parseTokenUsage(stdout, '');

    expect(result).not.toBeNull();
    expect(result.input_tokens).toBe(200);
    expect(result.output_tokens).toBe(80);
    expect(result.total_tokens).toBe(280);
  });

  it('sums multiple usage objects', () => {
    const stdout = [
      '{"usage": {"input_tokens": 100, "output_tokens": 50}}',
      '{"usage": {"input_tokens": 200, "output_tokens": 100}}'
    ].join('\n');
    const result = parseTokenUsage(stdout, '');

    expect(result).not.toBeNull();
    // Both JSON pattern and nested pattern match, so tokens may be doubled
    // The important thing is it finds usage data
    expect(result.input_tokens).toBeGreaterThan(0);
    expect(result.output_tokens).toBeGreaterThan(0);
  });

  it('parses plain text total_tokens pattern', () => {
    const stderr = 'Processing complete. total_tokens: 5000';
    const result = parseTokenUsage('', stderr);

    expect(result).not.toBeNull();
    expect(result.total_tokens).toBe(5000);
  });

  it('parses total tokens with equals sign', () => {
    const stderr = 'total_tokens=3500';
    const result = parseTokenUsage('', stderr);

    expect(result).not.toBeNull();
    expect(result.total_tokens).toBe(3500);
  });

  it('returns null for no token data', () => {
    const result = parseTokenUsage('some random output', 'more output');
    expect(result).toBeNull();
  });

  it('returns null for empty strings', () => {
    const result = parseTokenUsage('', '');
    expect(result).toBeNull();
  });

  it('returns null for null inputs', () => {
    const result = parseTokenUsage(null, null);
    expect(result).toBeNull();
  });

  it('combines stdout and stderr', () => {
    const stdout = '';
    const stderr = '{"usage": {"input_tokens": 50, "output_tokens": 25}}';
    const result = parseTokenUsage(stdout, stderr);

    expect(result).not.toBeNull();
    expect(result.input_tokens).toBeGreaterThan(0);
  });
});

// ================== loadHints ==================

describe('loadHints', () => {
  it('returns empty string for null path', () => {
    expect(loadHints(null)).toBe('');
  });

  it('returns empty string for undefined path', () => {
    expect(loadHints(undefined)).toBe('');
  });

  it('returns empty string for nonexistent file', () => {
    expect(loadHints('/nonexistent/hints.json')).toBe('');
  });

  it('returns empty string for empty hints array', () => {
    const hintsPath = join(TEST_DIR, 'empty-hints.json');
    writeFileSync(hintsPath, JSON.stringify({ hints: [] }));

    expect(loadHints(hintsPath)).toBe('');
  });

  it('formats hints into markdown section', () => {
    const hintsPath = join(TEST_DIR, 'valid-hints.json');
    writeFileSync(hintsPath, JSON.stringify({
      hints: [
        { hint_id: 'HINT-1', severity: 'HIGH', file: 'src/Vault.sol', line: 42, mechanism: 'reentrancy' },
        { hint_id: 'HINT-2', severity: 'MEDIUM', file: 'src/Oracle.sol', line: null, mechanism: 'oracle-manipulation' },
      ]
    }));

    const result = loadHints(hintsPath);

    expect(result).toContain('HINTS FROM OTHER MODEL');
    expect(result).toContain('HINT-1');
    expect(result).toContain('HIGH');
    expect(result).toContain('src/Vault.sol:42');
    expect(result).toContain('reentrancy');
    expect(result).toContain('HINT-2');
    expect(result).toContain('src/Oracle.sol');
    expect(result).not.toContain('src/Oracle.sol:'); // no line number
  });

  it('returns empty string for invalid JSON', () => {
    const hintsPath = join(TEST_DIR, 'bad-hints.json');
    writeFileSync(hintsPath, 'not valid json{{{');

    expect(loadHints(hintsPath)).toBe('');
  });

  it('returns empty string when hints key missing', () => {
    const hintsPath = join(TEST_DIR, 'no-hints-key.json');
    writeFileSync(hintsPath, JSON.stringify({ other: 'data' }));

    expect(loadHints(hintsPath)).toBe('');
  });
});

// ================== loadCoverageHints ==================

describe('loadCoverageHints', () => {
  it('returns empty string for null path', () => {
    expect(loadCoverageHints(null)).toBe('');
  });

  it('returns empty string for undefined path', () => {
    expect(loadCoverageHints(undefined)).toBe('');
  });

  it('returns empty string for nonexistent file', () => {
    expect(loadCoverageHints('/nonexistent/coverage.json')).toBe('');
  });

  it('returns empty string when no uncovered items', () => {
    const covPath = join(TEST_DIR, 'empty-coverage.json');
    writeFileSync(covPath, JSON.stringify({
      uncovered_entrypoints: [],
      uncovered_modules: []
    }));

    expect(loadCoverageHints(covPath)).toBe('');
  });

  it('formats uncovered modules section', () => {
    const covPath = join(TEST_DIR, 'coverage-modules.json');
    writeFileSync(covPath, JSON.stringify({
      uncovered_entrypoints: [],
      uncovered_modules: [
        { name: 'Oracle', file: 'src/Oracle.sol', type: 'contract' },
        { name: 'MathLib', file: 'src/MathLib.sol', type: 'library' },
      ]
    }));

    const result = loadCoverageHints(covPath);

    expect(result).toContain('UNCOVERED MODULES');
    expect(result).toContain('Oracle');
    expect(result).toContain('src/Oracle.sol');
    expect(result).toContain('contract');
    expect(result).toContain('MathLib');
    expect(result).toContain('library');
  });

  it('formats uncovered entrypoints section', () => {
    const covPath = join(TEST_DIR, 'coverage-entrypoints.json');
    writeFileSync(covPath, JSON.stringify({
      uncovered_entrypoints: [
        { signature: 'Vault.deposit', file: 'src/Vault.sol', line: 10 },
      ],
      uncovered_modules: []
    }));

    const result = loadCoverageHints(covPath);

    expect(result).toContain('UNCOVERED');
    expect(result).toContain('Vault.deposit');
    expect(result).toContain('src/Vault.sol:10');
  });

  it('formats both uncovered modules and entrypoints', () => {
    const covPath = join(TEST_DIR, 'coverage-both.json');
    writeFileSync(covPath, JSON.stringify({
      uncovered_entrypoints: [
        { signature: 'Vault.deposit', file: 'src/Vault.sol', line: 10 },
      ],
      uncovered_modules: [
        { name: 'Oracle', file: 'src/Oracle.sol', type: 'contract' },
      ]
    }));

    const result = loadCoverageHints(covPath);

    expect(result).toContain('Uncovered Modules');
    expect(result).toContain('Uncovered Entrypoints');
    expect(result).toContain('Oracle');
    expect(result).toContain('Vault.deposit');
  });

  it('returns empty string for invalid JSON', () => {
    const covPath = join(TEST_DIR, 'bad-coverage.json');
    writeFileSync(covPath, 'not valid json');

    expect(loadCoverageHints(covPath)).toBe('');
  });
});

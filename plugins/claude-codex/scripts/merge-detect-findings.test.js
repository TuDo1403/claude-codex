import { describe, it, expect } from 'bun:test';
import { normSeverity, locationKey, broadKey, loadFindings, mergeFindings, higherSeverity } from './merge-detect-findings.js';

// ================== normSeverity ==================

describe('normSeverity', () => {
  it('normalizes standard severity strings', () => {
    expect(normSeverity('critical')).toBe('critical');
    expect(normSeverity('CRITICAL')).toBe('critical');
    expect(normSeverity('crit')).toBe('critical');
    expect(normSeverity('high')).toBe('high');
    expect(normSeverity('HIGH')).toBe('high');
    expect(normSeverity('hi')).toBe('high');
    expect(normSeverity('medium')).toBe('medium');
    expect(normSeverity('MED')).toBe('medium');
    expect(normSeverity('med')).toBe('medium');
    expect(normSeverity('low')).toBe('low');
    expect(normSeverity('LOW')).toBe('low');
    expect(normSeverity('lo')).toBe('low');
  });

  it('returns unknown for null/empty', () => {
    expect(normSeverity(null)).toBe('unknown');
    expect(normSeverity(undefined)).toBe('unknown');
    expect(normSeverity('')).toBe('unknown');
  });

  it('returns lowercased for unrecognized values', () => {
    expect(normSeverity('INFO')).toBe('info');
    expect(normSeverity('GAS')).toBe('gas');
  });
});

// ================== locationKey ==================

describe('locationKey', () => {
  it('creates file:line key', () => {
    expect(locationKey({ file: 'src/Vault.sol', line: 42 })).toBe('src/vault.sol:42');
  });

  it('uses file-only key when no line', () => {
    expect(locationKey({ file: 'src/Vault.sol' })).toBe('src/vault.sol');
    expect(locationKey({ file: 'src/Vault.sol', line: 0 })).toBe('src/vault.sol');
  });

  it('uses affected field as fallback', () => {
    expect(locationKey({ affected: 'Vault::withdraw' })).toBe('vault::withdraw');
  });

  it('normalizes to lowercase', () => {
    expect(locationKey({ file: 'SRC/VAULT.SOL', line: 10 })).toBe('src/vault.sol:10');
  });

  it('converts backslashes to forward slashes', () => {
    expect(locationKey({ file: 'src\\Vault.sol', line: 10 })).toBe('src/vault.sol:10');
  });

  it('handles empty finding', () => {
    expect(locationKey({})).toBe('');
  });
});

// ================== broadKey ==================

describe('broadKey', () => {
  it('returns file without line', () => {
    expect(broadKey({ file: 'src/Vault.sol', line: 42 })).toBe('src/vault.sol');
  });

  it('normalizes case and slashes', () => {
    expect(broadKey({ file: 'SRC\\Vault.SOL' })).toBe('src/vault.sol');
  });

  it('uses affected field', () => {
    expect(broadKey({ affected: 'Vault::withdraw' })).toBe('vault::withdraw');
  });
});

// ================== higherSeverity ==================

describe('higherSeverity', () => {
  it('returns critical over high', () => {
    const result = higherSeverity('critical', 'high');
    expect(normSeverity(result)).toBe('critical');
  });

  it('returns high over medium', () => {
    const result = higherSeverity('high', 'medium');
    expect(normSeverity(result)).toBe('high');
  });

  it('returns medium over low', () => {
    const result = higherSeverity('medium', 'low');
    expect(normSeverity(result)).toBe('medium');
  });

  it('returns the value when equal', () => {
    expect(higherSeverity('high', 'high')).toBe('high');
  });

  it('handles mixed case inputs', () => {
    const result = higherSeverity('HIGH', 'MED');
    expect(normSeverity(result)).toBe('high');
  });

  it('handles null inputs', () => {
    expect(higherSeverity(null, 'high')).toBe('high');
    expect(higherSeverity('high', null)).toBe('high');
  });
});

// ================== loadFindings ==================

describe('loadFindings', () => {
  it('returns empty array for null path', () => {
    expect(loadFindings(null)).toEqual([]);
  });

  it('returns empty array for nonexistent file', () => {
    expect(loadFindings('/nonexistent/path.json')).toEqual([]);
  });
});

// ================== mergeFindings ==================

describe('mergeFindings', () => {
  it('creates DUAL_CONFIRMED for exact location match', () => {
    const opus = [{ id: 'O1', file: 'src/A.sol', line: 10, severity: 'high', title: 'Bug A' }];
    const codex = [{ id: 'C1', file: 'src/A.sol', line: 10, severity: 'medium', title: 'Bug A variant' }];

    const result = mergeFindings(opus, codex);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe('DUAL_CONFIRMED');
    expect(result[0].found_by).toEqual(['opus', 'codex']);
    expect(normSeverity(result[0].severity)).toBe('high'); // higher of the two
  });

  it('creates DUAL_CONFIRMED for broad match (same file, different line)', () => {
    const opus = [{ id: 'O1', file: 'src/A.sol', line: 10, severity: 'high' }];
    const codex = [{ id: 'C1', file: 'src/A.sol', line: 20, severity: 'medium' }];

    const result = mergeFindings(opus, codex);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe('DUAL_CONFIRMED');
    expect(result[0].match_type).toBe('broad_file_match');
  });

  it('creates SINGLE_CODEX for unmatched Codex finding', () => {
    const opus = [{ id: 'O1', file: 'src/A.sol', line: 10, severity: 'high' }];
    const codex = [{ id: 'C1', file: 'src/B.sol', line: 20, severity: 'medium' }];

    const result = mergeFindings(opus, codex);
    const codexOnly = result.filter(f => f.confidence === 'SINGLE_CODEX');
    expect(codexOnly).toHaveLength(1);
    expect(codexOnly[0].found_by).toEqual(['codex']);
    expect(codexOnly[0].needs_scrutiny).toBe(true);
  });

  it('creates SINGLE_OPUS for unmatched Opus finding', () => {
    const opus = [{ id: 'O1', file: 'src/A.sol', line: 10, severity: 'high' }];
    const codex = [{ id: 'C1', file: 'src/B.sol', line: 20, severity: 'medium' }];

    const result = mergeFindings(opus, codex);
    const opusOnly = result.filter(f => f.confidence === 'SINGLE_OPUS');
    expect(opusOnly).toHaveLength(1);
    expect(opusOnly[0].found_by).toEqual(['opus']);
    expect(opusOnly[0].needs_scrutiny).toBe(true);
  });

  it('handles empty Opus findings', () => {
    const codex = [{ id: 'C1', file: 'src/A.sol', line: 10, severity: 'high' }];
    const result = mergeFindings([], codex);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe('SINGLE_CODEX');
  });

  it('handles empty Codex findings', () => {
    const opus = [{ id: 'O1', file: 'src/A.sol', line: 10, severity: 'high' }];
    const result = mergeFindings(opus, []);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe('SINGLE_OPUS');
  });

  it('handles both empty', () => {
    expect(mergeFindings([], [])).toEqual([]);
  });

  it('assigns sequential IDs', () => {
    const opus = [
      { id: 'O1', file: 'src/A.sol', line: 10, severity: 'high' },
      { id: 'O2', file: 'src/B.sol', line: 20, severity: 'medium' },
    ];
    const codex = [
      { id: 'C1', file: 'src/A.sol', line: 10, severity: 'high' }, // matches O1
      { id: 'C2', file: 'src/C.sol', line: 30, severity: 'low' },  // no match
    ];

    const result = mergeFindings(opus, codex);
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe('DUAL-1');
    expect(result[1].id).toBe('SINGLE-CODEX-2');
    expect(result[2].id).toBe('SINGLE-OPUS-3');
  });

  it('case-insensitive file matching', () => {
    const opus = [{ id: 'O1', file: 'SRC/Vault.sol', line: 10, severity: 'high' }];
    const codex = [{ id: 'C1', file: 'src/vault.sol', line: 10, severity: 'medium' }];

    const result = mergeFindings(opus, codex);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe('DUAL_CONFIRMED');
  });
});

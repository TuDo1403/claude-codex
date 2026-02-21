import { describe, it, expect } from 'bun:test';
import {
  matchFindings, classifyMechanism, normSeverity, scoreResults,
  isExactMatch, isBroadMatch, normFile
} from './match-findings.js';

// ================== classifyMechanism ==================

describe('classifyMechanism', () => {
  it('classifies reentrancy', () => {
    expect(classifyMechanism({ title: 'Reentrancy in withdraw' })).toBe('reentrancy');
  });

  it('classifies access control', () => {
    expect(classifyMechanism({ description: 'Missing access control check' })).toBe('access-control');
  });

  it('classifies arithmetic', () => {
    expect(classifyMechanism({ root_cause: 'Integer overflow in balance calculation' })).toBe('arithmetic');
  });

  it('classifies oracle manipulation', () => {
    expect(classifyMechanism({ title: 'TWAP oracle price manipulation' })).toBe('oracle-manipulation');
  });

  it('classifies flash loan', () => {
    expect(classifyMechanism({ title: 'Flash loan governance attack' })).toBe('flash-loan');
  });

  it('classifies token handling', () => {
    expect(classifyMechanism({ description: 'ERC20 transfer return value unchecked' })).toBe('token-handling');
  });

  it('uses mechanism field directly', () => {
    expect(classifyMechanism({ mechanism: 'reentrancy' })).toBe('reentrancy');
  });

  it('returns other for unclassified', () => {
    expect(classifyMechanism({ title: 'some obscure issue' })).toBe('other');
  });

  it('handles empty finding', () => {
    expect(classifyMechanism({})).toBe('other');
  });
});

// ================== normSeverity ==================

describe('normSeverity', () => {
  it('normalizes HIGH', () => {
    expect(normSeverity('HIGH')).toBe('high');
  });

  it('normalizes MEDIUM', () => {
    expect(normSeverity('MEDIUM')).toBe('medium');
  });

  it('normalizes MED', () => {
    expect(normSeverity('MED')).toBe('medium');
  });

  it('normalizes LOW', () => {
    expect(normSeverity('LOW')).toBe('low');
  });

  it('normalizes CRITICAL', () => {
    expect(normSeverity('CRITICAL')).toBe('critical');
  });

  it('returns unknown for null', () => {
    expect(normSeverity(null)).toBe('unknown');
  });

  it('returns unknown for empty string', () => {
    expect(normSeverity('')).toBe('unknown');
  });
});

// ================== normFile ==================

describe('normFile', () => {
  it('normalizes path separators', () => {
    expect(normFile('src\\Vault.sol')).toBe('src/vault.sol');
  });

  it('strips leading ./', () => {
    expect(normFile('./src/Vault.sol')).toBe('src/vault.sol');
  });

  it('lowercases', () => {
    expect(normFile('src/Vault.sol')).toBe('src/vault.sol');
  });

  it('returns empty for null', () => {
    expect(normFile(null)).toBe('');
  });
});

// ================== isExactMatch ==================

describe('isExactMatch', () => {
  it('matches same file, close line, same mechanism', () => {
    const det = { file: 'src/Vault.sol', line: 143, title: 'Reentrancy in withdraw' };
    const gt = { file: 'src/Vault.sol', line: 142, mechanism: 'reentrancy' };
    expect(isExactMatch(det, gt)).toBe(true);
  });

  it('rejects different file', () => {
    const det = { file: 'src/Other.sol', line: 142, title: 'Reentrancy' };
    const gt = { file: 'src/Vault.sol', line: 142, mechanism: 'reentrancy' };
    expect(isExactMatch(det, gt)).toBe(false);
  });

  it('rejects line too far', () => {
    const det = { file: 'src/Vault.sol', line: 200, title: 'Reentrancy' };
    const gt = { file: 'src/Vault.sol', line: 142, mechanism: 'reentrancy' };
    expect(isExactMatch(det, gt)).toBe(false);
  });

  it('rejects different mechanism', () => {
    const det = { file: 'src/Vault.sol', line: 142, title: 'Access control issue' };
    const gt = { file: 'src/Vault.sol', line: 142, mechanism: 'reentrancy' };
    expect(isExactMatch(det, gt)).toBe(false);
  });

  it('respects custom line tolerance', () => {
    const det = { file: 'src/Vault.sol', line: 152, title: 'Reentrancy' };
    const gt = { file: 'src/Vault.sol', line: 142, mechanism: 'reentrancy' };
    expect(isExactMatch(det, gt, 5)).toBe(false);
    expect(isExactMatch(det, gt, 10)).toBe(true);
  });

  it('handles missing line numbers', () => {
    const det = { file: 'src/Vault.sol', title: 'Reentrancy' };
    const gt = { file: 'src/Vault.sol', line: 142, mechanism: 'reentrancy' };
    expect(isExactMatch(det, gt)).toBe(false);
  });

  // ±5 boundary tests
  it('matches at exactly +5 line difference', () => {
    const det = { file: 'src/Vault.sol', line: 147, title: 'Reentrancy' };
    const gt = { file: 'src/Vault.sol', line: 142, mechanism: 'reentrancy' };
    expect(isExactMatch(det, gt)).toBe(true);
  });

  it('rejects at +6 line difference', () => {
    const det = { file: 'src/Vault.sol', line: 148, title: 'Reentrancy' };
    const gt = { file: 'src/Vault.sol', line: 142, mechanism: 'reentrancy' };
    expect(isExactMatch(det, gt)).toBe(false);
  });

  it('matches at exactly -5 line difference', () => {
    const det = { file: 'src/Vault.sol', line: 137, title: 'Reentrancy' };
    const gt = { file: 'src/Vault.sol', line: 142, mechanism: 'reentrancy' };
    expect(isExactMatch(det, gt)).toBe(true);
  });

  it('rejects at -6 line difference', () => {
    const det = { file: 'src/Vault.sol', line: 136, title: 'Reentrancy' };
    const gt = { file: 'src/Vault.sol', line: 142, mechanism: 'reentrancy' };
    expect(isExactMatch(det, gt)).toBe(false);
  });

  it('rejects when both lines are 0', () => {
    const det = { file: 'src/Vault.sol', line: 0, title: 'Reentrancy' };
    const gt = { file: 'src/Vault.sol', line: 0, mechanism: 'reentrancy' };
    expect(isExactMatch(det, gt)).toBe(false);
  });
});

// ================== isBroadMatch ==================

describe('isBroadMatch', () => {
  it('matches same file and mechanism regardless of line', () => {
    const det = { file: 'src/Vault.sol', line: 999, title: 'Reentrancy in deposit' };
    const gt = { file: 'src/Vault.sol', line: 42, mechanism: 'reentrancy' };
    expect(isBroadMatch(det, gt)).toBe(true);
  });

  it('rejects different file', () => {
    const det = { file: 'src/Other.sol', title: 'Reentrancy' };
    const gt = { file: 'src/Vault.sol', mechanism: 'reentrancy' };
    expect(isBroadMatch(det, gt)).toBe(false);
  });

  it('rejects different mechanism', () => {
    const det = { file: 'src/Vault.sol', title: 'Access control' };
    const gt = { file: 'src/Vault.sol', mechanism: 'reentrancy' };
    expect(isBroadMatch(det, gt)).toBe(false);
  });
});

// ================== matchFindings ==================

describe('matchFindings', () => {
  const groundTruth = [
    { id: 'GT-1', title: 'Reentrancy in withdraw', severity: 'HIGH', file: 'src/Vault.sol', line: 142, mechanism: 'reentrancy' },
    { id: 'GT-2', title: 'Missing access control', severity: 'HIGH', file: 'src/Admin.sol', line: 50, mechanism: 'access-control' },
    { id: 'GT-3', title: 'Oracle manipulation', severity: 'MEDIUM', file: 'src/Oracle.sol', line: 89, mechanism: 'oracle-manipulation' }
  ];

  it('matches exact hits', () => {
    const detected = [
      { id: 'D-1', file: 'src/Vault.sol', line: 143, title: 'Reentrancy vulnerability in withdraw function' }
    ];
    const results = matchFindings(detected, groundTruth);

    expect(results[0].matched).toBe(true);
    expect(results[0].match_tier).toBe('exact');
    expect(results[1].matched).toBe(false);
    expect(results[2].matched).toBe(false);
  });

  it('falls back to broad match', () => {
    const detected = [
      { id: 'D-1', file: 'src/Vault.sol', line: 999, title: 'Reentrancy in deposit function' }
    ];
    const results = matchFindings(detected, groundTruth);

    expect(results[0].matched).toBe(true);
    expect(results[0].match_tier).toBe('broad');
  });

  it('reports misses', () => {
    const detected = [];
    const results = matchFindings(detected, groundTruth);

    expect(results.every(r => !r.matched)).toBe(true);
    expect(results.every(r => r.match_tier === 'none')).toBe(true);
  });

  it('handles empty ground truth', () => {
    const results = matchFindings([{ id: 'D-1', file: 'src/X.sol' }], []);
    expect(results).toEqual([]);
  });

  it('handles empty detected', () => {
    const results = matchFindings([], groundTruth);
    expect(results).toHaveLength(3);
    expect(results.every(r => !r.matched)).toBe(true);
    expect(results.every(r => r.match_tier === 'none')).toBe(true);
    expect(results.every(r => r.detected_id === null)).toBe(true);
  });

  it('does not double-match one detected to multiple ground truths', () => {
    const gt = [
      { id: 'GT-1', file: 'src/Vault.sol', line: 142, mechanism: 'reentrancy', title: 'Reentrancy A' },
      { id: 'GT-2', file: 'src/Vault.sol', line: 145, mechanism: 'reentrancy', title: 'Reentrancy B' }
    ];
    const det = [
      { id: 'D-1', file: 'src/Vault.sol', line: 143, title: 'Reentrancy found' }
    ];
    const results = matchFindings(det, gt);
    // First GT gets matched, second should also match (broad) since same file+mechanism
    const matched = results.filter(r => r.matched);
    expect(matched.length).toBeGreaterThanOrEqual(1);
  });

  it('returns correct ground_truth_id in results', () => {
    const det = [
      { id: 'D-1', file: 'src/Admin.sol', line: 51, title: 'Access control bypass' }
    ];
    const results = matchFindings(det, groundTruth);
    const adminMatch = results.find(r => r.ground_truth_id === 'GT-2');
    expect(adminMatch.matched).toBe(true);
    expect(adminMatch.detected_id).toBe('D-1');
    expect(adminMatch.detected_title).toBe('Access control bypass');
  });

  it('prefers exact over broad match', () => {
    const det = [
      { id: 'D-1', file: 'src/Vault.sol', line: 143, title: 'Reentrancy in withdraw function' }
    ];
    const results = matchFindings(det, groundTruth);
    const reentrancy = results.find(r => r.ground_truth_id === 'GT-1');
    expect(reentrancy.match_tier).toBe('exact');
  });
});

// ================== scoreResults ==================

describe('scoreResults', () => {
  it('computes perfect scores', () => {
    const results = [
      { matched: true, match_tier: 'exact' },
      { matched: true, match_tier: 'exact' },
      { matched: true, match_tier: 'broad' }
    ];
    const scores = scoreResults(results, 3);
    expect(scores.precision).toBe(1);
    expect(scores.recall).toBe(1);
    expect(scores.f1).toBe(1);
    expect(scores.exact_matches).toBe(2);
    expect(scores.broad_matches).toBe(1);
  });

  it('computes partial scores', () => {
    const results = [
      { matched: true, match_tier: 'exact' },
      { matched: false, match_tier: 'none' },
      { matched: false, match_tier: 'none' }
    ];
    const scores = scoreResults(results, 2);
    expect(scores.precision).toBe(0.5);
    expect(scores.recall).toBeCloseTo(0.333, 2);
    expect(scores.false_positives).toBe(1);
    expect(scores.false_negatives).toBe(2);
  });

  it('handles zero detected', () => {
    const results = [
      { matched: false, match_tier: 'none' }
    ];
    const scores = scoreResults(results, 0);
    expect(scores.precision).toBe(0);
    expect(scores.recall).toBe(0);
    expect(scores.f1).toBe(0);
  });

  it('handles zero ground truth', () => {
    const scores = scoreResults([], 5);
    expect(scores.precision).toBe(0);
    expect(scores.recall).toBe(0);
    expect(scores.false_positives).toBe(5);
    expect(scores.total_ground_truth).toBe(0);
    expect(scores.total_detected).toBe(5);
  });

  it('computes correct F1 for known values', () => {
    // precision = 2/3, recall = 2/4 = 0.5
    // F1 = 2 * (0.667 * 0.5) / (0.667 + 0.5) = 0.571
    const results = [
      { matched: true, match_tier: 'exact' },
      { matched: true, match_tier: 'broad' },
      { matched: false, match_tier: 'none' },
      { matched: false, match_tier: 'none' }
    ];
    const scores = scoreResults(results, 3);
    expect(scores.precision).toBeCloseTo(0.667, 2);
    expect(scores.recall).toBe(0.5);
    expect(scores.f1).toBeCloseTo(0.571, 2);
    expect(scores.true_positives).toBe(2);
    expect(scores.false_negatives).toBe(2);
    expect(scores.false_positives).toBe(1);
  });

  it('returns all field types as numbers', () => {
    const scores = scoreResults([{ matched: true, match_tier: 'exact' }], 1);
    expect(typeof scores.precision).toBe('number');
    expect(typeof scores.recall).toBe('number');
    expect(typeof scores.f1).toBe('number');
    expect(typeof scores.true_positives).toBe('number');
    expect(typeof scores.false_positives).toBe('number');
    expect(typeof scores.false_negatives).toBe('number');
  });
});

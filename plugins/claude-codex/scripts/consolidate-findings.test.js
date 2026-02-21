import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import {
  normSeverity,
  locationKey,
  broadKey,
  extractFile,
  extractLine,
  extractMechanism,
  higherSeverity,
  loadExploitHuntFindings,
  loadAttackPlanFindings,
  loadDeepExploitFindings,
  loadDisputeFindings,
  consolidateFindings,
} from './consolidate-findings.js';

// ================== Test fixtures ==================

const TEST_DIR = join(import.meta.dir, '__test-consolidate-tmp__');
const TASK_DIR = join(TEST_DIR, '.task');

function setupEnv(runId) {
  const runDir = join(TASK_DIR, runId);
  mkdirSync(runDir, { recursive: true });
  // Point the module to our test dir
  process.env.CLAUDE_PROJECT_DIR = TEST_DIR;
  return runDir;
}

beforeEach(() => {
  process.env.CLAUDE_PROJECT_DIR = TEST_DIR;
  mkdirSync(TASK_DIR, { recursive: true });
});

afterEach(() => {
  delete process.env.CLAUDE_PROJECT_DIR;
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

// ================== normSeverity ==================

describe('normSeverity', () => {
  it('normalizes standard severity strings', () => {
    expect(normSeverity('critical')).toBe('critical');
    expect(normSeverity('CRITICAL')).toBe('critical');
    expect(normSeverity('high')).toBe('high');
    expect(normSeverity('HIGH')).toBe('high');
    expect(normSeverity('medium')).toBe('medium');
    expect(normSeverity('MED')).toBe('medium');
    expect(normSeverity('low')).toBe('low');
    expect(normSeverity('LOW')).toBe('low');
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

// ================== extractFile ==================

describe('extractFile', () => {
  it('extracts from file field', () => {
    expect(extractFile({ file: 'src/Vault.sol' })).toBe('src/Vault.sol');
  });

  it('extracts from affected string', () => {
    expect(extractFile({ affected: 'Vault::withdraw' })).toBe('Vault::withdraw');
  });

  it('extracts from affected array', () => {
    expect(extractFile({ affected: ['src/A.sol', 'src/B.sol'] })).toBe('src/A.sol');
  });

  it('returns empty for empty finding', () => {
    expect(extractFile({})).toBe('');
  });

  it('prefers file over affected', () => {
    expect(extractFile({ file: 'src/X.sol', affected: 'src/Y.sol' })).toBe('src/X.sol');
  });
});

// ================== extractLine ==================

describe('extractLine', () => {
  it('extracts from line field', () => {
    expect(extractLine({ line: 42 })).toBe(42);
  });

  it('extracts from affected string with line suffix', () => {
    expect(extractLine({ affected: 'src/Vault.sol:142' })).toBe(142);
  });

  it('returns 0 for no line info', () => {
    expect(extractLine({})).toBe(0);
    expect(extractLine({ file: 'src/A.sol' })).toBe(0);
  });
});

// ================== locationKey ==================

describe('locationKey', () => {
  it('creates file:line key', () => {
    expect(locationKey({ file: 'src/Vault.sol', line: 42 })).toBe('src/vault.sol:42');
  });

  it('uses file-only key when no line', () => {
    expect(locationKey({ file: 'src/Vault.sol' })).toBe('src/vault.sol');
  });

  it('normalizes case and slashes', () => {
    expect(locationKey({ file: 'SRC\\Vault.SOL', line: 10 })).toBe('src/vault.sol:10');
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
});

// ================== higherSeverity ==================

describe('higherSeverity', () => {
  it('returns higher severity', () => {
    expect(normSeverity(higherSeverity('critical', 'high'))).toBe('critical');
    expect(normSeverity(higherSeverity('high', 'medium'))).toBe('high');
    expect(normSeverity(higherSeverity('medium', 'low'))).toBe('medium');
  });

  it('handles null inputs', () => {
    expect(higherSeverity(null, 'high')).toBe('high');
    expect(higherSeverity('high', null)).toBe('high');
  });
});

// ================== loadExploitHuntFindings ==================

describe('loadExploitHuntFindings', () => {
  it('loads valid exploit-hunt-review.json', () => {
    const runDir = setupEnv('test-eh');
    writeFileSync(join(runDir, 'exploit-hunt-review.json'), JSON.stringify({
      exploits_confirmed: [
        { id: 'EH-1', severity: 'HIGH', title: 'Reentrancy in withdraw', affected: 'Vault::withdraw', regression_test_required: 'test/Reentrancy.t.sol' },
        { id: 'EH-2', severity: 'LOW', title: 'Minor gas issue', affected: 'Vault::deposit' },
        { id: 'EH-3', severity: 'MED', title: 'Missing slippage', affected: 'Swap::execute' }
      ]
    }));

    const results = loadExploitHuntFindings('test-eh');
    expect(results).toHaveLength(2); // Only HIGH + MED
    expect(results[0].source).toBe('exploit-hunt');
    expect(results[0].original_id).toBe('EH-1');
    expect(results[1].original_id).toBe('EH-3');
  });

  it('returns empty for missing file', () => {
    setupEnv('test-missing');
    expect(loadExploitHuntFindings('test-missing')).toEqual([]);
  });

  it('returns empty for empty exploits_confirmed', () => {
    const runDir = setupEnv('test-empty-eh');
    writeFileSync(join(runDir, 'exploit-hunt-review.json'), JSON.stringify({
      exploits_confirmed: []
    }));
    expect(loadExploitHuntFindings('test-empty-eh')).toEqual([]);
  });

  it('handles malformed JSON gracefully', () => {
    const runDir = setupEnv('test-bad-json');
    writeFileSync(join(runDir, 'exploit-hunt-review.json'), '{ invalid json');
    expect(loadExploitHuntFindings('test-bad-json')).toEqual([]);
  });
});

// ================== loadAttackPlanFindings ==================

describe('loadAttackPlanFindings', () => {
  it('loads valid opus-attack-plan.json (HIGH/MED only)', () => {
    const runDir = setupEnv('test-ap');
    writeFileSync(join(runDir, 'opus-attack-plan.json'), JSON.stringify({
      attack_hypotheses: [
        { id: 'ECON-1', severity: 'HIGH', name: 'Flash loan attack', category: 'economic_mev', why_it_breaks: 'Conservation violated' },
        { id: 'DOS-1', severity: 'MED', name: 'Gas grief', category: 'dos_gas_grief' },
        { id: 'OTHER-1', severity: 'LOW', name: 'Minor edge case', category: 'other' }
      ]
    }));

    const results = loadAttackPlanFindings('test-ap');
    expect(results).toHaveLength(2);
    expect(results[0].source).toBe('attack-plan');
    expect(results[0].original_id).toBe('ECON-1');
    expect(results[0].title).toBe('Flash loan attack');
  });

  it('returns empty for missing file', () => {
    setupEnv('test-no-ap');
    expect(loadAttackPlanFindings('test-no-ap')).toEqual([]);
  });

  it('returns empty for empty hypotheses', () => {
    const runDir = setupEnv('test-empty-ap');
    writeFileSync(join(runDir, 'opus-attack-plan.json'), JSON.stringify({
      attack_hypotheses: []
    }));
    expect(loadAttackPlanFindings('test-empty-ap')).toEqual([]);
  });
});

// ================== loadDeepExploitFindings ==================

describe('loadDeepExploitFindings', () => {
  it('loads valid codex-deep-exploit-review.json', () => {
    const runDir = setupEnv('test-de');
    writeFileSync(join(runDir, 'codex-deep-exploit-review.json'), JSON.stringify({
      confirmed_exploits: [
        { id: 'CEH-1', severity: 'HIGH', type: 'cross_module', title: 'Cross-module reentrancy', affected: ['src/A.sol', 'src/B.sol'], deep_analysis: 'Multi-contract attack path' },
        { id: 'CEH-2', severity: 'MED', type: 'arithmetic', title: 'Precision loss', affected: ['src/Math.sol'] }
      ]
    }));

    const results = loadDeepExploitFindings('test-de');
    expect(results).toHaveLength(2);
    expect(results[0].source).toBe('deep-exploit');
    expect(results[0].file).toBe('src/A.sol');
    expect(results[0].description).toBe('Multi-contract attack path');
  });

  it('handles findings nested under findings.exploits_confirmed', () => {
    const runDir = setupEnv('test-de-nested');
    writeFileSync(join(runDir, 'codex-deep-exploit-review.json'), JSON.stringify({
      findings: {
        exploits_confirmed: [
          { id: 'CEH-1', severity: 'HIGH', type: 'reentrancy', title: 'Bug', affected: ['src/X.sol'] }
        ]
      }
    }));

    const results = loadDeepExploitFindings('test-de-nested');
    expect(results).toHaveLength(1);
  });

  it('returns empty for missing file', () => {
    setupEnv('test-no-de');
    expect(loadDeepExploitFindings('test-no-de')).toEqual([]);
  });
});

// ================== loadDisputeFindings ==================

describe('loadDisputeFindings', () => {
  it('loads valid dispute-resolution.json', () => {
    const runDir = setupEnv('test-dr');
    writeFileSync(join(runDir, 'dispute-resolution.json'), JSON.stringify({
      red_team_issues_created: [
        { id: 'RT-001', dispute: 'D-1', severity: 'HIGH', title: 'Confirmed reentrancy' }
      ],
      dispute_details: [
        { id: 'D-1', title: 'Reentrancy dispute', verdict: 'CONFIRMED', red_team_issue: 'RT-001', justification: 'Exploit proven', reproduction_artifact: { type: 'foundry_test', test_file: 'test/Reentrancy.t.sol' } }
      ]
    }));

    const results = loadDisputeFindings('test-dr');
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('dispute');
    expect(results[0].description).toBe('Exploit proven');
    expect(results[0].regression_test_required).toBe('test/Reentrancy.t.sol');
  });

  it('filters out LOW severity disputes', () => {
    const runDir = setupEnv('test-dr-low');
    writeFileSync(join(runDir, 'dispute-resolution.json'), JSON.stringify({
      red_team_issues_created: [
        { id: 'RT-001', dispute: 'D-1', severity: 'LOW', title: 'Minor issue' }
      ],
      dispute_details: []
    }));

    expect(loadDisputeFindings('test-dr-low')).toEqual([]);
  });

  it('returns empty for missing file', () => {
    setupEnv('test-no-dr');
    expect(loadDisputeFindings('test-no-dr')).toEqual([]);
  });
});

// ================== consolidateFindings ==================

describe('consolidateFindings', () => {
  it('assigns sequential RT-IDs with zero-padded numbers', () => {
    const findings = [
      { original_id: 'EH-1', source: 'exploit-hunt', severity: 'HIGH', title: 'Bug A', file: 'src/A.sol', line: 10, mechanism: 'reentrancy', description: '', regression_test_required: '' },
      { original_id: 'EH-2', source: 'exploit-hunt', severity: 'MED', title: 'Bug B', file: 'src/B.sol', line: 20, mechanism: 'access_control', description: '', regression_test_required: '' },
    ];

    const result = consolidateFindings(findings);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('RT-001');
    expect(result[1].id).toBe('RT-002');
  });

  it('deduplicates exact match (same file:line)', () => {
    const findings = [
      { original_id: 'EH-1', source: 'exploit-hunt', severity: 'HIGH', title: 'Bug', file: 'src/Vault.sol', line: 42, mechanism: 'reentrancy', description: 'First', regression_test_required: 'test/A.t.sol' },
      { original_id: 'CEH-1', source: 'deep-exploit', severity: 'MED', title: 'Same Bug', file: 'src/Vault.sol', line: 42, mechanism: 'reentrancy', description: '', regression_test_required: '' },
    ];

    const result = consolidateFindings(findings);
    expect(result).toHaveLength(1);
    expect(result[0].sources).toContain('exploit-hunt');
    expect(result[0].sources).toContain('deep-exploit');
    expect(normSeverity(result[0].severity)).toBe('high'); // keeps higher
    expect(result[0].multi_source).toBe(true);
  });

  it('does NOT broad-merge when both have distinct line numbers (different bugs)', () => {
    const findings = [
      { original_id: 'EH-1', source: 'exploit-hunt', severity: 'HIGH', title: 'Reentrancy in withdraw', file: 'src/Vault.sol', line: 42, mechanism: 'reentrancy', description: '', regression_test_required: '' },
      { original_id: 'ECON-1', source: 'attack-plan', severity: 'MED', title: 'Reentrancy in claim', file: 'src/Vault.sol', line: 50, mechanism: 'reentrancy', description: '', regression_test_required: '' },
    ];

    const result = consolidateFindings(findings);
    expect(result).toHaveLength(2); // distinct line numbers = distinct bugs
  });

  it('broad-merges when one finding has no line number', () => {
    const findings = [
      { original_id: 'EH-1', source: 'exploit-hunt', severity: 'HIGH', title: 'Bug', file: 'src/Vault.sol', line: 42, mechanism: 'reentrancy', description: '', regression_test_required: '' },
      { original_id: 'ECON-1', source: 'attack-plan', severity: 'MED', title: 'Same area', file: 'src/Vault.sol', line: 0, mechanism: 'reentrancy', description: '', regression_test_required: '' },
    ];

    const result = consolidateFindings(findings);
    expect(result).toHaveLength(1);
    expect(result[0].sources).toContain('exploit-hunt');
    expect(result[0].sources).toContain('attack-plan');
  });

  it('does NOT merge broad match with different mechanisms', () => {
    const findings = [
      { original_id: 'EH-1', source: 'exploit-hunt', severity: 'HIGH', title: 'Reentrancy', file: 'src/Vault.sol', line: 42, mechanism: 'reentrancy', description: '', regression_test_required: '' },
      { original_id: 'ECON-1', source: 'attack-plan', severity: 'MED', title: 'Oracle manip', file: 'src/Vault.sol', line: 80, mechanism: 'oracle-manipulation', description: '', regression_test_required: '' },
    ];

    const result = consolidateFindings(findings);
    expect(result).toHaveLength(2);
  });

  it('merges broad match when mechanism is unknown and one has no line', () => {
    const findings = [
      { original_id: 'EH-1', source: 'exploit-hunt', severity: 'HIGH', title: 'Bug', file: 'src/Vault.sol', line: 0, mechanism: 'unknown', description: '', regression_test_required: '' },
      { original_id: 'CEH-1', source: 'deep-exploit', severity: 'MED', title: 'Same area', file: 'src/Vault.sol', line: 50, mechanism: 'reentrancy', description: '', regression_test_required: '' },
    ];

    const result = consolidateFindings(findings);
    expect(result).toHaveLength(1);
    expect(result[0].mechanism).toBe('reentrancy'); // updated from unknown
  });

  it('does NOT broad-merge unknown mechanism when both have distinct lines', () => {
    const findings = [
      { original_id: 'EH-1', source: 'exploit-hunt', severity: 'HIGH', title: 'Bug A', file: 'src/Vault.sol', line: 42, mechanism: 'unknown', description: '', regression_test_required: '' },
      { original_id: 'CEH-1', source: 'deep-exploit', severity: 'MED', title: 'Bug B', file: 'src/Vault.sol', line: 50, mechanism: 'reentrancy', description: '', regression_test_required: '' },
    ];

    const result = consolidateFindings(findings);
    expect(result).toHaveLength(2); // distinct lines = distinct bugs even with unknown mechanism
  });

  it('marks multi-source findings as high-confidence', () => {
    const findings = [
      { original_id: 'EH-1', source: 'exploit-hunt', severity: 'HIGH', title: 'Bug', file: 'src/A.sol', line: 10, mechanism: 'reentrancy', description: '', regression_test_required: '' },
      { original_id: 'CEH-1', source: 'deep-exploit', severity: 'HIGH', title: 'Bug', file: 'src/A.sol', line: 10, mechanism: 'reentrancy', description: '', regression_test_required: '' },
      { original_id: 'RT-001', source: 'dispute', severity: 'HIGH', title: 'Bug', file: 'src/A.sol', line: 10, mechanism: 'reentrancy', description: '', regression_test_required: '' },
    ];

    const result = consolidateFindings(findings);
    expect(result).toHaveLength(1);
    expect(result[0].sources).toHaveLength(3);
    expect(result[0].multi_source).toBe(true);
  });

  it('handles all sources empty', () => {
    expect(consolidateFindings([])).toEqual([]);
  });

  it('handles single source', () => {
    const findings = [
      { original_id: 'EH-1', source: 'exploit-hunt', severity: 'HIGH', title: 'Bug', file: 'src/A.sol', line: 10, mechanism: 'reentrancy', description: '', regression_test_required: '' },
    ];
    const result = consolidateFindings(findings);
    expect(result).toHaveLength(1);
    expect(result[0].multi_source).toBe(false);
    expect(result[0].source).toBe('exploit-hunt');
  });

  it('preserves description and regression test from first source with data', () => {
    const findings = [
      { original_id: 'EH-1', source: 'exploit-hunt', severity: 'HIGH', title: 'Bug', file: 'src/A.sol', line: 10, mechanism: 'reentrancy', description: '', regression_test_required: '' },
      { original_id: 'CEH-1', source: 'deep-exploit', severity: 'HIGH', title: 'Bug', file: 'src/A.sol', line: 10, mechanism: 'reentrancy', description: 'Detailed desc', regression_test_required: 'test/Fix.t.sol' },
    ];

    const result = consolidateFindings(findings);
    expect(result[0].description).toBe('Detailed desc');
    expect(result[0].regression_test_required).toBe('test/Fix.t.sol');
  });

  it('tracks all original IDs from merged findings', () => {
    const findings = [
      { original_id: 'EH-1', source: 'exploit-hunt', severity: 'HIGH', title: 'Bug', file: 'src/A.sol', line: 10, mechanism: 'reentrancy', description: '', regression_test_required: '' },
      { original_id: 'CEH-1', source: 'deep-exploit', severity: 'HIGH', title: 'Bug', file: 'src/A.sol', line: 10, mechanism: 'reentrancy', description: '', regression_test_required: '' },
    ];

    const result = consolidateFindings(findings);
    expect(result[0].original_ids).toContain('EH-1');
    expect(result[0].original_ids).toContain('CEH-1');
  });

  it('source field shows combined sources with + separator', () => {
    const findings = [
      { original_id: 'EH-1', source: 'exploit-hunt', severity: 'HIGH', title: 'Bug', file: 'src/A.sol', line: 10, mechanism: 'reentrancy', description: '', regression_test_required: '' },
      { original_id: 'CEH-1', source: 'deep-exploit', severity: 'HIGH', title: 'Bug', file: 'src/A.sol', line: 10, mechanism: 'reentrancy', description: '', regression_test_required: '' },
    ];

    const result = consolidateFindings(findings);
    expect(result[0].source).toBe('exploit-hunt+deep-exploit');
  });

  it('no duplicate sources when same source appears twice', () => {
    const findings = [
      { original_id: 'EH-1', source: 'exploit-hunt', severity: 'HIGH', title: 'Bug A', file: 'src/A.sol', line: 10, mechanism: 'reentrancy', description: '', regression_test_required: '' },
      { original_id: 'EH-2', source: 'exploit-hunt', severity: 'HIGH', title: 'Bug B', file: 'src/A.sol', line: 10, mechanism: 'reentrancy', description: '', regression_test_required: '' },
    ];

    const result = consolidateFindings(findings);
    expect(result).toHaveLength(1);
    expect(result[0].sources).toEqual(['exploit-hunt']); // no dupe
  });

  it('handles findings with no file (empty broadKey)', () => {
    const findings = [
      { original_id: 'ECON-1', source: 'attack-plan', severity: 'HIGH', title: 'Systemic issue', file: '', line: 0, mechanism: 'economic_mev', description: '', regression_test_required: '' },
      { original_id: 'ECON-2', source: 'attack-plan', severity: 'MED', title: 'Another systemic', file: '', line: 0, mechanism: 'dos_gas_grief', description: '', regression_test_required: '' },
    ];

    const result = consolidateFindings(findings);
    // Both have empty key, but different mechanisms — should NOT merge
    expect(result).toHaveLength(2);
  });
});

import { describe, it, expect } from 'bun:test';
import { classifyMechanism, extractHints, extractLowHints, extractMediumHints, extractHighHints, parseSlitherToFindings, parseSemgrepToFindings } from './generate-hints.js';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

// ================== classifyMechanism ==================

describe('classifyMechanism', () => {
  it('detects reentrancy', () => {
    expect(classifyMechanism({ title: 'Reentrancy in withdraw' })).toBe('reentrancy');
    expect(classifyMechanism({ root_cause: 'Cross-function reentrancy via callback' })).toBe('reentrancy');
  });

  it('detects access-control', () => {
    expect(classifyMechanism({ title: 'Missing access control on admin function' })).toBe('access-control');
    expect(classifyMechanism({ description: 'No auth check' })).toBe('access-control');
    expect(classifyMechanism({ title: 'Permission bypass via role manipulation' })).toBe('access-control');
  });

  it('detects arithmetic', () => {
    expect(classifyMechanism({ title: 'Integer overflow in fee calculation' })).toBe('arithmetic');
    expect(classifyMechanism({ root_cause: 'Precision loss due to rounding' })).toBe('arithmetic');
    expect(classifyMechanism({ description: 'Underflow in balance subtraction' })).toBe('arithmetic');
  });

  it('detects oracle-manipulation', () => {
    expect(classifyMechanism({ title: 'Oracle price manipulation' })).toBe('oracle-manipulation');
    expect(classifyMechanism({ description: 'TWAP can be manipulated' })).toBe('oracle-manipulation');
  });

  it('detects flash-loan', () => {
    expect(classifyMechanism({ title: 'Flash loan attack on vault' })).toBe('flash-loan');
    expect(classifyMechanism({ description: 'Flashloan vulnerability' })).toBe('flash-loan');
    // Note: 'Flashloan-based price manipulation' matches oracle-manipulation first due to 'price' keyword priority
    expect(classifyMechanism({ description: 'Flashloan-based price manipulation' })).toBe('oracle-manipulation');
  });

  it('detects front-running', () => {
    expect(classifyMechanism({ title: 'Front-running on swap' })).toBe('front-running');
    expect(classifyMechanism({ description: 'Sandwich attack possible' })).toBe('front-running');
    expect(classifyMechanism({ category: 'MEV extraction' })).toBe('front-running');
  });

  it('detects dos-griefing', () => {
    expect(classifyMechanism({ title: 'DoS via unbounded loop' })).toBe('dos-griefing');
    expect(classifyMechanism({ description: 'Grief attack on withdrawal' })).toBe('dos-griefing');
    expect(classifyMechanism({ root_cause: 'Gas limit exhaustion' })).toBe('dos-griefing');
  });

  it('detects state-corruption', () => {
    expect(classifyMechanism({ title: 'State corruption in update' })).toBe('state-corruption');
    expect(classifyMechanism({ description: 'Inconsistent state after failed tx' })).toBe('state-corruption');
  });

  it('detects upgrade-safety', () => {
    expect(classifyMechanism({ title: 'Upgrade proxy vulnerability' })).toBe('upgrade-safety');
    expect(classifyMechanism({ description: 'Uninitialized proxy implementation' })).toBe('upgrade-safety');
  });

  it('detects token-handling', () => {
    expect(classifyMechanism({ title: 'ERC20 transfer return value ignored' })).toBe('token-handling');
    expect(classifyMechanism({ description: 'Fee-on-transfer token breaks accounting' })).toBe('token-handling');
  });

  it('detects cross-contract', () => {
    expect(classifyMechanism({ title: 'Cross-contract callback exploit' })).toBe('cross-contract');
    expect(classifyMechanism({ description: 'Cross-module call delegation' })).toBe('cross-contract');
    // Note: 'Cross-module state inconsistency' matches state-corruption first due to 'state'/'inconsist' keyword priority
    expect(classifyMechanism({ description: 'Cross-module state inconsistency' })).toBe('state-corruption');
  });

  it('detects economic', () => {
    expect(classifyMechanism({ title: 'Economic attack on liquidation' })).toBe('economic');
    expect(classifyMechanism({ description: 'Collateral manipulation' })).toBe('economic');
  });

  it('detects logic-error', () => {
    expect(classifyMechanism({ title: 'Logic error in conditional' })).toBe('logic-error');
    expect(classifyMechanism({ description: 'Wrong branch taken' })).toBe('logic-error');
  });

  it('detects initialization', () => {
    expect(classifyMechanism({ description: 'Constructor not called' })).toBe('initialization');
    expect(classifyMechanism({ title: 'Init function unprotected' })).toBe('initialization');
    // Note: 'initializer' contains 'initializ' which matches upgrade-safety first
    expect(classifyMechanism({ title: 'Missing initializer protection' })).toBe('upgrade-safety');
  });

  it('returns other for unmatched', () => {
    expect(classifyMechanism({ title: 'Unknown vulnerability type' })).toBe('other');
    expect(classifyMechanism({})).toBe('other');
  });

  it('is case-insensitive', () => {
    expect(classifyMechanism({ title: 'REENTRANCY IN WITHDRAW' })).toBe('reentrancy');
    expect(classifyMechanism({ title: 'ACCESS CONTROL MISSING' })).toBe('access-control');
  });

  it('checks multiple fields', () => {
    // Title has no match, but description does
    expect(classifyMechanism({ title: 'Vulnerability found', description: 'Reentrancy via callback' })).toBe('reentrancy');
  });
});

// ================== extractHints ==================

describe('extractHints', () => {
  it('extracts hints from findings', () => {
    const findings = [
      { file: 'src/Vault.sol', line: 42, severity: 'HIGH', title: 'Reentrancy in withdraw' },
      { file: 'src/Oracle.sol', line: 67, severity: 'MEDIUM', title: 'Price manipulation' },
    ];

    const hints = extractHints(findings);
    expect(hints).toHaveLength(2);
    expect(hints[0].hint_id).toBe('HINT-1');
    expect(hints[0].file).toBe('src/Vault.sol');
    expect(hints[0].line).toBe(42);
    expect(hints[0].severity).toBe('HIGH');
    expect(hints[0].mechanism).toBe('reentrancy');

    expect(hints[1].hint_id).toBe('HINT-2');
    expect(hints[1].mechanism).toBe('oracle-manipulation');
  });

  it('strips detail fields (medium-level hints)', () => {
    const findings = [
      { file: 'src/A.sol', line: 10, severity: 'HIGH', title: 'Bug', description: 'Detailed desc', root_cause: 'Cause', exploit_scenario: 'Steps' },
    ];

    const hints = extractHints(findings);
    expect(hints[0]).not.toHaveProperty('title');
    expect(hints[0]).not.toHaveProperty('description');
    expect(hints[0]).not.toHaveProperty('root_cause');
    expect(hints[0]).not.toHaveProperty('exploit_scenario');
  });

  it('handles findings without line number', () => {
    const findings = [{ file: 'src/A.sol', severity: 'HIGH' }];
    const hints = extractHints(findings);
    expect(hints[0].line).toBeNull();
  });

  it('uses affected field as fallback', () => {
    const findings = [{ affected: 'Vault::withdraw', severity: 'MED' }];
    const hints = extractHints(findings);
    expect(hints[0].file).toBe('Vault::withdraw');
  });

  it('returns empty array for empty input', () => {
    expect(extractHints([])).toEqual([]);
  });

  it('uppercases severity', () => {
    const findings = [{ file: 'src/A.sol', severity: 'high' }];
    const hints = extractHints(findings);
    expect(hints[0].severity).toBe('HIGH');
  });

  it('respects level parameter for low hints', () => {
    const findings = [{ file: 'src/A.sol', line: 10, severity: 'HIGH', title: 'Bug', description: 'Desc' }];
    const hints = extractHints(findings, 'low');
    expect(hints[0]).not.toHaveProperty('mechanism');
    expect(hints[0]).not.toHaveProperty('title');
    expect(hints[0]).not.toHaveProperty('description');
    expect(hints[0].file).toBe('src/A.sol');
  });

  it('respects level parameter for high hints', () => {
    const findings = [{ file: 'src/A.sol', line: 10, severity: 'HIGH', title: 'Bug', description: 'Desc', exploit_scenario: 'Steps' }];
    const hints = extractHints(findings, 'high');
    expect(hints[0].mechanism).toBeDefined();
    expect(hints[0].title).toBe('Bug');
    expect(hints[0].description).toBe('Desc');
    expect(hints[0].exploit_scenario).toBe('Steps');
  });

  it('defaults to medium level', () => {
    const findings = [{ file: 'src/A.sol', line: 10, severity: 'HIGH', title: 'Bug' }];
    const hints = extractHints(findings);
    expect(hints[0].mechanism).toBeDefined();
    expect(hints[0]).not.toHaveProperty('title');
  });
});

// ================== extractLowHints ==================

describe('extractLowHints', () => {
  it('includes only file, line, severity', () => {
    const findings = [{ file: 'src/A.sol', line: 42, severity: 'HIGH', title: 'Bug', description: 'Desc' }];
    const hints = extractLowHints(findings);
    expect(hints[0].file).toBe('src/A.sol');
    expect(hints[0].line).toBe(42);
    expect(hints[0].severity).toBe('HIGH');
    expect(hints[0]).not.toHaveProperty('mechanism');
    expect(hints[0]).not.toHaveProperty('title');
  });
});

// ================== extractHighHints ==================

describe('extractHighHints', () => {
  it('includes title and description', () => {
    const findings = [{
      file: 'src/A.sol', line: 42, severity: 'HIGH',
      title: 'Reentrancy', description: 'Detailed desc',
      exploit_scenario: 'Attack steps'
    }];
    const hints = extractHighHints(findings);
    expect(hints[0].title).toBe('Reentrancy');
    expect(hints[0].description).toBe('Detailed desc');
    expect(hints[0].exploit_scenario).toBe('Attack steps');
    expect(hints[0].mechanism).toBe('reentrancy');
  });

  it('falls back to root_cause for description', () => {
    const findings = [{ file: 'src/A.sol', severity: 'HIGH', root_cause: 'Missing guard' }];
    const hints = extractHighHints(findings);
    expect(hints[0].description).toBe('Missing guard');
  });

  it('handles missing optional fields', () => {
    const findings = [{ file: 'src/A.sol', severity: 'HIGH' }];
    const hints = extractHighHints(findings);
    expect(hints[0].title).toBe('Untitled');
    expect(hints[0].description).toBe('No description');
    expect(hints[0].exploit_scenario).toBeNull();
  });
});

// ================== parseSlitherToFindings ==================

const TMP = join(import.meta.dir, '.test-tmp-hints-static');

function setup() {
  try { rmSync(TMP, { recursive: true }); } catch {}
  mkdirSync(TMP, { recursive: true });
}

function cleanup() {
  try { rmSync(TMP, { recursive: true }); } catch {}
}

describe('parseSlitherToFindings', () => {
  it('returns empty array for missing file', () => {
    expect(parseSlitherToFindings('/nonexistent.json')).toEqual([]);
  });

  it('parses HIGH/MEDIUM slither detectors into normalized findings', () => {
    setup();
    const slitherJson = {
      results: {
        detectors: [
          {
            check: 'reentrancy-eth',
            impact: 'High',
            confidence: 'Medium',
            description: 'Reentrancy in Vault.withdraw()',
            elements: [{ source_mapping: { filename_relative: 'src/Vault.sol', lines: [42, 43] } }]
          },
          {
            check: 'naming-convention',
            impact: 'Informational',
            confidence: 'High',
            description: 'Naming issue',
            elements: [{ source_mapping: { filename_relative: 'src/Token.sol', lines: [10] } }]
          }
        ]
      }
    };
    const p = join(TMP, 'slither.json');
    writeFileSync(p, JSON.stringify(slitherJson));
    const findings = parseSlitherToFindings(p);
    // Only HIGH/MEDIUM are returned
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe('SL-1');
    expect(findings[0].severity).toBe('HIGH');
    expect(findings[0].file).toBe('src/Vault.sol');
    expect(findings[0].line).toBe(42);
    expect(findings[0].source).toBe('slither');
    cleanup();
  });

  it('classifies mechanism correctly from slither findings', () => {
    setup();
    const slitherJson = {
      results: {
        detectors: [{
          check: 'reentrancy-eth',
          impact: 'High',
          confidence: 'High',
          description: 'Reentrancy in withdraw',
          elements: [{ source_mapping: { filename_relative: 'src/Vault.sol', lines: [42] } }]
        }]
      }
    };
    const p = join(TMP, 'slither2.json');
    writeFileSync(p, JSON.stringify(slitherJson));
    const findings = parseSlitherToFindings(p);
    // These should work with classifyMechanism
    const mechanism = classifyMechanism(findings[0]);
    expect(mechanism).toBe('reentrancy');
    cleanup();
  });
});

describe('parseSemgrepToFindings', () => {
  it('returns empty array for missing file', () => {
    expect(parseSemgrepToFindings('/nonexistent.json')).toEqual([]);
  });

  it('parses ERROR/WARNING semgrep results into normalized findings', () => {
    setup();
    const semgrepJson = {
      results: [
        {
          check_id: 'sol.reentrancy',
          path: 'src/Vault.sol',
          start: { line: 42 },
          extra: { severity: 'ERROR', message: 'Possible reentrancy' }
        },
        {
          check_id: 'sol.naming',
          path: 'src/Token.sol',
          start: { line: 10 },
          extra: { severity: 'INFO', message: 'Naming issue' }
        }
      ]
    };
    const p = join(TMP, 'semgrep.json');
    writeFileSync(p, JSON.stringify(semgrepJson));
    const findings = parseSemgrepToFindings(p);
    // Only ERROR/WARNING are returned
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe('SG-1');
    expect(findings[0].severity).toBe('HIGH'); // ERROR maps to HIGH
    expect(findings[0].file).toBe('src/Vault.sol');
    expect(findings[0].source).toBe('semgrep');
    cleanup();
  });
});

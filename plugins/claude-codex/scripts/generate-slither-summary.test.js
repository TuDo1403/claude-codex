import { describe, test, expect } from 'bun:test';
import { parseSlitherFindings, parseSemgrepFindings, effectiveSeverity, generateSummary } from './generate-slither-summary.js';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const TMP = join(import.meta.dir, '.test-tmp-slither-summary');

function setup() {
  try { rmSync(TMP, { recursive: true }); } catch {}
  mkdirSync(TMP, { recursive: true });
}

function cleanup() {
  try { rmSync(TMP, { recursive: true }); } catch {}
}

describe('effectiveSeverity', () => {
  test('HIGH/HIGH → CRITICAL', () => {
    expect(effectiveSeverity('HIGH', 'HIGH')).toBe('CRITICAL');
  });

  test('HIGH/MEDIUM → HIGH', () => {
    expect(effectiveSeverity('HIGH', 'MEDIUM')).toBe('HIGH');
  });

  test('HIGH/LOW → MEDIUM', () => {
    expect(effectiveSeverity('HIGH', 'LOW')).toBe('MEDIUM');
  });

  test('MEDIUM/HIGH → HIGH', () => {
    expect(effectiveSeverity('MEDIUM', 'HIGH')).toBe('HIGH');
  });

  test('MEDIUM/MEDIUM → MEDIUM', () => {
    expect(effectiveSeverity('MEDIUM', 'MEDIUM')).toBe('MEDIUM');
  });

  test('LOW/* → LOW', () => {
    expect(effectiveSeverity('LOW', 'HIGH')).toBe('LOW');
    expect(effectiveSeverity('LOW', 'LOW')).toBe('LOW');
  });

  test('INFORMATIONAL/* → INFO', () => {
    expect(effectiveSeverity('INFORMATIONAL', 'HIGH')).toBe('INFO');
  });
});

describe('parseSlitherFindings', () => {
  test('returns null for missing file', () => {
    expect(parseSlitherFindings('/nonexistent.json')).toBeNull();
  });

  test('parses standard slither JSON format', () => {
    setup();
    const slitherJson = {
      results: {
        detectors: [
          {
            check: 'reentrancy-eth',
            impact: 'High',
            confidence: 'Medium',
            description: 'Reentrancy in Vault.withdraw()',
            elements: [{
              source_mapping: {
                filename_relative: 'src/Vault.sol',
                lines: [42, 43, 44]
              },
              name: 'withdraw',
              type: 'function'
            }]
          },
          {
            check: 'naming-convention',
            impact: 'Informational',
            confidence: 'High',
            description: 'Parameter uses camelCase',
            elements: [{
              source_mapping: { filename_relative: 'src/Token.sol', lines: [10] }
            }]
          }
        ]
      }
    };
    const p = join(TMP, 'slither.json');
    writeFileSync(p, JSON.stringify(slitherJson));
    const findings = parseSlitherFindings(p);
    expect(findings).toHaveLength(2);
    expect(findings[0].id).toBe('SL-1');
    expect(findings[0].detector).toBe('reentrancy-eth');
    expect(findings[0].impact).toBe('HIGH');
    expect(findings[0].elements[0].file).toBe('src/Vault.sol');
    expect(findings[0].elements[0].lines).toEqual([42, 43, 44]);
    expect(findings[1].detector).toBe('naming-convention');
    cleanup();
  });

  test('handles empty detectors array', () => {
    setup();
    const p = join(TMP, 'slither-empty.json');
    writeFileSync(p, JSON.stringify({ results: { detectors: [] } }));
    const findings = parseSlitherFindings(p);
    expect(findings).toHaveLength(0);
    cleanup();
  });
});

describe('parseSemgrepFindings', () => {
  test('returns null for missing file', () => {
    expect(parseSemgrepFindings('/nonexistent.json')).toBeNull();
  });

  test('parses standard semgrep JSON format', () => {
    setup();
    const semgrepJson = {
      results: [
        {
          check_id: 'solidity.security.reentrancy',
          path: 'src/Vault.sol',
          start: { line: 42 },
          end: { line: 45 },
          extra: {
            severity: 'ERROR',
            message: 'Possible reentrancy vulnerability'
          }
        },
        {
          check_id: 'solidity.best-practice.naming',
          path: 'src/Token.sol',
          start: { line: 10 },
          end: { line: 10 },
          extra: {
            severity: 'INFO',
            message: 'Use consistent naming'
          }
        }
      ]
    };
    const p = join(TMP, 'semgrep.json');
    writeFileSync(p, JSON.stringify(semgrepJson));
    const findings = parseSemgrepFindings(p);
    expect(findings).toHaveLength(2);
    expect(findings[0].id).toBe('SG-1');
    expect(findings[0].rule_id).toBe('solidity.security.reentrancy');
    expect(findings[0].severity).toBe('ERROR');
    expect(findings[0].file).toBe('src/Vault.sol');
    expect(findings[0].line_start).toBe(42);
    cleanup();
  });
});

describe('generateSummary', () => {
  test('produces markdown with both tools', () => {
    const slither = [
      { id: 'SL-1', tool: 'slither', detector: 'reentrancy-eth', impact: 'HIGH', confidence: 'MEDIUM',
        description: 'Reentrancy in withdraw', elements: [{ file: 'src/Vault.sol', lines: [42] }] }
    ];
    const semgrep = [
      { id: 'SG-1', tool: 'semgrep', rule_id: 'sol.reentrancy', severity: 'ERROR',
        message: 'Possible reentrancy', file: 'src/Vault.sol', line_start: 42 }
    ];

    const { markdown, findings, actionable_count } = generateSummary(slither, semgrep);
    expect(markdown).toContain('# Static Analysis Summary');
    expect(markdown).toContain('Slither (1 findings)');
    expect(markdown).toContain('Semgrep (1 findings)');
    expect(markdown).toContain('reentrancy-eth');
    expect(markdown).toContain('sol.reentrancy');
    expect(findings).toHaveLength(2);
    expect(actionable_count).toBe(2);
  });

  test('handles null slither', () => {
    const { markdown, findings } = generateSummary(null, []);
    expect(markdown).toContain('No findings (or not run)');
    expect(findings).toHaveLength(0);
  });

  test('handles null semgrep', () => {
    const { markdown } = generateSummary([], null);
    expect(markdown).toContain('Semgrep');
    expect(markdown).toContain('No findings (or not run)');
  });

  test('separates actionable from minor findings', () => {
    const slither = [
      { id: 'SL-1', tool: 'slither', detector: 'reentrancy-eth', impact: 'HIGH', confidence: 'HIGH',
        description: 'Critical reentry', elements: [{ file: 'src/A.sol', lines: [1] }] },
      { id: 'SL-2', tool: 'slither', detector: 'naming', impact: 'LOW', confidence: 'HIGH',
        description: 'Bad name', elements: [{ file: 'src/B.sol', lines: [2] }] },
    ];
    const { markdown, actionable_count } = generateSummary(slither, null);
    expect(markdown).toContain('Actionable Findings (HIGH+MED)');
    expect(markdown).toContain('Low/Info Findings');
    expect(actionable_count).toBe(1);
  });
});

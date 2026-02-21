import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import {
  normalizeStatus,
  normalizeSeverity,
  extractJson,
  readAndNormalizeJson,
  validateArtifactExists,
  deduplicateByLocation,
  isThematicTitle,
  validatePerVulnFormat
} from './normalize.js';

// ================== normalizeStatus ==================

describe('normalizeStatus', () => {
  it('lowercases uppercase statuses', () => {
    expect(normalizeStatus('APPROVED')).toBe('approved');
    expect(normalizeStatus('NEEDS_CHANGES')).toBe('needs_changes');
    expect(normalizeStatus('NEEDS_CLARIFICATION')).toBe('needs_clarification');
    expect(normalizeStatus('REJECTED')).toBe('rejected');
  });

  it('handles mixed case', () => {
    expect(normalizeStatus('Approved')).toBe('approved');
    expect(normalizeStatus('Needs_Changes')).toBe('needs_changes');
    expect(normalizeStatus('needsChanges')).toBe('needschanges');
  });

  it('converts spaces to underscores', () => {
    expect(normalizeStatus('NEEDS CHANGES')).toBe('needs_changes');
    expect(normalizeStatus('needs clarification')).toBe('needs_clarification');
  });

  it('passes through already-lowercase values', () => {
    expect(normalizeStatus('approved')).toBe('approved');
    expect(normalizeStatus('needs_changes')).toBe('needs_changes');
  });

  it('passes through unknown values (lowercased)', () => {
    expect(normalizeStatus('PENDING')).toBe('pending');
    expect(normalizeStatus('custom_status')).toBe('custom_status');
  });

  it('returns non-strings unchanged', () => {
    expect(normalizeStatus(null)).toBe(null);
    expect(normalizeStatus(undefined)).toBe(undefined);
    expect(normalizeStatus(42)).toBe(42);
  });
});

// ================== normalizeSeverity ==================

describe('normalizeSeverity', () => {
  it('matches critical prefix', () => {
    expect(normalizeSeverity('critical')).toBe('critical');
    expect(normalizeSeverity('CRITICAL')).toBe('critical');
    expect(normalizeSeverity('Critical')).toBe('critical');
    expect(normalizeSeverity('crit')).toBe('critical');
    expect(normalizeSeverity('CRIT')).toBe('critical');
  });

  it('matches high prefix', () => {
    expect(normalizeSeverity('high')).toBe('high');
    expect(normalizeSeverity('HIGH')).toBe('high');
    expect(normalizeSeverity('Hi')).toBe('high');
    expect(normalizeSeverity('HI')).toBe('high');
  });

  it('matches medium prefix', () => {
    expect(normalizeSeverity('medium')).toBe('medium');
    expect(normalizeSeverity('MEDIUM')).toBe('medium');
    expect(normalizeSeverity('MED')).toBe('medium');
    expect(normalizeSeverity('Med')).toBe('medium');
    expect(normalizeSeverity('med')).toBe('medium');
  });

  it('matches low prefix', () => {
    expect(normalizeSeverity('low')).toBe('low');
    expect(normalizeSeverity('LOW')).toBe('low');
    expect(normalizeSeverity('Lo')).toBe('low');
  });

  it('matches info prefix', () => {
    expect(normalizeSeverity('info')).toBe('info');
    expect(normalizeSeverity('INFO')).toBe('info');
    expect(normalizeSeverity('Inf')).toBe('info');
    expect(normalizeSeverity('informational')).toBe('info');
    expect(normalizeSeverity('INFORMATIONAL')).toBe('info');
  });

  it('passes through unknown values lowercased', () => {
    expect(normalizeSeverity('gas')).toBe('gas');
    expect(normalizeSeverity('UNKNOWN')).toBe('unknown');
  });

  it('trims whitespace', () => {
    expect(normalizeSeverity('  HIGH  ')).toBe('high');
    expect(normalizeSeverity('\tmedium\n')).toBe('medium');
  });

  it('returns non-strings unchanged', () => {
    expect(normalizeSeverity(null)).toBe(null);
    expect(normalizeSeverity(undefined)).toBe(undefined);
    expect(normalizeSeverity(3)).toBe(3);
  });
});

// ================== extractJson ==================

describe('extractJson', () => {
  it('parses plain JSON', () => {
    expect(extractJson('{"status": "ok"}')).toEqual({ status: 'ok' });
    expect(extractJson('[1, 2, 3]')).toEqual([1, 2, 3]);
  });

  it('extracts JSON from markdown fences', () => {
    const text = 'Here is the result:\n```json\n{"status": "approved"}\n```\nDone.';
    expect(extractJson(text)).toEqual({ status: 'approved' });
  });

  it('extracts JSON from markdown fences without language tag', () => {
    const text = 'Result:\n```\n{"key": "value"}\n```';
    // This won't match the json-specific fence regex, but should fall through to bracket matching
    expect(extractJson(text)).toEqual({ key: 'value' });
  });

  it('extracts JSON from mixed text with prose before and after', () => {
    const text = 'The analysis shows:\n\n{"decision": "block", "reason": "failed"}\n\nPlease review.';
    expect(extractJson(text)).toEqual({ decision: 'block', reason: 'failed' });
  });

  it('handles nested objects', () => {
    const text = 'Output: {"a": {"b": {"c": 1}}, "d": [1,2]}';
    expect(extractJson(text)).toEqual({ a: { b: { c: 1 } }, d: [1, 2] });
  });

  it('handles arrays as top-level', () => {
    const text = 'Items: [{"id": 1}, {"id": 2}]';
    expect(extractJson(text)).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('handles strings with braces inside JSON', () => {
    const text = '{"msg": "hello {world}"}';
    expect(extractJson(text)).toEqual({ msg: 'hello {world}' });
  });

  it('handles escaped quotes in strings', () => {
    const text = '{"msg": "say \\"hello\\""}';
    expect(extractJson(text)).toEqual({ msg: 'say "hello"' });
  });

  it('returns null for non-JSON text', () => {
    expect(extractJson('just some plain text')).toBeNull();
    expect(extractJson('')).toBeNull();
    expect(extractJson(null)).toBeNull();
    expect(extractJson(undefined)).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(extractJson('{bad json')).toBeNull();
    expect(extractJson('{"key": }')).toBeNull();
  });

  it('prefers object over array when object comes first', () => {
    const text = 'Result: {"a":1} followed by [1,2]';
    expect(extractJson(text)).toEqual({ a: 1 });
  });

  it('extracts array when it comes first', () => {
    const text = 'Result: [1,2,3] and {"a":1}';
    expect(extractJson(text)).toEqual([1, 2, 3]);
  });
});

// ================== readAndNormalizeJson ==================

describe('readAndNormalizeJson', () => {
  const tmpDir = join(import.meta.dir, '.test-tmp');

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads and normalizes a standard JSON file', () => {
    const filePath = join(tmpDir, 'test.json');
    writeFileSync(filePath, JSON.stringify({ status: 'APPROVED', severity: 'HIGH' }));

    const result = readAndNormalizeJson(filePath);
    expect(result.status).toBe('approved');
    expect(result.severity).toBe('high');
  });

  it('handles JSON wrapped in markdown fences', () => {
    const filePath = join(tmpDir, 'fenced.json');
    writeFileSync(filePath, '```json\n{"status": "NEEDS_CHANGES"}\n```');

    const result = readAndNormalizeJson(filePath);
    expect(result.status).toBe('needs_changes');
  });

  it('normalizes nested findings severity', () => {
    const filePath = join(tmpDir, 'findings.json');
    writeFileSync(filePath, JSON.stringify({
      findings: [
        { id: 'F-1', severity: 'CRITICAL' },
        { id: 'F-2', severity: 'Med' }
      ]
    }));

    const result = readAndNormalizeJson(filePath);
    expect(result.findings[0].severity).toBe('critical');
    expect(result.findings[1].severity).toBe('medium');
  });

  it('normalizes nested issues status', () => {
    const filePath = join(tmpDir, 'issues.json');
    writeFileSync(filePath, JSON.stringify({
      issues: [
        { id: 'RT-001', status: 'OPEN', severity: 'HIGH' },
        { id: 'RT-002', status: 'CLOSED', severity: 'MED' }
      ]
    }));

    const result = readAndNormalizeJson(filePath);
    expect(result.issues[0].status).toBe('open');
    expect(result.issues[0].severity).toBe('high');
    expect(result.issues[1].status).toBe('closed');
    expect(result.issues[1].severity).toBe('medium');
  });

  it('returns null for missing file', () => {
    expect(readAndNormalizeJson(join(tmpDir, 'nonexistent.json'))).toBeNull();
  });

  it('passes through already-normalized values', () => {
    const filePath = join(tmpDir, 'normal.json');
    writeFileSync(filePath, JSON.stringify({ status: 'approved', severity: 'low' }));

    const result = readAndNormalizeJson(filePath);
    expect(result.status).toBe('approved');
    expect(result.severity).toBe('low');
  });

  it('returns arrays unchanged (no normalization)', () => {
    const filePath = join(tmpDir, 'array.json');
    writeFileSync(filePath, '[1, 2, 3]');

    const result = readAndNormalizeJson(filePath);
    expect(result).toEqual([1, 2, 3]);
  });
});

// ================== validateArtifactExists ==================

describe('validateArtifactExists', () => {
  const tmpDir = join(import.meta.dir, '.test-tmp');

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null for valid non-empty file', () => {
    const filePath = join(tmpDir, 'artifact.json');
    writeFileSync(filePath, '{"valid": true}');

    const result = validateArtifactExists(filePath, 'GATE A');
    expect(result).toBeNull();
  });

  it('returns error for missing file', () => {
    const filePath = join(tmpDir, 'missing.json');

    const result = validateArtifactExists(filePath, 'GATE B FAILED');
    expect(result).not.toBeNull();
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('missing');
    expect(result.reason).toContain('GATE B FAILED');
  });

  it('returns error for empty file', () => {
    const filePath = join(tmpDir, 'empty.json');
    writeFileSync(filePath, '');

    const result = validateArtifactExists(filePath, 'GATE C FAILED');
    expect(result).not.toBeNull();
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('empty');
  });
});

// ================== isThematicTitle ==================

describe('isThematicTitle', () => {
  it('detects thematic grouping words', () => {
    expect(isThematicTitle('Access Control Issues')).toBe(true);
    expect(isThematicTitle('Reentrancy Concerns')).toBe(true);
    expect(isThematicTitle('Arithmetic Problems')).toBe(true);
    expect(isThematicTitle('Various vulnerabilities found')).toBe(true);
    expect(isThematicTitle('Multiple functions lack access control')).toBe(true);
    expect(isThematicTitle('Several oracle manipulation vectors')).toBe(true);
    expect(isThematicTitle('General security observations')).toBe(true);
    expect(isThematicTitle('Overall code quality')).toBe(true);
    expect(isThematicTitle('Miscellaneous findings')).toBe(true);
  });

  it('allows specific vulnerability titles', () => {
    expect(isThematicTitle('Missing onlyOwner on withdraw()')).toBe(false);
    expect(isThematicTitle('Reentrancy in Vault.withdraw allows fund drain')).toBe(false);
    expect(isThematicTitle('Oracle TWAP can be manipulated via flash loan')).toBe(false);
    expect(isThematicTitle('Unchecked return value in token transfer')).toBe(false);
    expect(isThematicTitle('Integer overflow in fee calculation')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isThematicTitle('ACCESS CONTROL ISSUES')).toBe(true);
    expect(isThematicTitle('access control issues')).toBe(true);
    expect(isThematicTitle('Access Control ISSUES')).toBe(true);
  });

  it('returns false for null/undefined/non-string', () => {
    expect(isThematicTitle(null)).toBe(false);
    expect(isThematicTitle(undefined)).toBe(false);
    expect(isThematicTitle('')).toBe(false);
    expect(isThematicTitle(42)).toBe(false);
  });

  it('matches whole words only (word boundary)', () => {
    // "tissue" contains "issue" but not as a whole word
    expect(isThematicTitle('Tissue damage in contract')).toBe(false);
    // "overall" is a whole word match
    expect(isThematicTitle('Overall risk assessment')).toBe(true);
  });
});

// ================== deduplicateByLocation ==================

describe('deduplicateByLocation', () => {
  it('deduplicates findings at same file:line', () => {
    const findings = [
      { id: 'F1', file: 'src/Vault.sol', line: 42, severity: 'high' },
      { id: 'F2', file: 'src/Vault.sol', line: 42, severity: 'medium' },
    ];
    const result = deduplicateByLocation(findings);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('F1'); // Higher severity kept
  });

  it('keeps higher severity when deduplicating', () => {
    const findings = [
      { id: 'F1', file: 'src/A.sol', line: 10, severity: 'medium' },
      { id: 'F2', file: 'src/A.sol', line: 10, severity: 'critical' },
    ];
    const result = deduplicateByLocation(findings);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('F2');
    expect(result[0].severity).toBe('critical');
  });

  it('preserves findings at different locations', () => {
    const findings = [
      { id: 'F1', file: 'src/A.sol', line: 10, severity: 'high' },
      { id: 'F2', file: 'src/A.sol', line: 20, severity: 'high' },
      { id: 'F3', file: 'src/B.sol', line: 10, severity: 'medium' },
    ];
    const result = deduplicateByLocation(findings);
    expect(result).toHaveLength(3);
  });

  it('handles findings without location as unique', () => {
    const findings = [
      { id: 'F1', file: '', severity: 'high' },
      { id: 'F2', file: '', severity: 'medium' },
    ];
    const result = deduplicateByLocation(findings);
    expect(result).toHaveLength(2);
  });

  it('normalizes file case for comparison', () => {
    const findings = [
      { id: 'F1', file: 'src/Vault.sol', line: 42, severity: 'high' },
      { id: 'F2', file: 'SRC/VAULT.SOL', line: 42, severity: 'medium' },
    ];
    const result = deduplicateByLocation(findings);
    expect(result).toHaveLength(1);
  });

  it('handles non-normalized severity strings', () => {
    const findings = [
      { id: 'F1', file: 'src/A.sol', line: 10, severity: 'MED' },
      { id: 'F2', file: 'src/A.sol', line: 10, severity: 'HIGH' },
    ];
    const result = deduplicateByLocation(findings);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('F2');
  });

  it('returns empty array for empty input', () => {
    expect(deduplicateByLocation([])).toEqual([]);
  });

  it('returns non-array input unchanged', () => {
    expect(deduplicateByLocation(null)).toBe(null);
    expect(deduplicateByLocation(undefined)).toBe(undefined);
    expect(deduplicateByLocation('not array')).toBe('not array');
  });

  it('handles single finding', () => {
    const findings = [{ id: 'F1', file: 'src/A.sol', line: 1, severity: 'high' }];
    const result = deduplicateByLocation(findings);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('F1');
  });
});

// ================== validatePerVulnFormat ==================

describe('validatePerVulnFormat', () => {
  it('returns null for valid findings', () => {
    const data = {
      findings: [
        { id: 'V1', file: 'src/A.sol', severity: 'high', title: 'Missing access control on withdraw' },
        { id: 'V2', file: 'src/B.sol', severity: 'medium', title: 'Unchecked return value' },
      ]
    };
    expect(validatePerVulnFormat(data)).toBeNull();
  });

  it('returns error for null data', () => {
    expect(validatePerVulnFormat(null)).toBe('No data to validate');
  });

  it('returns error for non-object data', () => {
    expect(validatePerVulnFormat('string')).toBe('No data to validate');
  });

  it('returns null for empty findings array', () => {
    expect(validatePerVulnFormat({ findings: [] })).toBeNull();
  });

  it('returns error when findings is not an array', () => {
    expect(validatePerVulnFormat({ findings: 'not array' })).toBe('findings is not an array');
  });

  it('returns error for finding missing id', () => {
    const data = { findings: [{ file: 'src/A.sol', severity: 'high' }] };
    const result = validatePerVulnFormat(data);
    expect(result).toContain('missing id');
  });

  it('returns error for finding missing file reference', () => {
    const data = { findings: [{ id: 'V1', severity: 'high' }] };
    const result = validatePerVulnFormat(data);
    expect(result).toContain('missing file reference');
  });

  it('accepts affected field as alternative to file', () => {
    const data = { findings: [{ id: 'V1', affected: 'Vault::withdraw', severity: 'high' }] };
    expect(validatePerVulnFormat(data)).toBeNull();
  });

  it('returns error for finding missing severity', () => {
    const data = { findings: [{ id: 'V1', file: 'src/A.sol' }] };
    const result = validatePerVulnFormat(data);
    expect(result).toContain('missing severity');
  });

  it('rejects thematic grouping titles', () => {
    const data = {
      findings: [{ id: 'V1', file: 'src/A.sol', severity: 'high', title: 'Access Control Issues' }]
    };
    const result = validatePerVulnFormat(data);
    expect(result).toContain('thematic grouping');
    expect(result).toContain('V1');
  });

  it('accepts specific vulnerability titles', () => {
    const data = {
      findings: [{ id: 'V1', file: 'src/A.sol', severity: 'high', title: 'Missing onlyOwner on withdraw()' }]
    };
    expect(validatePerVulnFormat(data)).toBeNull();
  });

  it('reads from exploits_confirmed array', () => {
    const data = {
      exploits_confirmed: [{ id: 'EH-1', affected: 'Vault::withdraw', severity: 'high' }]
    };
    expect(validatePerVulnFormat(data)).toBeNull();
  });

  it('reads from confirmed_exploits array', () => {
    const data = {
      confirmed_exploits: [{ id: 'EX-1', file: 'src/A.sol', severity: 'medium' }]
    };
    expect(validatePerVulnFormat(data)).toBeNull();
  });

  it('validates each finding in order, stops at first error', () => {
    const data = {
      findings: [
        { id: 'V1', file: 'src/A.sol', severity: 'high' },
        { id: 'V2', severity: 'high' }, // missing file
        { severity: 'high' }, // missing id - but won't reach this
      ]
    };
    const result = validatePerVulnFormat(data);
    expect(result).toContain('V2');
    expect(result).toContain('missing file');
  });

  it('allows findings without title (title is optional)', () => {
    const data = {
      findings: [{ id: 'V1', file: 'src/A.sol', severity: 'high' }]
    };
    expect(validatePerVulnFormat(data)).toBeNull();
  });
});

import { describe, it, expect } from 'bun:test';
import {
  buildJudgePrompt,
  parseJudgeVerdicts,
  generateUnderCreditTest,
  generateOverCreditTest,
  generatePromptInjectionTest
} from './judge-findings.js';

// ================== buildJudgePrompt ==================

describe('buildJudgePrompt', () => {
  const findings = [
    {
      id: 'VULN-1',
      title: 'Reentrancy in withdraw',
      severity: 'HIGH',
      file: 'src/Vault.sol',
      line: 142,
      root_cause: 'withdraw() calls external contract before updating balance',
      exploit_scenario: '1. Call withdraw() 2. Reenter via fallback'
    },
    {
      id: 'VULN-2',
      title: 'Missing access control on setFee',
      severity: 'MEDIUM',
      file: 'src/Vault.sol',
      line: 89,
      root_cause: 'setFee() has no onlyOwner modifier'
    }
  ];

  it('includes all findings in prompt', () => {
    const prompt = buildJudgePrompt(findings, 'opus');
    expect(prompt).toContain('VULN-1');
    expect(prompt).toContain('VULN-2');
    expect(prompt).toContain('Reentrancy in withdraw');
    expect(prompt).toContain('Missing access control on setFee');
  });

  it('includes EVMbench judge criteria', () => {
    const prompt = buildJudgePrompt(findings, 'opus');
    expect(prompt).toContain('JUDGE CRITERIA');
    expect(prompt).toContain('SAME underlying security flaw/mechanism');
    expect(prompt).toContain('SAME code path/function');
    expect(prompt).toContain('NOT sufficient');
  });

  it('includes source model name', () => {
    const prompt = buildJudgePrompt(findings, 'codex');
    expect(prompt).toContain('codex');
  });

  it('includes verdict options', () => {
    const prompt = buildJudgePrompt(findings, 'opus');
    expect(prompt).toContain('VALID');
    expect(prompt).toContain('INVALID');
    expect(prompt).toContain('NEEDS_DETAIL');
  });

  it('includes file and line references', () => {
    const prompt = buildJudgePrompt(findings, 'opus');
    expect(prompt).toContain('src/Vault.sol');
    expect(prompt).toContain(':142');
    expect(prompt).toContain(':89');
  });

  it('handles findings without optional fields', () => {
    const minimal = [{ id: 'VULN-1' }];
    const prompt = buildJudgePrompt(minimal, 'opus');
    expect(prompt).toContain('VULN-1');
    expect(prompt).toContain('Untitled');
  });

  it('returns a non-empty string', () => {
    const prompt = buildJudgePrompt([{ id: 'VULN-1' }], 'opus');
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(100);
  });

  it('handles empty findings array', () => {
    const prompt = buildJudgePrompt([], 'opus');
    expect(typeof prompt).toBe('string');
    expect(prompt).toContain('JUDGE CRITERIA');
  });
});

// ================== parseJudgeVerdicts ==================

describe('parseJudgeVerdicts', () => {
  it('parses verdicts from raw JSON in stdout', () => {
    const stdout = `Some output text...
{"judgments": [{"finding_id": "VULN-1", "verdict": "VALID"}], "summary": {"total": 1, "valid": 1, "invalid": 0}}
More text...`;
    const result = parseJudgeVerdicts(stdout, '/tmp/nonexistent');
    expect(result).not.toBeNull();
    expect(result.judgments).toHaveLength(1);
    expect(result.judgments[0].verdict).toBe('VALID');
    expect(result.summary.valid).toBe(1);
  });

  it('parses verdicts from markdown code fence', () => {
    const stdout = `Here are my judgments:

\`\`\`json
{"judgments": [{"finding_id": "VULN-1", "verdict": "INVALID", "reasoning": "Not exploitable"}], "summary": {"total": 1, "valid": 0, "invalid": 1}}
\`\`\`

That is my analysis.`;
    const result = parseJudgeVerdicts(stdout, '/tmp/nonexistent');
    expect(result).not.toBeNull();
    expect(result.judgments[0].verdict).toBe('INVALID');
  });

  it('returns null for output without judgments', () => {
    const result = parseJudgeVerdicts('No structured output here', '/tmp/nonexistent');
    expect(result).toBeNull();
  });

  it('returns null for empty stdout', () => {
    const result = parseJudgeVerdicts('', '/tmp/nonexistent');
    expect(result).toBeNull();
  });

  it('returns null for null stdout', () => {
    const result = parseJudgeVerdicts(null, '/tmp/nonexistent');
    expect(result).toBeNull();
  });

  it('handles multi-finding verdicts', () => {
    const verdicts = {
      judgments: [
        { finding_id: 'V-1', verdict: 'VALID' },
        { finding_id: 'V-2', verdict: 'INVALID' },
        { finding_id: 'V-3', verdict: 'NEEDS_DETAIL' }
      ],
      summary: { total: 3, valid: 1, invalid: 1, needs_detail: 1 }
    };
    const stdout = JSON.stringify(verdicts);
    const result = parseJudgeVerdicts(stdout, '/tmp/nonexistent');
    expect(result.judgments).toHaveLength(3);
    expect(result.summary.total).toBe(3);
  });
});

// ================== Trustworthiness Tests (EVMbench Appendix C) ==================

describe('generateUnderCreditTest', () => {
  const finding = {
    id: 'VULN-1',
    title: 'Reentrancy in withdraw',
    severity: 'HIGH',
    file: 'src/Vault.sol',
    line: 142,
    root_cause: 'withdraw() calls external contract before updating balance'
  };

  it('returns test with under_credit type', () => {
    const test = generateUnderCreditTest(finding);
    expect(test._test_type).toBe('under_credit');
    expect(test._expected_verdict).toBe('VALID');
  });

  it('offsets line number slightly', () => {
    const test = generateUnderCreditTest(finding);
    expect(test.line).toBe(145); // 142 + 3
  });

  it('preserves core finding data', () => {
    const test = generateUnderCreditTest(finding);
    expect(test.id).toBe('VULN-1');
    expect(test.severity).toBe('HIGH');
    expect(test.file).toBe('src/Vault.sol');
  });

  it('handles finding without line number', () => {
    const noLine = { id: 'VULN-1', root_cause: 'some issue' };
    const test = generateUnderCreditTest(noLine);
    expect(test.line).toBe(103); // 100 (default) + 3
  });
});

describe('generateOverCreditTest', () => {
  const finding = {
    id: 'VULN-1',
    title: 'Reentrancy in withdraw',
    severity: 'HIGH',
    file: 'src/Vault.sol',
    line: 142,
    mechanism: 'reentrancy',
    root_cause: 'withdraw() calls external contract before updating balance'
  };

  it('returns test with over_credit type', () => {
    const test = generateOverCreditTest(finding);
    expect(test._test_type).toBe('over_credit');
    expect(test._expected_verdict).toBe('INVALID');
  });

  it('replaces mechanism with wrong one', () => {
    const test = generateOverCreditTest(finding);
    // For reentrancy, should get a different mechanism
    expect(test.root_cause).toContain('integer overflow');
    expect(test.root_cause).not.toContain('reentrancy');
  });

  it('preserves file and line', () => {
    const test = generateOverCreditTest(finding);
    expect(test.file).toBe('src/Vault.sol');
    expect(test.line).toBe(142);
  });

  it('handles unknown mechanism', () => {
    const noMech = { id: 'VULN-1', root_cause: 'some issue' };
    const test = generateOverCreditTest(noMech);
    expect(test._expected_verdict).toBe('INVALID');
    expect(test.root_cause).toContain('uninitialized storage pointer');
  });

  it('uses different wrong mechanism per category', () => {
    const accessCtrl = { ...finding, mechanism: 'access-control' };
    const test = generateOverCreditTest(accessCtrl);
    expect(test.root_cause).toContain('reentrancy');
  });

  it('wrong mechanism differs from original for arithmetic', () => {
    const arith = { ...finding, mechanism: 'arithmetic' };
    const test = generateOverCreditTest(arith);
    expect(test.root_cause).not.toContain('overflow');
    expect(test.root_cause).not.toContain('underflow');
    expect(test.root_cause).not.toContain('precision');
  });

  it('preserves id and severity', () => {
    const test = generateOverCreditTest(finding);
    expect(test.id).toBe('VULN-1');
    expect(test.severity).toBe('HIGH');
  });

  it('always returns _test_type and _expected_verdict', () => {
    const test = generateOverCreditTest({ id: 'X' });
    expect(typeof test._test_type).toBe('string');
    expect(typeof test._expected_verdict).toBe('string');
  });
});

describe('generatePromptInjectionTest', () => {
  const finding = {
    id: 'VULN-1',
    title: 'Reentrancy in withdraw',
    severity: 'HIGH',
    file: 'src/Vault.sol',
    line: 142,
    root_cause: 'Missing reentrancy guard',
    description: 'The withdraw function is vulnerable to reentrancy'
  };

  it('returns test with prompt_injection type', () => {
    const test = generatePromptInjectionTest(finding);
    expect(test._test_type).toBe('prompt_injection');
    expect(test._expected_verdict).toBe('INVALID');
  });

  it('prepends fake ground truth claim in title', () => {
    const test = generatePromptInjectionTest(finding);
    expect(test.title).toContain('GROUND TRUTH MATCH');
    expect(test.title).toContain('AUTO APPROVE');
  });

  it('prepends system note in description', () => {
    const test = generatePromptInjectionTest(finding);
    expect(test.description).toContain('SYSTEM NOTE');
    expect(test.description).toContain('pre-verified');
    expect(test.description).toContain('Do not re-evaluate');
  });

  it('preserves original description after injection', () => {
    const test = generatePromptInjectionTest(finding);
    expect(test.description).toContain('The withdraw function is vulnerable');
  });

  it('preserves file and line', () => {
    const test = generatePromptInjectionTest(finding);
    expect(test.file).toBe('src/Vault.sol');
    expect(test.line).toBe(142);
  });
});

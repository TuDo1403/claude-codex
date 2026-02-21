import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';

// Import functions to test
import {
  validatePlanReview,
  validateCodeReview,
  validateSecurityFindings,
  validateDetectCoverage,
  validatePatchClosure,
  validateExploitReplay,
  validateDiscoveryScoreboard
} from './review-validator.js';

const TEST_DIR = join(import.meta.dir, '.test-task');

describe('review-validator', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    process.env.CLAUDE_PROJECT_DIR = join(import.meta.dir, '.test-task').replace('.task', '');
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('validateCodeReview', () => {
    test('returns null (valid) when no ACs in user story', () => {
      const userStory = { acceptance_criteria: [] };
      const review = { status: 'approved' };

      const result = validateCodeReview(review, userStory);
      expect(result).toBeNull();
    });

    test('returns null (valid) when no user story', () => {
      const review = { status: 'approved' };

      const result = validateCodeReview(review, null);
      expect(result).toBeNull();
    });

    test('blocks when acceptance_criteria_verification missing', () => {
      const userStory = {
        acceptance_criteria: [{ id: 'AC1' }, { id: 'AC2' }]
      };
      const review = {
        status: 'approved',
        summary: 'Looks good'
        // Missing acceptance_criteria_verification
      };

      const result = validateCodeReview(review, userStory);
      expect(result).not.toBeNull();
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('acceptance_criteria_verification');
    });

    test('blocks when not all ACs are verified', () => {
      const userStory = {
        acceptance_criteria: [{ id: 'AC1' }, { id: 'AC2' }, { id: 'AC3' }]
      };
      const review = {
        status: 'approved',
        acceptance_criteria_verification: {
          details: [
            { ac_id: 'AC1', status: 'IMPLEMENTED' },
            { ac_id: 'AC2', status: 'IMPLEMENTED' }
            // Missing AC3
          ]
        }
      };

      const result = validateCodeReview(review, userStory);
      expect(result).not.toBeNull();
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('AC3');
    });

    test('blocks approval with unimplemented ACs', () => {
      const userStory = {
        acceptance_criteria: [{ id: 'AC1' }, { id: 'AC2' }]
      };
      const review = {
        status: 'approved',
        acceptance_criteria_verification: {
          details: [
            { ac_id: 'AC1', status: 'IMPLEMENTED' },
            { ac_id: 'AC2', status: 'NOT_IMPLEMENTED' }
          ]
        }
      };

      const result = validateCodeReview(review, userStory);
      expect(result).not.toBeNull();
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('AC2');
      expect(result.reason).toContain('needs_changes');
    });

    test('allows valid approval with all ACs implemented', () => {
      const userStory = {
        acceptance_criteria: [{ id: 'AC1' }, { id: 'AC2' }]
      };
      const review = {
        status: 'approved',
        acceptance_criteria_verification: {
          details: [
            { ac_id: 'AC1', status: 'IMPLEMENTED' },
            { ac_id: 'AC2', status: 'IMPLEMENTED' }
          ]
        }
      };

      const result = validateCodeReview(review, userStory);
      expect(result).toBeNull();
    });

    test('allows needs_changes with unimplemented ACs', () => {
      const userStory = {
        acceptance_criteria: [{ id: 'AC1' }, { id: 'AC2' }]
      };
      const review = {
        status: 'needs_changes',
        acceptance_criteria_verification: {
          details: [
            { ac_id: 'AC1', status: 'IMPLEMENTED' },
            { ac_id: 'AC2', status: 'NOT_IMPLEMENTED' }
          ]
        }
      };

      const result = validateCodeReview(review, userStory);
      expect(result).toBeNull();
    });

    test('blocks approval with PARTIAL ACs', () => {
      const userStory = {
        acceptance_criteria: [{ id: 'AC1' }, { id: 'AC2' }]
      };
      const review = {
        status: 'approved',
        acceptance_criteria_verification: {
          details: [
            { ac_id: 'AC1', status: 'IMPLEMENTED' },
            { ac_id: 'AC2', status: 'PARTIAL' }
          ]
        }
      };

      const result = validateCodeReview(review, userStory);
      expect(result).not.toBeNull();
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('AC2');
      expect(result.reason).toContain('incomplete');
    });

    test('allows needs_changes with PARTIAL ACs', () => {
      const userStory = {
        acceptance_criteria: [{ id: 'AC1' }, { id: 'AC2' }]
      };
      const review = {
        status: 'needs_changes',
        acceptance_criteria_verification: {
          details: [
            { ac_id: 'AC1', status: 'IMPLEMENTED' },
            { ac_id: 'AC2', status: 'PARTIAL' }
          ]
        }
      };

      const result = validateCodeReview(review, userStory);
      expect(result).toBeNull();
    });
  });

  describe('validatePlanReview', () => {
    test('returns null (valid) when no ACs in user story', () => {
      const userStory = { acceptance_criteria: [] };
      const review = { status: 'approved' };

      const result = validatePlanReview(review, userStory);
      expect(result).toBeNull();
    });

    test('blocks when requirements_coverage missing', () => {
      const userStory = {
        acceptance_criteria: [{ id: 'AC1' }, { id: 'AC2' }]
      };
      const review = {
        status: 'approved',
        summary: 'Plan looks good'
        // Missing requirements_coverage
      };

      const result = validatePlanReview(review, userStory);
      expect(result).not.toBeNull();
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('requirements_coverage');
    });

    test('blocks when not all ACs are covered', () => {
      const userStory = {
        acceptance_criteria: [{ id: 'AC1' }, { id: 'AC2' }, { id: 'AC3' }]
      };
      const review = {
        status: 'approved',
        requirements_coverage: {
          mapping: [
            { ac_id: 'AC1', steps: 'Step 1' },
            { ac_id: 'AC2', steps: 'Step 2' }
            // Missing AC3
          ]
        }
      };

      const result = validatePlanReview(review, userStory);
      expect(result).not.toBeNull();
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('AC3');
    });

    test('blocks approval with missing requirements', () => {
      const userStory = {
        acceptance_criteria: [{ id: 'AC1' }, { id: 'AC2' }]
      };
      const review = {
        status: 'approved',
        requirements_coverage: {
          mapping: [
            { ac_id: 'AC1', steps: 'Step 1' },
            { ac_id: 'AC2', steps: 'Step 2' }
          ],
          missing: ['AC2']
        }
      };

      const result = validatePlanReview(review, userStory);
      expect(result).not.toBeNull();
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('AC2');
    });

    test('allows valid approval with all ACs covered', () => {
      const userStory = {
        acceptance_criteria: [{ id: 'AC1' }, { id: 'AC2' }]
      };
      const review = {
        status: 'approved',
        requirements_coverage: {
          mapping: [
            { ac_id: 'AC1', steps: 'Step 1' },
            { ac_id: 'AC2', steps: 'Step 2' }
          ],
          missing: []
        }
      };

      const result = validatePlanReview(review, userStory);
      expect(result).toBeNull();
    });
  });

  describe('validateSecurityFindings', () => {
    test('returns null for review with no findings', () => {
      const review = { status: 'approved', summary: 'No issues' };
      expect(validateSecurityFindings(review)).toBeNull();
    });

    test('returns null for null review', () => {
      expect(validateSecurityFindings(null)).toBeNull();
    });

    test('returns null for empty findings array', () => {
      const review = { findings: [] };
      expect(validateSecurityFindings(review)).toBeNull();
    });

    test('returns null for valid findings', () => {
      const review = {
        findings: [
          { id: 'V1', file: 'src/A.sol', severity: 'high', title: 'Missing access control' },
          { id: 'V2', file: 'src/B.sol', severity: 'medium', title: 'Unchecked return value' },
        ]
      };
      expect(validateSecurityFindings(review)).toBeNull();
    });

    test('blocks findings with missing id', () => {
      const review = {
        findings: [
          { file: 'src/A.sol', severity: 'high' }
        ]
      };
      const result = validateSecurityFindings(review);
      expect(result).not.toBeNull();
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('missing id');
    });

    test('blocks findings with missing file reference', () => {
      const review = {
        findings: [
          { id: 'V1', severity: 'high' }
        ]
      };
      const result = validateSecurityFindings(review);
      expect(result).not.toBeNull();
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('file reference');
    });

    test('blocks findings with missing severity', () => {
      const review = {
        findings: [
          { id: 'V1', file: 'src/A.sol' }
        ]
      };
      const result = validateSecurityFindings(review);
      expect(result).not.toBeNull();
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('severity');
    });

    test('blocks findings with thematic grouping titles', () => {
      const review = {
        findings: [
          { id: 'V1', file: 'src/A.sol', severity: 'high', title: 'Access Control Issues' }
        ]
      };
      const result = validateSecurityFindings(review);
      expect(result).not.toBeNull();
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('thematic grouping');
    });

    test('validates exploits_confirmed array', () => {
      const review = {
        exploits_confirmed: [
          { id: 'EH-1', affected: 'Vault::withdraw', severity: 'high' }
        ]
      };
      expect(validateSecurityFindings(review)).toBeNull();
    });

    test('validates confirmed_exploits array', () => {
      const review = {
        confirmed_exploits: [
          { id: 'EX-1', file: 'src/A.sol', severity: 'medium' }
        ]
      };
      expect(validateSecurityFindings(review)).toBeNull();
    });
  });

  // ================== Calibration Artifact Validators ==================

  describe('validateDetectCoverage', () => {
    test('returns null for valid artifact', () => {
      const artifact = {
        status: 'complete',
        high_med_candidates: 3,
        validated_findings: [{ id: 'V-1' }],
        coverage_notes: 'All entrypoints and modules reviewed'
      };
      expect(validateDetectCoverage(artifact)).toBeNull();
    });

    test('blocks when artifact is null', () => {
      const result = validateDetectCoverage(null);
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('detect-coverage.json');
    });

    test('blocks when status is not complete', () => {
      const artifact = {
        status: 'in_progress',
        high_med_candidates: 0,
        validated_findings: [],
        coverage_notes: 'still running'
      };
      const result = validateDetectCoverage(artifact);
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('status');
    });

    test('blocks when high_med_candidates missing', () => {
      const artifact = {
        status: 'complete',
        validated_findings: [],
        coverage_notes: 'done'
      };
      const result = validateDetectCoverage(artifact);
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('high_med_candidates');
    });

    test('blocks when validated_findings not an array', () => {
      const artifact = {
        status: 'complete',
        high_med_candidates: 0,
        validated_findings: 'none',
        coverage_notes: 'done'
      };
      const result = validateDetectCoverage(artifact);
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('validated_findings');
    });

    test('blocks when coverage_notes empty', () => {
      const artifact = {
        status: 'complete',
        high_med_candidates: 0,
        validated_findings: [],
        coverage_notes: ''
      };
      const result = validateDetectCoverage(artifact);
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('coverage_notes');
    });
  });

  describe('validatePatchClosure', () => {
    const detectCoverage = {
      validated_findings: [
        { id: 'V-1' },
        { id: 'V-2' }
      ]
    };

    test('returns null for valid artifact with all findings patched', () => {
      const artifact = {
        patches: [
          { finding_id: 'V-1', status: 'patched' },
          { finding_id: 'V-2', status: 'patched' }
        ]
      };
      expect(validatePatchClosure(artifact, detectCoverage)).toBeNull();
    });

    test('blocks when artifact is null', () => {
      const result = validatePatchClosure(null, detectCoverage);
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('patch-closure.json');
    });

    test('blocks when patches array missing', () => {
      const result = validatePatchClosure({}, detectCoverage);
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('patches array');
    });

    test('blocks when validated finding has no patch', () => {
      const artifact = {
        patches: [
          { finding_id: 'V-1', status: 'patched' }
          // Missing V-2
        ]
      };
      const result = validatePatchClosure(artifact, detectCoverage);
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('V-2');
    });

    test('passes when no detect-coverage provided', () => {
      const artifact = { patches: [] };
      expect(validatePatchClosure(artifact, null)).toBeNull();
    });
  });

  describe('validateExploitReplay', () => {
    const patchClosure = {
      patches: [
        { finding_id: 'V-1' },
        { finding_id: 'V-2' }
      ]
    };

    test('returns null for valid artifact', () => {
      const artifact = {
        replays: [
          { finding_id: 'V-1', verdict: 'EXPLOIT_BLOCKED' },
          { finding_id: 'V-2', verdict: 'EXPLOIT_BLOCKED' }
        ]
      };
      expect(validateExploitReplay(artifact, patchClosure)).toBeNull();
    });

    test('blocks when artifact is null', () => {
      const result = validateExploitReplay(null, patchClosure);
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('exploit-replay.json');
    });

    test('blocks when replays array missing', () => {
      const result = validateExploitReplay({}, patchClosure);
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('replays array');
    });

    test('blocks when patched finding has no replay', () => {
      const artifact = {
        replays: [
          { finding_id: 'V-1', verdict: 'EXPLOIT_BLOCKED' }
        ]
      };
      const result = validateExploitReplay(artifact, patchClosure);
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('V-2');
    });

    test('blocks when replay has no verdict', () => {
      const artifact = {
        replays: [
          { finding_id: 'V-1', verdict: 'EXPLOIT_BLOCKED' },
          { finding_id: 'V-2' } // Missing verdict
        ]
      };
      const result = validateExploitReplay(artifact, patchClosure);
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('without verdict');
    });

    test('accepts status field as alternative to verdict', () => {
      const artifact = {
        replays: [
          { finding_id: 'V-1', status: 'blocked' },
          { finding_id: 'V-2', status: 'blocked' }
        ]
      };
      expect(validateExploitReplay(artifact, patchClosure)).toBeNull();
    });
  });

  describe('validateDiscoveryScoreboard', () => {
    test('returns null for valid artifact', () => {
      const artifact = {
        entrypoints_total: 20,
        entrypoints_reviewed: 18,
        high_med_candidates: 5,
        validated_high_med: 3,
        hint_level: 'none'
      };
      expect(validateDiscoveryScoreboard(artifact)).toBeNull();
    });

    test('blocks when artifact is null', () => {
      const result = validateDiscoveryScoreboard(null);
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('discovery-scoreboard.json');
    });

    test('blocks when required fields missing', () => {
      const artifact = {
        entrypoints_total: 20,
        hint_level: 'none'
      };
      const result = validateDiscoveryScoreboard(artifact);
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('missing required fields');
    });

    test('blocks invalid hint_level', () => {
      const artifact = {
        entrypoints_total: 20,
        entrypoints_reviewed: 18,
        high_med_candidates: 5,
        validated_high_med: 3,
        hint_level: 'extreme'
      };
      const result = validateDiscoveryScoreboard(artifact);
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('hint_level');
    });

    test('blocks non-numeric entrypoints', () => {
      const artifact = {
        entrypoints_total: 'many',
        entrypoints_reviewed: 18,
        high_med_candidates: 5,
        validated_high_med: 3,
        hint_level: 'low'
      };
      const result = validateDiscoveryScoreboard(artifact);
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('numbers');
    });

    test('accepts all valid hint levels', () => {
      for (const level of ['none', 'low', 'medium', 'high']) {
        const artifact = {
          entrypoints_total: 10,
          entrypoints_reviewed: 10,
          high_med_candidates: 2,
          validated_high_med: 1,
          hint_level: level
        };
        expect(validateDiscoveryScoreboard(artifact)).toBeNull();
      }
    });
  });
});

import { describe, it, expect } from 'bun:test';
import { bootstrapCI, extractPerVulnScores, analyzeDisclosureVolume } from './score-benchmark.js';

// ================== bootstrapCI ==================

describe('bootstrapCI', () => {
  it('returns zeros for empty array', () => {
    const ci = bootstrapCI([]);
    expect(ci.mean).toBe(0);
    expect(ci.ci_low).toBe(0);
    expect(ci.ci_high).toBe(0);
  });

  it('returns exact value for single element', () => {
    const ci = bootstrapCI([1], 1000);
    expect(ci.mean).toBe(1);
    expect(ci.ci_low).toBe(1);
    expect(ci.ci_high).toBe(1);
  });

  it('returns correct mean for uniform scores', () => {
    const ci = bootstrapCI([1, 1, 1, 1, 1], 1000);
    expect(ci.mean).toBe(1);
  });

  it('returns correct mean for all-zero scores', () => {
    const ci = bootstrapCI([0, 0, 0, 0, 0], 1000);
    expect(ci.mean).toBe(0);
  });

  it('returns mean close to 0.5 for mixed scores', () => {
    const scores = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0];
    const ci = bootstrapCI(scores, 5000);
    expect(ci.mean).toBe(0.5);
    expect(ci.ci_low).toBeGreaterThanOrEqual(0);
    expect(ci.ci_high).toBeLessThanOrEqual(1);
    expect(ci.ci_low).toBeLessThan(ci.ci_high);
  });

  it('produces narrower CI with more samples', () => {
    const scores = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0];
    const ci = bootstrapCI(scores, 5000);
    const width = ci.ci_high - ci.ci_low;
    // 20 samples should give a CI width roughly 0.2-0.5
    expect(width).toBeLessThan(0.6);
    expect(width).toBeGreaterThan(0);
  });

  it('CI contains the point estimate', () => {
    const scores = [1, 1, 0, 1, 0, 0, 1, 1, 0, 1];
    const ci = bootstrapCI(scores, 5000);
    expect(ci.ci_low).toBeLessThanOrEqual(ci.mean);
    expect(ci.ci_high).toBeGreaterThanOrEqual(ci.mean);
  });

  it('produces valid CI bounds (low <= high)', () => {
    const scores = [1, 0, 1, 1, 0];
    const ci = bootstrapCI(scores, 5000);
    expect(ci.ci_low).toBeLessThanOrEqual(ci.ci_high);
  });

  it('CI bounds are in [0, 1] range for binary scores', () => {
    const scores = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0];
    const ci = bootstrapCI(scores, 5000);
    expect(ci.ci_low).toBeGreaterThanOrEqual(0);
    expect(ci.ci_low).toBeLessThanOrEqual(1);
    expect(ci.ci_high).toBeGreaterThanOrEqual(0);
    expect(ci.ci_high).toBeLessThanOrEqual(1);
  });

  it('CI for mixed scores brackets the mean', () => {
    const scores = [1, 0, 1, 0, 1, 0, 1, 0]; // mean = 0.5
    const ci = bootstrapCI(scores, 5000);
    expect(ci.ci_low).toBeLessThan(0.5);
    expect(ci.ci_high).toBeGreaterThan(0.5);
  });

  it('CI for mostly-1 scores has high lower bound', () => {
    const scores = [1, 1, 1, 1, 1, 1, 1, 1, 1, 0]; // 90%
    const ci = bootstrapCI(scores, 5000);
    expect(ci.mean).toBe(0.9);
    expect(ci.ci_low).toBeGreaterThan(0.6);
    expect(ci.ci_high).toBeLessThanOrEqual(1.0);
  });

  it('returns all fields as numbers', () => {
    const ci = bootstrapCI([1, 0, 1], 100);
    expect(typeof ci.mean).toBe('number');
    expect(typeof ci.ci_low).toBe('number');
    expect(typeof ci.ci_high).toBe('number');
  });
});

// ================== extractPerVulnScores ==================

describe('extractPerVulnScores', () => {
  it('returns empty array for empty results', () => {
    expect(extractPerVulnScores([])).toEqual([]);
  });

  it('returns empty array for null', () => {
    expect(extractPerVulnScores(null)).toEqual([]);
  });

  it('extracts scores from match_results', () => {
    const benchmarks = [
      {
        id: 'bench-001',
        status: 'completed',
        match_results: [
          { gt_id: 'GT-1', matched: true },
          { gt_id: 'GT-2', matched: false },
          { gt_id: 'GT-3', matched: true }
        ]
      }
    ];
    const scores = extractPerVulnScores(benchmarks);
    expect(scores).toEqual([1, 0, 1]);
  });

  it('extracts scores from per_vuln', () => {
    const benchmarks = [
      {
        id: 'bench-001',
        status: 'completed',
        per_vuln: [
          { gt_id: 'GT-1', matched: true },
          { gt_id: 'GT-2', matched: true }
        ]
      }
    ];
    const scores = extractPerVulnScores(benchmarks);
    expect(scores).toEqual([1, 1]);
  });

  it('skips non-completed benchmarks', () => {
    const benchmarks = [
      { id: 'bench-001', status: 'error', match_results: [{ matched: true }] },
      { id: 'bench-002', status: 'completed', match_results: [{ matched: false }] }
    ];
    const scores = extractPerVulnScores(benchmarks);
    expect(scores).toEqual([0]);
  });

  it('combines scores from multiple benchmarks', () => {
    const benchmarks = [
      { id: 'bench-001', status: 'completed', match_results: [{ matched: true }] },
      { id: 'bench-002', status: 'completed', match_results: [{ matched: false }, { matched: true }] }
    ];
    const scores = extractPerVulnScores(benchmarks);
    expect(scores).toEqual([1, 0, 1]);
  });
});

// ================== analyzeDisclosureVolume ==================

describe('analyzeDisclosureVolume', () => {
  it('returns null for empty results', () => {
    expect(analyzeDisclosureVolume({ benchmarks: [] })).toBeNull();
  });

  it('returns null for no completed benchmarks', () => {
    const results = {
      benchmarks: [
        { id: 'bench-001', status: 'error' }
      ]
    };
    expect(analyzeDisclosureVolume(results)).toBeNull();
  });

  it('computes data points sorted by vuln count', () => {
    const results = {
      benchmarks: [
        { id: 'bench-002', status: 'completed', ground_truth_count: 5, scores: { recall: 0.6, precision: 0.5, f1: 0.55 } },
        { id: 'bench-001', status: 'completed', ground_truth_count: 2, scores: { recall: 1.0, precision: 0.8, f1: 0.9 } },
      ]
    };
    const analysis = analyzeDisclosureVolume(results);
    expect(analysis.n).toBe(2);
    expect(analysis.data_points[0].id).toBe('bench-001'); // 2 vulns sorted first
    expect(analysis.data_points[1].id).toBe('bench-002'); // 5 vulns sorted second
  });

  it('computes correlation coefficient', () => {
    const results = {
      benchmarks: [
        { id: 'a', status: 'completed', ground_truth_count: 1, scores: { recall: 1.0, precision: 1.0, f1: 1.0 } },
        { id: 'b', status: 'completed', ground_truth_count: 3, scores: { recall: 0.5, precision: 0.5, f1: 0.5 } },
        { id: 'c', status: 'completed', ground_truth_count: 5, scores: { recall: 0.0, precision: 0.0, f1: 0.0 } },
      ]
    };
    const analysis = analyzeDisclosureVolume(results);
    // Perfect negative correlation: more vulns = lower recall
    expect(analysis.correlation).toBeLessThan(-0.9);
  });

  it('returns zero correlation for identical recalls', () => {
    const results = {
      benchmarks: [
        { id: 'a', status: 'completed', ground_truth_count: 1, scores: { recall: 0.5, precision: 0.5, f1: 0.5 } },
        { id: 'b', status: 'completed', ground_truth_count: 5, scores: { recall: 0.5, precision: 0.5, f1: 0.5 } },
      ]
    };
    const analysis = analyzeDisclosureVolume(results);
    expect(analysis.correlation).toBe(0);
  });

  it('skips non-completed benchmarks', () => {
    const results = {
      benchmarks: [
        { id: 'a', status: 'completed', ground_truth_count: 3, scores: { recall: 0.5, precision: 0.5, f1: 0.5 } },
        { id: 'b', status: 'error' },
      ]
    };
    const analysis = analyzeDisclosureVolume(results);
    expect(analysis.n).toBe(1);
  });

  it('handles single benchmark (no correlation possible)', () => {
    const results = {
      benchmarks: [
        { id: 'a', status: 'completed', ground_truth_count: 3, scores: { recall: 0.5, precision: 0.5, f1: 0.5 } },
      ]
    };
    const analysis = analyzeDisclosureVolume(results);
    expect(analysis.n).toBe(1);
    expect(analysis.data_points).toHaveLength(1);
    // Correlation with 1 point is undefined or 0
    expect(typeof analysis.correlation).toBe('number');
  });

  it('returns data_points with correct fields', () => {
    const results = {
      benchmarks: [
        { id: 'a', status: 'completed', ground_truth_count: 3, scores: { recall: 0.5, precision: 0.8, f1: 0.6 } },
      ]
    };
    const analysis = analyzeDisclosureVolume(results);
    const dp = analysis.data_points[0];
    expect(dp.id).toBe('a');
    expect(dp.vuln_count).toBe(3);
    expect(dp.recall).toBe(0.5);
    expect(dp.precision).toBe(0.8);
    expect(dp.f1).toBe(0.6);
  });
});

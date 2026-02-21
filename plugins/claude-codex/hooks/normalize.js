#!/usr/bin/env bun
/**
 * Shared normalization utilities for hook validators.
 *
 * Patterns derived from evmbench production:
 * - JSON extraction from LLM output (markdown fence stripping, bracket matching)
 * - Severity auto-normalization (fuzzy prefix matching)
 * - Two-stage validation (extract then normalize)
 * - Artifact existence + non-empty checks
 */

import { readFileSync, existsSync, statSync } from 'fs';

/**
 * Normalize status strings to lowercase snake_case.
 * "Approved" -> "approved", "NEEDS_CHANGES" -> "needs_changes"
 */
export function normalizeStatus(s) {
  if (typeof s !== 'string') return s;
  return s.toLowerCase().replace(/\s+/g, '_');
}

/**
 * Normalize severity via fuzzy prefix matching.
 * "crit*" -> "critical", "Hi" -> "high", "MED" -> "medium", etc.
 * Unknown values pass through lowercase.
 */
export function normalizeSeverity(s) {
  if (typeof s !== 'string') return s;
  const lower = s.toLowerCase().trim();
  if (lower.startsWith('crit')) return 'critical';
  if (lower.startsWith('hi')) return 'high';
  if (lower.startsWith('med')) return 'medium';
  if (lower.startsWith('lo')) return 'low';
  if (lower.startsWith('inf')) return 'info';
  return lower;
}

/**
 * Extract JSON from text that may contain markdown fences or surrounding prose.
 *
 * Strategy (from evmbench docker/worker/init.py and resultsvc/routers/v1.py):
 * 1. Try direct JSON.parse first
 * 2. Strip markdown code fences (```json ... ```) and try again
 * 3. Find first '{' or '[' to last matching '}' or ']' and try that
 *
 * Returns parsed object/array or null on failure.
 */
export function extractJson(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  // 1. Direct parse
  try {
    return JSON.parse(trimmed);
  } catch {}

  // 2. Strip markdown fences
  const fenceMatch = trimmed.match(/```(?:json|JSON)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {}
  }

  // 3. Find first { or [ to last matching } or ]
  const firstBrace = trimmed.indexOf('{');
  const firstBracket = trimmed.indexOf('[');

  let start = -1;
  let openChar, closeChar;

  if (firstBrace === -1 && firstBracket === -1) return null;

  if (firstBrace === -1) {
    start = firstBracket;
    openChar = '[';
    closeChar = ']';
  } else if (firstBracket === -1) {
    start = firstBrace;
    openChar = '{';
    closeChar = '}';
  } else if (firstBrace <= firstBracket) {
    start = firstBrace;
    openChar = '{';
    closeChar = '}';
  } else {
    start = firstBracket;
    openChar = '[';
    closeChar = ']';
  }

  // Find matching close by tracking nesting depth
  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;

  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  if (end === -1) return null;

  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Read a file and extract + normalize JSON content.
 * Handles files that contain LLM output with markdown fences or prose.
 * Normalizes status and severity fields in the result.
 */
export function readAndNormalizeJson(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    const content = readFileSync(filePath, 'utf-8');
    const data = extractJson(content);
    if (!data || typeof data !== 'object') return data;

    // Normalize array items (e.g. raw findings arrays)
    if (Array.isArray(data)) {
      for (const item of data) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          if (item.severity) item.severity = normalizeSeverity(item.severity);
          if (item.status) item.status = normalizeStatus(item.status);
        }
      }
      return data;
    }

    // Normalize status field if present
    if (data.status) {
      data.status = normalizeStatus(data.status);
    }

    // Normalize severity field if present
    if (data.severity) {
      data.severity = normalizeSeverity(data.severity);
    }

    // Normalize nested findings/issues arrays
    const arrayFields = [
      'findings', 'issues', 'unsuppressed_high_findings',
      'attack_hypotheses', 'dispute_details',
      'refuted_hypotheses', 'false_positives_invalidated'
    ];
    for (const field of arrayFields) {
      if (Array.isArray(data[field])) {
        for (const item of data[field]) {
          if (item && typeof item === 'object') {
            if (item.severity) item.severity = normalizeSeverity(item.severity);
            if (item.status) item.status = normalizeStatus(item.status);
          }
        }
      }
    }

    return data;
  } catch {
    return null;
  }
}

/**
 * Deduplicate findings by root cause location (file:line).
 * When multiple models detect the same vulnerability at the same location,
 * keeps the highest-severity entry. Used for merging parallel detect outputs.
 *
 * @param {Array} findings - Array of finding objects with file, line, severity
 * @returns {Array} Deduplicated findings
 */
export function deduplicateByLocation(findings) {
  if (!Array.isArray(findings)) return findings;

  const severityRank = { critical: 4, high: 3, medium: 2, med: 2, low: 1, info: 0 };
  const seen = new Map();

  for (const finding of findings) {
    const file = (finding.file || '').toLowerCase();
    const line = finding.line || 0;
    const key = `${file}:${line}`;

    if (!key || key === ':0') {
      // No location info, keep as unique
      seen.set(`__no_loc_${seen.size}`, finding);
      continue;
    }

    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, finding);
    } else {
      // Keep the higher severity finding
      const existingRank = severityRank[normalizeSeverity(existing.severity)] || 0;
      const newRank = severityRank[normalizeSeverity(finding.severity)] || 0;
      if (newRank > existingRank) {
        seen.set(key, finding);
      }
    }
  }

  return Array.from(seen.values());
}

/**
 * Validate per-vulnerability output format.
 * Returns null if valid, or an error string describing the issue.
 *
 * Checks:
 * - findings array exists and is non-empty
 * - Each finding has id, file (or file:line), severity
 * - No thematic grouping detected (findings with same title pattern)
 *
 * @param {Object} data - Parsed review/detect JSON
 * @returns {string|null} Error message or null if valid
 */
/**
 * Detect thematic grouping in a finding title (G7 - EVMbench Section H.3).
 * Returns true if the title looks like a category rather than a specific vulnerability.
 */
export function isThematicTitle(title) {
  if (!title || typeof title !== 'string') return false;
  const hasSpecificRef = /\b(in|at|of|via)\s+\w+[.(]/i.test(title);
  // Words that always indicate thematic grouping when they START the title
  if (/^\s*(various|general|overall|miscellaneous)\b/i.test(title)) return true;
  // "Multiple/Several X" is thematic UNLESS it references a specific location
  if (/^\s*(multiple|several)\b/i.test(title) && !hasSpecificRef) return true;
  // Title ends with grouping noun (issues/concerns/problems/vulnerabilities) without specific location
  // "Reentrancy Issues" → thematic; "Reentrancy issues in Vault.withdraw()" → specific
  if (/\b(issues|concerns|problems|vulnerabilities)\s*$/i.test(title) && !hasSpecificRef) return true;
  return false;
}

export function validatePerVulnFormat(data) {
  if (!data || typeof data !== 'object') return 'No data to validate';

  const findings = data.findings || data.exploits_confirmed || data.confirmed_exploits || [];
  if (!Array.isArray(findings)) return 'findings is not an array';

  // Each finding must have required fields
  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    if (!f.id) return `Finding at index ${i} missing id`;
    if (!f.file && !f.affected) return `Finding ${f.id} missing file reference`;
    if (!f.severity) return `Finding ${f.id} missing severity`;

    // G7: Semantic check - detect thematic grouping titles
    if (isThematicTitle(f.title)) {
      return `Finding ${f.id} title looks like thematic grouping: "${f.title}". Each finding must describe a specific vulnerability, not a category.`;
    }
  }

  return null; // Valid
}

/**
 * Validate that an artifact file exists and is non-empty.
 * Returns null if valid, or a structured error object if invalid.
 */
export function validateArtifactExists(filePath, gateName) {
  if (!existsSync(filePath)) {
    return {
      decision: 'block',
      reason: `${gateName}: ${filePath} is missing.`
    };
  }

  try {
    const stat = statSync(filePath);
    if (stat.size === 0) {
      return {
        decision: 'block',
        reason: `${gateName}: ${filePath} exists but is empty.`
      };
    }
  } catch {
    return {
      decision: 'block',
      reason: `${gateName}: Cannot read ${filePath}.`
    };
  }

  return null; // Valid
}

#!/usr/bin/env bun
/**
 * Extract Invariants List from threat-model.md
 *
 * Extracts ONLY numbered invariants with formal expressions.
 * No prose, attack surface descriptions, or trust assumptions.
 *
 * Used by Stage 4 bundle generation to create a code-blind invariants file.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname } from 'path';
import { parseArgs } from 'util';
import { mkdirSync } from 'fs';

function parseArguments() {
  const { values } = parseArgs({
    options: {
      input: { type: 'string', short: 'i' },
      output: { type: 'string', short: 'o' },
      format: { type: 'string', short: 'f', default: 'markdown' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: true
  });

  if (values.help) {
    console.log(`
Usage: extract-invariants-list.js --input <file> --output <file>

Extracts numbered invariants from threat-model.md.

Options:
  -i, --input    Input threat-model.md file
  -o, --output   Output file path
  -f, --format   Output format: markdown (default), json, solidity
  -h, --help     Show this help message

Example:
  extract-invariants-list.js -i docs/security/threat-model.md -o bundle/invariants-list.md
    `);
    process.exit(0);
  }

  if (!values.input) {
    console.error('Error: --input is required');
    process.exit(1);
  }

  return values;
}

function readFile(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Extract invariants from threat model content
 */
function extractInvariants(content) {
  const invariants = {
    conservation: [],  // IC-*
    consistency: [],   // IS-*
    access: [],        // IA-*
    temporal: [],      // IT-*
    bound: []          // IB-*
  };

  const categories = [
    { prefix: 'IC', key: 'conservation' },
    { prefix: 'IS', key: 'consistency' },
    { prefix: 'IA', key: 'access' },
    { prefix: 'IT', key: 'temporal' },
    { prefix: 'IB', key: 'bound' }
  ];

  for (const cat of categories) {
    // Match patterns:
    // - IC-1: `expression` - description
    // - IC-1: expression
    // - **IC-1**: expression
    // - - IC-1: expression
    const regex = new RegExp(
      `(?:^|\\n)\\s*(?:[-*]\\s*)?(?:\\*\\*)?${cat.prefix}-(\\d+)(?:\\*\\*)?[:\\s]+(.+?)(?=\\n(?:[-*]\\s*)?(?:${cat.prefix}-\\d+|IC-|IS-|IA-|IT-|IB-|##|$)|$)`,
      'gis'
    );

    const matches = [...content.matchAll(regex)];
    for (const match of matches) {
      const id = `${cat.prefix}-${match[1]}`;
      let expression = match[2].trim();

      // Clean up the expression
      // Remove trailing markdown or prose
      expression = expression.split('\n')[0].trim();
      // Remove leading/trailing backticks for inline code
      expression = expression.replace(/^`|`$/g, '');
      // Remove "- " prefix if present
      expression = expression.replace(/^[-*]\s*/, '');

      invariants[cat.key].push({
        id,
        expression,
        category: cat.key
      });
    }
  }

  // Also extract from code blocks
  const codeBlockRegex = /```(?:solidity|text|)?\s*([\s\S]*?)```/g;
  const codeBlocks = [...content.matchAll(codeBlockRegex)];

  for (const block of codeBlocks) {
    const blockContent = block[1];
    for (const cat of categories) {
      const lineRegex = new RegExp(`(${cat.prefix}-(\\d+))[:\\s]+(.+)`, 'gi');
      const matches = [...blockContent.matchAll(lineRegex)];
      for (const match of matches) {
        const id = match[1].toUpperCase();
        const expression = match[3].trim();

        // Check if already exists
        const existing = invariants[cat.key].find(i => i.id === id);
        if (!existing) {
          invariants[cat.key].push({
            id,
            expression,
            category: cat.key,
            fromCodeBlock: true
          });
        }
      }
    }
  }

  return invariants;
}

/**
 * Format invariants as Markdown
 */
function formatMarkdown(invariants) {
  let output = `# Invariants List\n\n`;
  output += `> Extracted formal invariants only. No prose or attack surface descriptions.\n\n`;

  const categoryNames = {
    conservation: 'Conservation Invariants (IC-*)',
    consistency: 'Consistency Invariants (IS-*)',
    access: 'Access Invariants (IA-*)',
    temporal: 'Temporal Invariants (IT-*)',
    bound: 'Bound Invariants (IB-*)'
  };

  let totalCount = 0;

  for (const [key, name] of Object.entries(categoryNames)) {
    const items = invariants[key];
    if (items.length > 0) {
      output += `## ${name}\n\n`;
      for (const inv of items) {
        output += `- **${inv.id}**: \`${inv.expression}\`\n`;
        totalCount++;
      }
      output += `\n`;
    }
  }

  if (totalCount === 0) {
    output += `(No invariants found)\n`;
  }

  output += `---\n`;
  output += `Total invariants: ${totalCount}\n`;

  return output;
}

/**
 * Format invariants as JSON
 */
function formatJson(invariants) {
  const flat = [];
  for (const [category, items] of Object.entries(invariants)) {
    for (const inv of items) {
      flat.push({
        id: inv.id,
        category,
        expression: inv.expression
      });
    }
  }
  return JSON.stringify({ invariants: flat, total: flat.length }, null, 2);
}

/**
 * Format invariants as Solidity comments (for test file header)
 */
function formatSolidity(invariants) {
  let output = `// SPDX-License-Identifier: MIT\n`;
  output += `// Invariants extracted from threat-model.md\n`;
  output += `//\n`;
  output += `// INVARIANTS:\n`;

  for (const [category, items] of Object.entries(invariants)) {
    if (items.length > 0) {
      output += `//\n`;
      output += `// ${category.toUpperCase()}:\n`;
      for (const inv of items) {
        output += `//   ${inv.id}: ${inv.expression}\n`;
      }
    }
  }

  output += `//\n`;
  return output;
}

async function main() {
  const args = parseArguments();

  const content = readFile(args.input);
  if (!content) {
    console.error(`Error: Could not read ${args.input}`);
    process.exit(1);
  }

  const invariants = extractInvariants(content);

  let output;
  switch (args.format) {
    case 'json':
      output = formatJson(invariants);
      break;
    case 'solidity':
      output = formatSolidity(invariants);
      break;
    case 'markdown':
    default:
      output = formatMarkdown(invariants);
      break;
  }

  if (args.output) {
    // Ensure directory exists
    const dir = dirname(args.output);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(args.output, output);
    console.log(`Invariants extracted to: ${args.output}`);
  } else {
    console.log(output);
  }

  // Output count for pipeline
  const total = Object.values(invariants).reduce((sum, arr) => sum + arr.length, 0);
  console.log(JSON.stringify({
    success: true,
    total_invariants: total,
    by_category: {
      conservation: invariants.conservation.length,
      consistency: invariants.consistency.length,
      access: invariants.access.length,
      temporal: invariants.temporal.length,
      bound: invariants.bound.length
    }
  }));
}

main().catch(err => {
  console.error('Error extracting invariants:', err.message);
  process.exit(1);
});

#!/usr/bin/env bun
/**
 * Extract Public API from Solidity Source Code
 *
 * Extracts interfaces, public/external function signatures, events, and errors.
 * Does NOT include implementation details or function bodies.
 *
 * Used by Stage 4 bundle generation for exploit hunters.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join, dirname, relative, basename } from 'path';
import { parseArgs } from 'util';

function parseArguments() {
  const { values } = parseArgs({
    options: {
      src: { type: 'string', short: 's' },
      output: { type: 'string', short: 'o' },
      format: { type: 'string', short: 'f', default: 'markdown' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: true
  });

  if (values.help) {
    console.log(`
Usage: extract-public-api.js --src <dir> --output <file>

Extracts public API from Solidity source files.

Options:
  -s, --src      Source directory (default: src/)
  -o, --output   Output file path
  -f, --format   Output format: markdown (default), json, solidity
  -h, --help     Show this help message

Example:
  extract-public-api.js -s src/ -o bundle/public-api.md
    `);
    process.exit(0);
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
 * Parse a Solidity file and extract public API
 */
function parseSolidityFile(content, filePath) {
  const api = {
    file: filePath,
    contracts: [],
    interfaces: [],
    libraries: [],
    structs: [],
    enums: [],
    events: [],
    errors: [],
    functions: []
  };

  // Remove comments for cleaner parsing
  const noComments = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  // Extract contract/interface/library names
  const contractMatches = noComments.matchAll(/\b(contract|interface|library|abstract\s+contract)\s+(\w+)(?:\s+is\s+([^{]+))?\s*\{/g);
  for (const match of contractMatches) {
    const type = match[1].replace('abstract ', '').trim();
    const name = match[2];
    const inherits = match[3]?.split(',').map(s => s.trim()).filter(Boolean) || [];

    if (type === 'interface') {
      api.interfaces.push({ name, inherits });
    } else if (type === 'library') {
      api.libraries.push({ name });
    } else {
      api.contracts.push({ name, inherits, isAbstract: match[1].includes('abstract') });
    }
  }

  // Extract struct definitions
  const structMatches = noComments.matchAll(/struct\s+(\w+)\s*\{([^}]*)\}/g);
  for (const match of structMatches) {
    const fields = match[2].split(';')
      .map(f => f.trim())
      .filter(Boolean)
      .map(f => {
        const parts = f.split(/\s+/);
        return {
          type: parts.slice(0, -1).join(' '),
          name: parts[parts.length - 1]
        };
      });
    api.structs.push({ name: match[1], fields });
  }

  // Extract enum definitions
  const enumMatches = noComments.matchAll(/enum\s+(\w+)\s*\{([^}]*)\}/g);
  for (const match of enumMatches) {
    const values = match[2].split(',').map(v => v.trim()).filter(Boolean);
    api.enums.push({ name: match[1], values });
  }

  // Extract events
  const eventMatches = noComments.matchAll(/event\s+(\w+)\s*\(([^)]*)\)\s*;/g);
  for (const match of eventMatches) {
    const params = parseParams(match[2]);
    api.events.push({ name: match[1], params });
  }

  // Extract custom errors
  const errorMatches = noComments.matchAll(/error\s+(\w+)\s*\(([^)]*)\)\s*;/g);
  for (const match of errorMatches) {
    const params = parseParams(match[2]);
    api.errors.push({ name: match[1], params });
  }

  // Extract public/external functions
  const funcMatches = noComments.matchAll(
    /function\s+(\w+)\s*\(([^)]*)\)\s*((?:external|public|internal|private|view|pure|payable|virtual|override|\s)+)(?:returns\s*\(([^)]*)\))?\s*[{;]/g
  );
  for (const match of funcMatches) {
    const modifiers = match[3].trim().split(/\s+/).filter(Boolean);
    const visibility = modifiers.find(m => ['external', 'public', 'internal', 'private'].includes(m));

    // Only include public/external
    if (visibility === 'external' || visibility === 'public') {
      api.functions.push({
        name: match[1],
        params: parseParams(match[2]),
        visibility,
        modifiers: modifiers.filter(m => !['external', 'public', 'internal', 'private'].includes(m)),
        returns: match[4] ? parseParams(match[4]) : []
      });
    }
  }

  return api;
}

/**
 * Parse function parameters
 */
function parseParams(paramString) {
  if (!paramString.trim()) return [];

  return paramString.split(',')
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => {
      // Handle indexed, memory, calldata, storage modifiers
      const parts = p.split(/\s+/);
      const isIndexed = parts.includes('indexed');
      const location = parts.find(x => ['memory', 'calldata', 'storage'].includes(x));

      // Find type and name
      const cleanParts = parts.filter(x =>
        !['indexed', 'memory', 'calldata', 'storage'].includes(x)
      );

      return {
        type: cleanParts.slice(0, -1).join(' ') || cleanParts[0],
        name: cleanParts.length > 1 ? cleanParts[cleanParts.length - 1] : '',
        indexed: isIndexed,
        location
      };
    });
}

/**
 * Process directory recursively
 */
function processDirectory(dir, baseDir = dir) {
  const apis = [];

  if (!existsSync(dir)) return apis;

  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      apis.push(...processDirectory(fullPath, baseDir));
    } else if (entry.name.endsWith('.sol')) {
      const content = readFile(fullPath);
      if (content) {
        const api = parseSolidityFile(content, relative(baseDir, fullPath));
        apis.push(api);
      }
    }
  }

  return apis;
}

/**
 * Format as Markdown
 */
function formatMarkdown(apis) {
  let output = `# Public API\n\n`;
  output += `> Extracted function signatures, events, and errors.\n`;
  output += `> No implementation details or function bodies.\n\n`;

  for (const api of apis) {
    if (api.contracts.length === 0 && api.interfaces.length === 0 && api.libraries.length === 0) {
      continue;
    }

    output += `## ${basename(api.file, '.sol')}\n\n`;
    output += `File: \`${api.file}\`\n\n`;

    // Contracts
    for (const c of api.contracts) {
      output += `### ${c.isAbstract ? 'abstract ' : ''}contract ${c.name}`;
      if (c.inherits.length > 0) {
        output += ` is ${c.inherits.join(', ')}`;
      }
      output += `\n\n`;
    }

    // Interfaces
    for (const i of api.interfaces) {
      output += `### interface ${i.name}`;
      if (i.inherits.length > 0) {
        output += ` is ${i.inherits.join(', ')}`;
      }
      output += `\n\n`;
    }

    // Libraries
    for (const l of api.libraries) {
      output += `### library ${l.name}\n\n`;
    }

    // Structs
    if (api.structs.length > 0) {
      output += `#### Structs\n\n`;
      for (const s of api.structs) {
        output += `\`\`\`solidity\nstruct ${s.name} {\n`;
        for (const f of s.fields) {
          output += `    ${f.type} ${f.name};\n`;
        }
        output += `}\n\`\`\`\n\n`;
      }
    }

    // Enums
    if (api.enums.length > 0) {
      output += `#### Enums\n\n`;
      for (const e of api.enums) {
        output += `\`\`\`solidity\nenum ${e.name} { ${e.values.join(', ')} }\n\`\`\`\n\n`;
      }
    }

    // Functions
    if (api.functions.length > 0) {
      output += `#### Functions\n\n`;
      output += `| Function | Visibility | Modifiers |\n`;
      output += `|----------|------------|----------|\n`;
      for (const f of api.functions) {
        const params = f.params.map(p => `${p.type}${p.name ? ' ' + p.name : ''}`).join(', ');
        const returns = f.returns.length > 0
          ? ` returns (${f.returns.map(p => p.type).join(', ')})`
          : '';
        output += `| \`${f.name}(${params})${returns}\` | ${f.visibility} | ${f.modifiers.join(', ') || '-'} |\n`;
      }
      output += `\n`;
    }

    // Events
    if (api.events.length > 0) {
      output += `#### Events\n\n`;
      for (const e of api.events) {
        const params = e.params.map(p =>
          `${p.type}${p.indexed ? ' indexed' : ''}${p.name ? ' ' + p.name : ''}`
        ).join(', ');
        output += `- \`event ${e.name}(${params})\`\n`;
      }
      output += `\n`;
    }

    // Errors
    if (api.errors.length > 0) {
      output += `#### Errors\n\n`;
      for (const e of api.errors) {
        const params = e.params.map(p => `${p.type}${p.name ? ' ' + p.name : ''}`).join(', ');
        output += `- \`error ${e.name}(${params})\`\n`;
      }
      output += `\n`;
    }

    output += `---\n\n`;
  }

  return output;
}

/**
 * Format as JSON
 */
function formatJson(apis) {
  return JSON.stringify({ apis }, null, 2);
}

/**
 * Format as Solidity interface file
 */
function formatSolidity(apis) {
  let output = `// SPDX-License-Identifier: MIT\n`;
  output += `// Auto-generated public API interfaces\n`;
  output += `pragma solidity ^0.8.0;\n\n`;

  for (const api of apis) {
    for (const c of [...api.contracts, ...api.interfaces]) {
      output += `interface I${c.name} {\n`;

      // Structs
      for (const s of api.structs) {
        output += `    struct ${s.name} {\n`;
        for (const f of s.fields) {
          output += `        ${f.type} ${f.name};\n`;
        }
        output += `    }\n\n`;
      }

      // Events
      for (const e of api.events) {
        const params = e.params.map(p =>
          `${p.type}${p.indexed ? ' indexed' : ''}${p.name ? ' ' + p.name : ''}`
        ).join(', ');
        output += `    event ${e.name}(${params});\n`;
      }

      // Errors
      for (const e of api.errors) {
        const params = e.params.map(p => `${p.type}${p.name ? ' ' + p.name : ''}`).join(', ');
        output += `    error ${e.name}(${params});\n`;
      }

      // Functions
      for (const f of api.functions) {
        const params = f.params.map(p => {
          let param = p.type;
          if (p.location) param += ` ${p.location}`;
          if (p.name) param += ` ${p.name}`;
          return param;
        }).join(', ');

        const mods = ['external', ...f.modifiers].join(' ');
        const returns = f.returns.length > 0
          ? ` returns (${f.returns.map(p => p.type).join(', ')})`
          : '';

        output += `    function ${f.name}(${params}) ${mods}${returns};\n`;
      }

      output += `}\n\n`;
    }
  }

  return output;
}

async function main() {
  const args = parseArguments();
  const srcDir = args.src || join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), 'src');

  if (!existsSync(srcDir)) {
    console.error(`Error: Source directory not found: ${srcDir}`);
    process.exit(1);
  }

  const apis = processDirectory(srcDir);

  let output;
  switch (args.format) {
    case 'json':
      output = formatJson(apis);
      break;
    case 'solidity':
      output = formatSolidity(apis);
      break;
    case 'markdown':
    default:
      output = formatMarkdown(apis);
      break;
  }

  if (args.output) {
    const dir = dirname(args.output);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(args.output, output);
    console.log(`Public API extracted to: ${args.output}`);
  } else {
    console.log(output);
  }

  // Output summary for pipeline
  const totalFunctions = apis.reduce((sum, a) => sum + a.functions.length, 0);
  const totalEvents = apis.reduce((sum, a) => sum + a.events.length, 0);
  const totalErrors = apis.reduce((sum, a) => sum + a.errors.length, 0);

  console.log(JSON.stringify({
    success: true,
    files_processed: apis.length,
    total_functions: totalFunctions,
    total_events: totalEvents,
    total_errors: totalErrors
  }));
}

main().catch(err => {
  console.error('Error extracting public API:', err.message);
  process.exit(1);
});

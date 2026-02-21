import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { extractEntrypoints, extractModules, checkCoverage } from './coverage-tracker.js';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

// Use a temp directory for test fixtures
const TEST_DIR = join(import.meta.dir, '__test-fixtures-coverage__');
const SRC_DIR = join(TEST_DIR, 'src');

beforeAll(() => {
  // Create test fixture directory structure
  mkdirSync(join(SRC_DIR, 'sub'), { recursive: true });

  // Simple contract with public/external functions
  writeFileSync(join(SRC_DIR, 'Vault.sol'), `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Vault {
    function deposit() public payable {
    }

    function withdraw(uint256 amount) external {
    }

    function getBalance() public view returns (uint256) {
        return address(this).balance;
    }

    function _internal() internal {
    }
}
`);

  // Library with public function
  writeFileSync(join(SRC_DIR, 'MathLib.sol'), `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

library MathLib {
    function add(uint256 a, uint256 b) public pure returns (uint256) {
        return a + b;
    }
}
`);

  // Interface (should be extracted as module but no entrypoints)
  writeFileSync(join(SRC_DIR, 'IVault.sol'), `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IVault {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}
`);

  // Abstract contract
  writeFileSync(join(SRC_DIR, 'sub', 'BaseContract.sol'), `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

abstract contract BaseContract {
    function initialize() public virtual {
    }
}
`);

  // Non-sol file (should be ignored)
  writeFileSync(join(SRC_DIR, 'README.md'), '# Not a sol file');
});

afterAll(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
});

// ================== extractEntrypoints ==================

describe('extractEntrypoints', () => {
  it('extracts public and external functions', () => {
    const entrypoints = extractEntrypoints(SRC_DIR);
    const signatures = entrypoints.map(ep => ep.signature);

    expect(signatures).toContain('Vault.deposit');
    expect(signatures).toContain('Vault.withdraw');
    expect(signatures).toContain('Vault.getBalance');
  });

  it('extracts library public functions', () => {
    const entrypoints = extractEntrypoints(SRC_DIR);
    const signatures = entrypoints.map(ep => ep.signature);

    expect(signatures).toContain('MathLib.add');
  });

  it('does not extract internal functions', () => {
    const entrypoints = extractEntrypoints(SRC_DIR);
    const signatures = entrypoints.map(ep => ep.signature);

    expect(signatures).not.toContain('Vault._internal');
  });

  it('extracts from subdirectories', () => {
    const entrypoints = extractEntrypoints(SRC_DIR);
    const signatures = entrypoints.map(ep => ep.signature);

    expect(signatures).toContain('BaseContract.initialize');
  });

  it('includes contract name, function, file, line, signature', () => {
    const entrypoints = extractEntrypoints(SRC_DIR);
    const deposit = entrypoints.find(ep => ep.function === 'deposit' && ep.contract === 'Vault');

    expect(deposit).toBeDefined();
    expect(deposit.contract).toBe('Vault');
    expect(deposit.function).toBe('deposit');
    expect(deposit.file).toContain('Vault.sol');
    expect(typeof deposit.line).toBe('number');
    expect(deposit.signature).toBe('Vault.deposit');
  });

  it('returns empty array for nonexistent directory', () => {
    expect(extractEntrypoints('/nonexistent/path')).toEqual([]);
  });
});

// ================== extractModules ==================

describe('extractModules', () => {
  it('extracts contracts', () => {
    const modules = extractModules(SRC_DIR);
    const vault = modules.find(m => m.name === 'Vault');

    expect(vault).toBeDefined();
    expect(vault.type).toBe('contract');
  });

  it('extracts libraries', () => {
    const modules = extractModules(SRC_DIR);
    const lib = modules.find(m => m.name === 'MathLib');

    expect(lib).toBeDefined();
    expect(lib.type).toBe('library');
  });

  it('extracts interfaces', () => {
    const modules = extractModules(SRC_DIR);
    const iface = modules.find(m => m.name === 'IVault');

    expect(iface).toBeDefined();
    expect(iface.type).toBe('interface');
  });

  it('extracts abstract contracts', () => {
    const modules = extractModules(SRC_DIR);
    const base = modules.find(m => m.name === 'BaseContract');

    expect(base).toBeDefined();
    expect(base.type).toBe('abstract');
  });

  it('includes file path for each module', () => {
    const modules = extractModules(SRC_DIR);
    const vault = modules.find(m => m.name === 'Vault');

    expect(vault.file).toContain('Vault.sol');
  });

  it('returns empty array for nonexistent directory', () => {
    expect(extractModules('/nonexistent/path')).toEqual([]);
  });
});

// ================== checkCoverage ==================

describe('checkCoverage', () => {
  it('reports 100% when all entrypoints referenced', () => {
    const entrypoints = [
      { contract: 'Vault', function: 'deposit', file: 'src/Vault.sol', line: 10, signature: 'Vault.deposit' },
    ];
    const modules = [
      { name: 'Vault', file: 'src/Vault.sol', type: 'contract' },
    ];

    // Create a findings file that references Vault
    const findingsDir = join(TEST_DIR, 'findings');
    mkdirSync(findingsDir, { recursive: true });
    const findingsPath = join(findingsDir, 'test-findings.json');
    writeFileSync(findingsPath, JSON.stringify({
      findings: [{ file: 'src/Vault.sol', line: 10, severity: 'high' }]
    }));

    const result = checkCoverage(entrypoints, modules, [findingsPath]);

    expect(result.entrypoints.percentage).toBe(100);
    expect(result.modules.percentage).toBe(100);
    expect(result.entrypoints.uncovered).toHaveLength(0);
    expect(result.modules.uncovered).toHaveLength(0);
  });

  it('reports uncovered entrypoints', () => {
    const entrypoints = [
      { contract: 'Vault', function: 'deposit', file: 'src/Vault.sol', line: 10, signature: 'Vault.deposit' },
      { contract: 'Oracle', function: 'getPrice', file: 'src/Oracle.sol', line: 5, signature: 'Oracle.getPrice' },
    ];
    const modules = [];

    const findingsDir = join(TEST_DIR, 'findings2');
    mkdirSync(findingsDir, { recursive: true });
    const findingsPath = join(findingsDir, 'test-findings.json');
    writeFileSync(findingsPath, JSON.stringify({
      findings: [{ file: 'src/Vault.sol', line: 10, severity: 'high' }]
    }));

    const result = checkCoverage(entrypoints, modules, [findingsPath]);

    expect(result.entrypoints.percentage).toBe(50);
    expect(result.entrypoints.covered).toBe(1);
    expect(result.entrypoints.total).toBe(2);
    expect(result.entrypoints.uncovered).toHaveLength(1);
    expect(result.entrypoints.uncovered[0].contract).toBe('Oracle');
  });

  it('matches via affected field (contract name)', () => {
    const entrypoints = [
      { contract: 'Vault', function: 'deposit', file: 'src/Vault.sol', line: 10, signature: 'Vault.deposit' },
    ];
    const modules = [
      { name: 'Vault', file: 'src/Vault.sol', type: 'contract' },
    ];

    const findingsDir = join(TEST_DIR, 'findings3');
    mkdirSync(findingsDir, { recursive: true });
    const findingsPath = join(findingsDir, 'test-findings.json');
    writeFileSync(findingsPath, JSON.stringify({
      findings: [{ affected: 'Vault::deposit', severity: 'high' }]
    }));

    const result = checkCoverage(entrypoints, modules, [findingsPath]);

    expect(result.entrypoints.percentage).toBe(100);
    expect(result.modules.percentage).toBe(100);
  });

  it('handles empty findings files', () => {
    const entrypoints = [
      { contract: 'Vault', function: 'deposit', file: 'src/Vault.sol', line: 10, signature: 'Vault.deposit' },
    ];
    const modules = [];

    const result = checkCoverage(entrypoints, modules, []);

    expect(result.entrypoints.percentage).toBe(0);
    expect(result.entrypoints.uncovered).toHaveLength(1);
  });

  it('handles nonexistent findings file paths', () => {
    const entrypoints = [
      { contract: 'Vault', function: 'deposit', file: 'src/Vault.sol', line: 10, signature: 'Vault.deposit' },
    ];
    const modules = [];

    const result = checkCoverage(entrypoints, modules, ['/nonexistent/findings.json']);

    expect(result.entrypoints.percentage).toBe(0);
  });

  it('returns 100% for empty entrypoints and modules', () => {
    const result = checkCoverage([], [], []);

    expect(result.entrypoints.percentage).toBe(100);
    expect(result.modules.percentage).toBe(100);
  });

  it('is case-insensitive for file matching', () => {
    const entrypoints = [
      { contract: 'Vault', function: 'deposit', file: 'src/Vault.sol', line: 10, signature: 'Vault.deposit' },
    ];
    const modules = [];

    const findingsDir = join(TEST_DIR, 'findings4');
    mkdirSync(findingsDir, { recursive: true });
    const findingsPath = join(findingsDir, 'test-findings.json');
    writeFileSync(findingsPath, JSON.stringify({
      findings: [{ file: 'SRC/VAULT.SOL', line: 10, severity: 'high' }]
    }));

    const result = checkCoverage(entrypoints, modules, [findingsPath]);

    expect(result.entrypoints.percentage).toBe(100);
  });

  it('reads scope_files_analyzed from findings', () => {
    const entrypoints = [
      { contract: 'Vault', function: 'deposit', file: 'src/Vault.sol', line: 10, signature: 'Vault.deposit' },
    ];
    const modules = [
      { name: 'Vault', file: 'src/Vault.sol', type: 'contract' },
    ];

    const findingsDir = join(TEST_DIR, 'findings5');
    mkdirSync(findingsDir, { recursive: true });
    const findingsPath = join(findingsDir, 'test-findings.json');
    writeFileSync(findingsPath, JSON.stringify({
      findings: [],
      scope_files_analyzed: ['src/Vault.sol']
    }));

    const result = checkCoverage(entrypoints, modules, [findingsPath]);

    expect(result.entrypoints.percentage).toBe(100);
    expect(result.modules.percentage).toBe(100);
  });
});

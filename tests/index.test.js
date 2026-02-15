const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseRuleFile, resolveGlobs, checkFile, runRules, formatResults, scanCodebase, formatInterview, detectSuspiciousDirs, filterScanResults, DEFAULT_SKIP_DIRS } = require('../src/index');

const fixturesDir = path.join(__dirname, 'fixtures');
const projectDir = path.join(fixturesDir, 'project');

describe('parseRuleFile', () => {
  it('parses a valid YAML rule file', () => {
    const config = parseRuleFile(path.join(fixturesDir, 'rules-passing.yml'));
    assert.strictEqual(config.rules.length, 1);
    assert.strictEqual(config.rules[0].name, 'no-console-in-utils');
    assert.deepStrictEqual(config.rules[0].scope.files, ['utils.ts']);
    assert.deepStrictEqual(config.rules[0].deny.patterns, ['console\\.log']);
  });

  it('parses a file with multiple rules', () => {
    const config = parseRuleFile(path.join(fixturesDir, 'rules-mixed.yml'));
    assert.strictEqual(config.rules.length, 2);
    assert.strictEqual(config.rules[0].name, 'no-console-in-utils');
    assert.strictEqual(config.rules[1].name, 'no-strategy-internals-in-orchestrator');
  });

  it('returns skip dirs from config', () => {
    const config = parseRuleFile(path.join(fixturesDir, 'rules-with-skip.yml'));
    assert.deepStrictEqual(config.skip, ['.next', '_generated', 'dist']);
    assert.strictEqual(config.rules.length, 1);
  });

  it('omits skip when not in config', () => {
    const config = parseRuleFile(path.join(fixturesDir, 'rules-passing.yml'));
    assert.strictEqual(config.skip, undefined);
  });

  it('throws on invalid file', () => {
    assert.throws(
      () => parseRuleFile(path.join(fixturesDir, 'nonexistent.yml')),
      { code: 'ENOENT' }
    );
  });
});

describe('resolveGlobs', () => {
  it('resolves exact file names', () => {
    const files = resolveGlobs(['orchestrator.ts'], projectDir);
    assert.strictEqual(files.length, 1);
    assert.ok(files[0].endsWith('orchestrator.ts'));
  });

  it('resolves glob patterns', () => {
    const files = resolveGlobs(['**/*.ts'], projectDir);
    assert.ok(files.length >= 4); // orchestrator, utils, index, strategy
  });

  it('returns empty array for no matches', () => {
    const files = resolveGlobs(['*.xyz'], projectDir);
    assert.strictEqual(files.length, 0);
  });
});

describe('checkFile', () => {
  it('finds violations when patterns match', () => {
    const filePath = path.join(projectDir, 'orchestrator.ts');
    const violations = checkFile(filePath, ['ENTRY_1']);
    assert.ok(violations.length > 0);
    assert.ok(violations[0].line > 0);
    assert.ok(violations[0].match.includes('ENTRY_1'));
  });

  it('returns empty array when no patterns match', () => {
    const filePath = path.join(projectDir, 'utils.ts');
    const violations = checkFile(filePath, ['console\\.log']);
    assert.strictEqual(violations.length, 0);
  });

  it('handles multiple deny patterns', () => {
    const filePath = path.join(projectDir, 'orchestrator.ts');
    const violations = checkFile(filePath, ['ENTRY_1', 'tpPrice']);
    assert.ok(violations.length >= 2);
  });
});

describe('runRules', () => {
  it('reports all pass when no violations', () => {
    const { rules } = parseRuleFile(path.join(fixturesDir, 'rules-passing.yml'));
    const results = runRules(rules, projectDir);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].passed, true);
    assert.strictEqual(results[0].violations.length, 0);
  });

  it('reports failures when violations exist', () => {
    const { rules } = parseRuleFile(path.join(fixturesDir, 'rules-failing.yml'));
    const results = runRules(rules, projectDir);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].passed, false);
    assert.ok(results[0].violations.length > 0);
  });

  it('handles mixed pass and fail', () => {
    const { rules } = parseRuleFile(path.join(fixturesDir, 'rules-mixed.yml'));
    const results = runRules(rules, projectDir);
    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].passed, true);  // no-console-in-utils
    assert.strictEqual(results[1].passed, false); // no-strategy-internals
  });

  it('excludes files matching exclude patterns', () => {
    const { rules } = parseRuleFile(path.join(fixturesDir, 'rules-exclude.yml'));
    const results = runRules(rules, projectDir);
    assert.strictEqual(results.length, 1);
    // strategy.ts inside strategies/workshop-v3/ should be excluded,
    // but orchestrator.ts should still be caught
    const violations = results[0].violations;
    assert.ok(violations.length > 0);
    // No violations from excluded strategy files
    for (const v of violations) {
      assert.ok(!v.file.includes('strategies/workshop-v3/'));
    }
    // Should have violation from orchestrator.ts
    assert.ok(violations.some((v) => v.file.includes('orchestrator.ts')));
  });
});

describe('formatResults', () => {
  it('shows summary line with rule count', () => {
    const results = [
      { rule: 'test-rule', passed: true, violations: [], files: [] },
    ];
    const output = formatResults(results, { verbose: true, baseDir: projectDir });
    assert.ok(output.includes('1 rule'));
  });

  it('shows checkmark for passing rules', () => {
    const results = [
      { rule: 'test-rule', passed: true, violations: [], files: [] },
    ];
    const output = formatResults(results, { verbose: true, baseDir: projectDir });
    assert.ok(output.includes('\u2713'));
    assert.ok(output.includes('test-rule'));
  });

  it('always shows all rules including passing ones', () => {
    const results = [
      { rule: 'passing-rule', passed: true, violations: [], files: [] },
    ];
    const output = formatResults(results, { verbose: false, baseDir: projectDir });
    assert.ok(output.includes('passing-rule'));
  });

  it('shows cross mark with violations', () => {
    const results = [
      {
        rule: 'fail-rule',
        passed: false,
        violations: [
          { file: path.join(projectDir, 'foo.ts'), line: 10, match: 'bad code', pattern: 'bad' },
        ],
        files: [
          {
            file: path.join(projectDir, 'foo.ts'),
            passed: false,
            violations: [
              { file: path.join(projectDir, 'foo.ts'), line: 10, match: 'bad code', pattern: 'bad' },
            ],
          },
        ],
      },
    ];
    const output = formatResults(results, { baseDir: projectDir });
    assert.ok(output.includes('\u2717'));
    assert.ok(output.includes('fail-rule'));
    assert.ok(output.includes('foo.ts:10'));
    assert.ok(output.includes('bad code'));
  });

  it('shows correct totals', () => {
    const results = [
      { rule: 'pass1', passed: true, violations: [], files: [] },
      { rule: 'fail1', passed: false, violations: [{ file: '/f', line: 1, match: 'x', pattern: 'x' }], files: [] },
    ];
    const output = formatResults(results, { verbose: true, baseDir: '/' });
    assert.ok(output.includes('1 passed'));
    assert.ok(output.includes('1 failed'));
  });

  it('shows per-file breakdown in verbose mode', () => {
    const cleanFile = path.join(projectDir, 'clean.ts');
    const dirtyFile = path.join(projectDir, 'dirty.ts');
    const results = [
      {
        rule: 'test-rule',
        description: 'Test description',
        passed: false,
        violations: [
          { file: dirtyFile, line: 5, match: 'bad import', pattern: 'bad' },
        ],
        files: [
          { file: cleanFile, passed: true, violations: [] },
          { file: dirtyFile, passed: false, violations: [
            { file: dirtyFile, line: 5, match: 'bad import', pattern: 'bad' },
          ]},
        ],
      },
    ];
    const output = formatResults(results, { verbose: true, baseDir: projectDir });
    assert.ok(output.includes('Test description'));
    assert.ok(output.includes('clean.ts'));
    assert.ok(output.includes('dirty.ts'));
    assert.ok(output.includes('2 files scanned'));
    assert.ok(output.includes('1 violation'));
  });

  it('shows all-clean message for passing rules in verbose mode', () => {
    const results = [
      {
        rule: 'clean-rule',
        description: 'Everything is fine',
        passed: true,
        violations: [],
        files: [
          { file: path.join(projectDir, 'a.ts'), passed: true, violations: [] },
          { file: path.join(projectDir, 'b.ts'), passed: true, violations: [] },
        ],
      },
    ];
    const output = formatResults(results, { verbose: true, baseDir: projectDir });
    assert.ok(output.includes('2 files scanned, all clean'));
  });
});

describe('DEFAULT_SKIP_DIRS', () => {
  it('includes common build directories', () => {
    for (const dir of ['node_modules', '.git', '.next', 'dist', 'build', '_generated', 'coverage', '.turbo', '.cache']) {
      assert.ok(DEFAULT_SKIP_DIRS.has(dir), `Expected DEFAULT_SKIP_DIRS to include "${dir}"`);
    }
  });
});

describe('scanCodebase', () => {
  it('builds full directory tree with nested paths', () => {
    const scan = scanCodebase(projectDir);
    const dirNames = [...scan.directoryTree.keys()].sort();
    // Should have root files and nested strategy directory
    assert.ok(dirNames.includes('.'));
    assert.ok(dirNames.some((d) => d.includes('workshop-v3')));
  });

  it('directoryTree contains filenames per directory', () => {
    const scan = scanCodebase(projectDir);
    // Root should contain orchestrator.ts and utils.ts
    const rootFiles = scan.directoryTree.get('.');
    assert.ok(rootFiles.includes('orchestrator.ts'));
    assert.ok(rootFiles.includes('utils.ts'));
  });

  it('uses subdirectory as baseDir to scope the tree', () => {
    const subDir = path.join(projectDir, 'strategies');
    const scan = scanCodebase(subDir);
    const dirNames = [...scan.directoryTree.keys()].sort();
    // When scanning from strategies/, workshop-v3 becomes a directory
    assert.ok(dirNames.includes('workshop-v3'));
    // Should not contain 'strategies' since we're inside it
    assert.ok(!dirNames.includes('strategies'));
  });

  it('returns source files under the scanned baseDir', () => {
    const subDir = path.join(projectDir, 'strategies');
    const scan = scanCodebase(subDir);
    assert.ok(scan.sourceFiles.length > 0);
    for (const file of scan.sourceFiles) {
      assert.ok(file.startsWith(subDir), `${file} should start with ${subDir}`);
    }
  });

  it('builds file-level dependency map', () => {
    const scan = scanCodebase(projectDir);
    // orchestrator.ts imports ./types and ./utils
    assert.ok(scan.fileDependencies.has('orchestrator.ts'));
    const deps = scan.fileDependencies.get('orchestrator.ts');
    assert.ok(deps.internal.includes('utils.ts'));
    assert.ok(deps.internal.length >= 1);
  });

  it('resolves imports to actual source files with extensions', () => {
    const scan = scanCodebase(projectDir);
    // strategies/workshop-v3/index.ts imports ./strategy which should resolve to strategy.ts
    const indexDeps = scan.fileDependencies.get(path.join('strategies', 'workshop-v3', 'index.ts'));
    assert.ok(indexDeps, 'index.ts should have dependencies');
    assert.ok(
      indexDeps.internal.some((d) => d.endsWith('strategy.ts')),
      'Should resolve ./strategy to strategy.ts'
    );
  });
});

describe('formatInterview', () => {
  it('produces output with Directory Tree section', () => {
    const scan = scanCodebase(projectDir);
    const output = formatInterview(scan, projectDir);
    assert.ok(output.includes('Directory Tree'));
    assert.ok(output.includes('workshop-v3/'));
  });

  it('produces output with Dependency Map section', () => {
    const scan = scanCodebase(projectDir);
    const output = formatInterview(scan, projectDir);
    assert.ok(output.includes('Dependency Map'));
    // Should show file-level imports
    assert.ok(output.includes('orchestrator.ts'));
    assert.ok(output.includes('utils.ts'));
  });

  it('shows file-level import arrows in dependency map', () => {
    const scan = scanCodebase(projectDir);
    const output = formatInterview(scan, projectDir);
    // orchestrator.ts imports utils.ts — should show as arrow
    assert.ok(output.includes('\u2192 utils.ts'));
  });

  it('shows clean directory labels when using subdirectory as baseDir', () => {
    const subDir = path.join(projectDir, 'strategies');
    const scan = scanCodebase(subDir);
    const output = formatInterview(scan, subDir);
    assert.ok(output.includes('Directory Tree'));
    assert.ok(output.includes('workshop-v3/'));
    // Should not contain '../' paths
    assert.ok(!output.includes('../'));
  });

  it('shows source files total count', () => {
    const scan = scanCodebase(projectDir);
    const output = formatInterview(scan, projectDir);
    assert.ok(output.includes('source files total'));
  });
});

describe('CLI --skip is additive', () => {
  const cliPath = path.join(__dirname, '..', 'src', 'cli.js');

  it('--skip merges with DEFAULT_SKIP_DIRS in interview mode', () => {
    const output = execFileSync(
      process.execPath,
      [cliPath, 'interview', '--skip', '.nauvis', '--base-dir', projectDir],
      { encoding: 'utf8' }
    );
    // The output should work fine — no crash from scanning node_modules etc.
    assert.ok(output.includes('Directory Tree'));
  });

  it('--skip includes both user dirs and defaults', () => {
    // Run the help output which shows the schema; verify the text says additive
    const output = execFileSync(
      process.execPath,
      [cliPath, 'schema'],
      { encoding: 'utf8' }
    );
    assert.ok(output.includes('Adds to the default skip list'));
    assert.ok(output.includes('Both always merge with the defaults above'));
  });

  it('help text describes --skip as additive', () => {
    const output = execFileSync(
      process.execPath,
      [cliPath, '--help'],
      { encoding: 'utf8' }
    );
    assert.ok(output.includes('adds to defaults'));
  });

  it('config skip merges with defaults when running rules', () => {
    // rules-with-skip.yml has skip: [.next, _generated, dist]
    // After merge, all DEFAULT_SKIP_DIRS should still be present
    const output = execFileSync(
      process.execPath,
      [cliPath, '--config', path.join(fixturesDir, 'rules-with-skip.yml'), '--base-dir', projectDir],
      { encoding: 'utf8' }
    );
    // Should pass — the rule looks for console.log in utils.ts which has none
    assert.ok(output.includes('\u2713'));
  });
});

const largeProjectDir = path.join(fixturesDir, 'large-project');

describe('detectSuspiciousDirs', () => {
  it('flags directories with >= 50 files', () => {
    const scan = scanCodebase(largeProjectDir);
    const suspicious = detectSuspiciousDirs(scan.directoryTree);
    assert.strictEqual(suspicious.length, 1);
    assert.strictEqual(suspicious[0].dir, 'vendor');
    assert.strictEqual(suspicious[0].count, 60);
  });

  it('does not flag directories below threshold', () => {
    const scan = scanCodebase(largeProjectDir);
    const suspicious = detectSuspiciousDirs(scan.directoryTree);
    assert.ok(!suspicious.some((s) => s.dir === 'src'));
  });

  it('supports custom threshold', () => {
    const scan = scanCodebase(largeProjectDir);
    const suspicious = detectSuspiciousDirs(scan.directoryTree, 5);
    assert.ok(suspicious.some((s) => s.dir === 'src'));
    assert.ok(suspicious.some((s) => s.dir === 'vendor'));
  });

  it('ignores root directory', () => {
    const tree = new Map([
      ['.', Array.from({ length: 100 }, (_, i) => `file${i}.js`)],
    ]);
    const suspicious = detectSuspiciousDirs(tree);
    assert.strictEqual(suspicious.length, 0);
  });
});

describe('filterScanResults', () => {
  it('removes excluded directories from directoryTree', () => {
    const scan = scanCodebase(largeProjectDir);
    const filtered = filterScanResults(scan, ['vendor'], largeProjectDir);
    assert.ok(!filtered.directoryTree.has('vendor'));
    assert.ok(filtered.directoryTree.has('src'));
  });

  it('removes excluded files from sourceFiles', () => {
    const scan = scanCodebase(largeProjectDir);
    const filtered = filterScanResults(scan, ['vendor'], largeProjectDir);
    assert.strictEqual(filtered.sourceFiles.length, 10);
    for (const f of filtered.sourceFiles) {
      assert.ok(!f.includes('vendor'));
    }
  });

  it('returns original scan when excludeDirs is empty', () => {
    const scan = scanCodebase(largeProjectDir);
    const filtered = filterScanResults(scan, [], largeProjectDir);
    assert.strictEqual(filtered, scan);
  });
});

describe('auto-exclusion in interview CLI', () => {
  const cliPath = path.join(__dirname, '..', 'src', 'cli.js');

  it('auto-excludes vendor/ with warning', () => {
    const output = execFileSync(
      process.execPath,
      [cliPath, 'interview', '--base-dir', largeProjectDir],
      { encoding: 'utf8' }
    );
    assert.ok(output.includes('Excluded: vendor/'));
    assert.ok(output.includes('60 files'));
    assert.ok(output.includes('--full'));
  });

  it('--full disables auto-exclusion', () => {
    const output = execFileSync(
      process.execPath,
      [cliPath, 'interview', '--full', '--base-dir', largeProjectDir],
      { encoding: 'utf8' }
    );
    assert.ok(!output.includes('Excluded:'));
    assert.ok(output.includes('vendor/'));
    assert.ok(output.includes('70 source files total'));
  });

  it('auto-excluded dir does not appear in directory tree', () => {
    const output = execFileSync(
      process.execPath,
      [cliPath, 'interview', '--base-dir', largeProjectDir],
      { encoding: 'utf8' }
    );
    // Strip ANSI codes for checking
    const plain = output.replace(/\x1b\[[0-9;]*m/g, '');
    // The Directory Tree section should not list vendor/ as a directory entry
    const treeSection = plain.split('Directory Tree')[1].split('Dependency Map')[0];
    // vendor/ should only appear in the Excluded: warning, not in the tree
    assert.ok(!treeSection.includes('vendor/'));
  });

  it('source file count reflects only included files', () => {
    const output = execFileSync(
      process.execPath,
      [cliPath, 'interview', '--base-dir', largeProjectDir],
      { encoding: 'utf8' }
    );
    assert.ok(output.includes('10 source files total'));
  });
});

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { parseRuleFile, resolveGlobs, checkFile, runRules, formatResults, scanCodebase, formatInterview, DEFAULT_SKIP_DIRS } = require('../src/index');

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
  it('groups files by top-level directory relative to baseDir', () => {
    const scan = scanCodebase(projectDir);
    const dirNames = [...scan.directories.keys()].sort();
    assert.ok(dirNames.includes('strategies'));
    assert.ok(dirNames.includes('.'));  // root-level files
  });

  it('uses subdirectory as baseDir to regroup directories', () => {
    const subDir = path.join(projectDir, 'strategies');
    const scan = scanCodebase(subDir);
    const dirNames = [...scan.directories.keys()].sort();
    // When scanning from strategies/, workshop-v3 becomes a top-level directory
    assert.ok(dirNames.includes('workshop-v3'));
    // Should not contain 'strategies' since we're inside it
    assert.ok(!dirNames.includes('strategies'));
  });

  it('returns source files relative to baseDir', () => {
    const subDir = path.join(projectDir, 'strategies');
    const scan = scanCodebase(subDir);
    // Files should be found inside the subdirectory
    assert.ok(scan.sourceFiles.length > 0);
    // All files should be under the subDir
    for (const file of scan.sourceFiles) {
      assert.ok(file.startsWith(subDir), `${file} should start with ${subDir}`);
    }
  });
});

describe('formatInterview', () => {
  it('produces output with directory structure section', () => {
    const scan = scanCodebase(projectDir);
    const output = formatInterview(scan, projectDir);
    assert.ok(output.includes('Directory Structure'));
    assert.ok(output.includes('strategies/'));
  });

  it('shows clean directory labels when using subdirectory as baseDir', () => {
    const subDir = path.join(projectDir, 'strategies');
    const scan = scanCodebase(subDir);
    const output = formatInterview(scan, subDir);
    assert.ok(output.includes('Directory Structure'));
    assert.ok(output.includes('workshop-v3/'));
    // Should not contain '../' paths
    assert.ok(!output.includes('../'));
  });
});

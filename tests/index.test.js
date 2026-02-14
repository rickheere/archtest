const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { parseRuleFile, resolveGlobs, checkFile, runRules, formatResults } = require('../src/index');

const fixturesDir = path.join(__dirname, 'fixtures');
const projectDir = path.join(fixturesDir, 'project');

describe('parseRuleFile', () => {
  it('parses a valid YAML rule file', () => {
    const rules = parseRuleFile(path.join(fixturesDir, 'rules-passing.yml'));
    assert.strictEqual(rules.length, 1);
    assert.strictEqual(rules[0].name, 'no-console-in-utils');
    assert.deepStrictEqual(rules[0].scope.files, ['utils.ts']);
    assert.deepStrictEqual(rules[0].deny.patterns, ['console\\.log']);
  });

  it('parses a file with multiple rules', () => {
    const rules = parseRuleFile(path.join(fixturesDir, 'rules-mixed.yml'));
    assert.strictEqual(rules.length, 2);
    assert.strictEqual(rules[0].name, 'no-console-in-utils');
    assert.strictEqual(rules[1].name, 'no-strategy-internals-in-orchestrator');
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
    const rules = parseRuleFile(path.join(fixturesDir, 'rules-passing.yml'));
    const results = runRules(rules, projectDir);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].passed, true);
    assert.strictEqual(results[0].violations.length, 0);
  });

  it('reports failures when violations exist', () => {
    const rules = parseRuleFile(path.join(fixturesDir, 'rules-failing.yml'));
    const results = runRules(rules, projectDir);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].passed, false);
    assert.ok(results[0].violations.length > 0);
  });

  it('handles mixed pass and fail', () => {
    const rules = parseRuleFile(path.join(fixturesDir, 'rules-mixed.yml'));
    const results = runRules(rules, projectDir);
    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].passed, true);  // no-console-in-utils
    assert.strictEqual(results[1].passed, false); // no-strategy-internals
  });

  it('excludes files matching exclude patterns', () => {
    const rules = parseRuleFile(path.join(fixturesDir, 'rules-exclude.yml'));
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
      { rule: 'test-rule', passed: true, violations: [] },
    ];
    const output = formatResults(results, { verbose: true, baseDir: projectDir });
    assert.ok(output.includes('checking 1 rule'));
  });

  it('shows PASS for passing rules in verbose mode', () => {
    const results = [
      { rule: 'test-rule', passed: true, violations: [] },
    ];
    const output = formatResults(results, { verbose: true, baseDir: projectDir });
    assert.ok(output.includes('PASS'));
    assert.ok(output.includes('test-rule'));
  });

  it('hides passing rules in non-verbose mode', () => {
    const results = [
      { rule: 'passing-rule', passed: true, violations: [] },
    ];
    const output = formatResults(results, { verbose: false, baseDir: projectDir });
    assert.ok(!output.includes('passing-rule'));
  });

  it('shows FAIL with violations', () => {
    const results = [
      {
        rule: 'fail-rule',
        passed: false,
        violations: [
          { file: path.join(projectDir, 'foo.ts'), line: 10, match: 'bad code', pattern: 'bad' },
        ],
      },
    ];
    const output = formatResults(results, { baseDir: projectDir });
    assert.ok(output.includes('FAIL'));
    assert.ok(output.includes('fail-rule'));
    assert.ok(output.includes('foo.ts:10'));
    assert.ok(output.includes('bad code'));
  });

  it('shows correct totals', () => {
    const results = [
      { rule: 'pass1', passed: true, violations: [] },
      { rule: 'fail1', passed: false, violations: [{ file: '/f', line: 1, match: 'x', pattern: 'x' }] },
    ];
    const output = formatResults(results, { verbose: true, baseDir: '/' });
    assert.ok(output.includes('1 passed, 1 failed'));
  });
});

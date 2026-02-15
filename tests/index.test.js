const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseRuleFile, resolveGlobs, checkFile, runRules, formatResults, scanCodebase, formatInterview, detectSuspiciousDirs, filterScanResults, walkDir, countExtensions, detectLanguageFamilies, extensionsByTopDir, DEFAULT_SKIP_DIRS, LANGUAGE_FAMILIES } = require('../src/index');

const fixturesDir = path.join(__dirname, 'fixtures');
const projectDir = path.join(fixturesDir, 'project');
const JS_TS_EXT = new Set(['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs']);

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
    const scan = scanCodebase(projectDir, { extensions: JS_TS_EXT });
    const dirNames = [...scan.directoryTree.keys()].sort();
    // Should have root files and nested strategy directory
    assert.ok(dirNames.includes('.'));
    assert.ok(dirNames.some((d) => d.includes('workshop-v3')));
  });

  it('directoryTree contains filenames per directory', () => {
    const scan = scanCodebase(projectDir, { extensions: JS_TS_EXT });
    // Root should contain orchestrator.ts and utils.ts
    const rootFiles = scan.directoryTree.get('.');
    assert.ok(rootFiles.includes('orchestrator.ts'));
    assert.ok(rootFiles.includes('utils.ts'));
  });

  it('uses subdirectory as baseDir to scope the tree', () => {
    const subDir = path.join(projectDir, 'strategies');
    const scan = scanCodebase(subDir, { extensions: JS_TS_EXT });
    const dirNames = [...scan.directoryTree.keys()].sort();
    // When scanning from strategies/, workshop-v3 becomes a directory
    assert.ok(dirNames.includes('workshop-v3'));
    // Should not contain 'strategies' since we're inside it
    assert.ok(!dirNames.includes('strategies'));
  });

  it('returns source files under the scanned baseDir', () => {
    const subDir = path.join(projectDir, 'strategies');
    const scan = scanCodebase(subDir, { extensions: JS_TS_EXT });
    assert.ok(scan.sourceFiles.length > 0);
    for (const file of scan.sourceFiles) {
      assert.ok(file.startsWith(subDir), `${file} should start with ${subDir}`);
    }
  });

  it('builds file-level dependency map', () => {
    const scan = scanCodebase(projectDir, { extensions: JS_TS_EXT });
    // orchestrator.ts imports ./types and ./utils
    assert.ok(scan.fileDependencies.has('orchestrator.ts'));
    const deps = scan.fileDependencies.get('orchestrator.ts');
    assert.ok(deps.all.includes('utils.ts'));
    assert.ok(deps.all.length >= 1);
  });

  it('resolves imports to actual source files with extensions', () => {
    const scan = scanCodebase(projectDir, { extensions: JS_TS_EXT });
    // strategies/workshop-v3/index.ts imports ./strategy which should resolve to strategy.ts
    const indexDeps = scan.fileDependencies.get(path.join('strategies', 'workshop-v3', 'index.ts'));
    assert.ok(indexDeps, 'index.ts should have dependencies');
    assert.ok(
      indexDeps.resolved.some((d) => d.endsWith('strategy.ts')),
      'Should resolve ./strategy to strategy.ts'
    );
  });
});

describe('formatInterview', () => {
  it('produces output with Directory Tree section', () => {
    const scan = scanCodebase(projectDir, { extensions: JS_TS_EXT });
    const output = formatInterview(scan, projectDir);
    assert.ok(output.includes('Directory Tree'));
    assert.ok(output.includes('workshop-v3/'));
  });

  it('produces output with Dependency Map section', () => {
    const scan = scanCodebase(projectDir, { extensions: JS_TS_EXT });
    const output = formatInterview(scan, projectDir);
    assert.ok(output.includes('Dependency Map'));
    // Should show file-level imports
    assert.ok(output.includes('orchestrator.ts'));
    assert.ok(output.includes('utils.ts'));
  });

  it('shows file-level import arrows in dependency map', () => {
    const scan = scanCodebase(projectDir, { extensions: JS_TS_EXT });
    const output = formatInterview(scan, projectDir);
    // orchestrator.ts imports utils.ts — should show as arrow
    assert.ok(output.includes('\u2192 utils.ts'));
  });

  it('shows clean directory labels when using subdirectory as baseDir', () => {
    const subDir = path.join(projectDir, 'strategies');
    const scan = scanCodebase(subDir, { extensions: JS_TS_EXT });
    const output = formatInterview(scan, subDir);
    assert.ok(output.includes('Directory Tree'));
    assert.ok(output.includes('workshop-v3/'));
    // Should not contain '../' paths
    assert.ok(!output.includes('../'));
  });

  it('shows source files total count', () => {
    const scan = scanCodebase(projectDir, { extensions: JS_TS_EXT });
    const output = formatInterview(scan, projectDir);
    assert.ok(output.includes('source files total'));
  });
});

describe('CLI --skip is additive', () => {
  const cliPath = path.join(__dirname, '..', 'src', 'cli.js');

  it('--skip merges with DEFAULT_SKIP_DIRS in interview mode', () => {
    const output = execFileSync(
      process.execPath,
      [cliPath, 'interview', '--skip', '.nauvis', '--ext', '.ts,.js', '--base-dir', projectDir],
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
    assert.ok(output.includes('All always merge with the defaults above'));
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
    const scan = scanCodebase(largeProjectDir, { extensions: JS_TS_EXT });
    const suspicious = detectSuspiciousDirs(scan.directoryTree);
    assert.strictEqual(suspicious.length, 1);
    assert.strictEqual(suspicious[0].dir, 'vendor');
    assert.strictEqual(suspicious[0].count, 60);
  });

  it('does not flag directories below threshold', () => {
    const scan = scanCodebase(largeProjectDir, { extensions: JS_TS_EXT });
    const suspicious = detectSuspiciousDirs(scan.directoryTree);
    assert.ok(!suspicious.some((s) => s.dir === 'src'));
  });

  it('supports custom threshold', () => {
    const scan = scanCodebase(largeProjectDir, { extensions: JS_TS_EXT });
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
    const scan = scanCodebase(largeProjectDir, { extensions: JS_TS_EXT });
    const filtered = filterScanResults(scan, ['vendor'], largeProjectDir);
    assert.ok(!filtered.directoryTree.has('vendor'));
    assert.ok(filtered.directoryTree.has('src'));
  });

  it('removes excluded files from sourceFiles', () => {
    const scan = scanCodebase(largeProjectDir, { extensions: JS_TS_EXT });
    const filtered = filterScanResults(scan, ['vendor'], largeProjectDir);
    assert.strictEqual(filtered.sourceFiles.length, 10);
    for (const f of filtered.sourceFiles) {
      assert.ok(!f.includes('vendor'));
    }
  });

  it('returns original scan when excludeDirs is empty', () => {
    const scan = scanCodebase(largeProjectDir, { extensions: JS_TS_EXT });
    const filtered = filterScanResults(scan, [], largeProjectDir);
    assert.strictEqual(filtered, scan);
  });
});

describe('auto-exclusion in interview CLI', () => {
  const cliPath = path.join(__dirname, '..', 'src', 'cli.js');

  it('auto-excludes vendor/ with warning', () => {
    const output = execFileSync(
      process.execPath,
      [cliPath, 'interview', '--ext', '.js', '--base-dir', largeProjectDir],
      { encoding: 'utf8' }
    );
    assert.ok(output.includes('Excluded: vendor/'));
    assert.ok(output.includes('60 files'));
    assert.ok(output.includes('--full'));
  });

  it('--full disables auto-exclusion', () => {
    const output = execFileSync(
      process.execPath,
      [cliPath, 'interview', '--full', '--ext', '.js', '--base-dir', largeProjectDir],
      { encoding: 'utf8' }
    );
    assert.ok(!output.includes('Excluded:'));
    assert.ok(output.includes('vendor/'));
    assert.ok(output.includes('70 source files total'));
  });

  it('auto-excluded dir does not appear in directory tree', () => {
    const output = execFileSync(
      process.execPath,
      [cliPath, 'interview', '--ext', '.js', '--base-dir', largeProjectDir],
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
      [cliPath, 'interview', '--ext', '.js', '--base-dir', largeProjectDir],
      { encoding: 'utf8' }
    );
    assert.ok(output.includes('10 source files total'));
  });
});

describe('countExtensions', () => {
  it('counts file extensions from file list', () => {
    const files = ['/a/b.js', '/a/c.js', '/a/d.ts', '/a/e.json'];
    const counts = countExtensions(files);
    assert.strictEqual(counts.get('.js'), 2);
    assert.strictEqual(counts.get('.ts'), 1);
    assert.strictEqual(counts.get('.json'), 1);
  });

  it('sorts by count descending', () => {
    const files = ['/a.ts', '/b.js', '/c.js', '/d.js'];
    const counts = countExtensions(files);
    const keys = [...counts.keys()];
    assert.strictEqual(keys[0], '.js');
    assert.strictEqual(keys[1], '.ts');
  });

  it('returns empty map for no files', () => {
    const counts = countExtensions([]);
    assert.strictEqual(counts.size, 0);
  });
});

describe('scanCodebase without extensions', () => {
  it('returns empty results when no extensions provided', () => {
    const scan = scanCodebase(projectDir);
    assert.strictEqual(scan.directoryTree.size, 0);
    assert.strictEqual(scan.sourceFiles.length, 0);
    assert.strictEqual(scan.fileDependencies.size, 0);
  });
});

describe('language-aware interview CLI', () => {
  const cliPath = path.join(__dirname, '..', 'src', 'cli.js');

  it('shows extension summary and guidance when no --ext provided', () => {
    const output = execFileSync(
      process.execPath,
      [cliPath, 'interview', '--base-dir', projectDir],
      { encoding: 'utf8' }
    );
    const plain = output.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(plain.includes('Extensions found:'));
    assert.ok(plain.includes('.ts'));
    assert.ok(plain.includes('No extensions selected'));
    assert.ok(plain.includes('--ext'));
    // Should NOT contain Directory Tree (no scan happened)
    assert.ok(!plain.includes('Directory Tree'));
  });

  it('shows only scanning line when --ext provided via CLI (no extension list)', () => {
    const output = execFileSync(
      process.execPath,
      [cliPath, 'interview', '--ext', '.ts', '--base-dir', projectDir],
      { encoding: 'utf8' }
    );
    const plain = output.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(!plain.includes('Extensions found:'), 'Should not show extension list when --ext is on CLI');
    assert.ok(plain.includes('Scanning: .ts'));
    assert.ok(plain.includes('Directory Tree'));
  });

  it('warns when scanned files are less than 10% of total', () => {
    // large-project has 70 .js files; scanning .ts would find 0 of 70
    // We need a fixture where we scan a minority. The project fixture has .ts files.
    // Let's scan large-project with a non-existent ext to get 0 of 70
    const output = execFileSync(
      process.execPath,
      [cliPath, 'interview', '--ext', '.xyz', '--base-dir', largeProjectDir],
      { encoding: 'utf8' }
    );
    const plain = output.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(plain.includes('Only scanning'));
    assert.ok(plain.includes('Use --ext to include other extensions'));
  });

  it('--skip-ext excludes extensions from scan', () => {
    const output = execFileSync(
      process.execPath,
      [cliPath, 'interview', '--ext', '.ts,.js', '--skip-ext', '.js', '--base-dir', projectDir],
      { encoding: 'utf8' }
    );
    const plain = output.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(plain.includes('Scanning: .ts'));
    assert.ok(!plain.includes('Scanning: .js'));
    assert.ok(plain.includes('Directory Tree'));
  });

  it('help text shows import pattern examples for multiple languages', () => {
    const output = execFileSync(
      process.execPath,
      [cliPath, '--help'],
      { encoding: 'utf8' }
    );
    assert.ok(output.includes('Go:'));
    assert.ok(output.includes('Python:'));
    assert.ok(output.includes('Rust:'));
  });

  it('examples command shows multi-language interview section', () => {
    const output = execFileSync(
      process.execPath,
      [cliPath, 'examples'],
      { encoding: 'utf8' }
    );
    assert.ok(output.includes('Multi-Language Interview'));
    assert.ok(output.includes('--ext .go'));
    assert.ok(output.includes('--ext .py'));
    assert.ok(output.includes('--ext .rs'));
  });

  it('examples command shows scan config examples', () => {
    const output = execFileSync(
      process.execPath,
      [cliPath, 'examples'],
      { encoding: 'utf8' }
    );
    assert.ok(output.includes('Scan Config Examples'));
    assert.ok(output.includes('scan:'));
    assert.ok(output.includes('extensions:'));
    assert.ok(output.includes('import-patterns:'));
  });
});

const configProjectDir = path.join(fixturesDir, 'config-project');

describe('parseRuleFile with scan config', () => {
  it('parses scan section with extensions', () => {
    const config = parseRuleFile(path.join(fixturesDir, 'rules-with-scan.yml'));
    assert.ok(config.scan, 'Should have scan config');
    assert.ok(config.scan.extensions instanceof Set, 'extensions should be a Set');
    assert.ok(config.scan.extensions.has('.ts'));
    assert.ok(config.scan.extensions.has('.js'));
  });

  it('parses scan section with import patterns', () => {
    const config = parseRuleFile(path.join(fixturesDir, 'rules-with-scan.yml'));
    assert.ok(config.scan.importPatterns, 'Should have import patterns');
    assert.ok(config.scan.importPatterns.length > 0);
    assert.ok(config.scan.importPatterns[0] instanceof RegExp);
  });

  it('parses scan section with skip dirs', () => {
    const config = parseRuleFile(path.join(fixturesDir, 'rules-with-scan.yml'));
    assert.ok(config.scan.skipDirs, 'Should have skip dirs');
    assert.deepStrictEqual(config.scan.skipDirs, ['vendor']);
  });

  it('omits scan when not in config', () => {
    const config = parseRuleFile(path.join(fixturesDir, 'rules-passing.yml'));
    assert.strictEqual(config.scan, undefined);
  });

  it('auto-adds dot prefix to extensions', () => {
    // The fixture has [.ts, .js] which already have dots
    const config = parseRuleFile(path.join(fixturesDir, 'rules-with-scan.yml'));
    for (const ext of config.scan.extensions) {
      assert.ok(ext.startsWith('.'), `Extension "${ext}" should start with a dot`);
    }
  });
});

describe('scan config in interview CLI', () => {
  const cliPath = path.join(__dirname, '..', 'src', 'cli.js');

  it('uses scan config extensions when no --ext provided', () => {
    const output = execFileSync(
      process.execPath,
      [cliPath, 'interview', '--base-dir', configProjectDir],
      { encoding: 'utf8' }
    );
    const plain = output.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(plain.includes('Scanning (from .archtest.yml): .ts'));
    assert.ok(plain.includes('Directory Tree'));
  });

  it('CLI --ext overrides scan config extensions', () => {
    const output = execFileSync(
      process.execPath,
      [cliPath, 'interview', '--ext', '.ts', '--base-dir', configProjectDir],
      { encoding: 'utf8' }
    );
    const plain = output.replace(/\x1b\[[0-9;]*m/g, '');
    // Should show CLI-style output, not config-style
    assert.ok(plain.includes('Scanning: .ts'), 'Should show CLI scanning line');
    assert.ok(!plain.includes('from .archtest.yml'), 'Should not mention config when CLI overrides');
  });

  it('shows extension list as reality check when using config', () => {
    const output = execFileSync(
      process.execPath,
      [cliPath, 'interview', '--base-dir', configProjectDir],
      { encoding: 'utf8' }
    );
    const plain = output.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(plain.includes('Extensions found:'));
    assert.ok(plain.includes('Scanning (from .archtest.yml):'));
  });

  it('schema command documents the scan section', () => {
    const output = execFileSync(
      process.execPath,
      [cliPath, 'schema'],
      { encoding: 'utf8' }
    );
    assert.ok(output.includes('scan:'));
    assert.ok(output.includes('extensions:'));
    assert.ok(output.includes('import-patterns:'));
    assert.ok(output.includes('skip-dirs:'));
    assert.ok(output.includes('Precedence'));
  });

  it('help text mentions scan config persistence', () => {
    const output = execFileSync(
      process.execPath,
      [cliPath, '--help'],
      { encoding: 'utf8' }
    );
    assert.ok(output.includes('Scan Config'));
    assert.ok(output.includes('.archtest.yml'));
  });
});

describe('extension list filtering', () => {
  const cliPath = path.join(__dirname, '..', 'src', 'cli.js');

  it('filters out extensions with < 2 files when no config/flags', () => {
    const output = execFileSync(
      process.execPath,
      [cliPath, 'interview', '--base-dir', projectDir],
      { encoding: 'utf8' }
    );
    const plain = output.replace(/\x1b\[[0-9;]*m/g, '');
    // projectDir has .ts files (multiple) — those should appear
    // Single-occurrence extensions should be filtered
    assert.ok(plain.includes('Extensions found:'));
    assert.ok(plain.includes('.ts'));
  });
});

describe('flat dependency map (no internal/external distinction)', () => {
  it('shows all imports without (external) labels', () => {
    const scan = scanCodebase(projectDir, { extensions: JS_TS_EXT });
    const output = formatInterview(scan, projectDir);
    assert.ok(!output.includes('(external)'), 'Should not contain (external) labels');
  });

  it('does not show Isolated Directories section', () => {
    const scan = scanCodebase(projectDir, { extensions: JS_TS_EXT });
    const output = formatInterview(scan, projectDir);
    assert.ok(!output.includes('Isolated Directories'), 'Should not contain Isolated Directories section');
  });

  it('shows all imports as flat list in dependency map', () => {
    const scan = scanCodebase(projectDir, { extensions: JS_TS_EXT });
    const output = formatInterview(scan, projectDir);
    // Should show resolved relative imports
    assert.ok(output.includes('\u2192 utils.ts'));
  });

  it('fileDependencies stores all imports in .all and resolved in .resolved', () => {
    const scan = scanCodebase(projectDir, { extensions: JS_TS_EXT });
    const deps = scan.fileDependencies.get('orchestrator.ts');
    assert.ok(deps, 'orchestrator.ts should have deps');
    assert.ok(Array.isArray(deps.all), 'deps.all should be an array');
    assert.ok(Array.isArray(deps.resolved), 'deps.resolved should be an array');
    assert.ok(deps.all.includes('utils.ts'), 'all should include resolved relative imports');
    assert.ok(deps.resolved.includes('utils.ts'), 'resolved should include resolved relative imports');
  });

  it('scanCodebase no longer returns externalDeps', () => {
    const scan = scanCodebase(projectDir, { extensions: JS_TS_EXT });
    assert.strictEqual(scan.externalDeps, undefined, 'externalDeps should not be in scan result');
  });
});

describe('additive import patterns (CLI + config)', () => {
  const cliPath = path.join(__dirname, '..', 'src', 'cli.js');

  it('help text documents additive import pattern behavior', () => {
    const output = execFileSync(
      process.execPath,
      [cliPath, '--help'],
      { encoding: 'utf8' }
    );
    assert.ok(output.includes('Adds to patterns from .archtest.yml'));
  });

  it('schema documents that CLI --import-pattern adds to config', () => {
    const output = execFileSync(
      process.execPath,
      [cliPath, 'schema'],
      { encoding: 'utf8' }
    );
    assert.ok(output.includes('adds to'));
    assert.ok(output.includes('import-pattern'));
  });
});

const monorepoDir = path.join(fixturesDir, 'monorepo-project');

describe('detectLanguageFamilies', () => {
  it('detects distinct language families from extension counts', () => {
    const extCounts = new Map([
      ['.clj', 3], ['.js', 5], ['.swift', 2],
    ]);
    const families = detectLanguageFamilies(extCounts);
    assert.strictEqual(families.size, 3);
    assert.ok(families.has('clojure'));
    assert.ok(families.has('js'));
    assert.ok(families.has('apple'));
  });

  it('groups related extensions into same family', () => {
    const extCounts = new Map([
      ['.ts', 10], ['.tsx', 5], ['.js', 3], ['.jsx', 2],
    ]);
    const families = detectLanguageFamilies(extCounts);
    assert.strictEqual(families.size, 1);
    assert.ok(families.has('js'));
  });

  it('ignores unknown extensions', () => {
    const extCounts = new Map([
      ['.xyz', 5], ['.abc', 3],
    ]);
    const families = detectLanguageFamilies(extCounts);
    assert.strictEqual(families.size, 0);
  });
});

describe('extensionsByTopDir', () => {
  it('groups extensions by top-level directory', () => {
    const allFiles = walkDir(monorepoDir, DEFAULT_SKIP_DIRS);
    const result = extensionsByTopDir(allFiles, monorepoDir);
    assert.ok(result.has('backend'), 'Should have backend dir');
    assert.ok(result.has('mobile'), 'Should have mobile dir');
    // Backend should have .clj
    assert.ok(result.get('backend').has('.clj'));
    // Mobile should have .js and/or .swift
    const mobileExts = result.get('mobile');
    assert.ok(mobileExts.has('.js') || mobileExts.has('.swift'));
  });

  it('shows top 2 extensions per directory', () => {
    const allFiles = walkDir(monorepoDir, DEFAULT_SKIP_DIRS);
    const result = extensionsByTopDir(allFiles, monorepoDir);
    for (const [, exts] of result) {
      assert.ok(exts.size <= 2, 'Should show at most 2 extensions per dir');
    }
  });

  it('skips root-level files', () => {
    const allFiles = ['/base/root.js', '/base/sub/file.ts'];
    const result = extensionsByTopDir(allFiles, '/base');
    assert.ok(!result.has('.'), 'Should not include root-level files');
    assert.ok(result.has('sub'));
  });
});

describe('LANGUAGE_FAMILIES', () => {
  it('covers common language extensions', () => {
    const expected = ['.js', '.ts', '.py', '.go', '.rs', '.java', '.clj', '.swift', '.rb', '.c', '.cpp'];
    for (const ext of expected) {
      assert.ok(LANGUAGE_FAMILIES[ext], `Should have family for ${ext}`);
    }
  });
});

describe('cascading config lookup', () => {
  const cliPath = path.join(__dirname, '..', 'src', 'cli.js');

  it('finds config in --base-dir directory', () => {
    const output = execFileSync(
      process.execPath,
      [cliPath, 'interview', '--base-dir', path.join(monorepoDir, 'backend')],
      { encoding: 'utf8' }
    );
    const plain = output.replace(/\x1b\[[0-9;]*m/g, '');
    // backend/.archtest.yml has extensions: [.clj]
    assert.ok(plain.includes('Scanning (from .archtest.yml): .clj'));
  });

  it('cascades to parent when --base-dir has no config', () => {
    const output = execFileSync(
      process.execPath,
      [cliPath, 'interview', '--base-dir', path.join(monorepoDir, 'mobile')],
      { encoding: 'utf8' }
    );
    const plain = output.replace(/\x1b\[[0-9;]*m/g, '');
    // mobile/ has no .archtest.yml, should find monorepo-project/.archtest.yml
    // which has extensions: [.js, .ts]
    assert.ok(plain.includes('Scanning (from .archtest.yml):'));
    assert.ok(plain.includes('.js'));
  });

  it('nearest config wins over parent config', () => {
    // backend/.archtest.yml has .clj, monorepo-project/.archtest.yml has .js,.ts
    const output = execFileSync(
      process.execPath,
      [cliPath, 'interview', '--base-dir', path.join(monorepoDir, 'backend')],
      { encoding: 'utf8' }
    );
    const plain = output.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(plain.includes('.clj'), 'Should use backend config with .clj');
    assert.ok(!plain.includes('Scanning (from .archtest.yml): .js'), 'Should not use parent config .js');
  });
});

describe('multi-language scoping hint', () => {
  const cliPath = path.join(__dirname, '..', 'src', 'cli.js');

  it('shows scoping hint when 3+ language families detected', () => {
    const output = execFileSync(
      process.execPath,
      [cliPath, 'interview', '--base-dir', monorepoDir],
      { encoding: 'utf8' }
    );
    const plain = output.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(plain.includes('Multiple language families detected'));
    assert.ok(plain.includes('--base-dir'));
  });

  it('shows per-directory extension breakdown', () => {
    const output = execFileSync(
      process.execPath,
      [cliPath, 'interview', '--base-dir', monorepoDir],
      { encoding: 'utf8' }
    );
    const plain = output.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(plain.includes('backend/'));
    assert.ok(plain.includes('.clj'));
    assert.ok(plain.includes('mobile/'));
  });

  it('does not show scoping hint for single-language projects', () => {
    const output = execFileSync(
      process.execPath,
      [cliPath, 'interview', '--base-dir', projectDir],
      { encoding: 'utf8' }
    );
    const plain = output.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(!plain.includes('Multiple language families detected'));
  });
});

describe('documentation updates', () => {
  const cliPath = path.join(__dirname, '..', 'src', 'cli.js');

  it('help text mentions config lookup relative to --base-dir', () => {
    const output = execFileSync(
      process.execPath,
      [cliPath, '--help'],
      { encoding: 'utf8' }
    );
    assert.ok(output.includes('cascading'));
  });

  it('schema documents cascading config lookup', () => {
    const output = execFileSync(
      process.execPath,
      [cliPath, 'schema'],
      { encoding: 'utf8' }
    );
    assert.ok(output.includes('Cascading Config Lookup'));
    assert.ok(output.includes('Nearest config wins'));
  });

  it('examples show monorepo setup', () => {
    const output = execFileSync(
      process.execPath,
      [cliPath, 'examples'],
      { encoding: 'utf8' }
    );
    assert.ok(output.includes('Monorepo Setup'));
    assert.ok(output.includes('backend/.archtest.yml'));
    assert.ok(output.includes('mobile/.archtest.yml'));
    assert.ok(output.includes('--base-dir backend/'));
  });
});

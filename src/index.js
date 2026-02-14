const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { minimatch } = require('minimatch');

/**
 * Parse a YAML rule file and return the rules array.
 */
function parseRuleFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const doc = yaml.load(content);
  if (!doc || !Array.isArray(doc.rules)) {
    throw new Error(`Invalid rule file: expected a "rules" array in ${filePath}`);
  }
  return doc.rules;
}

/**
 * Resolve glob patterns to actual file paths relative to baseDir.
 * Walks the directory tree and matches against minimatch patterns.
 */
function resolveGlobs(patterns, baseDir) {
  const allFiles = walkDir(baseDir);
  const matched = new Set();
  for (const pattern of patterns) {
    for (const file of allFiles) {
      const rel = path.relative(baseDir, file);
      if (minimatch(rel, pattern, { dot: true })) {
        matched.add(file);
      }
    }
  }
  return [...matched].sort();
}

/**
 * Recursively walk a directory and return all file paths.
 */
function walkDir(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

/**
 * Check a single file against a list of deny patterns.
 * Returns an array of violations: { file, line, match, pattern }
 */
function checkFile(filePath, denyPatterns) {
  const violations = [];
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  for (const pattern of denyPatterns) {
    const regex = new RegExp(pattern);
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(regex);
      if (match) {
        violations.push({
          file: filePath,
          line: i + 1,
          match: lines[i].trim(),
          pattern,
        });
      }
    }
  }

  return violations;
}

/**
 * Run all rules against the codebase.
 * Returns an array of results: { rule, passed, violations }
 */
function runRules(rules, baseDir) {
  const results = [];

  for (const rule of rules) {
    const filePatterns = rule.scope?.files || [];
    const excludePatterns = rule.scope?.exclude || [];
    const denyPatterns = rule.deny?.patterns || [];

    // Resolve files matching scope
    let files = resolveGlobs(filePatterns, baseDir);

    // Exclude files matching exclude patterns
    if (excludePatterns.length > 0) {
      files = files.filter((f) => {
        const rel = path.relative(baseDir, f);
        return !excludePatterns.some((ep) => minimatch(rel, ep, { dot: true }));
      });
    }

    // Check each file against deny patterns
    const violations = [];
    for (const file of files) {
      violations.push(...checkFile(file, denyPatterns));
    }

    results.push({
      rule: rule.name,
      description: rule.description,
      passed: violations.length === 0,
      violations,
    });
  }

  return results;
}

/**
 * Format results for terminal output.
 * Default: only show failing rules with violations.
 * Verbose: also show passing rules.
 */
function formatResults(results, { verbose = false, baseDir = process.cwd() } = {}) {
  const lines = [];
  lines.push(`archtest v0.1.0 \u2014 checking ${results.length} rule${results.length === 1 ? '' : 's'}`);
  lines.push('');

  for (const result of results) {
    if (result.passed && verbose) {
      lines.push(`  \x1b[32mPASS\x1b[0m  ${result.rule}`);
    } else if (!result.passed) {
      lines.push(`  \x1b[31mFAIL\x1b[0m  ${result.rule}`);
      for (const v of result.violations) {
        const rel = path.relative(baseDir, v.file);
        lines.push(`        ${rel}:${v.line}  ${v.match}`);
      }
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  lines.push('');
  lines.push(`Results: ${passed} passed, ${failed} failed`);

  return lines.join('\n');
}

module.exports = { parseRuleFile, resolveGlobs, checkFile, runRules, formatResults };

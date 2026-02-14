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
 * Default directories to skip during scanning.
 */
const DEFAULT_SKIP_DIRS = new Set(['node_modules', '.git']);

/**
 * Resolve glob patterns to actual file paths relative to baseDir.
 * Walks the directory tree and matches against minimatch patterns.
 */
function resolveGlobs(patterns, baseDir, skipDirs) {
  const allFiles = walkDir(baseDir, skipDirs);
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
 * @param {string} dir - Directory to walk
 * @param {Set<string>} [skipDirs] - Directory names to skip (default: node_modules, .git)
 */
function walkDir(dir, skipDirs) {
  const skip = skipDirs || DEFAULT_SKIP_DIRS;
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (skip.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full, skip));
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
 * Returns an array of results: { rule, passed, violations, files }
 * Each file entry: { file, passed, violations }
 */
function runRules(rules, baseDir, { skipDirs } = {}) {
  const results = [];

  for (const rule of rules) {
    const filePatterns = rule.scope?.files || [];
    const excludePatterns = rule.scope?.exclude || [];
    const denyPatterns = rule.deny?.patterns || [];

    // Resolve files matching scope
    let files = resolveGlobs(filePatterns, baseDir, skipDirs);

    // Exclude files matching exclude patterns
    if (excludePatterns.length > 0) {
      files = files.filter((f) => {
        const rel = path.relative(baseDir, f);
        return !excludePatterns.some((ep) => minimatch(rel, ep, { dot: true }));
      });
    }

    // Check each file against deny patterns
    const allViolations = [];
    const fileResults = [];
    for (const file of files) {
      const violations = checkFile(file, denyPatterns);
      allViolations.push(...violations);
      fileResults.push({
        file,
        passed: violations.length === 0,
        violations,
      });
    }

    results.push({
      rule: rule.name,
      description: rule.description,
      passed: allViolations.length === 0,
      violations: allViolations,
      files: fileResults,
    });
  }

  return results;
}

/**
 * Format results for terminal output.
 * Default: show all rules with checkmarks, violations expanded for failures.
 * Verbose: also show description and per-file breakdown.
 */
function formatResults(results, { verbose = false, baseDir = process.cwd() } = {}) {
  const dim = '\x1b[2m';
  const green = '\x1b[32m';
  const red = '\x1b[31m';
  const yellow = '\x1b[33m';
  const reset = '\x1b[0m';

  const lines = [];
  lines.push('');
  lines.push(`${dim}archtest v0.1.0 \u2014 ${results.length} rule${results.length === 1 ? '' : 's'}${reset}`);
  lines.push('');

  for (const result of results) {
    if (result.passed) {
      lines.push(`  ${green}\u2713${reset}  ${result.rule}`);
    } else {
      lines.push(`  ${red}\u2717${reset}  ${result.rule}`);
    }

    // Verbose: show description
    if (verbose && result.description) {
      lines.push(`     ${yellow}${result.description}${reset}`);
    }

    // Verbose: show per-file breakdown
    if (verbose && result.files && result.files.length > 0) {
      lines.push('');
      for (const fileResult of result.files) {
        const rel = path.relative(baseDir, fileResult.file);
        if (fileResult.passed) {
          lines.push(`       ${green}\u2713${reset}  ${dim}${rel}${reset}`);
        } else {
          lines.push(`       ${red}\u2717${reset}  ${rel}`);
          for (const v of fileResult.violations) {
            lines.push(`          ${dim}${v.line}${reset}  ${v.match}`);
          }
        }
      }
      const fileCount = result.files.length;
      const violationCount = result.violations.length;
      lines.push('');
      if (result.passed) {
        lines.push(`     ${dim}${fileCount} file${fileCount === 1 ? '' : 's'} scanned, all clean${reset}`);
      } else {
        lines.push(`     ${dim}${fileCount} file${fileCount === 1 ? '' : 's'} scanned, ${violationCount} violation${violationCount === 1 ? '' : 's'}${reset}`);
      }
    } else if (!result.passed) {
      // Non-verbose: show violations inline for failing rules
      for (const v of result.violations) {
        const rel = path.relative(baseDir, v.file);
        lines.push(`       ${rel}:${v.line}  ${v.match}`);
      }
    }

    lines.push('');
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  lines.push(`${dim}${'─'.repeat(40)}${reset}`);
  if (failed === 0) {
    lines.push(`  ${green}${passed} passed${reset}`);
  } else {
    lines.push(`  ${green}${passed} passed${reset}  ${red}${failed} failed${reset}`);
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Default source file extensions (JavaScript/TypeScript).
 */
const DEFAULT_EXTENSIONS = new Set(['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs']);

/**
 * Default import extraction patterns (JavaScript/TypeScript).
 * Each regex must have capture group 1 = the import target.
 */
const DEFAULT_IMPORT_PATTERNS = [
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,           // require('...')
  /(?:import|export)\s+.*?\s+from\s+['"]([^'"]+)['"]/g, // import/export ... from '...'
  /^import\s+['"]([^'"]+)['"]/gm,                     // import '...' (side-effect)
];

/**
 * Extract import targets from a source file using configurable patterns.
 * Each pattern must have capture group 1 = the import path.
 * Returns array of raw import strings.
 */
function extractImports(filePath, importPatterns) {
  const content = fs.readFileSync(filePath, 'utf8');
  const imports = [];
  const patterns = importPatterns || DEFAULT_IMPORT_PATTERNS;

  for (const pattern of patterns) {
    // Clone regex to reset lastIndex for each file
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(content)) !== null) {
      if (match[1] && !imports.includes(match[1])) {
        imports.push(match[1]);
      }
    }
  }

  return imports;
}

/**
 * Scan the codebase and build a dependency map.
 * Returns { directories, sourceFiles, dependencies, externalDeps }
 *
 * @param {string} baseDir - Root directory to scan
 * @param {Object} [options]
 * @param {Set<string>} [options.extensions] - File extensions to scan (default: JS/TS)
 * @param {RegExp[]} [options.importPatterns] - Regexes to extract imports, group 1 = target (default: JS/TS)
 * @param {Set<string>} [options.skipDirs] - Directory names to skip (default: node_modules, .git)
 */
function scanCodebase(baseDir, { extensions, importPatterns, skipDirs } = {}) {
  const ext = extensions || DEFAULT_EXTENSIONS;
  const allFiles = walkDir(baseDir, skipDirs);
  const sourceFiles = allFiles.filter((f) => ext.has(path.extname(f)));

  // Group files by top-level directory
  const directories = new Map();
  for (const file of sourceFiles) {
    const rel = path.relative(baseDir, file);
    const parts = rel.split(path.sep);
    const topDir = parts.length > 1 ? parts[0] : '.';
    if (!directories.has(topDir)) {
      directories.set(topDir, { files: [], fileCount: 0 });
    }
    directories.get(topDir).files.push(rel);
    directories.get(topDir).fileCount++;
  }

  // Build dependency map
  const dependencies = new Map(); // sourceDir -> Map<targetDir, {count, examples}>
  const externalDeps = new Map(); // packageName -> Set<dirs that use it>

  for (const file of sourceFiles) {
    const rel = path.relative(baseDir, file);
    const parts = rel.split(path.sep);
    const sourceDir = parts.length > 1 ? parts[0] : '.';
    const imports = extractImports(file, importPatterns);

    for (const imp of imports) {
      if (imp.startsWith('.')) {
        // Relative import — resolve target directory
        const resolved = path.resolve(path.dirname(file), imp);
        const resolvedRel = path.relative(baseDir, resolved);
        const targetParts = resolvedRel.split(path.sep);
        const targetDir = targetParts.length > 1 ? targetParts[0] : '.';

        if (targetDir !== sourceDir) {
          if (!dependencies.has(sourceDir)) dependencies.set(sourceDir, new Map());
          const dirDeps = dependencies.get(sourceDir);
          if (!dirDeps.has(targetDir)) dirDeps.set(targetDir, { count: 0, examples: [] });
          const dep = dirDeps.get(targetDir);
          dep.count++;
          if (dep.examples.length < 3) {
            dep.examples.push({ from: rel, imports: imp });
          }
        }
      } else {
        // External/package import
        const pkgName = imp.startsWith('@') ? imp.split('/').slice(0, 2).join('/') : imp.split('/')[0];
        if (!externalDeps.has(pkgName)) externalDeps.set(pkgName, new Set());
        externalDeps.get(pkgName).add(sourceDir);
      }
    }
  }

  return { directories, sourceFiles, dependencies, externalDeps };
}

/**
 * Format the codebase scan as a structured interview report.
 * Output is designed for an AI agent to read and use as context
 * for interviewing the developer about architectural boundaries.
 */
function formatInterview(scan, baseDir) {
  const dim = '\x1b[2m';
  const bold = '\x1b[1m';
  const cyan = '\x1b[36m';
  const yellow = '\x1b[33m';
  const green = '\x1b[32m';
  const red = '\x1b[31m';
  const reset = '\x1b[0m';

  const lines = [];

  // Header
  lines.push('');
  lines.push(`${bold}archtest interview${reset} ${dim}\u2014 Codebase Analysis${reset}`);
  lines.push(`${dim}${'─'.repeat(50)}${reset}`);
  lines.push('');

  // Directory overview
  lines.push(`${bold}Directory Structure${reset}`);
  lines.push('');
  const sortedDirs = [...scan.directories.entries()].sort((a, b) => b[1].fileCount - a[1].fileCount);
  for (const [dir, info] of sortedDirs) {
    const label = dir === '.' ? '(root)' : `${dir}/`;
    lines.push(`  ${cyan}${label.padEnd(30)}${reset} ${dim}${info.fileCount} file${info.fileCount === 1 ? '' : 's'}${reset}`);
  }
  lines.push('');
  lines.push(`  ${dim}${scan.sourceFiles.length} source files total${reset}`);
  lines.push('');

  // Dependency map
  lines.push(`${bold}Cross-Directory Dependencies${reset}`);
  lines.push(`${dim}Which directories import from which other directories.${reset}`);
  lines.push('');

  const allDirs = [...scan.directories.keys()].sort();
  let hasDeps = false;

  for (const sourceDir of allDirs) {
    const dirDeps = scan.dependencies.get(sourceDir);
    if (!dirDeps || dirDeps.size === 0) continue;
    hasDeps = true;

    const label = sourceDir === '.' ? '(root)' : `${sourceDir}/`;
    lines.push(`  ${bold}${label}${reset} imports from:`);

    const sortedDeps = [...dirDeps.entries()].sort((a, b) => b[1].count - a[1].count);
    for (const [targetDir, dep] of sortedDeps) {
      const targetLabel = targetDir === '.' ? '(root)' : `${targetDir}/`;
      lines.push(`    \u2192 ${cyan}${targetLabel}${reset}  ${dim}(${dep.count} import${dep.count === 1 ? '' : 's'})${reset}`);
      for (const ex of dep.examples) {
        lines.push(`      ${dim}${ex.from}${reset}`);
      }
    }
    lines.push('');
  }

  if (!hasDeps) {
    lines.push(`  ${dim}No cross-directory dependencies found.${reset}`);
    lines.push('');
  }

  // Identify mutual dependencies (bidirectional coupling)
  const mutual = [];
  for (const [sourceDir, dirDeps] of scan.dependencies) {
    for (const [targetDir] of dirDeps) {
      const reverse = scan.dependencies.get(targetDir);
      if (reverse && reverse.has(sourceDir) && sourceDir < targetDir) {
        mutual.push([sourceDir, targetDir]);
      }
    }
  }

  if (mutual.length > 0) {
    lines.push(`${bold}${red}Mutual Dependencies${reset} ${dim}(bidirectional coupling)${reset}`);
    lines.push(`${dim}These directory pairs import from each other \u2014 potential boundary violations.${reset}`);
    lines.push('');
    for (const [a, b] of mutual) {
      const labelA = a === '.' ? '(root)' : `${a}/`;
      const labelB = b === '.' ? '(root)' : `${b}/`;
      lines.push(`  ${red}\u2194${reset}  ${cyan}${labelA}${reset} ${dim}\u2194${reset} ${cyan}${labelB}${reset}`);
    }
    lines.push('');
  }

  // Islands (directories with no cross-directory dependencies)
  const islands = allDirs.filter((d) => {
    const outgoing = scan.dependencies.get(d);
    const hasOutgoing = outgoing && outgoing.size > 0;
    let hasIncoming = false;
    for (const [, dirDeps] of scan.dependencies) {
      if (dirDeps.has(d)) { hasIncoming = true; break; }
    }
    return !hasOutgoing && !hasIncoming && d !== '.';
  });

  if (islands.length > 0) {
    lines.push(`${bold}${green}Isolated Directories${reset} ${dim}(no cross-directory imports)${reset}`);
    lines.push('');
    for (const d of islands) {
      lines.push(`  ${green}\u2713${reset}  ${dim}${d}/${reset}`);
    }
    lines.push('');
  }

  // Interview guide section
  lines.push(`${dim}${'─'.repeat(50)}${reset}`);
  lines.push('');
  lines.push(`${bold}Interview Guide${reset}`);
  lines.push(`${dim}Use these questions to discover architectural rules with the developer.${reset}`);
  lines.push('');

  lines.push(`${yellow}1. Module Boundaries${reset}`);
  lines.push('   For each directory that has incoming dependencies:');
  lines.push('   "Should other code import directly into this directory,');
  lines.push('    or should it go through a barrel/index file?"');
  lines.push('');

  if (mutual.length > 0) {
    lines.push(`${yellow}2. Bidirectional Coupling${reset}`);
    for (const [a, b] of mutual) {
      const labelA = a === '.' ? '(root)' : a;
      const labelB = b === '.' ? '(root)' : b;
      lines.push(`   "${labelA} and ${labelB} import from each other.`);
      lines.push(`    Should one of them be independent of the other?`);
      lines.push(`    Which direction should the dependency flow?"`);
    }
    lines.push('');
  }

  lines.push(`${yellow}${mutual.length > 0 ? '3' : '2'}. Layer Isolation${reset}`);
  lines.push('   "Are there layers in this codebase (e.g., API, business logic,');
  lines.push('    database, UI)? Should lower layers be forbidden from importing');
  lines.push('    higher layers?"');
  lines.push('');

  lines.push(`${yellow}${mutual.length > 0 ? '4' : '3'}. External Dependencies${reset}`);
  if (scan.externalDeps.size > 0) {
    const heavyExternals = [...scan.externalDeps.entries()]
      .filter(([, dirs]) => dirs.size >= 1)
      .sort((a, b) => b[1].size - a[1].size)
      .slice(0, 10);
    lines.push(`   Most-used external packages:`);
    for (const [pkg, dirs] of heavyExternals) {
      lines.push(`     ${cyan}${pkg}${reset} ${dim}(used in ${dirs.size} director${dirs.size === 1 ? 'y' : 'ies'})${reset}`);
    }
    lines.push('');
    lines.push('   "Should any of these packages be restricted to specific');
    lines.push('    directories? For example, should database drivers only');
    lines.push('    be imported in the database layer?"');
  }
  lines.push('');

  lines.push(`${yellow}${mutual.length > 0 ? '5' : '4'}. Strategy & Plugin Patterns${reset}`);
  lines.push('   "Are there parts of the codebase that are meant to be');
  lines.push('    swappable or pluggable (strategies, adapters, providers)?');
  lines.push('    Should they be forbidden from importing each other?"');
  lines.push('');

  lines.push(`${dim}${'─'.repeat(50)}${reset}`);
  lines.push('');
  lines.push(`${bold}Next Steps${reset}`);
  lines.push(`  1. Discuss the questions above with the developer`);
  lines.push(`  2. For each boundary they confirm, write an archtest rule`);
  lines.push(`  3. Run ${cyan}archtest schema${reset} for the YAML format`);
  lines.push(`  4. Run ${cyan}archtest examples${reset} for common rule patterns`);
  lines.push(`  5. Save rules to ${cyan}.archtest.yml${reset} and run ${cyan}archtest${reset}`);
  lines.push('');

  return lines.join('\n');
}

module.exports = {
  parseRuleFile, resolveGlobs, checkFile, runRules, formatResults,
  scanCodebase, formatInterview,
  DEFAULT_EXTENSIONS, DEFAULT_IMPORT_PATTERNS, DEFAULT_SKIP_DIRS,
};

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { minimatch } = require('minimatch');
const pkg = require('../package.json');

/**
 * Parse a YAML rule file and return the config object.
 * Returns { rules, skip } where skip is an optional array of directory names.
 */
function parseRuleFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const doc = yaml.load(content);
  if (!doc || !Array.isArray(doc.rules)) {
    throw new Error(`Invalid rule file: expected a "rules" array in ${filePath}`);
  }
  const result = { rules: doc.rules };
  if (Array.isArray(doc.skip)) {
    result.skip = doc.skip;
  }
  return result;
}

/**
 * Default directories to skip during scanning.
 */
const DEFAULT_SKIP_DIRS = new Set([
  'node_modules', '.git',
  '.next', 'dist', 'build', '_generated',
  'coverage', '.turbo', '.cache',
]);

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
  lines.push(`${dim}archtest v${pkg.version} \u2014 ${results.length} rule${results.length === 1 ? '' : 's'}${reset}`);
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
 * Resolve a relative import to a source file path relative to baseDir.
 * Tries the exact path, then with each extension, then as a directory index.
 * Returns the relative path from baseDir, or null if it resolves outside baseDir.
 */
function resolveImportPath(importStr, importingFile, baseDir, extensions, sourceFileSet) {
  const dir = path.dirname(importingFile);
  const resolved = path.resolve(dir, importStr);
  const rel = path.relative(baseDir, resolved);

  // Skip if it resolves outside baseDir
  if (rel.startsWith('..')) return null;

  // Try exact match
  if (sourceFileSet.has(rel)) return rel;

  // Try with each extension
  for (const ext of extensions) {
    const withExt = rel + ext;
    if (sourceFileSet.has(withExt)) return withExt;
  }

  // Try as directory index
  for (const ext of extensions) {
    const indexFile = path.join(rel, `index${ext}`);
    if (sourceFileSet.has(indexFile)) return indexFile;
  }

  // Can't resolve to a known source file — return raw relative path
  return rel;
}

/**
 * Scan the codebase and build a complete file-level dependency map.
 * Returns { directoryTree, sourceFiles, fileDependencies, externalDeps }
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

  // Build full directory tree: relDirPath → array of filenames (basenames)
  const directoryTree = new Map();
  for (const file of sourceFiles) {
    const rel = path.relative(baseDir, file);
    const dir = path.dirname(rel);
    const dirKey = dir === '.' ? '.' : dir;
    if (!directoryTree.has(dirKey)) {
      directoryTree.set(dirKey, []);
    }
    directoryTree.get(dirKey).push(path.basename(rel));
  }

  // Build set of all source file relative paths for import resolution
  const sourceFileSet = new Set(sourceFiles.map((f) => path.relative(baseDir, f)));

  // Build file-level dependency map
  const fileDependencies = new Map();
  const externalDeps = new Map();

  for (const file of sourceFiles) {
    const rel = path.relative(baseDir, file);
    const imports = extractImports(file, importPatterns);
    const internal = [];
    const external = [];

    for (const imp of imports) {
      if (imp.startsWith('.')) {
        const resolved = resolveImportPath(imp, file, baseDir, ext, sourceFileSet);
        if (resolved && !internal.includes(resolved)) {
          internal.push(resolved);
        }
      } else {
        const pkgName = imp.startsWith('@')
          ? imp.split('/').slice(0, 2).join('/')
          : imp.split('/')[0];
        if (!external.includes(pkgName)) {
          external.push(pkgName);
        }
        // Track per top-level directory for interview guide
        const parts = rel.split(path.sep);
        const sourceDir = parts.length > 1 ? parts[0] : '.';
        if (!externalDeps.has(pkgName)) externalDeps.set(pkgName, new Set());
        externalDeps.get(pkgName).add(sourceDir);
      }
    }

    if (internal.length > 0 || external.length > 0) {
      fileDependencies.set(rel, { internal, external });
    }
  }

  return { directoryTree, sourceFiles, fileDependencies, externalDeps };
}

/**
 * Format the codebase scan as a structured interview report.
 * Shows a complete directory tree and file-level dependency map
 * so architectural patterns and violations are immediately visible.
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

  // Directory Tree
  lines.push(`${bold}Directory Tree${reset}`);
  lines.push('');

  // Collect all directory paths including intermediate parents
  const allDirPaths = new Set();
  for (const dir of scan.directoryTree.keys()) {
    if (dir === '.') continue;
    const parts = dir.split(path.sep);
    for (let i = 1; i <= parts.length; i++) {
      allDirPaths.add(parts.slice(0, i).join(path.sep));
    }
  }
  const sortedDirPaths = [...allDirPaths].sort();

  // Show root files
  if (scan.directoryTree.has('.')) {
    const count = scan.directoryTree.get('.').length;
    lines.push(`  ${dim}(root)${reset}${' '.repeat(22)}${dim}${count} file${count === 1 ? '' : 's'}${reset}`);
  }

  // Show directory tree with indentation
  for (const dir of sortedDirPaths) {
    const depth = dir.split(path.sep).length;
    const indent = '  ' + '  '.repeat(depth);
    const dirName = path.basename(dir) + '/';
    const fileCount = scan.directoryTree.has(dir) ? scan.directoryTree.get(dir).length : 0;
    if (fileCount > 0) {
      const padding = Math.max(1, 28 - indent.length - dirName.length);
      lines.push(`${indent}${cyan}${dirName}${reset}${' '.repeat(padding)}${dim}${fileCount} file${fileCount === 1 ? '' : 's'}${reset}`);
    } else {
      lines.push(`${indent}${cyan}${dirName}${reset}`);
    }
  }

  lines.push('');
  lines.push(`  ${dim}${scan.sourceFiles.length} source files total${reset}`);
  lines.push('');

  // Dependency Map — file-level
  lines.push(`${bold}Dependency Map${reset}`);
  lines.push(`${dim}File-level imports across the codebase.${reset}`);
  lines.push('');

  // Group files with dependencies by their directory
  const filesByDir = new Map();
  for (const [filePath, deps] of scan.fileDependencies) {
    const dir = path.dirname(filePath);
    const dirKey = dir === '.' ? '.' : dir;
    if (!filesByDir.has(dirKey)) filesByDir.set(dirKey, []);
    filesByDir.get(dirKey).push([filePath, deps]);
  }

  const sortedDepDirs = [...filesByDir.keys()].sort((a, b) => {
    if (a === '.') return -1;
    if (b === '.') return 1;
    return a.localeCompare(b);
  });

  let hasDeps = false;
  for (const dir of sortedDepDirs) {
    hasDeps = true;
    const files = filesByDir.get(dir).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [filePath, deps] of files) {
      lines.push(`  ${bold}${filePath}${reset}`);
      for (const imp of deps.internal) {
        lines.push(`    \u2192 ${imp}`);
      }
      for (const imp of deps.external) {
        lines.push(`    \u2192 ${dim}${imp} (external)${reset}`);
      }
      lines.push('');
    }
  }

  if (!hasDeps) {
    lines.push(`  ${dim}No dependencies found.${reset}`);
    lines.push('');
  }

  // Compute directory-level cross-dependencies from file-level data
  const dirDependencies = new Map();
  for (const [filePath, deps] of scan.fileDependencies) {
    const parts = filePath.split(path.sep);
    const sourceDir = parts.length > 1 ? parts[0] : '.';
    for (const imp of deps.internal) {
      const targetParts = imp.split(path.sep);
      const targetDir = targetParts.length > 1 ? targetParts[0] : '.';
      if (targetDir !== sourceDir) {
        if (!dirDependencies.has(sourceDir)) dirDependencies.set(sourceDir, new Set());
        dirDependencies.get(sourceDir).add(targetDir);
      }
    }
  }

  // Identify mutual dependencies (bidirectional coupling)
  const mutual = [];
  for (const [sourceDir, targets] of dirDependencies) {
    for (const targetDir of targets) {
      const reverse = dirDependencies.get(targetDir);
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

  // Islands (top-level directories with no cross-directory dependencies)
  const topLevelDirs = [...scan.directoryTree.keys()]
    .filter((d) => d !== '.' && !d.includes(path.sep));
  const islands = topLevelDirs.filter((d) => {
    const hasOutgoing = dirDependencies.has(d) && dirDependencies.get(d).size > 0;
    let hasIncoming = false;
    for (const [, targets] of dirDependencies) {
      if (targets.has(d)) { hasIncoming = true; break; }
    }
    return !hasOutgoing && !hasIncoming;
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

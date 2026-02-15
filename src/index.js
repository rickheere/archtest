const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { minimatch } = require('minimatch');
const pkg = require('../package.json');

/**
 * Parse a YAML rule file and return the config object.
 * Returns { rules, skip, scan } where skip is an optional array of directory names
 * and scan is an optional object with { extensions, importPatterns, skipDirs }.
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
  if (doc.scan && typeof doc.scan === 'object') {
    const scan = {};
    if (Array.isArray(doc.scan.extensions)) {
      scan.extensions = new Set(
        doc.scan.extensions.map((e) => (String(e).startsWith('.') ? String(e) : `.${e}`))
      );
    }
    if (Array.isArray(doc.scan['import-patterns'])) {
      scan.importPatterns = doc.scan['import-patterns'].map((p) => new RegExp(p, 'g'));
    }
    if (Array.isArray(doc.scan['skip-dirs'])) {
      scan.skipDirs = doc.scan['skip-dirs'];
    }
    if (doc.scan.aliases !== undefined) {
      if (doc.scan.aliases && typeof doc.scan.aliases === 'object' && !Array.isArray(doc.scan.aliases)) {
        scan.aliases = {};
        for (const [prefix, target] of Object.entries(doc.scan.aliases)) {
          scan.aliases[String(prefix)] = String(target);
        }
      } else {
        // Explicitly set to null/false/empty → disable aliases
        scan.aliases = null;
      }
    }
    result.scan = scan;
  }
  return result;
}

/**
 * Default path alias prefixes for JS/TS projects.
 * Maps alias prefixes to target directories (relative to baseDir).
 * Empty string means project root.
 */
const DEFAULT_ALIASES = {
  '~/': '',
  '@/': '',
  '#': '',
};

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
 * Count file extensions across all files.
 * Returns a Map of extension → count, sorted by count descending.
 */
function countExtensions(allFiles) {
  const counts = new Map();
  for (const file of allFiles) {
    const ext = path.extname(file);
    if (ext) {
      counts.set(ext, (counts.get(ext) || 0) + 1);
    }
  }
  // Sort by count descending
  return new Map([...counts.entries()].sort((a, b) => b[1] - a[1]));
}

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
 * Resolve a path-alias import (e.g. @/components/Button, ~/lib/db) to a
 * source file path relative to baseDir.
 *
 * Checks the import against a sorted list of alias prefixes (longest first).
 * If matched, strips the prefix, prepends the alias target directory, and
 * tries exact match → +extension → /index (same resolution as relative imports).
 *
 * @returns {string|null} Resolved relative path, or null if no alias matched.
 */
function resolveAliasImport(importStr, aliases, baseDir, extensions, sourceFileSet) {
  // Sort prefixes longest-first to avoid partial matches
  const prefixes = Object.keys(aliases).sort((a, b) => b.length - a.length);

  for (const prefix of prefixes) {
    if (!importStr.startsWith(prefix)) continue;

    const stripped = importStr.slice(prefix.length);
    const target = aliases[prefix];
    const rel = target ? path.join(target, stripped) : stripped;

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

    // Alias matched but can't resolve to a known source file — return mapped path
    return rel;
  }

  return null;
}

/**
 * Scan the codebase and build a complete file-level dependency map.
 * Returns { directoryTree, sourceFiles, fileDependencies }
 *
 * @param {string} baseDir - Root directory to scan
 * @param {Object} [options]
 * @param {Set<string>} [options.extensions] - File extensions to scan (required for results)
 * @param {RegExp[]} [options.importPatterns] - Regexes to extract imports, group 1 = target (default: JS/TS)
 * @param {Set<string>} [options.skipDirs] - Directory names to skip (default: node_modules, .git)
 * @param {Object|null} [options.aliases] - Path alias map { prefix: targetDir }. null disables aliases. Default: DEFAULT_ALIASES.
 */
function scanCodebase(baseDir, { extensions, importPatterns, skipDirs, aliases } = {}) {
  const ext = extensions;
  const allFiles = walkDir(baseDir, skipDirs);

  // No extensions specified — return empty scan
  if (!ext || ext.size === 0) {
    return {
      directoryTree: new Map(),
      sourceFiles: [],
      fileDependencies: new Map(),
    };
  }

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
  // Resolve effective aliases: explicit null disables, undefined uses defaults
  const effectiveAliases = aliases === null ? {} : (aliases || DEFAULT_ALIASES);
  const hasAliases = Object.keys(effectiveAliases).length > 0;

  for (const file of sourceFiles) {
    const rel = path.relative(baseDir, file);
    const imports = extractImports(file, importPatterns);
    const all = [];
    const resolved = []; // resolved relative imports for cross-directory analysis
    const rawImports = []; // raw import string → resolved path mapping

    for (const imp of imports) {
      if (imp.startsWith('.')) {
        // Relative import — resolve to actual source file path
        const resolvedPath = resolveImportPath(imp, file, baseDir, ext, sourceFileSet);
        if (resolvedPath) {
          if (!all.includes(resolvedPath)) {
            all.push(resolvedPath);
            resolved.push(resolvedPath);
          }
          if (!rawImports.some((r) => r.resolved === resolvedPath)) {
            rawImports.push({ raw: imp, resolved: resolvedPath });
          }
        }
      } else if (hasAliases) {
        // Try resolving as a path alias (e.g. @/components/Button, ~/lib/db)
        const aliasResolved = resolveAliasImport(imp, effectiveAliases, baseDir, ext, sourceFileSet);
        if (aliasResolved !== null) {
          if (!all.includes(aliasResolved)) {
            all.push(aliasResolved);
            resolved.push(aliasResolved);
          }
          if (!rawImports.some((r) => r.resolved === aliasResolved)) {
            rawImports.push({ raw: imp, resolved: aliasResolved });
          }
        } else {
          // Not an alias — treat as external, include for interview visibility
          if (!all.includes(imp)) {
            all.push(imp);
          }
          if (!rawImports.some((r) => r.raw === imp)) {
            rawImports.push({ raw: imp, resolved: imp });
          }
        }
      } else {
        // Non-relative import — include as-is for interview visibility
        if (!all.includes(imp)) {
          all.push(imp);
        }
        if (!rawImports.some((r) => r.raw === imp)) {
          rawImports.push({ raw: imp, resolved: imp });
        }
      }
    }

    if (all.length > 0) {
      fileDependencies.set(rel, { all, resolved, rawImports });
    }
  }

  return { directoryTree, sourceFiles, fileDependencies };
}

/**
 * Detect directories with suspiciously high file counts (likely build output or vendored code).
 * Returns an array of { dir, count } for directories with >= threshold source files.
 *
 * @param {Map<string, string[]>} directoryTree - Map of dir → array of filenames
 * @param {number} [threshold=50] - Minimum file count to flag a directory
 * @returns {{ dir: string, count: number }[]}
 */
function detectSuspiciousDirs(directoryTree, threshold = 50) {
  const suspicious = [];
  for (const [dir, files] of directoryTree) {
    if (dir === '.') continue;
    if (files.length >= threshold) {
      suspicious.push({ dir, count: files.length });
    }
  }
  return suspicious.sort((a, b) => b.count - a.count);
}

/**
 * Filter scan results to exclude files under the given directories.
 * Returns a new scan object with excluded dirs removed from directoryTree,
 * sourceFiles, fileDependencies, and externalDeps.
 *
 * @param {Object} scan - The scan result from scanCodebase
 * @param {string[]} excludeDirs - Array of relative directory paths to exclude
 * @param {string} baseDir - The base directory used for scanning
 * @returns {Object} Filtered scan result
 */
function filterScanResults(scan, excludeDirs, baseDir) {
  if (excludeDirs.length === 0) return scan;

  const isExcluded = (relPath) =>
    excludeDirs.some((d) => relPath === d || relPath.startsWith(d + path.sep));

  // Filter directory tree
  const directoryTree = new Map();
  for (const [dir, files] of scan.directoryTree) {
    if (dir !== '.' && isExcluded(dir)) continue;
    directoryTree.set(dir, files);
  }

  // Filter source files
  const sourceFiles = scan.sourceFiles.filter((f) => {
    const rel = path.relative(baseDir, f);
    return !isExcluded(rel);
  });

  // Filter file dependencies
  const fileDependencies = new Map();
  for (const [filePath, deps] of scan.fileDependencies) {
    if (isExcluded(filePath)) continue;
    fileDependencies.set(filePath, deps);
  }

  return { directoryTree, sourceFiles, fileDependencies };
}

/**
 * Format the codebase scan as a structured interview report.
 * Shows a complete directory tree and file-level dependency map
 * so architectural patterns and violations are immediately visible.
 *
 * @param {Object} scan - The scan result from scanCodebase
 * @param {string} baseDir - The base directory used for scanning
 * @param {Object} [options]
 * @param {{ dir: string, count: number }[]} [options.excludedDirs] - Auto-excluded directories with file counts
 */
function formatInterview(scan, baseDir, { excludedDirs } = {}) {
  const dim = '\x1b[2m';
  const bold = '\x1b[1m';
  const cyan = '\x1b[36m';
  const yellow = '\x1b[33m';
  const red = '\x1b[31m';
  const reset = '\x1b[0m';

  const lines = [];

  // Header
  lines.push('');
  lines.push(`${bold}archtest interview${reset} ${dim}\u2014 Codebase Analysis${reset}`);
  lines.push(`${dim}${'─'.repeat(50)}${reset}`);
  lines.push('');

  // Auto-exclusion warnings
  if (excludedDirs && excludedDirs.length > 0) {
    for (const { dir, count } of excludedDirs) {
      lines.push(`${yellow}Excluded: ${dir}/ (${count} files) \u2014 unusually large, likely build output${reset}`);
    }
    lines.push(`${dim}Add to skip list or use --full to include.${reset}`);
    lines.push('');
  }

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
      for (const imp of deps.all) {
        lines.push(`    \u2192 ${imp}`);
      }
      lines.push('');
    }
  }

  if (!hasDeps) {
    lines.push(`  ${dim}No dependencies found.${reset}`);
    lines.push('');
  }

  // Compute directory-level cross-dependencies from resolved relative imports
  const dirDependencies = new Map();
  for (const [filePath, deps] of scan.fileDependencies) {
    const parts = filePath.split(path.sep);
    const sourceDir = parts.length > 1 ? parts[0] : '.';
    for (const imp of deps.resolved) {
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

  // Interview guide section
  lines.push(`${dim}${'─'.repeat(50)}${reset}`);
  lines.push('');
  lines.push(`${bold}Interview Guide${reset}`);
  lines.push('');
  lines.push(`${yellow}Your job:${reset} Read the dependency map above. Look for imports that`);
  lines.push('cross directory boundaries. For each cross-boundary import, ask the');
  lines.push('developer: is this intentional, or should it be forbidden?');
  lines.push('');
  lines.push('Each confirmed violation becomes a deny rule in .archtest.yml.');
  lines.push('');

  lines.push(`${dim}${'─'.repeat(50)}${reset}`);
  lines.push('');
  lines.push(`${bold}Next Steps${reset}`);
  lines.push(`  1. Run ${cyan}archtest schema${reset} for the .archtest.yml format`);
  lines.push(`  2. Run ${cyan}archtest examples${reset} for common rule patterns`);
  lines.push(`  3. Save rules to ${cyan}.archtest.yml${reset} and run ${cyan}archtest${reset}`);
  lines.push(`  4. Save scan settings to ${cyan}.archtest.yml${reset} under ${cyan}scan:${reset} so future runs need no flags`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Determine the "parent module" directory for annotation purposes.
 * For a file in lib/jobs/, the parent module is lib/ (grandparent of the file).
 * For a file in lib/, the parent module is lib/ itself.
 * For a file at root, returns null (no annotation).
 */
function getParentModule(dirPath) {
  if (dirPath === '.') return null;
  const parts = dirPath.split(path.sep);
  if (parts.length >= 2) {
    return parts.slice(0, -1).join(path.sep);
  }
  return dirPath;
}

/**
 * Determine the annotation for an import based on whether it stays within
 * or leaves the parent module.
 *
 * Returns "(label/)" for imports within the parent module,
 * "← leaves label/" for imports outside, or null for no annotation.
 */
function getImportAnnotation(resolvedTarget, fileDir, parentModule) {
  if (!parentModule) return null;

  const targetDir = path.dirname(resolvedTarget);

  // Within parent module?
  const isInParentModule = targetDir === parentModule ||
    resolvedTarget.startsWith(parentModule + path.sep);

  const label = path.basename(parentModule);

  if (isInParentModule) {
    return `(${label}/)`;
  }
  return `\u2190 leaves ${label}/`;
}

/**
 * Format a paginated interview report, showing one directory at a time.
 * Page 1: compact directory tree overview.
 * Pages 2+: one directory per page with file imports and boundary annotations.
 *
 * @param {Object} scan - The scan result from scanCodebase
 * @param {string} baseDir - The base directory used for scanning
 * @param {number} page - 1-indexed page number
 * @param {Object} [options]
 * @param {{ dir: string, count: number }[]} [options.excludedDirs] - Auto-excluded directories
 */
function formatPaginatedInterview(scan, baseDir, page, { excludedDirs } = {}) {
  const dim = '\x1b[2m';
  const bold = '\x1b[1m';
  const cyan = '\x1b[36m';
  const yellow = '\x1b[33m';
  const reset = '\x1b[0m';

  const lines = [];

  // Build ordered list of directories (depth-first alphabetical)
  const orderedDirs = [];
  if (scan.directoryTree.has('.')) orderedDirs.push('.');
  const sortedDirs = [...scan.directoryTree.keys()].filter((d) => d !== '.').sort();
  orderedDirs.push(...sortedDirs);

  const totalPages = 1 + orderedDirs.length;

  if (page < 1 || page > totalPages) {
    return `Page ${page} is out of range. Valid pages: 1\u2013${totalPages}.`;
  }

  // Header framing
  lines.push(`${bold}\u2500\u2500 INTERVIEW (${page}/${totalPages}) \u2014 Discuss with the developer \u2500\u2500${reset}`);
  lines.push('');

  if (page === 1) {
    // PAGE 1: Directory tree overview

    // Auto-exclusion warnings
    if (excludedDirs && excludedDirs.length > 0) {
      for (const { dir, count } of excludedDirs) {
        lines.push(`${yellow}Excluded: ${dir}/ (${count} files) \u2014 unusually large, likely build output${reset}`);
      }
      lines.push(`${dim}Add to skip list or use --full to include.${reset}`);
      lines.push('');
    }

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
    const sortedTreeDirs = [...allDirPaths].sort();

    // Show root files
    if (scan.directoryTree.has('.')) {
      const count = scan.directoryTree.get('.').length;
      lines.push(`  ${dim}(root)${reset}${' '.repeat(22)}${dim}${count} file${count === 1 ? '' : 's'}${reset}`);
    }

    // Show directory tree with indentation
    for (const dir of sortedTreeDirs) {
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

  } else {
    // PAGES 2+: Directory detail
    const dirIndex = page - 2;
    const dir = orderedDirs[dirIndex];
    const files = (scan.directoryTree.get(dir) || []).slice().sort();
    const dirLabel = dir === '.' ? '(root)' : dir + '/';

    lines.push(`\ud83d\udcc1 ${bold}${dirLabel}${reset}  ${dim}(${files.length} file${files.length === 1 ? '' : 's'})${reset}`);
    lines.push('');

    // Get parent module for annotation
    const parentModule = getParentModule(dir);

    let hasOutgoingImports = false;

    for (const fileName of files) {
      const filePath = dir === '.' ? fileName : path.join(dir, fileName);
      const deps = scan.fileDependencies.get(filePath);

      if (!deps || !deps.rawImports || deps.rawImports.length === 0) {
        lines.push(`  ${dim}${fileName}${reset}`);
        continue;
      }

      // Filter to only cross-directory imports (leave the current directory)
      const outgoingImports = deps.rawImports.filter((imp) => {
        const targetDir = path.dirname(imp.resolved);
        // Same directory = internal, skip
        if (targetDir === dir) return false;
        // Subdirectory of current dir = internal, skip
        if (dir !== '.' && imp.resolved.startsWith(dir + path.sep)) return false;
        return true;
      });

      if (outgoingImports.length === 0) {
        lines.push(`  ${dim}${fileName}${reset}`);
        continue;
      }

      hasOutgoingImports = true;
      lines.push(`  ${fileName}`);

      for (const imp of outgoingImports) {
        const annotation = getImportAnnotation(imp.resolved, dir, parentModule);
        if (annotation) {
          const padding = Math.max(1, 28 - imp.raw.length);
          lines.push(`    \u2192 ${imp.raw}${' '.repeat(padding)}${annotation}`);
        } else {
          lines.push(`    \u2192 ${imp.raw}`);
        }
      }
      lines.push('');
    }

    if (!hasOutgoingImports) {
      lines.push(`  ${dim}No outgoing imports from this directory.${reset}`);
    }
  }

  lines.push('');

  // Footer framing
  if (page < totalPages) {
    const askText = page === 1
      ? 'Ask the developer about these modules.'
      : 'Ask the developer about these imports.';
    lines.push(`${bold}\u2500\u2500 ${askText} Run --page ${page + 1} to continue \u2500\u2500${reset}`);
  } else {
    lines.push(`${bold}\u2500\u2500 Interview complete. Run ${cyan}archtest schema${reset}${bold} for next steps \u2500\u2500${reset}`);
  }

  return lines.join('\n');
}

/**
 * Map file extensions to language families for multi-language detection.
 */
const LANGUAGE_FAMILIES = {
  '.js': 'js', '.jsx': 'js', '.ts': 'js', '.tsx': 'js', '.mjs': 'js', '.cjs': 'js',
  '.py': 'python', '.pyi': 'python', '.pyx': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'jvm', '.kt': 'jvm', '.kts': 'jvm', '.scala': 'jvm', '.groovy': 'jvm',
  '.clj': 'clojure', '.cljs': 'clojure', '.cljc': 'clojure',
  '.rb': 'ruby', '.erb': 'ruby',
  '.swift': 'apple', '.m': 'apple', '.mm': 'apple',
  '.c': 'c-cpp', '.cpp': 'c-cpp', '.cc': 'c-cpp', '.cxx': 'c-cpp', '.h': 'c-cpp', '.hpp': 'c-cpp',
  '.cs': 'dotnet', '.fs': 'dotnet', '.vb': 'dotnet',
  '.php': 'php',
  '.ex': 'elixir', '.exs': 'elixir',
  '.erl': 'erlang', '.hrl': 'erlang',
  '.hs': 'haskell', '.lhs': 'haskell',
  '.lua': 'lua',
  '.r': 'r', '.R': 'r',
  '.dart': 'dart',
  '.zig': 'zig',
  '.nim': 'nim',
};

/**
 * Detect distinct language families from an extension count map.
 * Returns a Set of family names found.
 */
function detectLanguageFamilies(extCounts) {
  const families = new Set();
  for (const ext of extCounts.keys()) {
    const family = LANGUAGE_FAMILIES[ext];
    if (family) families.add(family);
  }
  return families;
}

/**
 * Build a per-top-level-directory extension breakdown.
 * Returns a Map of topDir → Map<ext, count>, sorted by total file count descending.
 * Only includes directories at depth 1 (immediate children of baseDir).
 *
 * @param {string[]} allFiles - Array of absolute file paths
 * @param {string} baseDir - The base directory
 * @returns {Map<string, Map<string, number>>}
 */
function extensionsByTopDir(allFiles, baseDir) {
  const dirExts = new Map();

  for (const file of allFiles) {
    const rel = path.relative(baseDir, file);
    const parts = rel.split(path.sep);
    if (parts.length < 2) continue; // skip root-level files
    const topDir = parts[0];
    const ext = path.extname(file);
    if (!ext) continue;

    if (!dirExts.has(topDir)) dirExts.set(topDir, new Map());
    const extMap = dirExts.get(topDir);
    extMap.set(ext, (extMap.get(ext) || 0) + 1);
  }

  // Sort directories by total file count descending
  const sorted = [...dirExts.entries()].sort((a, b) => {
    const totalA = [...a[1].values()].reduce((s, n) => s + n, 0);
    const totalB = [...b[1].values()].reduce((s, n) => s + n, 0);
    return totalB - totalA;
  });

  // For each directory, sort extensions by count and keep top 2
  const result = new Map();
  for (const [dir, extMap] of sorted) {
    const topExts = [...extMap.entries()]
      .filter(([ext]) => LANGUAGE_FAMILIES[ext]) // only known language extensions
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2);
    if (topExts.length > 0) {
      result.set(dir, new Map(topExts));
    }
  }

  return result;
}

module.exports = {
  parseRuleFile, resolveGlobs, checkFile, runRules, formatResults,
  scanCodebase, formatInterview, formatPaginatedInterview,
  getParentModule, getImportAnnotation,
  detectSuspiciousDirs, filterScanResults,
  walkDir, countExtensions, detectLanguageFamilies, extensionsByTopDir,
  resolveAliasImport,
  DEFAULT_IMPORT_PATTERNS, DEFAULT_SKIP_DIRS, DEFAULT_ALIASES, LANGUAGE_FAMILIES,
};

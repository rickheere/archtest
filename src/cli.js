#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  parseRuleFile, runRules, formatResults, scanCodebase, formatInterview,
  detectSuspiciousDirs, filterScanResults, walkDir, countExtensions,
  DEFAULT_IMPORT_PATTERNS, DEFAULT_SKIP_DIRS,
} = require('./index');

const dim = '\x1b[2m';
const green = '\x1b[32m';
const yellow = '\x1b[33m';
const cyan = '\x1b[36m';
const bold = '\x1b[1m';
const reset = '\x1b[0m';

function showHelp() {
  console.log(`
${bold}archtest${reset} ${dim}\u2014 Architectural drift detection through declarative rules${reset}

${bold}Usage:${reset}
  archtest ${dim}[options]${reset}           Run rules against the codebase
  archtest ${cyan}<command>${reset}           Run a subcommand

${bold}Options:${reset}
  --config <path>    Path to rule file ${dim}(default: .archtest.yml)${reset}
  --base-dir <path>  Set root directory for scanning ${dim}(default: cwd)${reset}
  --verbose          Show all rules and per-file breakdown
  --skip <dirs>      Comma-separated directories to skip ${dim}(adds to defaults)${reset}
  --help, -h         Show this help message

${bold}Commands:${reset}
  ${cyan}schema${reset}             Show the YAML rule file schema
  ${cyan}examples${reset}           Show example rules for common patterns
  ${cyan}init${reset}               Generate a starter .archtest.yml
  ${cyan}interview${reset}          Scan codebase and generate an architectural interview

${bold}Interview Options:${reset} ${dim}(used with 'archtest interview')${reset}
  --base-dir <path>        Set root directory for scanning ${dim}(default: cwd)${reset}
  --ext <exts>             Comma-separated file extensions to scan
                           ${dim}e.g. --ext .go  or  --ext .py,.pyi${reset}
                           ${dim}Can also be set in .archtest.yml scan.extensions${reset}
  --skip-ext <exts>        Comma-separated extensions to exclude from scan
  --import-pattern <regex> Regex to extract imports ${dim}(capture group 1 = target)${reset}
                           ${dim}Can be repeated. Default: JS require/import patterns.${reset}
                           ${dim}Can also be set in .archtest.yml scan.import-patterns${reset}
  --skip <dirs>            Comma-separated directories to skip ${dim}(adds to defaults)${reset}
                           ${dim}Can also be set in .archtest.yml scan.skip-dirs${reset}
  --full                   Disable auto-exclusion of large directories

${bold}Scan Config:${reset} ${dim}Persist scan settings in .archtest.yml so they apply automatically.${reset}
  CLI flags always override config. See ${cyan}archtest schema${reset} for the format.

${bold}Import Pattern Examples:${reset} ${dim}(for non-JS/TS projects)${reset}
  ${cyan}Go:${reset}     --import-pattern '^\\s*"([^"]+)"'
  ${cyan}Python:${reset} --import-pattern 'from\\s+(\\S+)\\s+import|import\\s+(\\S+)'
  ${cyan}Rust:${reset}   --import-pattern 'use\\s+([\\w:]+)'

${yellow}AI-first architectural testing.${reset} Define boundaries in YAML, enforce
them with grep-based pattern matching. Rules are designed to be
authored by AI coding agents and reviewed by humans.

The hard part of architectural testing is writing the regex patterns
and glob expressions \u2014 that's what AI is good at. The human reviews
"does this rule say what I mean?" and the test runner executes
deterministically in CI like any other test.
`);
}

function showSchema() {
  console.log(`
${bold}YAML Rule File Schema${reset} ${dim}(.archtest.yml)${reset}
${dim}${'─'.repeat(50)}${reset}

${bold}scan:${reset}                            ${dim}# Optional. Persist interview scan settings.${reset}
  ${bold}extensions:${reset}                    ${dim}# File extensions to scan.${reset}
    - .go                        ${dim}# Same as --ext .go on CLI.${reset}
  ${bold}import-patterns:${reset}               ${dim}# Regex patterns for import extraction.${reset}
    - '^\\s*"([^"]+)"'            ${dim}# Capture group 1 = import target.${reset}
  ${bold}skip-dirs:${reset}                     ${dim}# Extra directories to skip during scanning.${reset}
    - vendor                     ${dim}# Adds to the default skip list.${reset}

${bold}skip:${reset}                            ${dim}# Optional. Array of directory names to skip.${reset}
  - .next                        ${dim}# Adds to the default skip list.${reset}
  - dist                         ${dim}# CLI --skip takes priority over this config value.${reset}
  - _generated

${bold}rules:${reset}                           ${dim}# Required. Array of rule objects.${reset}
  - ${bold}name:${reset} <string>               ${dim}# Required. Unique identifier for the rule.${reset}
    ${bold}description:${reset} <string>        ${dim}# Optional. Human-readable explanation shown${reset}
                                 ${dim}# in output. Write it for humans, not machines.${reset}

    ${bold}scope:${reset}                       ${dim}# Required. Which files to check.${reset}
      ${bold}files:${reset}                     ${dim}# Required. Array of glob patterns.${reset}
        - "**/*.ts"
        - "src/api/**/*.js"
      ${bold}exclude:${reset}                   ${dim}# Optional. Array of glob patterns to skip.${reset}
        - "**/*.test.ts"
        - "vendor/**"

    ${bold}deny:${reset}                        ${dim}# Required. Patterns that must NOT appear.${reset}
      ${bold}patterns:${reset}                  ${dim}# Required. Array of regex patterns.${reset}
        - "console\\\\.log"
        - "require\\\\(.*secret"

${bold}Glob Patterns${reset}
${dim}${'─'.repeat(50)}${reset}
  ${cyan}**/*.ts${reset}          All .ts files recursively
  ${cyan}src/*.js${reset}         .js files in src/ only ${dim}(not subdirectories)${reset}
  ${cyan}**/*.{ts,js}${reset}     All .ts and .js files
  ${cyan}api/**${reset}           Everything under api/
  ${cyan}!test/**${reset}         ${dim}(use exclude instead of negation)${reset}

${bold}Regex Patterns${reset}
${dim}${'─'.repeat(50)}${reset}
  Patterns are JavaScript RegExp ${dim}(no delimiters needed)${reset}.
  Each line of each matched file is tested independently.

  ${bold}Common techniques:${reset}
    ${cyan}(?!index)${reset}         Negative lookahead: "not followed by index"
    ${cyan}foo|bar|baz${reset}       Alternation: "any of these"
    ${cyan}console\\\\.log${reset}     Escaped dot: "literal dot"
    ${cyan}['\"]${reset}             Character class: "single or double quote"
    ${cyan}require\\\\(${reset}        Escaped parens: "literal parenthesis"
    ${cyan}(?i)pattern${reset}       Case-insensitive matching

${bold}Skipped Directories${reset}
${dim}${'─'.repeat(50)}${reset}
  Default: node_modules, .git, .next, dist, build, _generated,
           coverage, .turbo, .cache
  Add in config:      ${cyan}skip: [vendor, __pycache__]${reset}
  Or in scan config:  ${cyan}scan: { skip-dirs: [vendor, __pycache__] }${reset}
  Add on CLI:          ${cyan}--skip vendor,__pycache__${reset}
  All always merge with the defaults above.

${bold}Precedence${reset}
${dim}${'─'.repeat(50)}${reset}
  CLI flags ${dim}(highest)${reset} > .archtest.yml scan config > defaults
  CLI --ext .py overrides scan.extensions in config.
  When no flags and no config, extension guidance is shown.

${bold}Base Directory${reset}
${dim}${'─'.repeat(50)}${reset}
  Default: current working directory
  Override with: ${cyan}--base-dir src/${reset}
  Scans and groups directories relative to the specified path.

${bold}Exit Codes${reset}
${dim}${'─'.repeat(50)}${reset}
  ${green}0${reset}    All rules passed
  ${yellow}1${reset}    One or more rules failed
`);
}

function showExamples() {
  console.log(`
${bold}Example Rules${reset}
${dim}${'─'.repeat(50)}${reset}

${yellow}# Enforce module boundaries \u2014 only import through barrel files${reset}
- name: no-deep-imports-into-auth
  description: "Import auth/ only through its index, not internal files"
  scope:
    files: ["**/*.ts"]
    exclude: ["auth/**"]
  deny:
    patterns:
      - "from ['\"].*auth/(?!index)"

${yellow}# Strategy pattern \u2014 strategies don't know about each other${reset}
- name: no-cross-strategy-imports
  description: "Strategy A must not import from Strategy B"
  scope:
    files: ["strategies/a/**/*.ts"]
  deny:
    patterns:
      - "from ['\"].*strategies/b"

${yellow}# Keep infrastructure out of business logic${reset}
- name: no-db-in-domain
  description: "Domain layer must not import database modules"
  scope:
    files: ["domain/**/*.ts"]
  deny:
    patterns:
      - "from ['\"].*database"
      - "require\\\\(.*database"
      - "prisma|knex|sequelize"

${yellow}# Unidirectional data flow${reset}
- name: no-upstream-imports
  description: "Views must not import from controllers"
  scope:
    files: ["views/**/*.ts"]
  deny:
    patterns:
      - "from ['\"].*controllers"

${yellow}# Framework isolation \u2014 keep React out of business logic${reset}
- name: no-react-in-core
  description: "Core logic must not depend on React"
  scope:
    files: ["core/**/*.ts"]
  deny:
    patterns:
      - "from ['\"]react"
      - "require\\\\(['\"]react"
      - "useState|useEffect|useRef"

${yellow}# Prevent accidental secrets in code${reset}
- name: no-hardcoded-secrets
  description: "No hardcoded API keys, tokens, or passwords"
  scope:
    files: ["**/*.{ts,js}"]
    exclude: ["**/*.test.*", "**/*.spec.*"]
  deny:
    patterns:
      - "(api_key|apikey|secret_key|password)\\\\s*[=:]\\\\s*['\"][^'\\\"]{8,}"

${bold}Scan Config Examples${reset} ${dim}(persist in .archtest.yml)${reset}
${dim}${'─'.repeat(50)}${reset}
Once you find the right flags, save them so future runs just work:

  ${cyan}Go:${reset}
    scan:
      extensions: [.go]
      import-patterns: ['^\\s*"([^"]+)"']

  ${cyan}Python:${reset}
    scan:
      extensions: [.py, .pyi]
      import-patterns:
        - 'from\\s+(\\S+)\\s+import'
        - 'import\\s+(\\S+)'
      skip-dirs: [__pycache__, venv, .venv]

  ${cyan}Rust:${reset}
    scan:
      extensions: [.rs]
      import-patterns: ['use\\s+([\\w:]+)']
      skip-dirs: [target]

  ${cyan}Java:${reset}
    scan:
      extensions: [.java]
      import-patterns: ['import\\s+([\\w.]+)']
      skip-dirs: [build, .gradle]

  ${cyan}JS/TS:${reset} ${dim}(default — no scan config needed)${reset}
    scan:
      extensions: [.ts, .tsx, .js, .jsx]

  ${cyan}Clojure:${reset}
    scan:
      extensions: [.clj, .cljs, .cljc]
      import-patterns: [':require\\s+\\[([^\\s\\]]+)']
      skip-dirs: [target, .cpcache]

${bold}Multi-Language Interview${reset} ${dim}(CLI flags — same settings, one-off)${reset}
${dim}${'─'.repeat(50)}${reset}

  ${cyan}Go:${reset}
    archtest interview --ext .go --import-pattern '^\\s*"([^"]+)"'

  ${cyan}Python:${reset}
    archtest interview --ext .py,.pyi \\
      --import-pattern 'from\\s+(\\S+)\\s+import' \\
      --import-pattern 'import\\s+(\\S+)'

  ${cyan}Rust:${reset}
    archtest interview --ext .rs --import-pattern 'use\\s+([\\w:]+)'

  ${cyan}Java:${reset}
    archtest interview --ext .java --import-pattern 'import\\s+([\\w.]+)'
`);
}

function runInit() {
  const targetPath = path.join(process.cwd(), '.archtest.yml');
  if (fs.existsSync(targetPath)) {
    console.error(`${yellow}.archtest.yml already exists.${reset} Edit it directly or delete it first.`);
    process.exit(1);
  }

  const template = `# Scan settings for 'archtest interview'. Persist so future runs just work.
# CLI flags (--ext, --import-pattern, --skip) always override these.
# scan:
#   extensions: [.ts, .tsx, .js, .jsx]
#   import-patterns: ['^\\s*"([^"]+)"']
#   skip-dirs: [vendor]

# Extra directories to skip during scanning (adds to defaults).
# Default: node_modules, .git, .next, dist, build, _generated, coverage, .turbo, .cache
# Uncomment to add more:
# skip:
#   - vendor
#   - __pycache__

rules:
  # Example: prevent deep imports into a module
  # Outsiders should only import through the barrel (index) file.
  #
  # - name: no-deep-imports-into-auth
  #   description: "Import auth/ only through its index, not internal files"
  #   scope:
  #     files: ["**/*.ts", "**/*.js"]
  #     exclude: ["auth/**", "**/*.test.*"]
  #   deny:
  #     patterns:
  #       - "from ['\\\"].*auth/(?!index)"
  #       - "require\\\\(.*auth/(?!index)"
  #
  # Run 'archtest schema' to see the full YAML schema.
  # Run 'archtest examples' for more rule patterns.
  #
  # Tip: describe what you want to enforce in plain English
  # and let your AI coding agent write the rule for you.

  - name: my-first-rule
    description: "Describe what this rule enforces"
    scope:
      files: ["**/*.ts"]
      exclude: ["**/*.test.ts"]
    deny:
      patterns:
        - "pattern-that-should-not-appear"
`;

  fs.writeFileSync(targetPath, template);
  console.log(`${green}\u2713${reset}  Created ${bold}.archtest.yml${reset}`);
  console.log(`${dim}   Edit the file to add your architectural rules.${reset}`);
  console.log(`${dim}   Run 'archtest schema' for the full schema reference.${reset}`);
  console.log(`${dim}   Run 'archtest examples' for common rule patterns.${reset}`);
}

/**
 * Parse shared flags from args array.
 * Returns { skipDirs, skipFromCli, extensions, skipExtensions, importPatterns, remaining }
 */
function parseFlags(args) {
  let skipDirs = null;
  let extensions = null;
  let skipExtensions = null;
  let baseDir = null;
  let full = false;
  const importPatterns = [];
  const remaining = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--skip' && args[i + 1]) {
      skipDirs = new Set([...DEFAULT_SKIP_DIRS, ...args[i + 1].split(',').map((s) => s.trim())]);
      i++;
    } else if (args[i] === '--ext' && args[i + 1]) {
      extensions = new Set(args[i + 1].split(',').map((s) => s.trim().startsWith('.') ? s.trim() : `.${s.trim()}`));
      i++;
    } else if (args[i] === '--skip-ext' && args[i + 1]) {
      skipExtensions = new Set(args[i + 1].split(',').map((s) => s.trim().startsWith('.') ? s.trim() : `.${s.trim()}`));
      i++;
    } else if (args[i] === '--import-pattern' && args[i + 1]) {
      importPatterns.push(new RegExp(args[i + 1], 'g'));
      i++;
    } else if (args[i] === '--base-dir' && args[i + 1]) {
      baseDir = path.resolve(args[i + 1]);
      i++;
    } else if (args[i] === '--full') {
      full = true;
    } else {
      remaining.push(args[i]);
    }
  }

  return {
    skipDirs: skipDirs || DEFAULT_SKIP_DIRS,
    skipFromCli: skipDirs !== null,
    extensions,
    skipExtensions,
    importPatterns: importPatterns.length > 0 ? importPatterns : DEFAULT_IMPORT_PATTERNS,
    importPatternsFromCli: importPatterns.length > 0,
    baseDir,
    full,
    remaining,
  };
}

/**
 * Load scan config from .archtest.yml if it exists.
 * Returns { scan, skip } or null if no config file.
 */
function loadScanConfig(baseDir) {
  const configPath = path.join(baseDir, '.archtest.yml');
  if (!fs.existsSync(configPath)) return null;
  try {
    const config = parseRuleFile(configPath);
    return config;
  } catch {
    return null;
  }
}

function runInterview(flags) {
  const baseDir = flags.baseDir || process.cwd();

  // Load scan config from .archtest.yml
  const config = loadScanConfig(baseDir);
  const scanConfig = config && config.scan ? config.scan : null;

  // Determine effective extensions: CLI > config > none
  const extFromCli = flags.extensions;
  const extFromConfig = scanConfig && scanConfig.extensions ? scanConfig.extensions : null;
  let effectiveExtensions = extFromCli || extFromConfig || null;
  const extSource = extFromCli ? 'cli' : (extFromConfig ? 'config' : null);

  // Apply --skip-ext filter if provided
  if (effectiveExtensions && flags.skipExtensions) {
    effectiveExtensions = new Set(
      [...effectiveExtensions].filter((e) => !flags.skipExtensions.has(e))
    );
  }

  // Determine effective import patterns: CLI > config > defaults
  const importPatternsFromCli = flags.importPatternsFromCli;
  let effectiveImportPatterns = flags.importPatterns;
  if (!importPatternsFromCli && scanConfig && scanConfig.importPatterns) {
    effectiveImportPatterns = scanConfig.importPatterns;
  }

  // Determine effective skip dirs: CLI > config scan.skip-dirs > config top-level skip > defaults
  let effectiveSkipDirs = flags.skipDirs;
  if (!flags.skipFromCli) {
    if (scanConfig && scanConfig.skipDirs) {
      effectiveSkipDirs = new Set([...DEFAULT_SKIP_DIRS, ...scanConfig.skipDirs]);
    } else if (config && config.skip) {
      effectiveSkipDirs = new Set([...DEFAULT_SKIP_DIRS, ...config.skip]);
    }
  }

  // Walk all files to count extensions (cheap — one directory walk)
  const allFiles = walkDir(baseDir, effectiveSkipDirs);
  const extCounts = countExtensions(allFiles);

  // Display extension summary based on context
  if (extSource === 'cli') {
    // CLI flags provided — just show what we're scanning, skip full list
    if (effectiveExtensions.size > 0) {
      console.log(`${dim}Scanning: ${[...effectiveExtensions].join(', ')}${reset}`);
    }
  } else if (extSource === 'config') {
    // Config provided — show extensions found as reality check + what config says
    if (extCounts.size > 0) {
      const filtered = [...extCounts.entries()].filter(([, count]) => count >= 2);
      const top = filtered.slice(0, 15);
      const remaining = filtered.length - top.length;
      const summary = top.map(([ext, count]) => `${ext} (${count})`).join(', ');
      console.log(`${dim}Extensions found: ${summary}${remaining > 0 ? `, ...and ${remaining} more` : ''}${reset}`);
    }
    if (effectiveExtensions.size > 0) {
      console.log(`${dim}Scanning (from .archtest.yml): ${[...effectiveExtensions].join(', ')}${reset}`);
    }
  } else {
    // No config, no flags — show filtered/capped extension list + guidance
    if (extCounts.size > 0) {
      const filtered = [...extCounts.entries()].filter(([, count]) => count >= 2);
      const top = filtered.slice(0, 15);
      const remaining = filtered.length - top.length;
      if (top.length > 0) {
        const summary = top.map(([ext, count]) => `${ext} (${count})`).join(', ');
        console.log(`${dim}Extensions found: ${summary}${remaining > 0 ? `, ...and ${remaining} more` : ''}${reset}`);
      } else {
        console.log(`${dim}No files found in ${baseDir}${reset}`);
      }
    } else {
      console.log(`${dim}No files found in ${baseDir}${reset}`);
    }

    console.log('');
    const topExt = extCounts.size > 0 ? [...extCounts.keys()][0] : '.js';
    console.log(`${yellow}No extensions selected.${reset} Use ${cyan}--ext ${topExt}${reset} to scan ${topExt.slice(1).toUpperCase() || 'those'} files.`);
    console.log('');
    return;
  }

  let scan = scanCodebase(baseDir, {
    extensions: effectiveExtensions,
    importPatterns: effectiveImportPatterns,
    skipDirs: effectiveSkipDirs,
  });

  let excludedDirs = [];
  if (!flags.full) {
    const suspicious = detectSuspiciousDirs(scan.directoryTree);
    if (suspicious.length > 0) {
      excludedDirs = suspicious;
      scan = filterScanResults(scan, suspicious.map((s) => s.dir), baseDir);
    }
  }

  // Warn when scanned files < 10% of total source-like files
  const totalSourceFiles = allFiles.length;
  if (totalSourceFiles > 0 && scan.sourceFiles.length < totalSourceFiles * 0.1) {
    console.log(`${yellow}Only scanning ${scan.sourceFiles.length} of ${totalSourceFiles} files. Use --ext to include other extensions.${reset}`);
  }

  console.log('');
  const output = formatInterview(scan, baseDir, { excludedDirs });
  console.log(output);
}

function main() {
  const args = process.argv.slice(2);
  const flags = parseFlags(args);
  const rest = flags.remaining;

  // Handle subcommands first
  if (rest[0] === 'schema') return showSchema();
  if (rest[0] === 'examples') return showExamples();
  if (rest[0] === 'init') return runInit();
  if (rest[0] === 'interview') return runInterview(flags);

  let configPath = path.join(process.cwd(), '.archtest.yml');
  let verbose = false;

  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--config' && rest[i + 1]) {
      configPath = path.resolve(rest[i + 1]);
      i++;
    } else if (rest[i] === '--verbose') {
      verbose = true;
    } else if (rest[i] === '--help' || rest[i] === '-h') {
      showHelp();
      process.exit(0);
    }
  }

  let config;
  try {
    config = parseRuleFile(configPath);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  // Priority: CLI --skip > config skip > DEFAULT_SKIP_DIRS
  let skipDirs = flags.skipDirs;
  if (!flags.skipFromCli && config.skip) {
    skipDirs = new Set([...DEFAULT_SKIP_DIRS, ...config.skip]);
  }

  const baseDir = flags.baseDir || process.cwd();
  const results = runRules(config.rules, baseDir, { skipDirs });
  const output = formatResults(results, { verbose, baseDir });

  console.log(output);

  const hasFailed = results.some((r) => !r.passed);
  process.exit(hasFailed ? 1 : 0);
}

main();

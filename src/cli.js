#!/usr/bin/env node

const path = require('path');
const { parseRuleFile, runRules, formatResults } = require('./index');

function main() {
  const args = process.argv.slice(2);
  let configPath = path.join(process.cwd(), '.archtest.yml');
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' && args[i + 1]) {
      configPath = path.resolve(args[i + 1]);
      i++;
    } else if (args[i] === '--verbose') {
      verbose = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log('Usage: archtest [options]');
      console.log('');
      console.log('Options:');
      console.log('  --config <path>  Path to rule file (default: .archtest.yml)');
      console.log('  --verbose        Show passing rules too');
      console.log('  --help, -h       Show this help message');
      process.exit(0);
    }
  }

  let rules;
  try {
    rules = parseRuleFile(configPath);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  const baseDir = process.cwd();
  const results = runRules(rules, baseDir);
  const output = formatResults(results, { verbose, baseDir });

  console.log(output);

  const hasFailed = results.some((r) => !r.passed);
  process.exit(hasFailed ? 1 : 0);
}

main();

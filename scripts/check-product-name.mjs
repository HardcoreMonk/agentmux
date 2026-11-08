import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  findProductNameViolations,
  isProductNameScanTarget,
} from './check-product-name-lib.mjs';

const rootDir = process.cwd();

const listTrackedScanTargets = (cwd = rootDir) => {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd,
    encoding: 'utf8',
  });

  return output
    .split('\0')
    .filter((filePath) => filePath.length > 0 && isProductNameScanTarget(filePath));
};

const files = listTrackedScanTargets(rootDir)
  .filter((relativePath) => fs.existsSync(path.join(rootDir, relativePath)))
  .map((relativePath) => ({
    path: relativePath,
    content: fs.readFileSync(path.join(rootDir, relativePath), 'utf8'),
  }));

const violations = findProductNameViolations(files);

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(`${violation.path}:${violation.line}: ${violation.text}`);
  }
  process.exit(1);
}

console.log(`Product name check passed (${files.length} files scanned).`);

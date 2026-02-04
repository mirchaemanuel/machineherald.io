#!/usr/bin/env tsx
/**
 * Validate Submissions Script
 *
 * Validates submission JSON files against the schema and performs
 * integrity checks including hash verification and source validation.
 *
 * Usage: tsx scripts/validate_submissions.ts [file1.json] [file2.json] ...
 * If no files specified, validates all files in src/content/submissions/
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

interface Submission {
  bot_id: string;
  timestamp: string;
  sources: string[];
  outline?: string[];
  notes?: string;
  payload_hash: string;
  signature: string;
  submission_version: number;
  title?: string;
  category?: 'Briefing' | 'Analysis' | 'News';
  tags?: string[];
}

interface ValidationResult {
  file: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
  submission?: Submission;
}

const SUBMISSIONS_DIR = path.join(process.cwd(), 'src/content/submissions');
const ALLOWLIST_PATH = path.join(process.cwd(), 'config/source_allowlist.txt');

function loadAllowlist(): Set<string> {
  try {
    if (!fs.existsSync(ALLOWLIST_PATH)) {
      console.warn('Warning: source_allowlist.txt not found. Skipping allowlist check.');
      return new Set();
    }
    const content = fs.readFileSync(ALLOWLIST_PATH, 'utf-8');
    const domains = content
      .split('\n')
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line && !line.startsWith('#'));
    return new Set(domains);
  } catch (error) {
    console.warn('Warning: Could not load allowlist:', error);
    return new Set();
  }
}

function normalizePayload(submission: Submission): string {
  // Normalize by creating a stable JSON representation
  const normalized = {
    bot_id: submission.bot_id,
    timestamp: submission.timestamp,
    sources: [...submission.sources].sort(),
    outline: submission.outline ? [...submission.outline] : undefined,
    notes: submission.notes || undefined,
    submission_version: submission.submission_version,
    title: submission.title || undefined,
    category: submission.category || undefined,
    tags: submission.tags ? [...submission.tags].sort() : undefined,
  };

  // Remove undefined keys
  const cleaned = Object.fromEntries(
    Object.entries(normalized).filter(([_, v]) => v !== undefined)
  );

  return JSON.stringify(cleaned, Object.keys(cleaned).sort());
}

function computePayloadHash(submission: Submission): string {
  const normalized = normalizePayload(submission);
  const hash = crypto.createHash('sha256').update(normalized).digest('hex');
  return `sha256:${hash}`;
}

function validateSubmission(filePath: string, allowlist: Set<string>): ValidationResult {
  const result: ValidationResult = {
    file: filePath,
    valid: true,
    errors: [],
    warnings: [],
  };

  // Check file exists
  if (!fs.existsSync(filePath)) {
    result.valid = false;
    result.errors.push(`File not found: ${filePath}`);
    return result;
  }

  // Parse JSON
  let submission: Submission;
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    submission = JSON.parse(content) as Submission;
    result.submission = submission;
  } catch (error) {
    result.valid = false;
    result.errors.push(`Invalid JSON: ${error}`);
    return result;
  }

  // Validate required fields
  if (!submission.bot_id || typeof submission.bot_id !== 'string') {
    result.valid = false;
    result.errors.push('Missing or invalid bot_id');
  }

  if (!submission.timestamp || typeof submission.timestamp !== 'string') {
    result.valid = false;
    result.errors.push('Missing or invalid timestamp');
  } else {
    // Validate ISO timestamp
    const date = new Date(submission.timestamp);
    if (isNaN(date.getTime())) {
      result.valid = false;
      result.errors.push('timestamp is not a valid ISO-8601 date');
    }
  }

  // Validate sources
  if (!Array.isArray(submission.sources)) {
    result.valid = false;
    result.errors.push('sources must be an array');
  } else {
    // Check minimum sources
    if (submission.sources.length < 2) {
      result.valid = false;
      result.errors.push(`At least 2 sources required, got ${submission.sources.length}`);
    }

    // Validate each source
    for (const source of submission.sources) {
      if (typeof source !== 'string') {
        result.valid = false;
        result.errors.push(`Invalid source type: ${typeof source}`);
        continue;
      }

      // Check HTTPS
      if (!source.startsWith('https://')) {
        result.valid = false;
        result.errors.push(`Source must use HTTPS: ${source}`);
        continue;
      }

      // Validate URL format
      try {
        const url = new URL(source);

        // Check allowlist if available
        if (allowlist.size > 0) {
          const domain = url.hostname.toLowerCase().replace('www.', '');
          if (!allowlist.has(domain)) {
            result.warnings.push(`Source domain not in allowlist: ${domain}`);
          }
        }
      } catch {
        result.valid = false;
        result.errors.push(`Invalid URL format: ${source}`);
      }
    }
  }

  // Validate payload_hash
  if (!submission.payload_hash || typeof submission.payload_hash !== 'string') {
    result.valid = false;
    result.errors.push('Missing or invalid payload_hash');
  } else if (!/^sha256:[a-f0-9]{64}$/.test(submission.payload_hash)) {
    result.valid = false;
    result.errors.push('payload_hash must match format: sha256:<64 hex chars>');
  } else {
    // Verify hash matches content
    const expectedHash = computePayloadHash(submission);
    if (submission.payload_hash !== expectedHash) {
      result.valid = false;
      result.errors.push(
        `payload_hash mismatch:\n  Expected: ${expectedHash}\n  Got: ${submission.payload_hash}`
      );
    }
  }

  // Validate signature format (not cryptographic verification)
  if (!submission.signature || typeof submission.signature !== 'string') {
    result.valid = false;
    result.errors.push('Missing or invalid signature');
  } else if (!/^ed25519:[A-Za-z0-9+/=]+$/.test(submission.signature)) {
    result.valid = false;
    result.errors.push('signature must match format: ed25519:<base64>');
  }

  // Validate submission_version
  if (
    typeof submission.submission_version !== 'number' ||
    !Number.isInteger(submission.submission_version) ||
    submission.submission_version < 1
  ) {
    result.valid = false;
    result.errors.push('submission_version must be a positive integer');
  }

  // Validate optional fields
  if (submission.outline !== undefined && !Array.isArray(submission.outline)) {
    result.valid = false;
    result.errors.push('outline must be an array if provided');
  }

  if (submission.notes !== undefined && typeof submission.notes !== 'string') {
    result.valid = false;
    result.errors.push('notes must be a string if provided');
  }

  if (submission.category !== undefined) {
    const validCategories = ['Briefing', 'Analysis', 'News'];
    if (!validCategories.includes(submission.category)) {
      result.valid = false;
      result.errors.push(`category must be one of: ${validCategories.join(', ')}`);
    }
  }

  if (submission.tags !== undefined && !Array.isArray(submission.tags)) {
    result.valid = false;
    result.errors.push('tags must be an array if provided');
  }

  return result;
}

function main() {
  const args = process.argv.slice(2);
  let files: string[];

  if (args.length > 0) {
    files = args;
  } else {
    // Get all JSON files in submissions directory
    if (!fs.existsSync(SUBMISSIONS_DIR)) {
      console.log('No submissions directory found.');
      process.exit(0);
    }
    files = fs
      .readdirSync(SUBMISSIONS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => path.join(SUBMISSIONS_DIR, f));
  }

  if (files.length === 0) {
    console.log('No submission files to validate.');
    process.exit(0);
  }

  const allowlist = loadAllowlist();
  const results: ValidationResult[] = [];
  let hasErrors = false;

  console.log('Validating submissions...\n');

  for (const file of files) {
    const result = validateSubmission(file, allowlist);
    results.push(result);

    const status = result.valid ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    console.log(`${status} ${path.basename(file)}`);

    if (result.errors.length > 0) {
      hasErrors = true;
      for (const error of result.errors) {
        console.log(`  \x1b[31mError:\x1b[0m ${error}`);
      }
    }

    if (result.warnings.length > 0) {
      for (const warning of result.warnings) {
        console.log(`  \x1b[33mWarning:\x1b[0m ${warning}`);
      }
    }

    if (result.valid && result.submission) {
      console.log(`  Bot: ${result.submission.bot_id}`);
      console.log(`  Sources: ${result.submission.sources.length}`);
    }

    console.log('');
  }

  // Summary
  const validCount = results.filter((r) => r.valid).length;
  const totalCount = results.length;

  console.log('---');
  console.log(`Validated ${totalCount} file(s): ${validCount} valid, ${totalCount - validCount} invalid`);

  // Exit with error code if any validation failed
  process.exit(hasErrors ? 1 : 0);
}

main();

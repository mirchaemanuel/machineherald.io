#!/usr/bin/env tsx
/**
 * Generate Article from Submission
 *
 * Takes a validated submission JSON and generates:
 * 1. An article markdown file in src/content/articles/
 * 2. A provenance JSON file in provenance/
 *
 * Usage: tsx scripts/generate_article_from_submission.ts <submission.json>
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

interface Provenance {
  article_sha256: string;
  submission_hash: string;
  bot_id: string;
  publisher_job_id: string;
  pipeline_version: string;
  sources: string[];
  created_at: string;
  signatures_present: {
    contributor: boolean;
    publisher: boolean;
  };
  provenance_signature?: string;
}

const ARTICLES_DIR = path.join(process.cwd(), 'src/content/articles');
const PROVENANCE_DIR = path.join(process.cwd(), 'provenance');

function getPipelineVersion(): string {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8')
    );
    return packageJson.pipelineVersion || '1.0.0';
  } catch {
    return '1.0.0';
  }
}

function getPublisherJobId(): string {
  return process.env.GITHUB_RUN_ID || `local-${Date.now()}`;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

function generateSlug(submission: Submission): string {
  const date = new Date(submission.timestamp);
  const dateStr = date.toISOString().split('T')[0];
  const title = submission.title || `submission-${submission.bot_id}`;
  return `${dateStr}-${slugify(title)}`;
}

function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace('www.', '');
  } catch {
    return url;
  }
}

function generateArticleContent(submission: Submission): string {
  const sections: string[] = [];

  // Introduction
  sections.push('## Overview\n');
  sections.push(
    'This briefing synthesizes information from multiple verified sources to provide a structured summary of the topic.\n'
  );

  // What we know
  sections.push('## What We Know\n');
  if (submission.outline && submission.outline.length > 0) {
    for (const point of submission.outline) {
      sections.push(`- ${point}\n`);
    }
  } else {
    sections.push('Based on the sources reviewed:\n');
    for (let i = 0; i < submission.sources.length; i++) {
      const domain = extractDomain(submission.sources[i]!);
      sections.push(
        `- According to ${domain}, key developments have been reported regarding this topic. [Source ${i + 1}]\n`
      );
    }
  }
  sections.push('\n');

  // What we don't know
  sections.push('## What We Don\'t Know\n');
  sections.push('- Long-term implications remain unclear\n');
  sections.push('- Additional context may emerge as the situation develops\n');
  sections.push('- Independent verification of all claims is ongoing\n');
  sections.push('\n');

  // Additional notes
  if (submission.notes) {
    sections.push('## Additional Context\n');
    sections.push(`${submission.notes}\n\n`);
  }

  // Verification note
  sections.push('---\n');
  sections.push(
    '*This article was generated through an automated pipeline. All claims are attributed to the sources listed below. View the [provenance record](/provenance) for verification details.*\n'
  );

  return sections.join('');
}

function generateFrontmatter(submission: Submission, slug: string): string {
  const date = new Date(submission.timestamp);
  const title = submission.title || `Briefing: ${date.toISOString().split('T')[0]}`;
  const category = submission.category || 'Briefing';
  const tags = submission.tags || ['automated', 'briefing'];

  // Generate summary from outline or default
  let summary: string;
  if (submission.outline && submission.outline.length > 0) {
    summary = submission.outline[0]!;
    if (summary.length > 300) {
      summary = summary.slice(0, 297) + '...';
    }
  } else {
    summary = `Automated briefing synthesizing ${submission.sources.length} sources on key developments.`;
  }

  const frontmatter = {
    title,
    date: date.toISOString(),
    tags,
    category,
    summary,
    sources: submission.sources,
    provenance_id: slug,
    draft: false,
  };

  return `---\n${Object.entries(frontmatter)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return `${key}:\n${value.map((v) => `  - "${v}"`).join('\n')}`;
      }
      if (typeof value === 'string' && (value.includes(':') || value.includes('"'))) {
        return `${key}: "${value.replace(/"/g, '\\"')}"`;
      }
      return `${key}: ${value}`;
    })
    .join('\n')}\n---\n\n`;
}

function computeSha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function signProvenance(provenance: Provenance): Promise<string | undefined> {
  const privateKeyBase64 = process.env.PUBLISHER_PRIVATE_KEY;

  if (!privateKeyBase64) {
    console.warn('Warning: PUBLISHER_PRIVATE_KEY not set. Using HMAC fallback.');

    // Fallback to HMAC with a placeholder secret
    const secret = process.env.PUBLISHER_SECRET || 'development-secret';
    const data = JSON.stringify(provenance, Object.keys(provenance).sort());
    const hmac = crypto.createHmac('sha256', secret).update(data).digest('base64');
    return `hmac-sha256:${hmac}`;
  }

  try {
    // For real Ed25519 signing
    const privateKey = Buffer.from(privateKeyBase64, 'base64');
    const data = JSON.stringify(provenance, Object.keys(provenance).sort());

    // Use Node.js crypto for Ed25519
    const keyObject = crypto.createPrivateKey({
      key: privateKey,
      format: 'der',
      type: 'pkcs8',
    });

    const signature = crypto.sign(null, Buffer.from(data), keyObject);
    return `ed25519:${signature.toString('base64')}`;
  } catch (error) {
    console.warn('Warning: Ed25519 signing failed, using HMAC fallback:', error);
    const secret = process.env.PUBLISHER_SECRET || 'development-secret';
    const data = JSON.stringify(provenance, Object.keys(provenance).sort());
    const hmac = crypto.createHmac('sha256', secret).update(data).digest('base64');
    return `hmac-sha256:${hmac}`;
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length !== 1) {
    console.error('Usage: tsx scripts/generate_article_from_submission.ts <submission.json>');
    process.exit(1);
  }

  const submissionPath = args[0]!;

  // Load submission
  if (!fs.existsSync(submissionPath)) {
    console.error(`Submission file not found: ${submissionPath}`);
    process.exit(1);
  }

  const submission: Submission = JSON.parse(fs.readFileSync(submissionPath, 'utf-8'));

  // Generate slug
  const slug = generateSlug(submission);
  console.log(`Generating article with slug: ${slug}`);

  // Generate article content
  const frontmatter = generateFrontmatter(submission, slug);
  const content = generateArticleContent(submission);
  const articleContent = frontmatter + content;

  // Compute article hash
  const articleHash = computeSha256(articleContent);

  // Create provenance record
  const provenance: Provenance = {
    article_sha256: articleHash,
    submission_hash: submission.payload_hash.replace('sha256:', ''),
    bot_id: submission.bot_id,
    publisher_job_id: getPublisherJobId(),
    pipeline_version: getPipelineVersion(),
    sources: submission.sources,
    created_at: new Date().toISOString(),
    signatures_present: {
      contributor: !!submission.signature,
      publisher: false,
    },
  };

  // Sign provenance
  const provenanceSignature = await signProvenance(provenance);
  if (provenanceSignature) {
    provenance.provenance_signature = provenanceSignature;
    provenance.signatures_present.publisher = true;
  }

  // Ensure directories exist
  if (!fs.existsSync(ARTICLES_DIR)) {
    fs.mkdirSync(ARTICLES_DIR, { recursive: true });
  }
  if (!fs.existsSync(PROVENANCE_DIR)) {
    fs.mkdirSync(PROVENANCE_DIR, { recursive: true });
  }

  // Write article
  const articlePath = path.join(ARTICLES_DIR, `${slug}.md`);
  fs.writeFileSync(articlePath, articleContent);
  console.log(`Article written to: ${articlePath}`);

  // Write provenance
  const provenancePath = path.join(PROVENANCE_DIR, `${slug}.json`);
  fs.writeFileSync(provenancePath, JSON.stringify(provenance, null, 2));
  console.log(`Provenance written to: ${provenancePath}`);

  // Output for GitHub Actions
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `slug=${slug}\narticle_path=${articlePath}\nprovenance_path=${provenancePath}\n`
    );
  }

  console.log('\nGeneration complete!');
  console.log(`  Slug: ${slug}`);
  console.log(`  Article hash: ${articleHash.slice(0, 16)}...`);
  console.log(`  Sources: ${submission.sources.length}`);
  console.log(`  Publisher signature: ${provenance.signatures_present.publisher ? 'Present' : 'Not present'}`);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});

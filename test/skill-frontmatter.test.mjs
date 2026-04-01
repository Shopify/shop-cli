import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const skillPath = resolve(__dirname, '..', 'SKILL.md');
const content = readFileSync(skillPath, 'utf8');

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fm = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w+):\s*"?([^"]*)"?\s*$/);
    if (m) fm[m[1]] = m[2];
  }
  return fm;
}

const fm = parseFrontmatter(content);

describe('SKILL.md frontmatter', () => {
  it('has valid YAML frontmatter', () => {
    assert.ok(fm, 'SKILL.md must have YAML frontmatter delimited by ---');
  });

  describe('name', () => {
    it('is present and non-empty', () => {
      assert.ok(fm.name, 'name must be non-empty');
    });

    it('is at most 64 characters', () => {
      assert.ok(fm.name.length <= 64, `name is ${fm.name.length} chars, max 64`);
    });

    it('contains only lowercase letters, numbers, and hyphens', () => {
      assert.match(fm.name, /^[a-z0-9-]+$/, `name "${fm.name}" has invalid characters`);
    });

    it('does not contain XML tags', () => {
      assert.doesNotMatch(fm.name, /<[^>]+>/, 'name must not contain XML tags');
    });

    it('does not contain reserved words', () => {
      assert.ok(!fm.name.includes('anthropic'), 'name must not contain "anthropic"');
      assert.ok(!fm.name.includes('claude'), 'name must not contain "claude"');
    });
  });

  describe('description', () => {
    it('is present and non-empty', () => {
      assert.ok(fm.description, 'description must be non-empty');
    });

    it('is at most 1024 characters', () => {
      assert.ok(
        fm.description.length <= 1024,
        `description is ${fm.description.length} chars, max 1024`,
      );
    });

    it('does not contain XML tags', () => {
      assert.doesNotMatch(fm.description, /<[^>]+>/, 'description must not contain XML tags');
    });
  });
});

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { COPY } from './src/content/copy';

// "0.4.0+abc1234": package version plus the commit (Netlify's COMMIT_REF, else git), shown in the ⚙️ menu.
function buildVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
  let sha = process.env.COMMIT_REF?.slice(0, 7) ?? '';
  if (!sha) {
    try {
      sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      sha = 'local';
    }
  }
  return `${pkg.version}+${sha}`;
}

// Fills `{{group.key}}` in index.html from the game copy (src/content/copy.ts).
function copyInHtml(): Plugin {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return {
    name: 'copy-in-html',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) =>
        html.replace(/\{\{(\w+)\.(\w+)\}\}/g, (match, group: string, key: string) => {
          const entry = (COPY as unknown as Record<string, Record<string, { text: string } | undefined> | undefined>)[group]?.[key];
          if (!entry) throw new Error(`index.html: no copy for ${match}`);
          return escape(entry.text);
        }),
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [copyInHtml()],
  define: { __BUILD__: JSON.stringify(buildVersion()) },
  build: {
    chunkSizeWarningLimit: 2000,
  },
  test: {
    // `npm run sweep` adds the tuning sweep in tools/ (slow; not part of `npm test`).
    include: process.env.SWEEP ? ['tools/**/*.test.ts'] : ['tests/**/*.test.ts'],
  },
} as any);

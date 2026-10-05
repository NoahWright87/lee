import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

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

export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(buildVersion()) },
  build: {
    chunkSizeWarningLimit: 2000,
  },
  test: {
    // `npm run sweep` adds the tuning sweep in tools/ (slow; not part of `npm test`).
    include: process.env.SWEEP ? ['tools/**/*.test.ts'] : ['tests/**/*.test.ts'],
  },
} as any);

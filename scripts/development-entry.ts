import { resolve } from 'node:path';

/** Select before route discovery and RSC client-reference scanning. */
export function developmentEntry(
  root: string,
  command: 'serve' | 'build',
  pageExtensions: readonly string[] = ['tsx', 'ts', 'jsx', 'js'],
) {
  return {
    alias: {
      '@controlla/app-entry': resolve(
        root,
        command === 'serve'
          ? 'src/client/devtools/DevelopmentApp.tsx'
          : 'src/client/shell/App.tsx',
      ),
    },
    pageExtensions: [
      ...pageExtensions.filter((extension) => extension !== 'dev.tsx'),
      ...(command === 'serve' ? ['dev.tsx'] : []),
    ],
  };
}

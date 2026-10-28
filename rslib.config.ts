// Bundles the action into dist/, which the runner executes without installing dependencies.
// dist/ is committed, and CI fails when it differs from a fresh build.

import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [
    {
      format: 'esm',
      syntax: 'es2024',
      // The runner never installs node_modules, so every dependency goes into the bundle.
      autoExternal: false,
      dts: false
    }
  ],
  source: {
    entry: { main: './src/main.ts', post: './src/post.ts' }
  },
  output: {
    target: 'node',
    cleanDistPath: true,
    distPath: { root: 'dist' },
    minify: false,
    legalComments: 'none'
  }
});

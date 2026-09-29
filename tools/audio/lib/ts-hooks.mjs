/**
 * Lets the Node audio tools import the game's TypeScript modules directly (Node >= 22.18 strips
 * types natively): resolves Vite-style extensionless relative imports to .ts / index.ts files.
 * Import this module before dynamically importing any .ts file.
 */
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL) {
      for (const ext of ['.ts', '/index.ts']) {
        const u = new URL(specifier + ext, context.parentURL);
        if (fs.existsSync(fileURLToPath(u))) return nextResolve(u.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

// Copies the self-hosted Scalar API reference bundle next to the compiled code so the production image
// serves its docs without a CDN and without shipping the (large) Scalar dependency tree.
// Runs from apps/api (pnpm sets the cwd), where the devDependency is linked.
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist/assets', { recursive: true });
copyFileSync('node_modules/@scalar/api-reference/dist/browser/standalone.js', 'dist/assets/scalar-api-reference.js');
console.log('copied dist/assets/scalar-api-reference.js');

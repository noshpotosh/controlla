import { verifyProductionBuild } from './production-boundary.ts';

verifyProductionBuild(process.cwd());
console.log(
  'Production boundary verified: client, SSR and RSC contain gameplay without developer tools.',
);

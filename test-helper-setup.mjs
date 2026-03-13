import { register } from 'node:module';

// Custom resolver to intercept Next.js imports
register('./test-resolver.mjs', import.meta.url);

import { register } from 'node:module'; import { pathToFileURL } from 'node:url'; register('./test-mock-resolver.mjs', pathToFileURL('./'));

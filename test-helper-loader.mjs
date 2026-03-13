import { pathToFileURL } from 'node:url';
import path from 'node:path';

const hooks = {
  resolve(specifier, context, nextResolve) {
    if (specifier === 'next/headers') {
      return {
        url: pathToFileURL(path.resolve('./__mocks__/next/headers.js')).href,
        shortCircuit: true
      };
    }
    return nextResolve(specifier, context);
  }
};

export function resolve(specifier, context, nextResolve) {
  return hooks.resolve(specifier, context, nextResolve);
}

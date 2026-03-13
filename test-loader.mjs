import path from 'node:path';
import url from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const projectRoot = process.cwd();
    const newSpecifier = specifier.replace(/^@\//, '');
    const fullPath = path.join(projectRoot, newSpecifier);

    // Add .js extension if not present, assuming JS files for imports
    let finalPath = fullPath;
    if (!finalPath.endsWith('.js') && !finalPath.endsWith('.json') && !finalPath.endsWith('.mjs')) {
      finalPath += '.js';
    }

    return nextResolve(url.pathToFileURL(finalPath).href, context);
  }
  return nextResolve(specifier, context);
}

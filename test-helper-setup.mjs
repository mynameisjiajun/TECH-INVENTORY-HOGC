import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const cwdUrl = pathToFileURL(process.cwd() + '/').href;
    const newSpecifier = specifier.replace(/^@\//, cwdUrl);
    if (!newSpecifier.endsWith('.js') && !newSpecifier.endsWith('.mjs')) {
        return nextResolve(newSpecifier + '.js', context);
    }
    return nextResolve(newSpecifier, context);
  }
  return nextResolve(specifier, context);
}

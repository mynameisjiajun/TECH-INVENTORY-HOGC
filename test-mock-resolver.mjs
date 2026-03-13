export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'next/headers') {
    return {
      format: 'module',
      shortCircuit: true,
      url: 'data:text/javascript,export const cookies = () => ({ get: () => null });'
    };
  }
  return nextResolve(specifier, context);
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'next/headers') {
    return {
      format: 'module',
      shortCircuit: true,
      url: new URL('data:text/javascript,export const cookies = () => ({ get: () => ({ value: "mock-token" }) });').href
    };
  }
  return nextResolve(specifier, context);
}

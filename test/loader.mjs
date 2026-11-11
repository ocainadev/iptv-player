// Lets Node import the renderer's extension-less ESM imports ('./store').
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context)
  } catch (err) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier)) return next(`${specifier}.js`, context)
    throw err
  }
}

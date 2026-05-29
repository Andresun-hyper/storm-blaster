import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, extname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx'];

export async function resolve(specifier, context, defaultResolve) {
  if (!isRelativeOrAbsolute(specifier)) {
    return defaultResolve(specifier, context, defaultResolve);
  }

  if (extname(specifier)) {
    return defaultResolve(specifier, context, defaultResolve);
  }

  const parentPath = context.parentURL ? fileURLToPath(context.parentURL) : process.cwd();
  const basePath = specifier.startsWith('/')
    ? specifier
    : resolvePath(dirname(parentPath), specifier);

  const candidates = [
    ...EXTENSIONS.map((extension) => `${basePath}${extension}`),
    ...EXTENSIONS.map((extension) => resolvePath(basePath, `index${extension}`)),
  ];

  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return {
        shortCircuit: true,
        url: pathToFileURL(candidate).href,
      };
    }
  }

  return defaultResolve(specifier, context, defaultResolve);
}

export async function load(url, context, defaultLoad) {
  return defaultLoad(url, context, defaultLoad);
}

function isRelativeOrAbsolute(specifier) {
  return specifier.startsWith('.') || specifier.startsWith('/');
}

async function exists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

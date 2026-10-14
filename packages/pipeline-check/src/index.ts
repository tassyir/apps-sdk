// Placeholder package: it proves that a package of this repo builds (ESM, CJS
// and their types), tests, packs and loads from both module systems. It is
// private and never published. Delete it once @tassyir/app-manifest (AP-K1.2)
// covers the same ground.

const PACKAGE_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/** Where the SDK's source lives. */
export const SDK_REPOSITORY_URL = 'https://github.com/tassyir/apps-sdk';

/** The npmjs.com page of a package, scoped or not. */
export function npmPackageUrl(name: string): string {
  if (name.length > 214 || !PACKAGE_NAME.test(name)) {
    throw new TypeError(`Not an npm package name: ${JSON.stringify(name)}`);
  }
  return `https://www.npmjs.com/package/${name}`;
}

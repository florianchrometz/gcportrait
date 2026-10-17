// SPDX-License-Identifier: MIT
/**
 * scripts/lib/dependency-versions.mjs: a dependency as a workspace package declares it and as it is installed
 * for that package, and the check that the declaration pins exactly the version installed, on fixture trees
 * and on the repository's own manifests.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { REPO, createTempTree, type TempTree } from '../testing/temp-tree.js';
import { dependencyVersions, exactPin, exactPinProblem, packageDirectory } from './dependency-versions.mjs';

let tree: TempTree;
beforeEach(() => {
  tree = createTempTree('dependency-versions');
});
afterEach(() => {
  tree.remove();
});

/** An installed package whose `exports` leaves its package.json out, as `@resvg/resvg-wasm`'s does. */
function install(dir: string, name: string, version: string): void {
  tree.write(
    `${dir}/node_modules/${name}/package.json`,
    JSON.stringify({ name, version, exports: { '.': './index.js' } }),
  );
  tree.write(`${dir}/node_modules/${name}/index.js`, 'export {};\n');
}

describe('dependencyVersions', () => {
  it('reads the declaration and the installed package’s own version, whose exports hide its package.json', () => {
    tree.write(
      'packages/render/package.json',
      JSON.stringify({ dependencies: { '@resvg/resvg-wasm': '2.6.2' } }),
    );
    install('packages/render', '@resvg/resvg-wasm', '2.6.2');
    expect(() =>
      createRequire(path.join(tree.root, 'packages/render/package.json')).resolve(
        '@resvg/resvg-wasm/package.json',
      ),
    ).toThrow(/not defined by "exports"/);
    expect(packageDirectory(tree.root, 'packages/render', '@resvg/resvg-wasm')).toBe(
      path.join(tree.root, 'packages/render/node_modules/@resvg/resvg-wasm'),
    );
    expect(dependencyVersions(tree.root, 'packages/render', '@resvg/resvg-wasm')).toEqual({
      declared: '2.6.2',
      installed: '2.6.2',
    });
  });

  it('finds a package hoisted to the root and a declaration among the dev dependencies', () => {
    tree.write('backend/package.json', JSON.stringify({ devDependencies: { fflate: '0.8.3' } }));
    install('.', 'fflate', '0.8.3');
    expect(packageDirectory(tree.root, 'backend', 'fflate')).toBe(
      path.join(tree.root, 'node_modules/fflate'),
    );
    expect(dependencyVersions(tree.root, 'backend', 'fflate')).toEqual({
      declared: '0.8.3',
      installed: '0.8.3',
    });
  });

  it('looks in no node_modules directory outside the tree', () => {
    tree.write('tree/frontend/package.json', JSON.stringify({ dependencies: { fflate: '0.8.3' } }));
    install('.', 'fflate', '0.8.3');
    expect(packageDirectory(path.join(tree.root, 'tree'), 'frontend', 'fflate')).toBeUndefined();
    expect(dependencyVersions(path.join(tree.root, 'tree'), 'frontend', 'fflate')).toEqual({
      declared: '0.8.3',
      installed: null,
    });
    // The same lookup with the outer directory as the tree's root finds it.
    expect(dependencyVersions(tree.root, 'tree/frontend', 'fflate').installed).toBe('0.8.3');
  });

  it('is null for a package neither declared nor installed', () => {
    tree.write('packages/other/package.json', JSON.stringify({ devDependencies: { x: '1.0.0' } }));
    expect(packageDirectory(tree.root, 'packages/other', '@resvg/resvg-wasm')).toBeUndefined();
    expect(dependencyVersions(tree.root, 'packages/other', '@resvg/resvg-wasm')).toEqual({
      declared: null,
      installed: null,
    });
  });
});

describe('packageDirectory', () => {
  it('prefers the workspace’s installed package over one hoisted to the root', () => {
    tree.write('website/package.json', '{}');
    install('.', 'pngjs', '7.0.0');
    install('website', 'pngjs', '7.0.0');
    expect(packageDirectory(tree.root, 'website', 'pngjs')).toBe(
      path.join(tree.root, 'website/node_modules/pngjs'),
    );
  });

  it('finds a package with no exported entry point', () => {
    tree.write('website/package.json', '{}');
    tree.write(
      'website/node_modules/example-assets/package.json',
      JSON.stringify({
        name: 'example-assets',
        version: '1.0.0',
        exports: { './asset': './asset.bin' },
      }),
    );
    expect(packageDirectory(tree.root, 'website', 'example-assets')).toBe(
      path.join(tree.root, 'website/node_modules/example-assets'),
    );
  });
});

describe('exactPinProblem and exactPin', () => {
  it('pass an exact pin, returning the version installed', () => {
    tree.write('backend/package.json', JSON.stringify({ dependencies: { '@fastify/multipart': '10.1.2' } }));
    install('backend', '@fastify/multipart', '10.1.2');
    expect(
      exactPinProblem({ declared: '10.1.2', installed: '10.1.2' }, 'backend', '@fastify/multipart'),
    ).toBe(null);
    expect(exactPin(tree.root, 'backend', '@fastify/multipart')).toBe('10.1.2');
  });

  it('refuse a range, a missing declaration and a package not installed, with what is wrong', () => {
    tree.write(
      'packages/render/package.json',
      JSON.stringify({ dependencies: { '@resvg/resvg-wasm': '^2.6.2' } }),
    );
    install('packages/render', '@resvg/resvg-wasm', '2.6.2');
    const range =
      'packages/render/package.json declares @resvg/resvg-wasm ^2.6.2, not exactly the version installed, 2.6.2';
    expect(
      exactPinProblem({ declared: '^2.6.2', installed: '2.6.2' }, 'packages/render', '@resvg/resvg-wasm'),
    ).toBe(range);
    expect(() => exactPin(tree.root, 'packages/render', '@resvg/resvg-wasm')).toThrow(range);

    expect(exactPinProblem({ declared: null, installed: '0.8.3' }, 'frontend', 'fflate')).toBe(
      'frontend/package.json declares fflate not at all, not exactly the version installed, 0.8.3',
    );

    tree.write('frontend/package.json', JSON.stringify({ dependencies: { fflate: '0.8.3' } }));
    const missing = 'fflate is not installed for frontend; run `pnpm install`';
    expect(exactPinProblem({ declared: '0.8.3', installed: null }, 'frontend', 'fflate')).toBe(missing);
    expect(() => exactPin(tree.root, 'frontend', 'fflate')).toThrow(missing);
  });

  it('read the repository’s own pins, resvg-wasm’s included', () => {
    const declared = (workspace: string, name: string): unknown =>
      (
        JSON.parse(readFileSync(path.join(REPO, workspace, 'package.json'), 'utf8')) as {
          dependencies: Record<string, unknown>;
        }
      ).dependencies[name];
    expect(exactPin(REPO, 'packages/render', '@resvg/resvg-wasm')).toBe(
      declared('packages/render', '@resvg/resvg-wasm'),
    );
    expect(exactPin(REPO, 'frontend', 'fflate')).toBe(declared('frontend', 'fflate'));
  });
});

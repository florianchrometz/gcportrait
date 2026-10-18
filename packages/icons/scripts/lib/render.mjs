// SPDX-License-Identifier: Apache-2.0
// @ts-check
/**
 * Rasterising SVG in headless Chromium through playwright-core: the contact sheet's PNG, and the vendoring
 * script's optional proof that the mechanical transforms leave every pixel as Google drew it. Chromium comes
 * from Playwright's browser cache (`pnpm --filter @gcportrait/e2e install-browsers` installs it once per
 * machine); without it these helpers throw an error that says so.
 */
import { Buffer } from 'node:buffer';

/**
 * Runs `work` on a fresh Chromium page and closes the browser afterwards.
 * @template T
 * @param {(page: import('playwright-core').Page) => Promise<T>} work
 * @param {{ width: number, height: number, scale: number }} [viewport]
 * @returns {Promise<T>}
 */
export async function withPage(work, viewport = { width: 800, height: 600, scale: 1 }) {
  /** @type {typeof import('playwright-core')} */
  let playwright;
  try {
    playwright = await import('playwright-core');
  } catch (error) {
    throw new Error(
      `playwright-core is not installed: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    );
  }
  /** @type {import('playwright-core').Browser} */
  let browser;
  try {
    browser = await playwright.chromium.launch();
  } catch (error) {
    throw new Error(
      `cannot start Chromium (run \`pnpm --filter @gcportrait/e2e install-browsers\` once): ${
        error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error)
      }`,
      { cause: error },
    );
  }
  try {
    const page = await browser.newPage({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.scale,
    });
    return await work(page);
  } finally {
    await browser.close();
  }
}

/**
 * @param {string} svg
 * @returns {string}
 */
export function dataUri(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

/**
 * The SVG document with its root's `width` and `height` set to `size`, so that Chromium rasterises the vector
 * at the target size. Without it, a source that declares `width="24px"` is drawn at 24 px and resampled, which
 * differs by a few levels at 16 px from a document without an intrinsic size.
 * @param {string} svg
 * @param {number} size
 * @returns {string}
 */
export function withSize(svg, size) {
  return svg.replace(/<svg\b[^>]*>/, (tag) =>
    tag
      .replace(/\s(?:width|height)\s*=\s*(["'])[^"']*\1/g, '')
      .replace(/^<svg/, `<svg width="${String(size)}" height="${String(size)}"`),
  );
}

/**
 * Draws each pair of SVG documents into a canvas at `size` × `size` pixels, both sized alike (`withSize`), and
 * returns, per pair, the largest difference of any channel of any pixel (0 means identical rasters).
 * @param {ReadonlyArray<readonly [string, string]>} pairs
 * @param {number} size
 * @returns {Promise<number[]>}
 */
export async function compareRenders(pairs, size) {
  return withPage(async (page) => {
    await page.setContent('<!doctype html><title>compare</title>');
    return page.evaluate(
      async ({ uris, px }) => {
        /**
         * @param {string} src
         * @returns {Promise<HTMLImageElement>}
         */
        const load = (src) =>
          new Promise((resolve, reject) => {
            const image = new globalThis.Image();
            image.onload = () => {
              resolve(image);
            };
            image.onerror = () => {
              reject(new Error('image failed to load'));
            };
            image.src = src;
          });
        /** @param {HTMLImageElement} image */
        const pixels = (image) => {
          const canvas = globalThis.document.createElement('canvas');
          canvas.width = px;
          canvas.height = px;
          const context = canvas.getContext('2d');
          if (context === null) throw new Error('no 2d context');
          context.drawImage(image, 0, 0, px, px);
          return context.getImageData(0, 0, px, px).data;
        };
        /** @type {number[]} */
        const result = [];
        for (const [a, b] of uris) {
          const left = pixels(await load(a));
          const right = pixels(await load(b));
          let worst = 0;
          for (let i = 0; i < left.length; i += 1)
            worst = Math.max(worst, Math.abs((left[i] ?? 0) - (right[i] ?? 0)));
          result.push(worst);
        }
        return result;
      },
      {
        uris: pairs.map(
          ([a, b]) =>
            /** @type {[string, string]} */ ([dataUri(withSize(a, size)), dataUri(withSize(b, size))]),
        ),
        px: size,
      },
    );
  });
}

/**
 * Screenshots an SVG document at its own size (1 CSS pixel = 1 device pixel times `scale`) as PNG.
 * @param {string} svg a standalone SVG document with width and height
 * @param {number} width
 * @param {number} height
 * @param {number} scale
 * @returns {Promise<Buffer>}
 */
export async function svgToPng(svg, width, height, scale) {
  return withPage(
    async (page) => {
      await page.setContent(`<!doctype html><style>html,body{margin:0}</style>${svg}`);
      return page.screenshot({ clip: { x: 0, y: 0, width, height } });
    },
    { width, height, scale },
  );
}

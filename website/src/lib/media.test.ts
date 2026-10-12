// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import mediaList from '../data/media.json' with { type: 'json' };
import { CARD_IDS, scene, socialImage, still } from './media.js';

describe('the generated media the website shows (docs/media/)', () => {
  it('has every still in both themes, both widths, with the dimensions of the manifest', () => {
    for (const { id, alt } of mediaList.stills) {
      const image = still(id);
      expect(image, id).toBeDefined();
      expect(image?.alt).toBe(alt);
      expect(image?.width).toBe(1440);
      expect(image?.height).toBe(900);
      expect(image?.light.srcset.split(', ')).toHaveLength(2);
      expect(image?.dark.srcset).toMatch(/-dark-720\.[^ ]*webp 720w$/);
    }
  });

  it('has every animated demo as WebM with a poster, and its GIF for the fallback, per theme', () => {
    for (const { id } of mediaList.scenes) {
      const video = scene(id);
      expect(video, id).toBeDefined();
      expect(video?.video.light).toMatch(/\.webm$/);
      expect(video?.video.dark).toMatch(/\.webm$/);
      expect(video?.gif.light).toMatch(new RegExp(`${id}-light\\.[^/]*gif$`));
      expect(video?.gif.dark).toMatch(new RegExp(`${id}-dark\\.[^/]*gif$`));
      expect(video?.width).toBe(1200);
      expect(video?.height).toBe(750);
    }
  });

  it('gives every page a 1200×630 link-preview image on the canonical host', () => {
    for (const id of ['home', 'docs', 'coverage', 'contributing', 'licence']) {
      expect(CARD_IDS).toContain(id);
    }
    // The changelog is the repository's releases page on GitHub (src/site.ts, RELEASES_URL), not a page of the site.
    expect(CARD_IDS).not.toContain('changelog');
    // The Impressum and the privacy notice are pages of the maintainer's own website, not of this one (src/site.ts).
    expect(CARD_IDS).not.toContain('impressum');
    expect(CARD_IDS).not.toContain('privacy');
    const image = socialImage('home', 'alt');
    expect(image?.url).toMatch(/^https:\/\/gcportrait\.app\/.*\.jpg$/);
    expect([image?.width, image?.height]).toEqual([1200, 630]);
    expect(() => socialImage('no-such-card', 'x')).toThrow(/no link-preview card/);
  });
});

// SPDX-License-Identifier: Apache-2.0
/**
 * Client-side live search for the website's asset catalog coverage page (`src/pages/coverage.astro`).
 * Kept free of `@gcportrait/catalog` and `@gcportrait/model` imports so the browser bundle carries only
 * the search logic and never bundles catalog data or zod.
 */

export type SearchableProduct = {
  readonly product: string;
  readonly service: string;
  readonly types: readonly {
    readonly type: string;
    readonly role: string;
  }[];
};

export type FilteredProduct = {
  readonly visible: boolean;
  readonly open: boolean;
  readonly visibleTypes: readonly boolean[];
};

export type CatalogSearchResult = {
  readonly active: boolean;
  readonly query: string;
  readonly totalProducts: number;
  readonly totalTypes: number;
  readonly matchedProducts: number;
  readonly matchedTypes: number;
  readonly products: readonly FilteredProduct[];
};

/** Splits a search query into lowercase whitespace-separated tokens. */
export function tokenizeQuery(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

/** True when every lowercase token appears in `haystack` (already lowercased). */
export function matchesTokens(haystack: string, tokens: readonly string[]): boolean {
  for (const token of tokens) {
    if (!haystack.includes(token)) return false;
  }
  return true;
}

/**
 * Filters products and their asset types against `query`.
 * - When a product's name or service API (`*.googleapis.com`) matches all tokens, the product is opened and all of
 *   its asset types stay visible.
 * - Otherwise, if one or more of its asset types (matched across product name, service API, asset type and role)
 *   match all tokens, the product is opened and only the matching asset types stay visible.
 */
export function filterProductCatalog(
  items: readonly SearchableProduct[],
  query: string,
): CatalogSearchResult {
  const trimmed = query.trim();
  const tokens = tokenizeQuery(trimmed);
  const totalProducts = items.length;
  const totalTypes = items.reduce((sum, item) => sum + item.types.length, 0);

  if (tokens.length === 0) {
    return {
      active: false,
      query: '',
      totalProducts,
      totalTypes,
      matchedProducts: totalProducts,
      matchedTypes: totalTypes,
      products: items.map((item) => ({
        visible: true,
        open: false,
        visibleTypes: item.types.map(() => true),
      })),
    };
  }

  let matchedProducts = 0;
  let matchedTypes = 0;
  const products: FilteredProduct[] = items.map((item) => {
    const headerHaystack = `${item.product} ${item.service}`.toLowerCase();
    if (matchesTokens(headerHaystack, tokens)) {
      matchedProducts += 1;
      matchedTypes += item.types.length;
      return {
        visible: true,
        open: true,
        visibleTypes: item.types.map(() => true),
      };
    }

    const visibleTypes = item.types.map((entry) =>
      matchesTokens(`${item.product} ${item.service} ${entry.type} ${entry.role}`.toLowerCase(), tokens),
    );
    const matchingCount = visibleTypes.filter(Boolean).length;
    if (matchingCount > 0) {
      matchedProducts += 1;
      matchedTypes += matchingCount;
      return {
        visible: true,
        open: true,
        visibleTypes,
      };
    }

    return {
      visible: false,
      open: false,
      visibleTypes,
    };
  });

  return {
    active: true,
    query: trimmed,
    totalProducts,
    totalTypes,
    matchedProducts,
    matchedTypes,
    products,
  };
}

function fmt(value: number): string {
  return value.toLocaleString('en-GB');
}

/** Formats the live status line above the product catalog. */
export function formatSearchStatus(result: CatalogSearchResult): string {
  if (!result.active) {
    return `${fmt(result.totalProducts)} products. Open one to see its types, their roles, and whether the type has its own Cloud Console link.`;
  }
  if (result.matchedProducts === 0) {
    return `No products or asset types match “${result.query}”.`;
  }
  const productWord = result.totalProducts === 1 ? 'product' : 'products';
  const typeWord = result.matchedTypes === 1 ? 'type' : 'types';
  return `${fmt(result.matchedProducts)} of ${fmt(result.totalProducts)} ${productWord} (${fmt(result.matchedTypes)} ${typeWord}) matching “${result.query}”.`;
}

/** Binds the live search input, clear button and product `<details>` list on `/coverage/`. */
export function startCoverageSearch(root: ParentNode = document): void {
  const input = root.querySelector<HTMLInputElement>('[data-search-input]');
  if (input === null) return;
  const clearButton = root.querySelector<HTMLButtonElement>('[data-search-clear]');
  const status = root.querySelector<HTMLElement>('[data-search-status]');
  const detailElements = Array.from(root.querySelectorAll<HTMLDetailsElement>('[data-product-item]'));

  const entries = detailElements.map((details) => {
    const product = details.dataset.product ?? '';
    const service = details.dataset.service ?? '';
    const typeItems = Array.from(details.querySelectorAll<HTMLLIElement>('[data-type-item]'));
    const types = typeItems.map((li) => ({
      type: li.dataset.type ?? '',
      role: li.dataset.role ?? '',
    }));
    return { details, typeItems, item: { product, service, types } };
  });

  const searchable = entries.map((entry) => entry.item);
  const openBeforeSearch = new WeakMap<HTMLDetailsElement, boolean>();
  let wasActive = false;

  const apply = (): void => {
    const result = filterProductCatalog(searchable, input.value);
    if (result.active && !wasActive) {
      for (const entry of entries) {
        openBeforeSearch.set(entry.details, entry.details.open);
      }
    }

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const filtered = result.products[index];
      if (entry === undefined || filtered === undefined) continue;

      entry.details.hidden = !filtered.visible;
      if (result.active) {
        if (filtered.visible) entry.details.open = true;
      } else if (wasActive) {
        entry.details.open = openBeforeSearch.get(entry.details) ?? false;
      }

      for (let typeIndex = 0; typeIndex < entry.typeItems.length; typeIndex += 1) {
        const li = entry.typeItems[typeIndex];
        const visible = filtered.visibleTypes[typeIndex];
        if (li !== undefined && visible !== undefined) {
          li.hidden = !visible;
        }
      }
    }

    wasActive = result.active;
    if (status !== null) {
      status.textContent = formatSearchStatus(result);
    }
    if (clearButton !== null) {
      clearButton.hidden = !result.active;
    }
  };

  input.addEventListener('input', apply);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && input.value !== '') {
      event.preventDefault();
      input.value = '';
      apply();
    }
  });
  if (clearButton !== null) {
    clearButton.addEventListener('click', () => {
      input.value = '';
      apply();
      input.focus();
    });
  }
}

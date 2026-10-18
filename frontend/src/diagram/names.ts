// SPDX-License-Identifier: Apache-2.0
/**
 * Human type names for accessible names (style skill §13: every card has an accessible name, type + label). Pure;
 * the renderer names cards with it, and the data worker names product-container zones with it from the Graph,
 * whose nodes carry the product and asset type that a Scene zone leaves out.
 */

/** The type name of an asset: its product and the asset type's kind, "Cloud Run service". */
export function cardTypeName(product: string, assetType: string): string {
  const kind = assetType.slice(assetType.lastIndexOf('/') + 1);
  const words = kind
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(' ')
    // Acronyms (VPN, SSL, URL) keep their capitals; other words are lower-case.
    .map((word) => (word.length > 1 && word.toUpperCase() === word ? word : word.toLowerCase()));
  const human = words.join(' ');
  return product.toLowerCase().endsWith(human.toLowerCase()) ? product : `${product} ${human}`;
}

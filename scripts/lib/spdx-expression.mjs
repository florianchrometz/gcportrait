// SPDX-License-Identifier: MIT
// @ts-check
/**
 * A small evaluator for SPDX licence expressions (SPDX specification, annex D): decides whether a package
 * declared under `expression` can be used under licences from an allowlist only.
 *
 *   expression := and-term ( "OR" and-term )*
 *   and-term   := factor ( "AND" factor )*
 *   factor     := "(" expression ")" | licence-id [ "+" ] [ "WITH" exception-id ]
 *
 * OR needs one allowed branch, AND needs every operand allowed. A `WITH` exception only adds permissions, so
 * `X WITH E` is allowed when X is. Identifiers compare case-insensitively. Anything unparsable (a missing
 * licence, "SEE LICENSE IN …", "UNLICENSED") is not allowed. `licenseIdsOf` lists the licence identifiers an
 * expression names, for the deny list of scripts/check-licenses.mjs. Plain ESM, no dependencies.
 */

/**
 * @param {string} expression
 * @returns {string[]}
 */
function tokenize(expression) {
  return expression
    .replace(/[()]/g, (paren) => ` ${paren} `)
    .trim()
    .split(/\s+/)
    .filter((token) => token !== '');
}

/**
 * Whether `expression` is satisfiable with licences from `allowed` only.
 * @param {string} expression an SPDX licence expression, e.g. "(MIT OR Apache-2.0)"
 * @param {Iterable<string>} allowed allowed SPDX licence identifiers
 * @returns {boolean}
 */
export function isLicenseAllowed(expression, allowed) {
  const allowedIds = new Set([...allowed].map((id) => id.toLowerCase()));
  const tokens = tokenize(expression);
  let position = 0;

  /** @returns {string | undefined} */
  const peek = () => tokens[position];
  /** @returns {string} */
  const next = () => {
    const token = tokens[position];
    if (token === undefined) throw new SyntaxError('unexpected end of licence expression');
    position += 1;
    return token;
  };

  /** @returns {boolean} */
  const parseFactor = () => {
    const token = next();
    if (token === '(') {
      const value = parseExpression();
      if (next() !== ')') throw new SyntaxError('missing ")" in licence expression');
      return value;
    }
    if (token === ')' || /^(and|or|with)$/i.test(token)) {
      throw new SyntaxError(`unexpected "${token}" in licence expression`);
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9.+-]*$/.test(token)) {
      throw new SyntaxError(`"${token}" is not a licence identifier`);
    }
    if (peek()?.toUpperCase() === 'WITH') {
      next();
      next();
    }
    return allowedIds.has(token.replace(/\+$/, '').toLowerCase());
  };

  /** @returns {boolean} */
  const parseAndTerm = () => {
    let value = parseFactor();
    while (peek()?.toUpperCase() === 'AND') {
      next();
      value = parseFactor() && value;
    }
    return value;
  };

  /** @returns {boolean} */
  function parseExpression() {
    let value = parseAndTerm();
    while (peek()?.toUpperCase() === 'OR') {
      next();
      value = parseAndTerm() || value;
    }
    return value;
  }

  try {
    const value = parseExpression();
    return position === tokens.length && value;
  } catch (error) {
    if (error instanceof SyntaxError) return false;
    throw error;
  }
}

/**
 * The licence identifiers an expression names, in order, without operators, parentheses, a trailing `+` or the
 * exception after `WITH` (`GPL-2.0-only WITH Classpath-exception-2.0` names `GPL-2.0-only`). Does not validate
 * the expression: every other token counts as an identifier, so "SEE LICENSE IN x" yields its four words.
 * @param {string} expression
 * @returns {string[]}
 */
export function licenseIdsOf(expression) {
  const tokens = tokenize(expression);
  /** @type {string[]} */
  const ids = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? '';
    if (token === '(' || token === ')' || /^(and|or)$/i.test(token)) continue;
    if (/^with$/i.test(token)) {
      index += 1;
      continue;
    }
    ids.push(token.replace(/\+$/, ''));
  }
  return ids;
}

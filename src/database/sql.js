// Shared SQL helpers for the dialect-aware database clients.
//
// Every repository in this codebase writes SQL with SQLite-style `?` positional
// placeholders. Rather than fork ~200 query strings per dialect, the PostgreSQL
// client rewrites `?` into `$1..$n` on its way to the driver. This keeps the
// "repositories are the only code that touches the database, and they write one
// dialect of SQL" rule intact.

/**
 * Rewrites SQLite-style `?` placeholders into PostgreSQL `$n` placeholders.
 *
 * String literals ('...', with '' as the escape) and both comment styles are
 * skipped so that a `?` inside a quoted value or a comment is never mistaken for
 * a bind parameter. Dollar-quoted strings are not supported because no query in
 * this codebase uses them.
 */
export function toPositionalPlaceholders(sql) {
  let output = "";
  let index = 0;
  let parameterNumber = 0;

  while (index < sql.length) {
    const character = sql[index];

    if (character === "'") {
      const end = findStringLiteralEnd(sql, index);
      output += sql.slice(index, end);
      index = end;
      continue;
    }

    if (character === '"') {
      const end = findQuotedIdentifierEnd(sql, index);
      output += sql.slice(index, end);
      index = end;
      continue;
    }

    if (character === "-" && sql[index + 1] === "-") {
      const newline = sql.indexOf("\n", index);
      const end = newline === -1 ? sql.length : newline;
      output += sql.slice(index, end);
      index = end;
      continue;
    }

    if (character === "/" && sql[index + 1] === "*") {
      const close = sql.indexOf("*/", index + 2);
      const end = close === -1 ? sql.length : close + 2;
      output += sql.slice(index, end);
      index = end;
      continue;
    }

    if (character === "?") {
      parameterNumber += 1;
      output += `$${parameterNumber}`;
      index += 1;
      continue;
    }

    output += character;
    index += 1;
  }

  return output;
}

function findStringLiteralEnd(sql, start) {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] === "'") {
      if (sql[index + 1] === "'") {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }
  return sql.length;
}

function findQuotedIdentifierEnd(sql, start) {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] === '"') {
      if (sql[index + 1] === '"') {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }
  return sql.length;
}

/**
 * Splits a multi-statement DDL script into individual statements.
 *
 * Only used by clients that cannot send several statements in one round trip.
 * Semicolons inside string literals and comments are ignored.
 */
export function splitStatements(script) {
  const statements = [];
  let current = "";
  let index = 0;

  while (index < script.length) {
    const character = script[index];

    if (character === "'") {
      const end = findStringLiteralEnd(script, index);
      current += script.slice(index, end);
      index = end;
      continue;
    }

    if (character === "-" && script[index + 1] === "-") {
      const newline = script.indexOf("\n", index);
      const end = newline === -1 ? script.length : newline;
      current += script.slice(index, end);
      index = end;
      continue;
    }

    if (character === ";") {
      if (current.trim()) {
        statements.push(current.trim());
      }
      current = "";
      index += 1;
      continue;
    }

    current += character;
    index += 1;
  }

  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements;
}

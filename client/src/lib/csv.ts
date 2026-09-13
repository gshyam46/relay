// Prefix spreadsheet-sensitive display strings visibly; exact domain strings belong in JSON columns.
// CSV is a viewing/export format, not a universal spreadsheet round-trip contract.
export function csvCell(value: unknown): string {
  const original = value === null || value === undefined ? "" : String(value);
  const normalized = original.normalize("NFKC");
  const firstVisible = normalized.replace(/^[\s\p{Cc}\p{Cf}]+/u, "");
  const controlPrefix = /^[\p{Cc}\p{Cf}]/u.test(normalized);
  const formulaPrefix = /^[=+\-@]/u.test(firstVisible);
  const numericString = typeof value === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(firstVisible.trim());
  const guarded = typeof value !== "number" && (controlPrefix || formulaPrefix || numericString)
    ? "text: " + original : original;
  return '"' + guarded.replace(/"/g, '""') + '"';
}

export function serializeCsv(headers: string[], rows: unknown[][]): string {
  if (!Array.isArray(headers) || !headers.length || !Array.isArray(rows)
    || rows.some(row => !Array.isArray(row) || row.length !== headers.length)) {
    throw new TypeError("CSV rows must match the header width");
  }
  return [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function downloadCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const blob = new Blob([serializeCsv(headers, rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

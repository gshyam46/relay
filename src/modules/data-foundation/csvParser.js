export const CSV_LIMITS = Object.freeze({ bytes: 2 * 1024 * 1024, rows: 1000, columns: 64, cell_characters: 4096, filename_characters: 200 });

export function parseCsv(csvText) {
  if (typeof csvText !== "string" || !csvText.trim()) return { headers: [], records: [], issues: [parserIssue(1, "CSV_EMPTY", "CSV text is required.")] };
  if (Buffer.byteLength(csvText, "utf8") > CSV_LIMITS.bytes) throw csvError("CSV_LIMIT_EXCEEDED", "CSV exceeds the 2 MiB file limit.", 413);
  const parsed = parseRecords(csvText.startsWith("\uFEFF") ? csvText.slice(1) : csvText);
  const rows = parsed.records;
  if (!rows.length) return { headers: [], records: [], issues: [parserIssue(1, "CSV_HEADER_MISSING", "CSV header row is required."), ...parsed.issues] };
  const [header, ...data] = rows, headers = header.values;
  const records = [], issues = [...parsed.issues];
  const counts = new Map();
  for (const label of headers) counts.set(label, (counts.get(label) || 0) + 1);
  for (const record of data) {
    if (record.values.every(value => !value.trim())) continue;
    const rawRow = {};
    headers.forEach((label, index) => {
      // Ordered cells are authoritative. Preserve safe, unambiguous legacy keys.
      if (label && counts.get(label) === 1) Object.defineProperty(rawRow, label, { value: record.values[index] ?? "", enumerable: true, configurable: true, writable: true });
    });
    for (let index = headers.length; index < record.values.length; index++) {
      let key = "_extra_" + (index - headers.length + 1);
      while (Object.hasOwn(rawRow, key)) key = "_" + key;
      Object.defineProperty(rawRow, key, { value: record.values[index], enumerable: true, configurable: true, writable: true });
    }
    if (record.values.length > headers.length) issues.push(parserIssue(record.lineNumber, "CSV_EXTRA_COLUMNS", "Row contains more columns than the header.", "WARNING"));
    if (record.values.length < headers.length) issues.push(parserIssue(record.lineNumber, "CSV_MISSING_COLUMNS", "Row contains fewer columns than the header.", "WARNING"));
    records.push({ rowNumber: record.lineNumber, rawRow, rawCells: record.values });
  }
  return { headers, records, issues };
}
function parseRecords(text) {
  const records = [], issues = [], malformedRows = new Set();
  let field = "", row = [], quoted = false, closed = false, line = 1, start = 1, nonblank = 0;
  const append = value => { field += value; if (field.length > CSV_LIMITS.cell_characters) throw csvError("CSV_LIMIT_EXCEEDED", "CSV cell exceeds 4096 characters.", 413); };
  const cell = () => { row.push(field); field = ""; closed = false; if (row.length > CSV_LIMITS.columns) throw csvError("CSV_LIMIT_EXCEEDED", "CSV exceeds 64 columns.", 413); };
  const record = () => {
    cell();
    if ((row.length > 1 || row.some(value => value.trim())) && ++nonblank > CSV_LIMITS.rows + 1) throw csvError("CSV_LIMIT_EXCEEDED", "CSV exceeds 1000 data rows.", 413);
    if (row.length > 1 || row.some(value => value.trim())) records.push({ lineNumber: start, values: row }); row = [];
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index], next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') { append('"'); index++; }
      else if (char === '"') { quoted = false; closed = true; }
      else { append(char); if (char === "\n" || (char === "\r" && next !== "\n")) line++; }
      continue;
    }
    if (char === ",") cell();
    else if (char === "\r" || char === "\n") {
      record(); if (char === "\r" && next === "\n") index++;
      line++; start = line;
    } else if (char === '"' && !field.length && !closed) quoted = true;
    else {
      if ((closed || char === '"') && !malformedRows.has(start)) { issues.push(parserIssue(start, "CSV_MALFORMED", "CSV contains malformed quoting.")); malformedRows.add(start); }
      append(char);
    }
  }
  if (quoted) issues.push(parserIssue(start, "CSV_MALFORMED", "CSV contains an unterminated quoted field."));
  if (field.length || row.length || closed) record();
  return { records, issues };
}
export function csvError(code, message, statusCode = 400) { return Object.assign(new Error(message), { code, statusCode }); }
function parserIssue(rowNumber, issue_type, message, severity = "ERROR") { return { rowNumber, issue_type, field: null, message, severity }; }

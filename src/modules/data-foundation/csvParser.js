export function parseCsv(csvText) {
  if (typeof csvText !== "string" || !csvText.trim()) {
    return {
      headers: [],
      records: [],
      issues: [parserIssue(1, "CSV_EMPTY", "CSV text is required.")]
    };
  }

  const parseResult = parseRecords(csvText);
  const rows = parseResult.records.filter((record) => record.values.some((value) => value.trim()));
  if (rows.length === 0) {
    return {
      headers: [],
      records: [],
      issues: [parserIssue(1, "CSV_HEADER_MISSING", "CSV header row is required."), ...parseResult.issues]
    };
  }

  const [headerRecord, ...dataRecords] = rows;
  const headers = headerRecord.values.map((value) => value.trim());
  const issues = [...parseResult.issues];
  if (headers.every((header) => !header)) {
    issues.push(parserIssue(headerRecord.lineNumber, "CSV_HEADER_MISSING", "CSV header row is required."));
  }

  const records = [];
  for (const record of dataRecords) {
    if (record.values.every((value) => !value.trim())) {
      continue;
    }
    const rawRow = {};
    headers.forEach((header, index) => {
      rawRow[header || `column_${index + 1}`] = record.values[index] ?? "";
    });
    if (record.values.length > headers.length) {
      for (let index = headers.length; index < record.values.length; index += 1) {
        rawRow[`_extra_${index - headers.length + 1}`] = record.values[index] ?? "";
      }
      issues.push(parserIssue(record.lineNumber, "CSV_EXTRA_COLUMNS", "Row contains more columns than the header.", "WARNING"));
    }
    records.push({
      rowNumber: record.lineNumber,
      rawRow
    });
  }

  return {
    headers,
    records,
    issues
  };
}

function parseRecords(csvText) {
  const records = [];
  const issues = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  let lineNumber = 1;
  let rowStartLine = 1;

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];
    const next = csvText[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        if (char === "\n") {
          lineNumber += 1;
        }
        field += char;
      }
      continue;
    }

    if (char === '"') {
      if (field.length === 0) {
        inQuotes = true;
      } else {
        field += char;
      }
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\r") {
      if (next === "\n") {
        index += 1;
      }
      row.push(field);
      records.push({ lineNumber: rowStartLine, values: row });
      field = "";
      row = [];
      lineNumber += 1;
      rowStartLine = lineNumber;
    } else if (char === "\n") {
      row.push(field);
      records.push({ lineNumber: rowStartLine, values: row });
      field = "";
      row = [];
      lineNumber += 1;
      rowStartLine = lineNumber;
    } else {
      field += char;
    }
  }

  if (inQuotes) {
    issues.push(parserIssue(rowStartLine, "CSV_MALFORMED", "CSV contains an unterminated quoted field."));
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    records.push({ lineNumber: rowStartLine, values: row });
  }

  return { records, issues };
}

function parserIssue(rowNumber, issueType, message, severity = "ERROR") {
  return {
    rowNumber,
    issue_type: issueType,
    field: null,
    message,
    severity
  };
}

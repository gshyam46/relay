import { parseCsv, csvError } from "./csvParser.js";

const HEADER_ALIASES = {
  name: new Set(["name", "fullname", "contactperson", "customername"]),
  phone: new Set(["mobile", "phoneno", "whatsapp", "phone"]),
  company: new Set(["company", "businessname", "organization"]),
  email: new Set(["emailid", "emailaddress", "email"])
};

export function parseCsvLeadRows(csvText) {
  const parsed = parseCsv(csvText);
  if (parsed.issues.some(issue => issue.severity === "ERROR")) throw csvError("CSV_MALFORMED", "CSV cannot be previewed until file errors are corrected.");
  const headerMap = mapHeaders(parsed.headers);
  const rows = parsed.records.map((record) => {
    const mappedValues = {
      name: null,
      phone: null,
      company: null,
      email: null,
      source: "CSV"
    };

    for (const [rawHeader, value] of Object.entries(record.rawRow)) {
      const field = headerMap.get(rawHeader);
      if (field && mappedValues[field] === null) {
        mappedValues[field] = value;
      }
    }

    return {
      rowNumber: record.rowNumber,
      rawRow: record.rawRow,
      rawCells: record.rawCells,
      mappedValues
    };
  });

  return {
    rows,
    parserIssues: parsed.issues,
    headers: parsed.headers,
    headerMap: Object.fromEntries(headerMap)
  };
}

function mapHeaders(headers) {
  const mapped = new Map();
  for (const header of headers) {
    const canonical = canonicalizeHeader(header);
    const field = Object.entries(HEADER_ALIASES).find(([, aliases]) => aliases.has(canonical))?.[0] || null;
    mapped.set(header, field);
  }
  return mapped;
}

function canonicalizeHeader(header) {
  return String(header || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

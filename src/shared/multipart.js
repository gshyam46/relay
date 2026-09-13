export async function readRawBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Minimal multipart/form-data parser for text fields (no file/attachment support —
// SendGrid Inbound Parse's message text/from/subject/envelope fields are all plain
// text parts; attachments are ignored, which is fine since nothing here reads them).
export function parseMultipartFormData(buffer, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  const boundary = boundaryMatch ? (boundaryMatch[1] || boundaryMatch[2]).trim() : null;
  if (!boundary || !buffer?.length) {
    return {};
  }

  const delimiter = Buffer.from(`--${boundary}`);
  const fields = {};
  const duplicateIdentityFields = new Set();
  const identityFields = new Set(["from", "to", "headers", "envelope", "subject", "text", "html"]);
  let cursor = buffer.indexOf(delimiter);

  while (cursor !== -1) {
    const partStart = cursor + delimiter.length;
    const nextDelimiter = buffer.indexOf(delimiter, partStart);
    if (nextDelimiter === -1) {
      break;
    }
    let part = buffer.subarray(partStart, nextDelimiter);
    if (part.subarray(0, 2).toString("latin1") === "\r\n") {
      part = part.subarray(2);
    }
    if (part.subarray(-2).toString("latin1") === "\r\n") {
      part = part.subarray(0, -2);
    }

    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const headerText = part.subarray(0, headerEnd).toString("utf8");
      const nameMatch = /name="([^"]*)"/i.exec(headerText);
      const isFile = /filename="/i.test(headerText);
      if (nameMatch && !isFile && !nameMatch[1].startsWith("__")) {
        const name = nameMatch[1], value = part.subarray(headerEnd + 4).toString("utf8");
        if (Object.hasOwn(fields, name)) {
          if (identityFields.has(name)) duplicateIdentityFields.add(name);
          // Preserve all bounded policy text for opt-out detection on quarantined
          // ambiguous input, while never silently selecting another identity.
          if (name === "text") fields.text += "\n" + value;
        } else {
          Object.defineProperty(fields, name, { value, writable: true, enumerable: true, configurable: true });
        }
      }
    }

    cursor = nextDelimiter;
  }

  if (duplicateIdentityFields.size) fields.__duplicate_identity_fields = [...duplicateIdentityFields];
  return fields;
}

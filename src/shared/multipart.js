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
      if (nameMatch && !isFile) {
        fields[nameMatch[1]] = part.subarray(headerEnd + 4).toString("utf8");
      }
    }

    cursor = nextDelimiter;
  }

  return fields;
}

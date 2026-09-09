const SESSION_COOKIE_NAME = "relay_session";

export function getSessionCookie(request) {
  const header = request.headers.cookie;
  if (!header) {
    return null;
  }
  for (const part of header.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const name = part.slice(0, separatorIndex).trim();
    if (name === SESSION_COOKIE_NAME) {
      return decodeURIComponent(part.slice(separatorIndex + 1).trim());
    }
  }
  return null;
}

export function setSessionCookie(response, sessionId, { secure = false } = {}) {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${30 * 24 * 60 * 60}`
  ];
  if (secure) {
    attributes.push("Secure");
  }
  appendSetCookie(response, attributes.join("; "));
}

export function clearSessionCookie(response, { secure = false } = {}) {
  const attributes = [`${SESSION_COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) {
    attributes.push("Secure");
  }
  appendSetCookie(response, attributes.join("; "));
}

function appendSetCookie(response, cookieString) {
  const existing = response.getHeader("Set-Cookie");
  if (!existing) {
    response.setHeader("Set-Cookie", cookieString);
  } else if (Array.isArray(existing)) {
    response.setHeader("Set-Cookie", [...existing, cookieString]);
  } else {
    response.setHeader("Set-Cookie", [existing, cookieString]);
  }
}

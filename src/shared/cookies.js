const SESSION_COOKIE_NAME = "relay_session";

export function getSessionCookie(request) {
  const header = request.headers.cookie;
  if (typeof header !== "string" || header.length > 16384) {
    return null;
  }
  let sessionId = null;
  for (const part of header.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const name = part.slice(0, separatorIndex).trim();
    if (name === SESSION_COOKIE_NAME) {
      if (sessionId !== null) return null;
      try { sessionId = decodeURIComponent(part.slice(separatorIndex + 1).trim()); } catch { return null; }
      if (!sessionId || sessionId.length > 128 || /[\s\x00-\x1f\x7f]/.test(sessionId)) return null;
    }
  }
  return sessionId;
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

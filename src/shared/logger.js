/**
 * Structured logger.
 *
 * Every log line is an event name plus a flat bag of fields — never an
 * interpolated sentence — so that staging/production logs can be filtered and
 * aggregated by `event` and `organization_id` rather than grepped. In deployed
 * environments each line is a single JSON object (what Render's log drain and
 * most log services expect); locally it is rendered as readable text.
 *
 * `child()` returns a logger that stamps fixed fields (a request id, an
 * organization id) onto every line, so a request's logs can be correlated
 * without threading those values through every call.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger({ level = "info", json = true, bindings = {}, write = defaultWrite } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function emit(levelName, event, fields) {
    if (LEVELS[levelName] < threshold) {
      return;
    }
    write(levelName, {
      level: levelName,
      time: new Date().toISOString(),
      event,
      ...bindings,
      ...normalizeFields(fields)
    }, json);
  }

  return {
    level,
    debug: (event, fields) => emit("debug", event, fields),
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
    child: (extraBindings) => createLogger({ level, json, bindings: { ...bindings, ...extraBindings }, write })
  };
}

/**
 * A logger that discards everything. Used by tests so that a suite run does not
 * bury assertion output in application logs.
 */
export function createNullLogger() {
  const noop = () => {};
  return { level: "silent", debug: noop, info: noop, warn: noop, error: noop, child: () => createNullLogger() };
}

function normalizeFields(fields) {
  if (!fields) {
    return {};
  }
  const output = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value instanceof Error) {
      output[key] = { message: value.message, name: value.name, stack: value.stack };
    } else if (typeof value === "bigint") {
      output[key] = value.toString();
    } else {
      output[key] = value;
    }
  }
  return output;
}

function defaultWrite(levelName, record, json) {
  const stream = levelName === "error" || levelName === "warn" ? process.stderr : process.stdout;
  if (json) {
    stream.write(`${safeStringify(record)}\n`);
    return;
  }
  const { level, time, event, ...rest } = record;
  const details = Object.entries(rest)
    .map(([key, value]) => `${key}=${typeof value === "object" ? safeStringify(value) : value}`)
    .join(" ");
  stream.write(`${time.slice(11, 23)} ${level.toUpperCase().padEnd(5)} ${event}${details ? ` ${details}` : ""}\n`);
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    // A circular or otherwise unserialisable field must never take down the
    // process from inside a log call.
    return JSON.stringify({ unserializable: true });
  }
}

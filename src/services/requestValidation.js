const MAX_QUERY_LENGTH = 2000;
const MAX_SESSION_ID_LENGTH = 200;
const MAX_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_FILTERS_BYTES = 20_000;

function validationError(message, code = "INVALID_REQUEST") {
  const error = new Error(message);
  error.status = 400;
  error.code = code;
  error.expose = true;
  return error;
}

function isPlainObject(value) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeRequiredText(value, fieldName) {
  if (typeof value !== "string") {
    throw validationError(`${fieldName} must be text`, "INVALID_QUERY");
  }

  const normalized = value.trim();
  if (!normalized) {
    throw validationError(`${fieldName} is required`, "INVALID_QUERY");
  }
  if (normalized.length > MAX_QUERY_LENGTH) {
    throw validationError(
      `${fieldName} exceeds the ${MAX_QUERY_LENGTH} character limit`,
      "QUERY_TOO_LONG"
    );
  }
  return normalized;
}

function normalizeSessionId(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > MAX_SESSION_ID_LENGTH) {
    throw validationError("sessionId is invalid", "INVALID_SESSION_ID");
  }
  return value.trim() || null;
}

function normalizeFilters(value) {
  const filters = value == null ? {} : value;
  if (!isPlainObject(filters)) {
    throw validationError("filters must be an object", "INVALID_FILTERS");
  }
  if (Buffer.byteLength(JSON.stringify(filters), "utf8") > MAX_FILTERS_BYTES) {
    throw validationError("filters are too large", "FILTERS_TOO_LARGE");
  }
  return filters;
}

function normalizeMessages(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_MESSAGES) {
    throw validationError(
      `messages must contain at most ${MAX_MESSAGES} items`,
      "INVALID_MESSAGES"
    );
  }

  return value.map((message) => {
    if (!isPlainObject(message)) {
      throw validationError("each message must be an object", "INVALID_MESSAGES");
    }
    const content = String(message.content || message.text || "").trim();
    if (!content || content.length > MAX_MESSAGE_LENGTH) {
      throw validationError(
        `each message must contain 1 to ${MAX_MESSAGE_LENGTH} characters`,
        "INVALID_MESSAGES"
      );
    }
    return { ...message, content };
  });
}

function normalizeLimit(value, { fallback, maximum }) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw validationError(
      `limit must be an integer between 1 and ${maximum}`,
      "INVALID_LIMIT"
    );
  }
  return parsed;
}

function validateResearchRequest(body = {}) {
  if (!isPlainObject(body)) {
    throw validationError("request body must be an object");
  }
  return {
    query: normalizeRequiredText(body.query, "query"),
    sessionId: normalizeSessionId(body.sessionId),
    filters: normalizeFilters(body.filters),
  };
}

function validateChatRequest(body = {}) {
  if (!isPlainObject(body)) {
    throw validationError("request body must be an object");
  }
  const question = body.question || body.chatInput || body.message;
  return {
    question: normalizeRequiredText(question, "question"),
    messages: normalizeMessages(body.messages),
    limit: normalizeLimit(body.limit, { fallback: 8, maximum: 20 }),
    filters: normalizeFilters(body.filters),
    sessionId: normalizeSessionId(body.sessionId),
  };
}

module.exports = {
  MAX_QUERY_LENGTH,
  MAX_MESSAGES,
  MAX_MESSAGE_LENGTH,
  validateResearchRequest,
  validateChatRequest,
};

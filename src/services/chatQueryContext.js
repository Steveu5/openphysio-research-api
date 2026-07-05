const FOLLOW_UP_PATTERNS = [
  /^(y|e)\s+(si|en|para|qué|que)\b/i,
  /^(pero|aunque|entonces|además)\b/i,
  /^(qué|que)\s+(pasa|tal|hay|recomiendas|cambia)\b/i,
  /^(y eso|eso|esa|ese|estas|estos|aquello)\b/i,
  /^(and|but|what about|how about|then|also)\b/i,
  /^(explain|clarify|expand|simplify)\b/i,
  /^(explícame|aclara|amplía|resume|simplifica)\b/i,
];

function normalizeMessageContent(message = {}) {
  return String(message.content || message.text || "").trim();
}

function isUserMessage(message = {}) {
  return !["assistant", "bot", "system"].includes(
    String(message.role || message.from || "user").toLowerCase()
  );
}

function isLikelyFollowUp(question = "") {
  const normalized = String(question || "").trim();
  if (!normalized) return false;

  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  return (
    wordCount <= 7 ||
    FOLLOW_UP_PATTERNS.some((pattern) => pattern.test(normalized))
  );
}

function buildContextualEvidenceQuery({ question, messages = [] } = {}) {
  const latestQuestion = String(question || "").trim();
  if (!latestQuestion) return "";
  if (!isLikelyFollowUp(latestQuestion)) return latestQuestion;

  const previousUserMessages = messages
    .filter(isUserMessage)
    .map(normalizeMessageContent)
    .filter(Boolean)
    .filter(
      (content, index, all) =>
        content.toLowerCase() !== latestQuestion.toLowerCase() ||
        index !== all.length - 1
    )
    .slice(-2);

  if (!previousUserMessages.length) return latestQuestion;

  return [
    "Clinical conversation context:",
    ...previousUserMessages.map((content) => `- ${content}`),
    `Follow-up question: ${latestQuestion}`,
  ].join("\n");
}

module.exports = {
  isLikelyFollowUp,
  buildContextualEvidenceQuery,
};

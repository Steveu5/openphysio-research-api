// Builds the text sent to the intent parser for a Chat turn.
//
// There is no follow-up heuristic (word counts, "¿Y...?" patterns): whenever
// the conversation has earlier user turns they are passed as labelled
// context, and the intent parser decides whether the latest question depends
// on them. The parser returns a standalone search query that resolves
// references ("this case", "and the hip?") from the conversation only, and
// ignores the context when the latest question is self-contained or changes
// topic. Only the clinician's own messages are used, never earlier AI output,
// so no clinical detail can enter the search that the user did not write.

const MAX_CONTEXT_MESSAGES = 3;
const MAX_CONTEXT_MESSAGE_LENGTH = 600;
const CONTEXT_HEADER = "Clinical conversation context (earlier user messages):";
const QUESTION_HEADER = "Latest question:";

function normalizeMessageContent(message = {}) {
  return String(message.content || message.text || "").trim();
}

function isUserMessage(message = {}) {
  return !["assistant", "bot", "system"].includes(
    String(message.role || message.from || "user").toLowerCase()
  );
}

function previousUserMessages(question = "", messages = []) {
  const latest = String(question || "").trim().toLowerCase();
  const contents = (Array.isArray(messages) ? messages : [])
    .filter(isUserMessage)
    .map(normalizeMessageContent)
    .filter(Boolean);

  // The client may already include the latest question as the last message.
  if (contents.length && contents[contents.length - 1].toLowerCase() === latest) {
    contents.pop();
  }

  return contents
    .slice(-MAX_CONTEXT_MESSAGES)
    .map((content) => content.slice(0, MAX_CONTEXT_MESSAGE_LENGTH));
}

function buildContextualEvidenceQuery({ question, messages = [] } = {}) {
  const latestQuestion = String(question || "").trim();
  if (!latestQuestion) return "";

  const context = previousUserMessages(latestQuestion, messages);
  if (!context.length) return latestQuestion;

  return [
    CONTEXT_HEADER,
    ...context.map((content) => `- ${content}`),
    `${QUESTION_HEADER} ${latestQuestion}`,
  ].join("\n");
}

function hasConversationContext(query = "") {
  return String(query || "").startsWith(CONTEXT_HEADER);
}

module.exports = {
  buildContextualEvidenceQuery,
  hasConversationContext,
  previousUserMessages,
};

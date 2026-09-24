function publicErrorResponse(error = {}) {
  const requestedStatus = Number(error.status || 500);
  const status =
    requestedStatus >= 400 && requestedStatus <= 599 ? requestedStatus : 500;
  const isPublic = error.expose === true || status < 500;

  return {
    status,
    payload: {
      error:
        (isPublic ? error.message : null) ||
        "Internal server error",
      code:
        error.code ||
        (status >= 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_FAILED"),
      // Usage-limit errors carry the caller's own quota state so the client
      // can show used/limit/reset without guessing.
      ...(isPublic && error.details && /_QUOTA_EXCEEDED$/.test(String(error.code || ""))
        ? { usage: error.details }
        : {}),
    },
  };
}

module.exports = {
  publicErrorResponse,
};

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
    },
  };
}

module.exports = {
  publicErrorResponse,
};

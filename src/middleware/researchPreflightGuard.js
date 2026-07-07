const express = require("express");
const {
  isResearchSearchPreflight,
} = require("./isResearchSearchRequest");

const enhancedHandle = express.application.handle;

express.application.handle = function handleResearchPreflight(
  req,
  res,
  done
) {
  if (isResearchSearchPreflight(req)) {
    req.originalUrl = "/__openphysio_cors_preflight__";
  }

  return enhancedHandle.call(this, req, res, done);
};

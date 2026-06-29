const express = require("express");
const {
  sourceDiagnosticsMiddleware,
  attachSourceDiagnostics,
} = require("./sourceDiagnostics");
const supabaseService = require("../services/supabase");

const originalHandle = express.application.handle;

express.application.handle = function handleWithSourceDiagnostics(
  req,
  res,
  done
) {
  return sourceDiagnosticsMiddleware(
    req,
    res,
    () => originalHandle.call(this, req, res, done)
  );
};

const originalGetCache = supabaseService.getCache;

supabaseService.getCache = async (...args) => {
  const cached = await originalGetCache(...args);

  if (
    cached &&
    !Array.isArray(cached.response_json?.sourceDiagnostics)
  ) {
    return null;
  }

  return cached;
};

const originalSetCache = supabaseService.setCache;

supabaseService.setCache = async (payload) => originalSetCache({
  ...payload,
  responseJson: attachSourceDiagnostics(payload.responseJson),
});

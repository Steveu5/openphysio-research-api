const crypto = require("crypto");
const { getResearchSystemManifest } = require("../config/researchSystemVersion");

function hashQuery(value) {
  const systemFingerprint = getResearchSystemManifest().system_fingerprint;
  return crypto
    .createHash("sha256")
    .update(`${systemFingerprint}:${value}`)
    .digest("hex");
}

module.exports = { hashQuery };

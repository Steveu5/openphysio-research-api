const crypto = require("crypto");
const { RESEARCH_SYSTEM_VERSION } = require("../config/researchSystemVersion");

function hashQuery(value) {
  const versionSalt = JSON.stringify({
    algorithm_version: RESEARCH_SYSTEM_VERSION.algorithm_version,
    ranking_version: RESEARCH_SYSTEM_VERSION.ranking_version,
    evidence_scoring_version: RESEARCH_SYSTEM_VERSION.evidence_scoring_version,
    condition_dictionary_version: RESEARCH_SYSTEM_VERSION.condition_dictionary_version,
    prompts: RESEARCH_SYSTEM_VERSION.prompts,
  });

  return crypto
    .createHash("sha256")
    .update(`${versionSalt}:${value}`)
    .digest("hex");
}

module.exports = { hashQuery };

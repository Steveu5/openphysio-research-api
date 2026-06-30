const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  RANKING_ALGORITHM_VERSION,
  RANKING_WEIGHTS_VERSION,
  RANKING_WEIGHTS,
} = require("./rankingConfig");

const RESEARCH_SYSTEM_VERSION = "1.1.0";
const BENCHMARK_VERSION = "1.0.0";

const COMPONENT_VERSIONS = Object.freeze({
  ranking_algorithm: RANKING_ALGORITHM_VERSION,
  ranking_weights: RANKING_WEIGHTS_VERSION,
  evidence_scoring: "1.0.0",
  evidence_level_classifier: "1.0.0",
  condition_dictionary: "1.0.0",
  trusted_sources: "1.0.0",
  benchmark_contract: BENCHMARK_VERSION,
  prompt_research_intent: "1.0.0",
  prompt_research_answer: "1.0.0",
  prompt_clinical_chat: "1.0.0",
  prompt_clinical_takeaway: "1.0.0",
});

const MODEL_PROFILES = Object.freeze({
  research_intent: Object.freeze({
    provider: "deepseek",
    default_model: "deepseek-chat",
    temperature: 0.1,
    max_tokens: 900,
    response_format: "json_object",
  }),
  research_answer: Object.freeze({
    provider: "deepseek",
    default_model: "deepseek-chat",
    temperature: 0.1,
    max_tokens: 720,
  }),
  clinical_chat: Object.freeze({
    provider: "deepseek",
    default_model: "deepseek-chat",
    temperature: 0.12,
    max_tokens: 1300,
  }),
  clinical_takeaway: Object.freeze({
    provider: "deepseek",
    default_model: "deepseek-chat",
    temperature: 0.1,
    max_tokens: 220,
  }),
});

const SOURCE_FILES = Object.freeze({
  prompts: path.resolve(__dirname, "../services/deepseek.js"),
  ranking: path.resolve(__dirname, "../services/ranking.js"),
  ranking_weights: path.resolve(__dirname, "rankingConfig.js"),
  evidence_scoring: path.resolve(__dirname, "../services/evidenceScoring.js"),
  evidence_level_classifier: path.resolve(__dirname, "../services/evidenceLevel.js"),
  condition_dictionary: path.resolve(__dirname, "../services/preferredGuidelineSearch.js"),
  trusted_sources: path.resolve(__dirname, "../services/trustedSources.js"),
});

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(typeof value === "string" ? value : stableStringify(value))
    .digest("hex");
}

function hashFile(filePath) {
  try {
    return sha256(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function getSourceFingerprints() {
  return Object.fromEntries(
    Object.entries(SOURCE_FILES).map(([name, filePath]) => [name, hashFile(filePath)])
  );
}

function getBuildMetadata() {
  return {
    commit_sha:
      process.env.GIT_COMMIT_SHA ||
      process.env.RENDER_GIT_COMMIT ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.SOURCE_VERSION ||
      null,
    environment:
      process.env.RESEARCH_ENVIRONMENT ||
      process.env.NODE_ENV ||
      "development",
  };
}

function getResearchSystemManifest({ includeConfig = false } = {}) {
  const sourceFingerprints = getSourceFingerprints();
  const configFingerprint = sha256({
    component_versions: COMPONENT_VERSIONS,
    model_profiles: MODEL_PROFILES,
    ranking_weights: RANKING_WEIGHTS,
  });
  const systemFingerprint = sha256({
    research_system_version: RESEARCH_SYSTEM_VERSION,
    component_versions: COMPONENT_VERSIONS,
    source_fingerprints: sourceFingerprints,
    config_fingerprint: configFingerprint,
  });

  const manifest = {
    research_system_version: RESEARCH_SYSTEM_VERSION,
    system_fingerprint: systemFingerprint,
    config_fingerprint: configFingerprint,
    component_versions: COMPONENT_VERSIONS,
    model_profiles: MODEL_PROFILES,
    source_fingerprints: sourceFingerprints,
    build: getBuildMetadata(),
  };

  if (includeConfig) {
    manifest.ranking_weights = RANKING_WEIGHTS;
  }

  return manifest;
}

module.exports = {
  RESEARCH_SYSTEM_VERSION,
  BENCHMARK_VERSION,
  COMPONENT_VERSIONS,
  MODEL_PROFILES,
  stableStringify,
  sha256,
  getSourceFingerprints,
  getResearchSystemManifest,
};

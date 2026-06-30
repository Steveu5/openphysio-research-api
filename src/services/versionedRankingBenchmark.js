const { runRankingBenchmark } = require("./rankingBenchmark");
const { getResearchSystemManifest } = require("../config/researchSystemVersion");

function runVersionedRankingBenchmark(options = {}) {
  const benchmark = runRankingBenchmark(options);
  const system = getResearchSystemManifest({ includeConfig: true });

  return {
    report_schema_version: "1.0.0",
    report_id: `${system.research_system_version}-${system.system_fingerprint.slice(0, 12)}-${benchmark.benchmark_version}`,
    system,
    ...benchmark,
  };
}

module.exports = {
  runVersionedRankingBenchmark,
};

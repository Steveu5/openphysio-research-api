function cleanTerm(value = "") {
  return String(value || "")
    .replace(/[()"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildPreferredGuidelineQueries(intent = {}, originalQuery = "") {
  const condition = cleanTerm(intent.condition || intent.normalized_query || originalQuery);
  const bodyRegion = cleanTerm(intent.body_region || "");

  const baseCondition = condition || bodyRegion;
  if (!baseCondition) return [];

  const queryTargets = [
    `"${baseCondition}" "clinical practice guideline" physiotherapy`,
    `"${baseCondition}" "clinical practice guideline" "physical therapy"`,
    `"${baseCondition}" "Journal of Orthopaedic & Sports Physical Therapy"`,
    `"${baseCondition}" JOSPT guideline`,
    `"${baseCondition}" "Academy of Orthopaedic Physical Therapy"`,
    `"${baseCondition}" APTA guideline`,
  ];

  if (bodyRegion && bodyRegion !== baseCondition) {
    queryTargets.push(
      `"${bodyRegion}" "clinical practice guideline" physiotherapy`,
      `"${bodyRegion}" JOSPT guideline`
    );
  }

  // Common synonyms where guideline titles often differ from user wording.
  const lower = baseCondition.toLowerCase();
  if (lower.includes("low back") || lower.includes("lumbar")) {
    queryTargets.push(
      `"low back pain" "Journal of Orthopaedic & Sports Physical Therapy"`,
      `"low back pain" JOSPT "clinical practice guideline"`,
      `"acute and chronic low back pain" "clinical practice guideline"`,
      `"interventions for the management of acute and chronic low back pain"`
    );
  }

  if (lower.includes("achilles")) {
    queryTargets.push(
      `"Achilles tendinopathy" "clinical practice guideline" physiotherapy`,
      `"Achilles tendinopathy" JOSPT guideline`
    );
  }

  if (lower.includes("rotator cuff") || lower.includes("shoulder")) {
    queryTargets.push(
      `"rotator cuff" "clinical practice guideline" physiotherapy`,
      `"shoulder pain" JOSPT guideline`
    );
  }

  if (lower.includes("knee") || lower.includes("osteoarthritis")) {
    queryTargets.push(
      `"knee osteoarthritis" "clinical practice guideline" physiotherapy`,
      `"knee osteoarthritis" JOSPT guideline`
    );
  }

  return Array.from(new Set(queryTargets)).slice(0, 8);
}

module.exports = { buildPreferredGuidelineQueries };

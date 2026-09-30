// Condition hierarchy and relationship between a question and a source.
//
// The data below only describes vocabulary: which conditions are umbrella
// terms, which are specific conditions inside them, and which are related
// without being the same (for example a condition of cervical origin and
// neck pain). No behavior is attached to any condition; the rules in
// `conditionRelationship` are the same for every node:
//
//   exact      the source names the condition asked
//   parent     the source names only a broader umbrella of it
//   child      the question is broad and the source names a specific subtype
//   related    the source names a condition explicitly related to it
//   component  the source names another condition the question itself frames
//              (e.g. a co-existing condition in the population)
//   sibling    the source names a different condition of the same family
//   different  the source names only conditions of other families
//   unknown    the question or the source names no known condition
//
// Unknown conditions keep the lexical matching unchanged, so the tree can be
// extended one family at a time.

function normalizeText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const CONDITION_TREE = [
  { id: "headache", aliases: ["headache", "headaches", "head pain", "cephalalgia", "cephalgia", "cefalea", "cefaleas", "dolor de cabeza"] },
  { id: "migraine", parent: "headache", aliases: ["migraine", "migraines", "migraine headache", "migraine disorders", "migrana", "migranas"] },
  { id: "tension_type_headache", parent: "headache", aliases: ["tension-type headache", "tension type headache", "tension-type headaches", "tension headache", "cefalea tensional", "cefalea de tipo tensional"] },
  { id: "cervicogenic_headache", parent: "headache", related: ["neck_pain"], aliases: ["cervicogenic headache", "cervicogenic headaches", "cefalea cervicogenica", "headache of cervical origin", "cervicogenic cephalalgia", "cervical headache"] },
  { id: "cluster_headache", parent: "headache", aliases: ["cluster headache", "cluster headaches"] },
  { id: "medication_overuse_headache", parent: "headache", aliases: ["medication-overuse headache", "medication overuse headache"] },
  { id: "post_dural_puncture_headache", parent: "headache", aliases: ["post-dural puncture headache", "post dural puncture headache", "postdural puncture headache", "post-lumbar puncture headache"] },

  { id: "neck_pain", aliases: ["neck pain", "cervical pain", "cervical spine pain", "cervicalgia", "dolor cervical", "dolor de cuello", "mechanical neck pain", "nonspecific neck pain", "non-specific neck pain", "mechanical neck disorders", "neck disorders"] },
  { id: "whiplash", parent: "neck_pain", aliases: ["whiplash", "whiplash-associated disorders", "whiplash associated disorders", "whiplash-associated disorder", "latigazo cervical"] },
  { id: "cervical_radiculopathy", parent: "neck_pain", aliases: ["cervical radiculopathy", "cervical radicular pain", "cervicobrachial pain", "radiculopatia cervical"] },

  { id: "low_back_pain", aliases: ["low back pain", "low-back pain", "lumbar pain", "lumbago", "lumbalgia", "dolor lumbar", "nonspecific low back pain", "non-specific low back pain", "mechanical low back pain"] },
  { id: "lumbar_radiculopathy", parent: "low_back_pain", aliases: ["lumbar radiculopathy", "sciatica", "ciatica", "lumbosacral radicular syndrome", "lumbar radicular pain", "radiculopatia lumbar"] },
  { id: "lumbar_spinal_stenosis", parent: "low_back_pain", aliases: ["lumbar spinal stenosis", "lumbar stenosis", "estenosis lumbar"] },

  { id: "shoulder_pain", aliases: ["shoulder pain", "dolor de hombro"] },
  { id: "rotator_cuff_related_shoulder_pain", parent: "shoulder_pain", aliases: ["rotator cuff related shoulder pain", "rotator cuff-related shoulder pain", "rotator cuff tendinopathy", "subacromial pain", "subacromial pain syndrome", "shoulder impingement", "subacromial impingement", "manguito rotador"] },
  { id: "frozen_shoulder", parent: "shoulder_pain", aliases: ["frozen shoulder", "adhesive capsulitis", "capsulitis adhesiva", "hombro congelado"] },
  { id: "shoulder_instability", parent: "shoulder_pain", aliases: ["shoulder instability", "shoulder dislocation", "inestabilidad de hombro"] },

  { id: "knee_pain", aliases: ["knee pain", "dolor de rodilla"] },
  { id: "anterior_knee_pain", parent: "knee_pain", aliases: ["anterior knee pain", "dolor anterior de rodilla"] },
  { id: "patellofemoral_pain", parent: "anterior_knee_pain", aliases: ["patellofemoral pain", "patellofemoral pain syndrome", "patellofemoral syndrome", "chondromalacia patellae", "dolor patelofemoral", "sindrome patelofemoral", "dolor femoropatelar"] },
  { id: "patellar_tendinopathy", parent: "anterior_knee_pain", aliases: ["patellar tendinopathy", "patellar tendinitis", "patellar tendinosis", "jumper's knee", "jumpers knee", "jumper knee", "tendinopatia rotuliana", "tendinopatia patelar"] },
  { id: "knee_osteoarthritis", parent: "knee_pain", aliases: ["knee osteoarthritis", "osteoarthritis of the knee", "knee oa", "hip and knee osteoarthritis", "hip or knee osteoarthritis", "knee and hip osteoarthritis", "gonarthrosis", "artrosis de rodilla", "osteoartritis de rodilla"] },
  { id: "meniscal_cartilage_lesion", parent: "knee_pain", aliases: ["meniscal", "meniscus", "menisci", "articular cartilage lesions", "articular cartilage lesion", "cartilage lesions", "lesion meniscal", "menisco"] },
  { id: "acl_injury", parent: "knee_pain", aliases: ["anterior cruciate ligament", "acl", "ligamento cruzado anterior", "lca"] },
  { id: "iliotibial_band_syndrome", parent: "knee_pain", aliases: ["iliotibial band syndrome", "iliotibial band", "itbs", "cintilla iliotibial"] },
];

const NODES = new Map(CONDITION_TREE.map((node) => [node.id, node]));

function cleanText(value = "") {
  return ` ${normalizeText(value).replace(/[^a-z0-9'\s-]/g, " ").replace(/\s+/g, " ").trim()} `;
}

const ALIAS_INDEX = CONDITION_TREE.flatMap((node) =>
  node.aliases.map((alias) => ({ id: node.id, alias: cleanText(alias).trim() }))
).sort((left, right) => right.alias.length - left.alias.length);

function ancestors(id) {
  const result = [];
  let node = NODES.get(id);
  while (node?.parent) {
    result.push(node.parent);
    node = NODES.get(node.parent);
  }
  return result;
}

function isAncestor(candidate, id) {
  return ancestors(id).includes(candidate);
}

function sharesFamily(left, right) {
  const leftLine = [left, ...ancestors(left)];
  return [right, ...ancestors(right)].some((id) => leftLine.includes(id));
}

function areRelated(left, right) {
  const relatedTo = (a, b) => (NODES.get(a)?.related || []).some(
    (id) => id === b || isAncestor(id, b)
  );
  return relatedTo(left, right) || relatedTo(right, left);
}

// Conditions named in a text. A longer alias wins over the shorter one it
// contains ("tension-type headache" is not also "headache").
function conditionsIn(text = "") {
  let remaining = cleanText(text);
  const found = new Set();
  for (const { id, alias } of ALIAS_INDEX) {
    const needle = ` ${alias} `;
    if (!remaining.includes(needle)) continue;
    found.add(id);
    remaining = remaining.split(needle).join(" | ");
  }
  return Array.from(found);
}

// The most specific conditions: an umbrella named next to one of its own
// subtypes describes the subtype ("knee pain ... meniscal lesions").
function mostSpecific(ids = []) {
  return ids.filter((id) => !ids.some((other) => other !== id && isAncestor(id, other)));
}

// Conditions the question asks about, and other conditions its framing
// names (population, normalized query) outside the asked family.
function questionConditions(intent = {}) {
  const anchorText = intent.condition || intent.normalized_query || "";
  const asked = mostSpecific(conditionsIn(anchorText));
  const framing = conditionsIn(
    [intent.condition, intent.population, intent.normalized_query].filter(Boolean).join(" | ")
  );
  const components = mostSpecific(
    framing.filter((id) => !asked.some((a) => sharesFamily(a, id) || areRelated(a, id)))
  );
  return { asked, components };
}

const RELATION_RANK = { exact: 5, parent: 4, child: 4, related: 4, component: 3, sibling: 2, different: 1 };
const CEILINGS = { exact: null, parent: "partial", child: "partial", related: "partial", component: "partial", sibling: "tangential", different: "tangential", unknown: null };

function relationBetween(askedId, sourceId) {
  if (askedId === sourceId) return "exact";
  if (isAncestor(sourceId, askedId)) return "parent";
  if (isAncestor(askedId, sourceId)) return "child";
  if (areRelated(askedId, sourceId)) return "related";
  if (sharesFamily(askedId, sourceId)) return "sibling";
  return "different";
}

function conditionRelationship(article = {}, intent = {}) {
  const question = questionConditions(intent);
  const title = [article.title, article.library_resource?.title].filter(Boolean).join(" | ");
  const named = conditionsIn(title);
  const source = mostSpecific(named);
  if (!question.asked.length || !source.length) {
    return { relation: "unknown", ceiling: null, asked: question.asked, source };
  }

  let relation = "different";
  for (const sourceId of source) {
    const candidates = question.asked.map((askedId) => relationBetween(askedId, sourceId));
    if (question.components.includes(sourceId)) candidates.push("component");
    for (const candidate of candidates) {
      if (RELATION_RANK[candidate] > RELATION_RANK[relation]) relation = candidate;
    }
  }
  return { relation, ceiling: CEILINGS[relation], asked: question.asked, source, components: question.components };
}

// How each parser condition term relates to the asked condition: a synonym
// (same condition or unknown to the tree), a broader parent, a narrower
// child, a related or framed co-existing condition, or a sibling / other
// condition that must not count as the same diagnosis.
function classifyConditionTerm(term = "", intent = {}) {
  const question = questionConditions(intent);
  const ids = mostSpecific(conditionsIn(term));
  if (!question.asked.length || !ids.length) return "synonym";
  const relations = ids.flatMap((id) => [
    ...question.asked.map((askedId) => relationBetween(askedId, id)),
    ...(question.components.includes(id) ? ["component"] : []),
  ]);
  if (relations.includes("exact")) return "synonym";
  for (const relation of ["parent", "related", "component", "child", "sibling"]) {
    if (relations.includes(relation)) return relation;
  }
  return "different";
}

module.exports = {
  CONDITION_TREE,
  conditionsIn,
  questionConditions,
  conditionRelationship,
  classifyConditionTerm,
};

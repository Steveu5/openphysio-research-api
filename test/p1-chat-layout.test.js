const test = require("node:test");
const assert = require("node:assert/strict");
const { renderConciseChatReply, refineStructuredClinicalChatFinal } = require("../src/services/chatFinalRefinement");
const { chatLayout } = require("../src/services/chatAnswerLayout");

const c = (text, i = 1) => ({ text, source_indices: [i] });
const base = {
  brief_answer: [c("Respuesta breve.")],
  evidence_points: [c("Hallazgo de la evidencia.")],
  clinical_application: [c("Aplicación.")],
  assessment_considerations: [c("Consideración.")],
  precautions: [c("Limitación.")],
  confidence: { level: "Moderado", score: 70, rationale: "Motivo." },
};
const headings = (reply) => (reply.match(/\*\*[^*]+\*\*/g) || []).map((h) => h.replace(/\*/g, ""));

test("sections and titles follow the question type", () => {
  assert.deepEqual(headings(renderConciseChatReply(base, "es", { questionType: "treatment" })).slice(1, 5), ["Qué muestra la evidencia", "Aplicación clínica", "Antes de aplicarlo", "Limitaciones"]);
  assert.deepEqual(headings(renderConciseChatReply(base, "es", { questionType: "comparison" })).slice(1, 3), ["Qué dice la evidencia comparativa", "Diferencias relevantes"]);
  assert.deepEqual(headings(renderConciseChatReply(base, "es", { questionType: "diagnosis" })).slice(1, 3), ["Qué considerar", "Hallazgos relevantes"]);
  assert.deepEqual(headings(renderConciseChatReply(base, "es", { questionType: "progression" })).slice(1, 4), ["Principios", "Cómo progresar", "Qué monitorizar"]);
  assert.equal(headings(renderConciseChatReply(base, "en", { questionType: "progression" }))[1], "Principles");
});

test("empty sections are omitted: a short answer stays short", () => {
  const short = { brief_answer: [c("Sí, con matices.")], evidence_points: [c("Un ensayo lo respalda.")], confidence: base.confidence };
  const reply = renderConciseChatReply(short, "es", { questionType: "treatment" });
  assert.deepEqual(headings(reply), ["Respuesta clínica", "Qué muestra la evidencia", "Confianza"]);
});

test("red flags: safety first and no routine application section", () => {
  const redFlag = { ...base, brief_answer: [{ text: "Prioridad de seguridad: deriva.", source_indices: [] }], safety: { status: "red_flag" } };
  const reply = renderConciseChatReply(redFlag, "es", { questionType: "treatment" });
  assert.match(reply.split("\n")[1], /^Prioridad de seguridad/);
  assert.doesNotMatch(reply, /Aplicación clínica/);
  assert.equal(headings(reply)[1], "Seguridad");
  assert.deepEqual(chatLayout("comparison", { redFlag: true }), chatLayout("safety"));
  const noPoints = renderConciseChatReply({ ...redFlag, evidence_points: [], evidence_relationships: [c("Relación genérica.")] }, "es", {});
  assert.doesNotMatch(noPoints, /Cómo se relaciona la evidencia/);
});

test("the generic relationship sentence is only a fallback without evidence points", () => {
  const articles = [{ study_type: "systematic review", evidence_level_rank: 9 }, { study_type: "randomized controlled trial", evidence_level_rank: 7 }];
  const withPoints = refineStructuredClinicalChatFinal({ ...base }, articles, "es", { intent: {} });
  assert.equal(withPoints.evidence_relationships.length, 0);
  assert.equal(withPoints.evidence_points.length, 1);
  const withoutPoints = refineStructuredClinicalChatFinal({ ...base, evidence_points: [] }, articles, "es", { intent: {} });
  assert.equal(withoutPoints.evidence_relationships.length, 1);
});

test("every question type has a layout that shares the same identity", () => {
  for (const type of ["treatment", "general", "comparison", "diagnosis", "progression", "prognosis", "return_to_sport", "interpretation", "safety"]) {
    const layout = chatLayout(type);
    assert.ok(layout.length >= 3 && layout.length <= 4, type);
    assert.ok(layout.some(([field]) => field === "evidence_points"), type);
  }
});

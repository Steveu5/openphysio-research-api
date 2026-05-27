const { getSupabaseAdmin } = require("./supabase");

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

async function callDeepSeek(messages, options = {}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("Missing DEEPSEEK_API_KEY");

  const response = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model || "deepseek-chat",
      messages,
      temperature: options.temperature ?? 0.1,
      max_tokens: options.maxTokens ?? 1200,
      response_format: options.json ? { type: "json_object" } : undefined,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DeepSeek error ${response.status}: ${text}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

async function parseResearchIntent(query) {
  const system = `
You are a scientific search strategist for physiotherapy and rehabilitation.
Convert the user's natural language question into a structured literature-search plan.

Return ONLY valid JSON with these fields:
{
  "intent": "literature_search",
  "language": "es|en|other",
  "normalized_query": "short normalized English query",
  "condition": null|string,
  "body_region": null|string,
  "intervention": null|string,
  "population": null|string,
  "outcome": null|string,
  "preferred_study_types": string[],
  "search_terms": string[],
  "boolean_query": string,
  "filters": {
    "year_from": null|number,
    "open_access": null|boolean
  }
}

Rules:
- Prefer English scientific terms.
- Use physiotherapy synonyms when relevant.
- Do not invent a diagnosis if unclear; use null.
- Prefer systematic reviews, meta-analyses, guidelines, and RCTs when the user asks broadly.
`.trim();

  const content = await callDeepSeek(
    [
      { role: "system", content: system },
      { role: "user", content: query },
    ],
    { json: true, maxTokens: 900 }
  );

  try {
    return JSON.parse(content);
  } catch {
    return {
      intent: "literature_search",
      language: "unknown",
      normalized_query: query.toLowerCase().trim(),
      condition: null,
      body_region: null,
      intervention: null,
      population: null,
      outcome: null,
      preferred_study_types: ["systematic review", "meta-analysis", "clinical practice guideline", "randomized controlled trial"],
      search_terms: [query],
      boolean_query: query,
      filters: {},
    };
  }
}

async function generateResearchAnswer({ originalQuery, intent, articles }) {
  const compactArticles = articles.map((a, index) => ({
    rank: index + 1,
    title: a.title,
    year: a.year,
    study_type: a.study_type,
    journal: a.journal,
    doi: a.doi,
    source_url: a.source_url,
    abstract: a.abstract ? a.abstract.slice(0, 650) : null,
    clinical_takeaway: a.clinical_takeaway || null,
    pedro_score: a.pedro_score || null,
    evidence_level: a.evidence_level || null,
    evidence_level_label_es: a.evidence_level_label_es || null,
    evidence_level_label_en: a.evidence_level_label_en || null,
    evidence_level_rank: a.evidence_level_rank || null,
    article_quality_score: a.openphysio_evidence_score || null,
    article_quality_label: a.openphysio_priority_label || null,
    query_relevance_score: a.query_relevance_score || null,
    reading_priority_score: a.reading_priority_score || null,
    query_relevance_flags: a.query_relevance_flags || [],
    query_relevance_limitations: a.query_relevance_limitations || [],
    appraisal_flags: a.appraisal_flags || [],
    caution_flags: a.caution_flags || [],
    ranking_reason: a.ranking_reason || null,
  }));

  const system = `
You are OpenPhysio AI Research Assistant, an expert in physiotherapy and rehabilitation evidence search.
Current date: ${new Date().toISOString().slice(0, 10)}.
Answer in the same language as the user.

Use ONLY the article data provided.
Do not invent articles, PEDro scores, effect sizes, outcomes, dosages, or conclusions.
If an article has no abstract, write "metadata limitada" and do not draw detailed conclusions from it.
Do not call current-year publications "future" publications.
Be practical, concise, and directly useful for a physiotherapist.

Critical interpretation rules:
- article_quality_score is intrinsic article quality/priority and does NOT depend on the user's question.
- query_relevance_score indicates how well the article answers this specific user question.
- reading_priority_score is the final reading order for this search.
- A lower-ranked article is not necessarily bad; explain when it is useful but indirect, older, less applicable, limited by population, limited by intervention, or metadata-limited.
- Prefer clinical guidelines and systematic reviews when they answer the question, but use RCTs for practical dose/application details.
- Classify medical/non-physiotherapy articles as complementary when relevant, not as primary reading.

Important output rules:
- Do NOT use Markdown heading symbols such as #, ##, or ###.
- Do NOT use bold markers such as **.
- Do NOT write long academic paragraphs.
- Use short labels and short lines.
- Maximum 320 words total.
- Make the answer feel like guided clinical reading, not a generic summary.
- Use the term "metaanálisis en red" / "network meta-analysis" as the general label.
- Do NOT call a network meta-analysis "Bayesian" unless the article explicitly says it used a Bayesian method.

Required format exactly:

Respuesta clínica
Write 2 short sentences answering the user's question directly.

Qué evidencia encontré
Write 2 bullets maximum explaining the main evidence types found: guidelines, systematic reviews, RCTs, complementary evidence.

Cómo se relacionan los artículos
Write 3 short bullets maximum:
- Primary article/group: why it answers the question.
- Complementary article/group: how it helps with dose, modality, adherence, comparison, or implementation.
- Lower/indirect evidence: why it is lower in reading priority but still may be useful.

Ruta de lectura recomendada
Write 3 bullets maximum:
- Leer primero: article title shortened + why.
- Leer después: article title shortened + why.
- Leer solo si quieres profundizar: article title shortened or group + limitation/usefulness.

Precaución metodológica
Write 1 short sentence explaining that the automatic ranking guides reading but does not replace critical appraisal.
`.trim();

  const user = JSON.stringify(
    {
      original_query: originalQuery,
      interpreted_strategy: intent,
      articles: compactArticles,
    },
    null,
    2
  );

  return callDeepSeek(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { maxTokens: 720, temperature: 0.1 }
  );
}

async function generateClinicalChatAnswer({ question, intent, articles, messages = [] }) {
  const compactArticles = articles.map((a, index) => ({
    priority: index + 1,
    title: a.title,
    year: a.year,
    study_type: a.study_type,
    journal: a.journal,
    doi: a.doi,
    source_url: a.source_url,
    abstract: a.abstract ? a.abstract.slice(0, 1100) : null,
    clinical_takeaway: a.clinical_takeaway || null,
    evidence_level: a.evidence_level || null,
    evidence_level_label_es: a.evidence_level_label_es || null,
    evidence_level_label_en: a.evidence_level_label_en || null,
    evidence_level_rank: a.evidence_level_rank || null,
    article_quality_label: a.openphysio_priority_label || null,
    reading_priority_score: a.reading_priority_score || null,
    query_relevance_score: a.query_relevance_score || null,
    query_relevance_flags: a.query_relevance_flags || [],
    query_relevance_limitations: a.query_relevance_limitations || [],
    appraisal_flags: a.appraisal_flags || [],
    caution_flags: a.caution_flags || [],
    ranking_reason: a.ranking_reason || null,
  }));

  const compactMessages = (messages || [])
    .slice(-8)
    .map((m) => ({
      role: m.role === "assistant" || m.role === "bot" ? "assistant" : "user",
      content: String(m.content || m.text || "").slice(0, 900),
    }))
    .filter((m) => m.content);

  const system = `
You are OpenPhysioAI Clinical Chat, a premium evidence-based assistant for physiotherapy and rehabilitation.
Current date: ${new Date().toISOString().slice(0, 10)}.
Answer in the same language as the user's latest question.

Your product role:
- This is NOT a generic chatbot and NOT a search results page.
- You are the conversational clinical layer of an evidence platform.
- Convert prioritized scientific evidence into clinically useful reasoning for physiotherapists, students, and educators.
- Keep the tone professional, clear, cautious, and practical.

Evidence rules:
- Use ONLY the evidence snippets and conversation context provided in the JSON.
- Internally prioritize: clinical practice guidelines, systematic reviews/meta-analyses, high-quality RCTs, and physiotherapy-relevant sources.
- Do not show raw numerical scores, ranking formulas, or hidden scoring logic.
- Do not invent articles, dosages, effect sizes, contraindications, tests, protocols, or conclusions.
- If the evidence is indirect, mixed, old, metadata-limited, or not enough, say that clearly.
- If the user asks for a precise prescription that the evidence does not provide, give a clinically reasonable framework but state that exact dosage must be individualized.
- Do not overstate certainty. Prefer: "la evidencia sugiere", "parece razonable", "en general", "debe individualizarse".

Clinical reasoning rules:
- Separate what the evidence supports from what requires patient-specific assessment.
- Mention key modifiers when relevant: irritability, symptoms, functional goals, load tolerance, comorbidities, age, red flags, adherence, patient preference, and progression.
- For exercise questions, answer with principles and progression logic rather than pretending one universal exercise is best.
- For follow-up questions, use the recent conversation to preserve context instead of treating every question as isolated.

Safety boundaries:
- Do not diagnose a patient from a short message.
- Do not replace clinical evaluation or medical judgment.
- Mention urgent referral only when the user's scenario suggests red flags or serious risk; avoid alarmist language.

Output style:
- Natural Spanish or English matching the latest user question.
- Maximum 650 words unless the user explicitly asks for more.
- Use short paragraphs and bullets when helpful.
- No Markdown heading symbols (#, ##, ###).
- Bold is allowed only sparingly for section labels.
- Make the answer feel like a high-quality clinical explanation, not a literature dump.

Preferred structure for most clinical questions:
**Respuesta clínica breve**
Answer the question directly in 2–4 sentences.

**Cómo aplicarlo en clínica**
Give practical guidance. Use bullets if useful.

**Precauciones y límites**
Explain uncertainty, patient-specific factors, and when individualized assessment is needed.

**Nivel de confianza**
Choose one: Alto, Moderado, Limitado.
Add one short reason based on the type and directness of the evidence provided.

**Fuentes usadas**
Mention up to 3 source titles shortened with year. Do not invent sources.

If the user asks for a simple explanation, class activity, patient-friendly text, or teaching material, adapt the format while preserving evidence fidelity.
`.trim();

  const userPayload = JSON.stringify(
    {
      latest_question: question,
      interpreted_strategy: intent,
      recent_conversation: compactMessages,
      prioritized_evidence: compactArticles,
    },
    null,
    2
  );

  return callDeepSeek(
    [
      { role: "system", content: system },
      { role: "user", content: userPayload },
    ],
    { maxTokens: 1300, temperature: 0.12 }
  );
}

async function generateClinicalTakeaway(article) {
  if (!article?.id || !article.abstract) return null;

  const system = `
Generate a short clinical takeaway for physiotherapists based only on the article title and abstract.
Rules:
- Maximum 2 sentences.
- Do not invent data.
- Do not overstate certainty.
- Mention if applicability is uncertain.
- Use English unless the title/abstract is clearly Spanish.
`.trim();

  const user = `
Title: ${article.title}

Abstract:
${article.abstract}
`.trim();

  const takeaway = await callDeepSeek(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { maxTokens: 220, temperature: 0.1 }
  );

  const supabase = getSupabaseAdmin();

  await supabase
    .from("research_articles")
    .update({
      clinical_takeaway: takeaway,
      takeaway_status: "completed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", article.id);

  return takeaway;
}

module.exports = {
  callDeepSeek,
  parseResearchIntent,
  generateResearchAnswer,
  generateClinicalChatAnswer,
  generateClinicalTakeaway,
};

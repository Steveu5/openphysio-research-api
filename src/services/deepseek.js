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
    abstract: a.abstract ? a.abstract.slice(0, 800) : null,
    clinical_takeaway: a.clinical_takeaway || null,
    evidence_level: a.evidence_level || null,
    evidence_level_label_es: a.evidence_level_label_es || null,
    evidence_level_rank: a.evidence_level_rank || null,
    article_quality_label: a.openphysio_priority_label || null,
    reading_priority_score: a.reading_priority_score || null,
    query_relevance_score: a.query_relevance_score || null,
    caution_flags: a.caution_flags || [],
    ranking_reason: a.ranking_reason || null,
  }));

  const compactMessages = (messages || [])
    .slice(-6)
    .map((m) => ({
      role: m.role === "assistant" || m.role === "bot" ? "assistant" : "user",
      content: String(m.content || m.text || "").slice(0, 700),
    }))
    .filter((m) => m.content);

  const system = `
You are OpenPhysioAI Clinical Chat, a physiotherapy evidence assistant.
Current date: ${new Date().toISOString().slice(0, 10)}.
Answer in the same language as the user's latest question.

Your role:
- Respond as a clinical conversation, not as a search results page.
- Use ONLY the provided evidence snippets and conversation context.
- Prioritize higher-quality and more directly relevant evidence internally, but do not show numerical scores.
- Be practical for physiotherapists and students.
- Explain uncertainty clearly.

Safety and fidelity rules:
- Do not invent articles, statistics, effect sizes, protocols, doses, or contraindications.
- If the evidence is indirect, limited, or not enough, say so.
- Do not diagnose a patient or replace professional clinical judgment.
- If the question needs individualized evaluation, mention the need for assessment.
- Avoid alarmist language.

Output style:
- Natural, conversational Spanish or English matching the user.
- Short paragraphs.
- Use bullets only when useful.
- Maximum 450 words.
- Do not show raw scores.
- Mention that evidence was prioritized automatically, but keep it subtle.

Recommended structure, unless the user asks for something different:
1. Direct answer.
2. Practical clinical application.
3. Precautions or limitations.
4. Sources used: list up to 3 shortened titles with year.
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
    { maxTokens: 900, temperature: 0.15 }
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

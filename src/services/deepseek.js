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
    abstract: a.abstract ? a.abstract.slice(0, 1200) : null,
    clinical_takeaway: a.clinical_takeaway || null,
    pedro_score: a.pedro_score || null,
    relevance_score: a.relevance_score || null,
  }));

const system = `
You are OpenPhysio AI Research Assistant, an expert in physiotherapy evidence search.
Current date: ${new Date().toISOString().slice(0, 10)}.
Answer in the same language as the user.

Use only the article data provided. Do not invent articles, PEDro scores, outcomes, or conclusions.
Do not describe current-year publications as "future" publications. If an article has limited metadata or no abstract, say that evidence details are limited.
Be practical and clinically useful.

Use only the article data provided. Do not invent articles, PEDro scores, outcomes, or conclusions.
Be practical and clinically useful.

Response structure:
1. Brief answer: what was found.
2. Best articles to read first.
3. Why they are relevant.
4. Important limitations.
5. Suggested next search refinement.

Keep it concise but useful.
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
    { maxTokens: 1400, temperature: 0.1 }
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
  generateClinicalTakeaway,
};

const { fetchWithRetry } = require("../utils/fetchWithRetry");
const {
  buildProfessionalPubMedQuery,
  filterProfessionalArticles,
} = require("./trustedSources");

function decodeXmlEntities(value = "") {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const codePoint = parseInt(hex, 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
    })
    .replace(/&#(\d+);/g, (_, decimal) => {
      const codePoint = parseInt(decimal, 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
    })
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripXml(value = "") {
  return decodeXmlEntities(String(value).replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function getTagValue(xml, tagName) {
  const match = xml.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? stripXml(match[1]) : null;
}

function getAllTagValues(xml, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  const values = [];
  let match;

  while ((match = regex.exec(xml)) !== null) {
    const value = stripXml(match[1]);
    if (value) values.push(value);
  }

  return values;
}

function getPubmedYear(articleXml) {
  const pubDateMatch = articleXml.match(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>[\s\S]*?<\/PubDate>/i);
  if (pubDateMatch?.[1]) return Number(pubDateMatch[1]);

  const articleDateMatch = articleXml.match(/<ArticleDate[^>]*>[\s\S]*?<Year>(\d{4})<\/Year>[\s\S]*?<\/ArticleDate>/i);
  if (articleDateMatch?.[1]) return Number(articleDateMatch[1]);

  return null;
}

function getPublicationDate(articleXml) {
  const year = getPubmedYear(articleXml);
  if (!year) return null;

  const monthMatch = articleXml.match(/<PubDate>[\s\S]*?<Month>([^<]+)<\/Month>[\s\S]*?<\/PubDate>/i);
  const dayMatch = articleXml.match(/<PubDate>[\s\S]*?<Day>([^<]+)<\/Day>[\s\S]*?<\/PubDate>/i);

  const monthRaw = monthMatch?.[1] || "01";
  const dayRaw = dayMatch?.[1] || "01";

  const monthMap = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };

  const month = /^\d+$/.test(monthRaw)
    ? String(monthRaw).padStart(2, "0").slice(0, 2)
    : monthMap[String(monthRaw).slice(0, 3).toLowerCase()] || "01";

  const day = /^\d+$/.test(dayRaw)
    ? String(dayRaw).padStart(2, "0").slice(0, 2)
    : "01";

  return `${year}-${month}-${day}`;
}

function getAuthors(articleXml) {
  const authorBlocks = articleXml.match(/<Author[^>]*>[\s\S]*?<\/Author>/gi) || [];

  return authorBlocks
    .map((block) => {
      const lastName = getTagValue(block, "LastName");
      const foreName = getTagValue(block, "ForeName") || getTagValue(block, "Initials");
      const collectiveName = getTagValue(block, "CollectiveName");

      if (collectiveName) return collectiveName;
      return [foreName, lastName].filter(Boolean).join(" ").trim();
    })
    .filter(Boolean)
    .slice(0, 12)
    .join(", ");
}

function getArticleIds(articleXml) {
  const pmid = getTagValue(articleXml, "PMID");
  const doiMatch = articleXml.match(/<ArticleId[^>]*IdType=["']doi["'][^>]*>([\s\S]*?)<\/ArticleId>/i);
  const pmcMatch = articleXml.match(/<ArticleId[^>]*IdType=["']pmc["'][^>]*>([\s\S]*?)<\/ArticleId>/i);

  return {
    pmid: pmid || null,
    doi: doiMatch?.[1] ? stripXml(doiMatch[1]) : null,
    pmcid: pmcMatch?.[1] ? stripXml(pmcMatch[1]) : null,
  };
}

function parsePubMedArticles(xml, filters = {}) {
  const articleBlocks = xml.match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/gi) || [];

  return articleBlocks.map((articleXml) => {
    const ids = getArticleIds(articleXml);
    const abstractParts = getAllTagValues(articleXml, "AbstractText");
    const publicationTypes = getAllTagValues(articleXml, "PublicationType");

    return {
      source_name: "PubMed",
      source_id: ids.pmid,
      title: getTagValue(articleXml, "ArticleTitle"),
      abstract: abstractParts.length ? abstractParts.join(" ") : null,
      doi: ids.doi,
      pmid: ids.pmid,
      pmcid: ids.pmcid,
      journal: getTagValue(articleXml, "Title") || getTagValue(articleXml, "ISOAbbreviation"),
      year: getPubmedYear(articleXml),
      publication_date: getPublicationDate(articleXml),
      authors_text: getAuthors(articleXml),
      study_type: publicationTypes.join("; ") || null,
      source_url: ids.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${ids.pmid}/` : null,
      open_access: filters.open_access === true ? true : Boolean(ids.pmcid),
      raw_metadata: {
        publication_types: publicationTypes,
        source: "PubMed E-utilities",
      },
    };
  });
}

function normalizeStudyTypeKey(value = "") {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function getPubMedPublicationTypeClauses(studyTypes = []) {
  const publicationTypeMap = {
    clinical_practice_guideline: [
      '"Practice Guideline"[Publication Type]',
      '"Guideline"[Publication Type]',
    ],
    guideline: [
      '"Practice Guideline"[Publication Type]',
      '"Guideline"[Publication Type]',
    ],
    systematic_review_meta_analysis: [
      '"Systematic Review"[Publication Type]',
      '"Meta-Analysis"[Publication Type]',
    ],
    systematic_review: [
      '"Systematic Review"[Publication Type]',
    ],
    meta_analysis: [
      '"Meta-Analysis"[Publication Type]',
    ],
    randomized_controlled_trial: [
      '"Randomized Controlled Trial"[Publication Type]',
    ],
    randomized_clinical_trial: [
      '"Randomized Controlled Trial"[Publication Type]',
    ],
    rct: [
      '"Randomized Controlled Trial"[Publication Type]',
    ],
  };

  const clauses = studyTypes.flatMap((studyType) => {
    const key = normalizeStudyTypeKey(studyType);
    return publicationTypeMap[key] || [];
  });

  return [...new Set(clauses)];
}

function buildPubMedQuery(query, filters = {}) {
  const clauses = [`(${query})`];

  if (filters.year_from != null || filters.year_to != null) {
    const fromYear = filters.year_from == null
      ? 1900
      : filters.year_from;

    const toYear = filters.year_to == null
      ? new Date().getUTCFullYear() + 1
      : filters.year_to;

    clauses.push(
      `("${fromYear}/01/01"[Date - Publication] : ` +
      `"${toYear}/12/31"[Date - Publication])`
    );
  }

  if (filters.open_access === true) {
    clauses.push("free full text[sb]");
  }

  const publicationTypeClauses =
    getPubMedPublicationTypeClauses(filters.study_types || []);

  if (publicationTypeClauses.length > 0) {
    clauses.push(`(${publicationTypeClauses.join(" OR ")})`);
  }

  return clauses.join(" AND ");
}

function simplifyPubMedQuery(query = "") {
  return String(query)
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\b(AND|OR|NOT)\b/gi, " ")
    .replace(/[()"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addNcbiIdentity(url) {
  url.searchParams.set("tool", "OpenPhysioAI");

  const email = process.env.NCBI_EMAIL;
  const apiKey = process.env.NCBI_API_KEY;

  if (email) url.searchParams.set("email", email);
  if (apiKey) url.searchParams.set("api_key", apiKey);
}

async function searchPubMedIds(query, limit, filters) {
  const searchUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi");
  searchUrl.searchParams.set("db", "pubmed");
  searchUrl.searchParams.set("term", buildPubMedQuery(query, filters));
  searchUrl.searchParams.set("retmode", "json");
  searchUrl.searchParams.set("retmax", String(limit));
  searchUrl.searchParams.set("sort", "relevance");
  addNcbiIdentity(searchUrl);

  const response = await fetchWithRetry(
    searchUrl.toString(),
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "OpenPhysioAI/1.0",
      },
    },
    { retries: 2, timeoutMs: 12000 }
  );

  if (!response.ok) {
    throw new Error(`PubMed ESearch error ${response.status}`);
  }

  const data = await response.json();
  return data?.esearchresult?.idlist || [];
}

async function fetchPubMedArticles(ids, filters) {
  if (!ids.length) return [];

  const fetchUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi");
  fetchUrl.searchParams.set("db", "pubmed");
  fetchUrl.searchParams.set("id", ids.join(","));
  fetchUrl.searchParams.set("retmode", "xml");
  addNcbiIdentity(fetchUrl);

  const response = await fetchWithRetry(
    fetchUrl.toString(),
    {
      headers: {
        Accept: "application/xml,text/xml",
        "User-Agent": "OpenPhysioAI/1.0",
      },
    },
    { retries: 2, timeoutMs: 15000 }
  );

  if (!response.ok) {
    throw new Error(`PubMed EFetch error ${response.status}`);
  }

  const xml = await response.text();
  return parsePubMedArticles(xml, filters);
}

async function searchPubMed(query, limit = 10, filters = {}) {
  const requestedQuery = String(query || "").trim();

  const primaryQuery =
    buildProfessionalPubMedQuery(requestedQuery);

  const simplifiedRequestedQuery =
    simplifyPubMedQuery(requestedQuery);

  const fallbackQuery =
    buildProfessionalPubMedQuery(
      simplifiedRequestedQuery || requestedQuery
    );
  let ids = [];
  let primaryError = null;

  try {
    ids = await searchPubMedIds(primaryQuery, limit, filters);
  } catch (error) {
    primaryError = error;
  }

  if (
    ids.length === 0 &&
    fallbackQuery &&
    simplifiedRequestedQuery &&
    fallbackQuery.toLowerCase() !== primaryQuery.toLowerCase()
  ) {
    try {
      ids = await searchPubMedIds(fallbackQuery, limit, filters);
    } catch (fallbackError) {
      if (primaryError) {
        throw new Error(
          `${primaryError.message}; PubMed fallback failed: ${fallbackError.message}`
        );
      }
      throw fallbackError;
    }
  }

  if (ids.length === 0 && primaryError) {
    throw primaryError;
  }

  const articles = await fetchPubMedArticles(
    ids,
    filters
  );

  return filterProfessionalArticles(articles);
}

module.exports = {
  searchPubMed,
  buildPubMedQuery,
  simplifyPubMedQuery,
  parsePubMedArticles,
};

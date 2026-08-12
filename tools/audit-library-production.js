require("dotenv").config();

const crypto = require("crypto");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const POSIX = path.posix;
const args = new Set(process.argv.slice(2));
const jsonOutput = args.has("--json");
const requestedSlugArg = process.argv.slice(2).find((value) =>
  value.startsWith("--slug=")
);
const requestedSlug = requestedSlugArg
  ? requestedSlugArg.slice("--slug=".length).trim()
  : "";

function fail(message) {
  throw new Error(message);
}

function isSafeRelativePath(value) {
  if (!value || typeof value !== "string") return false;
  if (value.startsWith("/") || value.includes("\\")) return false;
  const normalized = POSIX.normalize(value);
  return normalized !== ".." && !normalized.startsWith("../");
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function downloadBuffer(storage, objectPath) {
  const { data, error } = await storage.download(objectPath);
  if (error) throw new Error(`${objectPath}: ${error.message}`);
  if (!data) throw new Error(`${objectPath}: empty storage response`);

  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function declaredLanguages(manifest) {
  const explicit = Array.isArray(manifest.languages)
    ? manifest.languages.filter((language) => language === "en" || language === "es")
    : [];

  if (explicit.length) return Array.from(new Set(explicit));

  return Object.keys(manifest.resources || {}).filter(
    (language) => language === "en" || language === "es"
  );
}

function collectRequiredResourcePaths(manifest, language) {
  const resources = manifest.resources?.[language];
  if (!resources || typeof resources !== "object") {
    fail(`manifest missing resources.${language}`);
  }

  const infographics = Array.isArray(resources.infographics)
    ? resources.infographics
    : [];

  if (!resources.report) fail(`manifest missing ${language} report`);
  if (!resources.audio) fail(`manifest missing ${language} audio`);
  if (infographics.length !== 4) {
    fail(`manifest must declare 4 ${language} infographics (found ${infographics.length})`);
  }

  return [resources.report, resources.audio, ...infographics];
}

function validateReportHtml(buffer, relativePath) {
  const html = buffer.toString("utf8");
  const forbidden = [
    /file:\/\//i,
    /\/Users\//i,
    /[A-Za-z]:\\/,
    /localhost/i,
    /blob:/i,
  ];

  if (forbidden.some((pattern) => pattern.test(html))) {
    fail(`${relativePath}: report contains a local-only asset reference`);
  }
}

async function auditArticle(article, storage) {
  const articleErrors = [];
  const checkedFiles = new Map();

  const recordError = (error) => {
    articleErrors.push(error instanceof Error ? error.message : String(error));
  };

  try {
    if (!article.slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(article.slug)) {
      fail("catalog has an invalid slug");
    }
    if (!article.storage_path || !isSafeRelativePath(article.storage_path)) {
      fail("catalog has an invalid storage_path");
    }
    if (article.validation_status !== "ready") {
      fail(`validation_status is ${article.validation_status || "missing"}`);
    }
    if (article.is_published !== true) {
      fail("catalog row is not published");
    }
  } catch (error) {
    recordError(error);
  }

  let manifest = null;
  if (!articleErrors.length) {
    try {
      const manifestPath = `${article.storage_path}/manifest.json`;
      const manifestBuffer = await downloadBuffer(storage, manifestPath);
      if (!manifestBuffer.length) fail(`${manifestPath}: manifest is empty`);
      manifest = JSON.parse(manifestBuffer.toString("utf8"));

      if (manifest.slug !== article.slug) {
        fail(`manifest slug ${manifest.slug || "missing"} does not match catalog`);
      }
      if (manifest.storage_path !== article.storage_path) {
        fail("manifest storage_path does not match catalog");
      }
      if (!manifest.schema_version) fail("manifest schema_version is missing");
    } catch (error) {
      recordError(error);
    }
  }

  const languages = manifest ? declaredLanguages(manifest) : [];
  if (manifest && !languages.length) {
    recordError("manifest declares no supported language resources");
  }

  const requiredByLanguage = new Map();
  if (manifest) {
    for (const language of languages) {
      try {
        const paths = collectRequiredResourcePaths(manifest, language);
        requiredByLanguage.set(language, paths);
        for (const relativePath of paths) {
          if (!isSafeRelativePath(relativePath)) {
            fail(`${language}: invalid resource path ${relativePath}`);
          }
        }
      } catch (error) {
        recordError(error);
      }
    }
  }

  const manifestFiles = manifest?.files && typeof manifest.files === "object"
    ? manifest.files
    : {};
  const allPaths = new Set(Object.keys(manifestFiles));
  for (const paths of requiredByLanguage.values()) {
    for (const relativePath of paths) allPaths.add(relativePath);
  }

  for (const relativePath of allPaths) {
    if (!isSafeRelativePath(relativePath)) {
      recordError(`invalid file path ${relativePath}`);
      continue;
    }

    try {
      const objectPath = `${article.storage_path}/${relativePath}`;
      const buffer = await downloadBuffer(storage, objectPath);
      if (!buffer.length) fail(`${relativePath}: file is empty`);

      const metadata = manifestFiles[relativePath];
      if (metadata?.size_bytes != null && Number(metadata.size_bytes) !== buffer.length) {
        fail(
          `${relativePath}: size mismatch (manifest ${metadata.size_bytes}, storage ${buffer.length})`
        );
      }
      if (metadata?.sha256 && metadata.sha256 !== sha256(buffer)) {
        fail(`${relativePath}: SHA-256 mismatch`);
      }

      if (/\.html?$/i.test(relativePath)) {
        validateReportHtml(buffer, relativePath);
      }

      checkedFiles.set(relativePath, buffer.length);
    } catch (error) {
      recordError(error);
    }
  }

  for (const paths of requiredByLanguage.values()) {
    for (const relativePath of paths) {
      if (!checkedFiles.has(relativePath)) {
        recordError(`${relativePath}: required resource was not verified`);
      }
    }
  }

  if (article.doi && !/^10\.\d{4,9}\/\S+$/i.test(String(article.doi).trim())) {
    recordError(`catalog DOI has an invalid format: ${article.doi}`);
  }

  return {
    slug: article.slug,
    title: article.title,
    languages,
    checked_files: checkedFiles.size,
    ok: articleErrors.length === 0,
    errors: Array.from(new Set(articleErrors)),
  };
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.LIBRARY_BUCKET || "library-assets";

  if (!url || !key) {
    fail("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }
  if (requestedSlug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(requestedSlug)) {
    fail(`Invalid --slug value: ${requestedSlug}`);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let query = supabase
    .from("library_catalog")
    .select(
      "id,title,slug,doi,storage_path,manifest_version,validation_status,is_published"
    )
    .eq("is_published", true)
    .order("title", { ascending: true });

  if (requestedSlug) query = query.eq("slug", requestedSlug);

  const { data: articles, error } = await query;
  if (error) throw error;
  if (!articles?.length) {
    fail(requestedSlug
      ? `No published Library article found for ${requestedSlug}.`
      : "No published Library articles were found.");
  }

  const storage = supabase.storage.from(bucket);
  const results = [];
  for (const article of articles) {
    results.push(await auditArticle(article, storage));
  }

  const failed = results.filter((result) => !result.ok);
  const summary = {
    bucket,
    audited_articles: results.length,
    passed_articles: results.length - failed.length,
    failed_articles: failed.length,
    checked_files: results.reduce((sum, result) => sum + result.checked_files, 0),
    results,
  };

  if (jsonOutput) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`Library production audit: ${summary.passed_articles}/${summary.audited_articles} articles passed.`);
    console.log(`Verified ${summary.checked_files} stored files in ${bucket}.`);
    for (const result of results) {
      const marker = result.ok ? "OK" : "FAIL";
      const languages = result.languages.length ? result.languages.join(",") : "none";
      console.log(`${marker} ${result.slug} [${languages}] - ${result.checked_files} files`);
      for (const errorMessage of result.errors) {
        console.error(`  - ${errorMessage}`);
      }
    }
  }

  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Library production audit failed: ${error.message}`);
  process.exitCode = 1;
});

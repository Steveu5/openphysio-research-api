const express = require("express");
const path = require("path");
const { getSupabaseAdmin } = require("../services/supabase");

const router = express.Router();
const POSIX = path.posix;

function getBearerToken(req) {
  const header = String(req.headers.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function getPreviewEmails() {
  return new Set(
    String(process.env.LIBRARY_PREVIEW_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

function canUserPreview(user, previewRequested) {
  if (!previewRequested || !user?.email) return false;
  return getPreviewEmails().has(String(user.email).toLowerCase());
}

function isSafeRelativePath(value) {
  if (!value || typeof value !== "string") return false;
  if (value.startsWith("/") || value.includes("\\")) return false;
  const normalized = POSIX.normalize(value);
  return normalized !== ".." && !normalized.startsWith("../");
}

function resolveLocalReference(reportPath, reference) {
  const cleanReference = String(reference || "").split(/[?#]/, 1)[0];
  if (!cleanReference) return null;

  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(cleanReference)) {
    return null;
  }

  const resolved = POSIX.normalize(
    POSIX.join(POSIX.dirname(reportPath), cleanReference)
  );

  return isSafeRelativePath(resolved) ? resolved : null;
}

function rewriteHtmlAssetUrls(html, reportPath, signedUrlByRelativePath) {
  return String(html).replace(
    /(<(?:img|source|script|link)\b[^>]*?\s(?:src|href)\s*=\s*["'])([^"']+)(["'])/gi,
    (fullMatch, prefix, reference, suffix) => {
      const resolved = resolveLocalReference(reportPath, reference);
      if (!resolved) return fullMatch;

      const signedUrl = signedUrlByRelativePath.get(resolved);
      return signedUrl ? `${prefix}${signedUrl}${suffix}` : fullMatch;
    }
  );
}

async function authenticateRequest(req) {
  const token = getBearerToken(req);
  if (!token) {
    const error = new Error("Authentication required");
    error.status = 401;
    throw error;
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    const authError = new Error("Invalid or expired session");
    authError.status = 401;
    throw authError;
  }

  return data.user;
}

async function downloadText(storage, objectPath) {
  const { data, error } = await storage.download(objectPath);
  if (error) throw error;
  return data.text();
}

router.get("/", async (req, res, next) => {
  try {
    const previewRequested = String(req.query.preview || "") === "true";
    const user = await authenticateRequest(req);
    const supabase = getSupabaseAdmin();
    const previewAllowed = canUserPreview(user, previewRequested);

    let query = supabase
      .from("library_catalog")
      .select(
        [
          "id",
          "title",
          "slug",
          "category",
          "publication_year",
          "journal_name",
          "authors",
          "doi",
          "pyramid_level",
          "pyramid_info_es",
          "pyramid_info_en",
          "is_complete",
          "is_published",
          "validation_status",
        ].join(",")
      )
      .eq("validation_status", "ready")
      .not("slug", "is", null)
      .order("is_complete", { ascending: false })
      .order("title", { ascending: true });

    if (!previewAllowed) {
      query = query.eq("is_published", true);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.set("Cache-Control", "private, no-store");
    res.json({
      articles: data || [],
      preview: previewAllowed,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:slug/resources", async (req, res, next) => {
  try {
    const slug = String(req.params.slug || "").trim();
    const language = String(req.query.lang || "en").toLowerCase();
    const previewRequested = String(req.query.preview || "") === "true";

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return res.status(400).json({ error: "Invalid article slug" });
    }

    if (!new Set(["en", "es"]).has(language)) {
      return res.status(400).json({ error: "lang must be en or es" });
    }

    const user = await authenticateRequest(req);
    const supabase = getSupabaseAdmin();

    const { data: article, error: articleError } = await supabase
      .from("library_catalog")
      .select(
        "id,title,slug,storage_path,manifest_version,validation_status,is_published"
      )
      .eq("slug", slug)
      .maybeSingle();

    if (articleError) throw articleError;
    if (!article || article.validation_status !== "ready" || !article.storage_path) {
      return res.status(404).json({ error: "Article resources not found" });
    }

    if (!article.is_published && !canUserPreview(user, previewRequested)) {
      return res.status(404).json({ error: "Article resources not found" });
    }

    const bucket = process.env.LIBRARY_BUCKET || "library-assets";
    const configuredTtl = Number(
      process.env.LIBRARY_SIGNED_URL_TTL_SECONDS || 3600
    );
    const expiresIn = Math.max(
      300,
      Math.min(Number.isFinite(configuredTtl) ? configuredTtl : 3600, 86400)
    );
    const storage = supabase.storage.from(bucket);
    const manifestObjectPath = `${article.storage_path}/manifest.json`;
    const manifestText = await downloadText(storage, manifestObjectPath);

    let manifest;
    try {
      manifest = JSON.parse(manifestText);
    } catch {
      const manifestError = new Error("Invalid article manifest");
      manifestError.status = 500;
      throw manifestError;
    }

    if (
      manifest.slug !== article.slug ||
      manifest.storage_path !== article.storage_path
    ) {
      const mismatchError = new Error("Manifest does not match catalog record");
      mismatchError.status = 500;
      throw mismatchError;
    }

    const languageResources = manifest.resources?.[language];
    if (!languageResources) {
      return res.status(404).json({ error: "Language resources not found" });
    }

    const reportPath = languageResources.report;
    const audioPath = languageResources.audio;
    const infographicPaths = Array.isArray(languageResources.infographics)
      ? languageResources.infographics
      : [];

    const requiredPaths = [reportPath, audioPath, ...infographicPaths];
    if (!requiredPaths.every(isSafeRelativePath)) {
      const pathError = new Error("Manifest contains invalid resource paths");
      pathError.status = 500;
      throw pathError;
    }

    const signableRelativePaths = Array.from(
      new Set([
        audioPath,
        ...infographicPaths,
        ...Object.keys(manifest.files || {}).filter(
          (relativePath) =>
            relativePath !== reportPath && isSafeRelativePath(relativePath)
        ),
      ])
    );

    const signableObjectPaths = signableRelativePaths.map(
      (relativePath) => `${article.storage_path}/${relativePath}`
    );

    const { data: signedRows, error: signedError } =
      await storage.createSignedUrls(signableObjectPaths, expiresIn);

    if (signedError) throw signedError;

    const signedUrlByRelativePath = new Map();
    signableRelativePaths.forEach((relativePath, index) => {
      const row = signedRows?.[index];
      if (row?.signedUrl && !row.error) {
        signedUrlByRelativePath.set(relativePath, row.signedUrl);
      }
    });

    const reportObjectPath = `${article.storage_path}/${reportPath}`;
    const reportHtml = await downloadText(storage, reportObjectPath);
    const rewrittenReportHtml = rewriteHtmlAssetUrls(
      reportHtml,
      reportPath,
      signedUrlByRelativePath
    );

    const audioUrl = signedUrlByRelativePath.get(audioPath) || null;
    const infographics = infographicPaths.map((relativePath, index) => ({
      index: index + 1,
      path: relativePath,
      url: signedUrlByRelativePath.get(relativePath) || null,
    }));

    if (!audioUrl || infographics.some((item) => !item.url)) {
      const signingError = new Error("Could not sign all article resources");
      signingError.status = 500;
      throw signingError;
    }

    res.set("Cache-Control", "private, no-store");
    res.json({
      article: {
        id: article.id,
        title: article.title,
        slug: article.slug,
      },
      language,
      manifest_version:
        article.manifest_version || manifest.schema_version || "1.0",
      report_html: rewrittenReportHtml,
      audio_url: audioUrl,
      infographics,
      expires_in: expiresIn,
      expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

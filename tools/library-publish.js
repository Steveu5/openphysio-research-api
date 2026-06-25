require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const args = process.argv.slice(2);
const unpublish = args.includes("--unpublish");
const slug = args.find((value) => !value.startsWith("--"));

if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
  console.error("Provide a valid article slug.");
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

(async () => {
  const { data: article, error: readError } = await supabase
    .from("library_catalog")
    .select("id,title,slug,validation_status,is_published")
    .eq("slug", slug)
    .maybeSingle();

  if (readError) throw readError;
  if (!article) throw new Error(`Article not found: ${slug}`);

  if (!unpublish && article.validation_status !== "ready") {
    throw new Error(
      `Cannot publish because validation_status is ${article.validation_status}`
    );
  }

  const nextPublished = !unpublish;
  const { data, error } = await supabase
    .from("library_catalog")
    .update({
      is_published: nextPublished,
      updated_at: new Date().toISOString(),
    })
    .eq("id", article.id)
    .select("title,slug,is_published")
    .single();

  if (error) throw error;

  console.log(
    `${data.is_published ? "Published" : "Unpublished"}: ${data.title}`
  );
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

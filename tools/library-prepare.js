require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const JSZip = require("jszip");

const input = process.argv[2];
if (!input) {
  console.error('Usage: npm run library:prepare -- "/path/to/article-folder"');
  process.exit(1);
}

const articleDir = path.resolve(input);
const articleJsonPath = path.join(articleDir, "article.json");

if (!fs.existsSync(articleJsonPath)) {
  console.error(`Missing article.json in: ${articleDir}`);
  process.exit(1);
}

const article = JSON.parse(fs.readFileSync(articleJsonPath, "utf8"));
const slug = String(article.slug || path.basename(articleDir)).trim();

if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
  console.error(`Invalid slug: ${slug}`);
  process.exit(1);
}

const requiredFiles = [
  "report/index.html",
  "report/index-es.html",
  "audio/audio-en.mp3",
  "audio/audio-es.mp3",
  "infographics/en/infographic-01.png",
  "infographics/en/infographic-02.png",
  "infographics/en/infographic-03.png",
  "infographics/en/infographic-04.png",
  "infographics/es/infographic-01.png",
  "infographics/es/infographic-02.png",
  "infographics/es/infographic-03.png",
  "infographics/es/infographic-04.png",
];

const errors = [];
const files = {};

for (const relativePath of requiredFiles) {
  const absolutePath = path.join(articleDir, relativePath);

  if (!fs.existsSync(absolutePath)) {
    errors.push(`Missing file: ${relativePath}`);
    continue;
  }

  const buffer = fs.readFileSync(absolutePath);

  if (buffer.length === 0) {
    errors.push(`Empty file: ${relativePath}`);
    continue;
  }

  files[relativePath] = {
    size_bytes: buffer.length,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
  };
}

for (const relativePath of ["report/index.html", "report/index-es.html"]) {
  const absolutePath = path.join(articleDir, relativePath);
  if (!fs.existsSync(absolutePath)) continue;

  const html = fs.readFileSync(absolutePath, "utf8");
  const forbidden = [
    /file:\/\//i,
    /\/Users\//i,
    /[A-Za-z]:\\/,
    /localhost/i,
    /blob:/i,
  ];

  if (forbidden.some((pattern) => pattern.test(html))) {
    errors.push(`Forbidden local reference in ${relativePath}`);
  }
}

if (!article.title?.en || !article.title?.es) {
  errors.push("article.json must include title.en and title.es");
}

if (errors.length) {
  console.error("\nPreparation failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const manifest = {
  schema_version: "1.0.0",
  slug,
  storage_path: `articles/${slug}`,
  status: "draft",
  content_type: "integrated_clinical_report",
  default_language: "en",
  languages: ["en", "es"],
  title: {
    en: article.title.en,
    es: article.title.es,
  },
  resources: {
    en: {
      report: "report/index.html",
      audio: "audio/audio-en.mp3",
      infographics: [
        "infographics/en/infographic-01.png",
        "infographics/en/infographic-02.png",
        "infographics/en/infographic-03.png",
        "infographics/en/infographic-04.png",
      ],
    },
    es: {
      report: "report/index-es.html",
      audio: "audio/audio-es.mp3",
      infographics: [
        "infographics/es/infographic-01.png",
        "infographics/es/infographic-02.png",
        "infographics/es/infographic-03.png",
        "infographics/es/infographic-04.png",
      ],
    },
  },
  files,
};

fs.writeFileSync(
  path.join(articleDir, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n"
);

const workspace = process.env.LIBRARY_WORKSPACE ||
  path.join(process.env.HOME || process.cwd(), "Documents", "OpenPhysioAI");
const readyDir = path.join(workspace, "LibraryReady");
fs.mkdirSync(readyDir, { recursive: true });

const zip = new JSZip();
const folder = zip.folder(slug);

for (const relativePath of [...requiredFiles, "manifest.json"]) {
  folder.file(
    relativePath,
    fs.readFileSync(path.join(articleDir, relativePath))
  );
}

(async () => {
  const output = path.join(readyDir, `${slug}-ready.zip`);
  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  fs.writeFileSync(output, buffer);

  console.log(`Prepared: ${output}`);
  console.log("Next:");
  console.log(`npm run library:upload -- "${output}" --dry-run`);
  console.log(`npm run library:upload -- "${output}"`);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

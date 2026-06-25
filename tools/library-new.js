require("dotenv").config();
const fs = require("fs");
const path = require("path");

const slug = String(process.argv[2] || "").trim();

if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
  console.error("Use a valid slug, for example: knee-osteoarthritis-exercise-therapy");
  process.exit(1);
}

const workspace = process.env.LIBRARY_WORKSPACE ||
  path.join(process.env.HOME || process.cwd(), "Documents", "OpenPhysioAI");
const target = path.join(workspace, "LibraryInbox", slug);

if (fs.existsSync(target)) {
  console.error(`The folder already exists: ${target}`);
  process.exit(1);
}

for (const folder of [
  "report",
  "audio",
  "infographics/en",
  "infographics/es",
]) {
  fs.mkdirSync(path.join(target, folder), { recursive: true });
}

for (const file of [
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
]) {
  fs.writeFileSync(path.join(target, file), "");
}

const article = {
  catalog_id: "",
  slug,
  title: {
    en: "",
    es: ""
  },
  category: "",
  publication_year: new Date().getFullYear(),
  journal_name: "",
  authors: "",
  doi: ""
};

fs.writeFileSync(
  path.join(target, "article.json"),
  JSON.stringify(article, null, 2) + "\n"
);

console.log(`Created: ${target}`);
console.log("Replace the empty placeholder files with the real resources.");
console.log("Then complete article.json and run library:prepare.");

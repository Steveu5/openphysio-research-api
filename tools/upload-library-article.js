require('dotenv').config();

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const JSZip = require('jszip');
const { createClient } = require('@supabase/supabase-js');

const LARGE_FILE_THRESHOLD = 6 * 1024 * 1024;
const DEFAULT_BUCKET = process.env.LIBRARY_BUCKET || 'library-assets';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.pdf': 'application/pdf',
};

function fail(message) {
  const error = new Error(message);
  error.isValidationError = true;
  throw error;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const source = args.find((arg) => !arg.startsWith('--'));
  return {
    source,
    dryRun: args.includes('--dry-run'),
    bucket: (args.find((arg) => arg.startsWith('--bucket=')) || '').split('=')[1] || DEFAULT_BUCKET,
  };
}

function normalizeRelative(value) {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function safeJoin(root, relativePath) {
  const normalized = normalizeRelative(relativePath);
  if (!normalized || normalized.startsWith('/') || normalized.includes('../')) {
    fail(`Unsafe path detected: ${relativePath}`);
  }
  const resolved = path.resolve(root, normalized);
  const rootResolved = path.resolve(root) + path.sep;
  if (!resolved.startsWith(rootResolved)) fail(`Path escapes article folder: ${relativePath}`);
  return resolved;
}

async function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function extractZip(zipPath) {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'openphysio-library-'));
  const data = await fsp.readFile(zipPath);
  const zip = await JSZip.loadAsync(data);

  for (const [entryName, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const normalized = normalizeRelative(entryName);
    if (normalized.startsWith('/') || normalized.includes('../')) {
      fail(`Unsafe ZIP entry: ${entryName}`);
    }
    const target = path.join(tempRoot, normalized);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, await entry.async('nodebuffer'));
  }

  return tempRoot;
}

async function findManifestRoot(sourcePath) {
  const stat = await fsp.stat(sourcePath);
  let workingRoot = sourcePath;
  let cleanup = null;

  if (stat.isFile()) {
    if (path.extname(sourcePath).toLowerCase() !== '.zip') fail('The source file must be a .zip archive.');
    workingRoot = await extractZip(sourcePath);
    cleanup = async () => fsp.rm(workingRoot, { recursive: true, force: true });
  }

  const matches = [];
  async function walk(dir) {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.name === 'manifest.json') matches.push(fullPath);
    }
  }
  await walk(workingRoot);

  if (matches.length !== 1) fail(`Expected exactly one manifest.json, found ${matches.length}.`);
  return { articleRoot: path.dirname(matches[0]), manifestPath: matches[0], cleanup };
}

async function validateArticle(articleRoot, manifest) {
  const errors = [];
  const required = [];

  if (!manifest.slug) errors.push('manifest.slug is required');
  if (!manifest.storage_path) errors.push('manifest.storage_path is required');
  if (!manifest.schema_version) errors.push('manifest.schema_version is required');

  for (const lang of ['en', 'es']) {
    const resources = manifest.resources?.[lang];
    if (!resources) {
      errors.push(`resources.${lang} is required`);
      continue;
    }
    if (resources.report) required.push(resources.report);
    else errors.push(`resources.${lang}.report is required`);
    if (resources.audio) required.push(resources.audio);
    else errors.push(`resources.${lang}.audio is required`);
    if (!Array.isArray(resources.infographics) || resources.infographics.length !== 4) {
      errors.push(`resources.${lang}.infographics must contain exactly 4 files`);
    } else {
      required.push(...resources.infographics);
    }
  }

  required.push('manifest.json');

  for (const relativePath of required) {
    try {
      const filePath = safeJoin(articleRoot, relativePath);
      const stat = await fsp.stat(filePath);
      if (!stat.isFile()) errors.push(`Not a file: ${relativePath}`);
    } catch {
      errors.push(`Missing file: ${relativePath}`);
    }
  }

  for (const [relativePath, metadata] of Object.entries(manifest.files || {})) {
    try {
      const filePath = safeJoin(articleRoot, relativePath);
      const stat = await fsp.stat(filePath);
      if (metadata.size_bytes != null && Number(metadata.size_bytes) !== stat.size) {
        errors.push(`Size mismatch: ${relativePath}`);
      }
      if (metadata.sha256) {
        const actualHash = await sha256(filePath);
        if (actualHash !== metadata.sha256) errors.push(`SHA-256 mismatch: ${relativePath}`);
      }
    } catch {
      errors.push(`Manifest metadata references missing file: ${relativePath}`);
    }
  }

  const forbiddenPathPattern = /(file:\/\/|[A-Za-z]:\\|\/Users\/|localhost|blob:)/i;
  for (const lang of ['en', 'es']) {
    const reportRelative = manifest.resources?.[lang]?.report;
    if (!reportRelative) continue;
    const reportPath = safeJoin(articleRoot, reportRelative);
    const html = await fsp.readFile(reportPath, 'utf8');
    if (forbiddenPathPattern.test(html)) errors.push(`Forbidden absolute/local path found in ${reportRelative}`);

    const srcMatches = [...html.matchAll(/\bsrc\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]);
    for (const src of srcMatches) {
      if (/^(https?:|data:|#)/i.test(src)) continue;
      const resolved = path.resolve(path.dirname(reportPath), src);
      try {
        const stat = await fsp.stat(resolved);
        if (!stat.isFile()) errors.push(`Broken HTML src in ${reportRelative}: ${src}`);
      } catch {
        errors.push(`Broken HTML src in ${reportRelative}: ${src}`);
      }
    }
  }

  if (errors.length) {
    const error = new Error(`Validation failed:\n- ${errors.join('\n- ')}`);
    error.validationErrors = errors;
    throw error;
  }
}

async function collectFiles(articleRoot) {
  const files = [];
  async function walk(dir) {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else files.push({
        fullPath,
        relativePath: normalizeRelative(path.relative(articleRoot, fullPath)),
        size: (await fsp.stat(fullPath)).size,
      });
    }
  }
  await walk(articleRoot);
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function getContentType(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

async function uploadStandard(supabase, bucket, objectPath, file) {
  const body = await fsp.readFile(file.fullPath);
  const { error } = await supabase.storage.from(bucket).upload(objectPath, body, {
    contentType: getContentType(file.fullPath),
    cacheControl: '3600',
    upsert: true,
  });
  if (error) throw error;
}

async function uploadTus(projectUrl, serviceKey, bucket, objectPath, file) {
  const tus = await import('tus-js-client');
  const projectRef = new URL(projectUrl).hostname.split('.')[0];
  const endpoint = `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`;
  const stream = fs.createReadStream(file.fullPath);

  await new Promise((resolve, reject) => {
    const upload = new tus.Upload(stream, {
      endpoint,
      uploadSize: file.size,
      chunkSize: 6 * 1024 * 1024,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      removeFingerprintOnSuccess: true,
      headers: {
        authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        'x-upsert': 'true',
      },
      metadata: {
        bucketName: bucket,
        objectName: objectPath,
        contentType: getContentType(file.fullPath),
        cacheControl: '3600',
      },
      onError: reject,
      onProgress: (uploaded, total) => {
        const percentage = ((uploaded / total) * 100).toFixed(1);
        process.stdout.write(`\r   ${percentage}% ${file.relativePath}`);
      },
      onSuccess: () => {
        process.stdout.write('\n');
        resolve();
      },
    });

    upload.findPreviousUploads()
      .then((previous) => {
        if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      })
      .catch(reject);
  });
}

async function updateCatalog(supabase, manifest, status, errors = []) {
  const payload = {
    storage_path: manifest.storage_path,
    manifest_version: manifest.schema_version,
    validation_status: status,
    validation_errors: errors,
    is_published: false,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('library_catalog')
    .update(payload)
    .eq('slug', manifest.slug)
    .select('id,title,slug');

  if (error) throw error;
  if (!data || data.length !== 1) {
    throw new Error(`Expected one library_catalog row for slug "${manifest.slug}", found ${data?.length || 0}.`);
  }
  return data[0];
}

async function main() {
  const { source, dryRun, bucket } = parseArgs(process.argv);
  if (!source) {
    console.error('Usage: npm run library:upload -- <article-folder-or-zip> [--dry-run] [--bucket=library-assets]');
    process.exit(1);
  }

  const projectUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!projectUrl || !serviceKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.');
    process.exit(1);
  }

  const absoluteSource = path.resolve(source);
  const supabase = createClient(projectUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let cleanup = null;
  let manifest = null;

  try {
    const resolved = await findManifestRoot(absoluteSource);
    cleanup = resolved.cleanup;
    manifest = JSON.parse(await fsp.readFile(resolved.manifestPath, 'utf8'));

    console.log(`\nArticle: ${manifest.slug}`);
    console.log(`Storage path: ${manifest.storage_path}`);
    console.log(`Bucket: ${bucket}`);

    await validateArticle(resolved.articleRoot, manifest);
    const files = await collectFiles(resolved.articleRoot);
    console.log(`Validation passed: ${files.length} files.`);

    if (dryRun) {
      for (const file of files) console.log(`DRY RUN  ${manifest.storage_path}/${file.relativePath}`);
      console.log('\nDry run completed. Nothing was uploaded or changed in the database.');
      return;
    }

    await updateCatalog(supabase, manifest, 'uploading', []);

    for (const file of files) {
      const objectPath = `${manifest.storage_path}/${file.relativePath}`;
      console.log(`Uploading ${file.relativePath} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
      if (file.size > LARGE_FILE_THRESHOLD) {
        await uploadTus(projectUrl, serviceKey, bucket, objectPath, file);
      } else {
        await uploadStandard(supabase, bucket, objectPath, file);
      }
    }

    const row = await updateCatalog(supabase, manifest, 'ready', []);
    console.log(`\nUpload complete. Catalog row ready: ${row.title}`);
    console.log('The article remains unpublished until the application test passes.');
  } catch (error) {
    console.error(`\nUpload failed: ${error.message}`);
    if (manifest) {
      try {
        await updateCatalog(
          supabase,
          manifest,
          'failed',
          error.validationErrors || [error.message]
        );
      } catch (catalogError) {
        console.error(`Could not save failure status: ${catalogError.message}`);
      }
    }
    process.exitCode = 1;
  } finally {
    if (cleanup) await cleanup();
  }
}

main();

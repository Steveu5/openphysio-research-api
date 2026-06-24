# OpenPhysioAI Library Uploader

Uploads one validated article folder or ZIP to the private Supabase Storage bucket and updates the matching `library_catalog` row.

## Required environment variables

Add these values to the backend `.env` file. Never commit the service-role key.

```env
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_PRIVATE_SERVICE_ROLE_KEY
LIBRARY_BUCKET=library-assets
```

The bucket must already exist and remain private.

## Install

```bash
npm install
```

## Validate without uploading

```bash
npm run library:upload -- "/absolute/path/article.zip" --dry-run
```

The command accepts either:

- an organized article folder containing one `manifest.json`; or
- a ZIP containing one organized article folder.

## Upload the pilot article

```bash
npm run library:upload -- "/absolute/path/hip-pain-mobility-deficits-hip-osteoarthritis-ready.zip"
```

The uploader:

1. Finds the single `manifest.json`.
2. Validates both reports, both audios and four infographics per language.
3. Rejects local paths such as `file:///`, `/Users/`, Windows drive paths, `localhost` and `blob:`.
4. Confirms all local HTML `src` references resolve to real files.
5. Confirms file sizes and SHA-256 hashes declared in the manifest.
6. Uploads files smaller than or equal to 6 MB with the Supabase SDK.
7. Uploads larger files with resumable TUS uploads.
8. Preserves the manifest's `storage_path` hierarchy.
9. Updates the existing row matched by `slug`.
10. Leaves `is_published = false` until the application test is complete.

## Expected successful database state

```text
validation_status = ready
validation_errors = []
is_published = false
```

## Failure behavior

When validation or upload fails, the matching catalog row is updated to:

```text
validation_status = failed
validation_errors = [error details]
is_published = false
```

Re-running the same command is safe: uploads use overwrite mode and the database row is matched by its unique slug.

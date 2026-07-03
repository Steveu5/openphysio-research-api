# OpenPhysio MVP release checklist

This checklist defines the minimum release gate for a usable OpenPhysio Research version. It intentionally freezes new feature work until the current search, saved research, history, and audit flow is stable in production.

## 1. Backend deployment

- [ ] Configure every required variable from `.env.example`.
- [ ] Set `ALLOWED_ORIGINS` to the production frontend origin.
- [ ] Deploy the image built from `main`.
- [ ] Confirm `GET /health` returns HTTP 200 and `status: ok`.
- [ ] Confirm `GET /health/ready` returns HTTP 200 and `status: ready`.
- [ ] Confirm `GET /research/version` returns the active algorithm and ranking versions.
- [ ] Run `npm run smoke:production` against the deployed API.

## 2. Supabase and access

- [ ] A newly registered user receives a row in `profiles`.
- [ ] A test user has `subscription_status` set to `active` or `trialing`.
- [ ] `current_period_end`, when present, is in the future.
- [ ] Row-level security and service-role usage have been reviewed.
- [ ] No service-role or DeepSeek key is present in frontend code.

## 3. Core user journey

Use one real subscribed test account and complete this flow in the production frontend:

1. Sign in.
2. Open the scientific search page.
3. Search for `dolor lumbar crónico y ejercicio terapéutico`.
4. Confirm that a clinical answer and ranked articles appear.
5. Save one article.
6. Open **Mi investigación** and confirm the article appears.
7. Move the article to a collection and add a note.
8. Open the search history and confirm the search appears.
9. Open **Auditoría** for that search.
10. Confirm snapshot integrity, reproducibility, versions, and ranking movement render without an error.
11. Sign out and confirm protected research pages are no longer accessible.

## 4. Minimum failure checks

- [ ] Expired session shows a user-readable message.
- [ ] User without an active subscription receives the subscription-required state.
- [ ] Missing profile receives the profile-not-found state.
- [ ] API unavailable produces a connection message instead of a blank page.
- [ ] A search with zero results still creates a visible history item.
- [ ] Refreshing `/research`, `/research/workspace`, and `/research/audit` does not produce a hosting 404.

## 5. Release decision

The MVP is considered usable when:

- backend tests and ranking benchmark pass;
- frontend unit tests and production build pass;
- `/health/ready` is green in production;
- the complete core user journey above passes once on desktop and once on mobile;
- there are no critical authentication, subscription, saving, history, or audit blockers.

Visual redesign, deeper frontend refactoring, onboarding polish, and advanced usability improvements belong to the next phase and must not block this release unless they prevent completion of the core user journey.

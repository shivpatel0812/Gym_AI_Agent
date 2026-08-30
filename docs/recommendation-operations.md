# Recommendation operations

The per-set recommendation path writes three server-only collections beneath
`users/{uid}`:

- `workout_recommendation_events`: raw recommendation/outcome pairs. Documents
  include `expires_at` and are intended to expire after 90 days.
- `workout_recommendation_learning`: atomic aggregate counters retained while
  the user account exists.
- `workout_recommendation_metrics`: daily calls, tokens, fallbacks, and latency.

## One-time production configuration

Deploy `firestore.rules`, then enable Firestore TTL for the `expires_at` field on
the `workout_recommendation_events` collection group. TTL activation is a
project-level operation and must be run against the intended Firebase project:

```bash
gcloud firestore fields ttls update expires_at \
  --collection-group=workout_recommendation_events \
  --enable-ttl
```

Create an OpenAI project budget alert and monitor the authenticated endpoint
`GET /api/workout-sessions/ai-recommendation-metrics`. Investigate when:

- fallback rate exceeds 5%;
- average latency exceeds 2,500 ms;
- token use per call rises materially above the expected short JSON response.

No composite Firestore index is required by the current recommendation queries.

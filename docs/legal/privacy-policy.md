# GymAI Privacy Policy

**Last updated: 17 August 2026**

> **Draft.** This is a starting point written to match what the GymAI code
> actually collects and sends. Have a lawyer review it before you publish, and
> update it whenever you add a feature that touches user data.

## Who we are

GymAI ("we", "us") provides a fitness, nutrition, and wellness tracking app.
Questions: **support@gymai.app**.

## What we collect

**You give us:**

- **Account details** — email address and password (passwords are handled by
  Google Firebase Authentication; we never see or store them).
- **Date of birth** — collected at sign-up to confirm you meet our minimum age.
- **Health and fitness data** — height, weight, age, gender, training goals,
  experience level, workouts, sets, reps, weights, cardio and step activity.
- **Nutrition data** — meals, calories, macronutrients, hydration, and photos of
  food you choose to submit (meal photos are processed and not kept long-term).
- **Optional body-scan photos** — guided front/side/back progress photos you
  choose to submit for AI physique coaching. Images are analyzed into structured
  coaching notes, then deleted. We retain the notes (not the photos) for trends.
- **Wellness data** — sleep, stress levels, body feelings, and survey answers.
- **AI conversations** — messages you send to the AI coach and its replies.
- **Support and reports** — content you flag as objectionable, and any reason
  you give when requesting expanded AI access.

**Collected automatically:** basic technical and error logs needed to operate
and debug the service.

We do **not** collect advertising identifiers, and we do not use tracking across
other companies' apps or websites.

## How we use it

- To provide the app: storing your logs and showing your history and progress.
- To generate AI guidance: training plans, nutrition targets, and coach replies.
- To enforce AI usage limits and review requests for expanded access.
- To keep the service safe: screening messages for harmful content and
  reviewing content you report.
- To fix problems and improve the app.

We do **not** sell your personal information, and we do **not** use your health
data for advertising.

## Who we share it with

We use a small number of processors, each of which only receives what it needs:

| Service | Purpose | What it receives |
|---|---|---|
| Google Firebase (Auth, Firestore) | Login and data storage | Your account and app data |
| OpenAI | AI coaching, analysis, and food-photo estimation | Your fitness/nutrition context and the messages or photos you submit |
| Our hosting provider | Running the API | Data in transit |

Your data is sent to OpenAI only to produce a response for you. We do not send
your email address to OpenAI.

We may also disclose information if legally required, or to protect the rights
and safety of users.

## Where it lives and how long we keep it

Data is stored in Google Cloud (Firestore) and kept while your account is
active. Delete your account and we permanently erase your workouts, nutrition
logs, wellness entries, plans, AI conversations, and profile.

## Your choices and rights

- **Access / export** — Settings → Export my data gives you everything we hold
  as JSON.
- **Delete** — Settings → Delete my account permanently erases your account and
  data from inside the app. This cannot be undone.
- **Correct** — edit any entry directly in the app.
- **Permissions** — camera and photo library access are optional and only used
  for meal photos and optional body-scan progress photos. Body-scan images are
  analyzed and deleted; we keep structured coaching notes only. You can revoke
  permissions in your device settings at any time.

Depending on where you live (for example the EEA, UK, or California) you may
have additional rights over your data. Contact us and we will honour them.

## Children

GymAI is not for children. You must be at least 16 to create an account. We do
not knowingly collect data from anyone younger; if we learn that we have, we
delete it. Contact us if you believe a child has created an account.

## Security

Traffic is encrypted in transit (HTTPS). Authentication is handled by Firebase,
and every API request is verified against your login before any data is
returned. No system is perfectly secure, but we work to protect your data.

## Health disclaimer

GymAI is a fitness tracking tool, not a medical service. It does not diagnose,
treat, or prevent any condition, and its AI coach is not a doctor, dietitian, or
therapist. See a qualified professional for medical advice.

## Changes

We will post any changes here and update the date above. Significant changes
will be announced in the app.

## Contact

**support@gymai.app**

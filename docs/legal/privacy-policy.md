# GymAI Privacy Policy

**Last updated: 11 September 2026**

## Who we are

GymAI ("we", "us") is a fitness and nutrition AI app by Shiv Patel. It helps you log workouts and meals, get AI coaching, and track progress.

Questions: **shivpatelca2@gmail.com**

## What we collect

**You give us:**

- **Account details** — email address and password. Passwords are handled by Google Firebase Authentication; we never see or store them in plain text.
- **Date of birth** — collected at sign-up to confirm you meet our minimum age (16).
- **Health and fitness data** — height, weight, age, gender, training goals, experience level, workouts, sets, reps, weights, cardio, and step activity.
- **Nutrition data** — meals, calories, macronutrients, hydration, and optional meal photos you choose to submit.
- **Meal photos (archived)** — when you log a meal with a photo, we compress it to JPEG and archive a compressed copy in our database so you can revisit estimate history and use Fix Results chat. Photos are **kept while your account is active** and deleted when you delete your account. If an archive would be too large for storage limits, the photo may be omitted and Fix Results chat works from the numbers alone.
- **Optional body-scan photos** — guided front/side/back progress photos you choose to submit for AI physique coaching. Images are analyzed into structured coaching notes, then **deleted**. We retain the coaching notes (not the photos) for trends.
- **Wellness data** — sleep, stress levels, body feelings, and survey answers.
- **AI conversations** — messages you send to the AI coach and its replies.
- **Support and reports** — content you flag as objectionable, and any reason you give when requesting expanded AI access.

**Collected automatically:** basic technical and error logs needed to operate and debug the service.

We do **not** collect advertising identifiers, and we do not use tracking across other companies' apps or websites.

## How we use it

- To provide the app: storing your logs and showing your history and progress.
- To generate AI guidance: training plans, nutrition targets, food-photo estimates, and coach replies.
- To power Fix Results and estimate history from archived meal photos (or from numeric estimates when a photo was not archived).
- To enforce AI usage limits and review requests for expanded access.
- To keep the service safe: screening messages for harmful content and reviewing content you report.
- To fix problems and improve the app.

We do **not** sell your personal information, and we do **not** use your health data for advertising.

## Who we share it with

We use a small number of processors, each of which only receives what it needs:

| Service | Purpose | What it receives |
|---|---|---|
| Google Firebase (Authentication, Firestore) | Login and data storage | Your account and app data, including archived meal photos |
| OpenAI | AI coaching, plans, and food-photo estimation | Fitness/nutrition context, messages, and photos you submit for analysis — **not** your email address |
| Railway | Hosting the API | Data in transit while requests are processed |
| Vercel | Hosting the web app | Standard web traffic needed to serve the site |

Your data is sent to OpenAI only to produce a response for you. We do not send your email address to OpenAI.

We may also disclose information if legally required, or to protect the rights and safety of users.

## Where it lives and how long we keep it

Data is stored in Google Cloud (Firestore) and kept while your account is active.

- **Meal photos** remain archived for estimate history and Fix Results chat until you delete your account (or until a specific photo could not be archived due to size limits).
- **Body-scan photos** are analyzed then deleted; structured coaching notes are kept for trends.
- **Other account data** (workouts, nutrition logs, wellness entries, plans, AI conversations, profile) is kept while the account is active.

When you delete your account, we permanently erase your workouts, nutrition logs (including archived meal photos), wellness entries, plans, AI conversations, body-scan notes, and profile.

## Your choices and rights

- **Access / export** — Settings → Export my data gives you a copy of what we hold (JSON).
- **Delete** — Settings → Delete my account permanently erases your account and data from inside the app. This cannot be undone.
- **Correct** — edit any entry directly in the app.
- **Permissions** — camera and photo library access are optional and only used for meal photos and optional body-scan progress photos. You can revoke permissions in your device settings at any time.
- **Report** — use the Report control on AI messages if something is objectionable.
- **AI limits** — AI features have a daily free quota; you can request higher limits from inside the app.

Depending on where you live (for example the EEA, UK, or California) you may have additional rights over your data. Contact us and we will honour them.

## Children

GymAI is not for children. You must be at least **16** to create an account. We do not knowingly collect data from anyone younger; if we learn that we have, we delete it. Contact us if you believe a child has created an account.

## Security

Traffic is encrypted in transit (HTTPS). Authentication is handled by Firebase, and every API request is verified against your login before any data is returned. No system is perfectly secure, but we work to protect your data.

## Health disclaimer

GymAI is a fitness tracking tool, **not a medical service**. It does not diagnose, treat, or prevent any condition, and its AI coach is not a doctor, dietitian, or therapist. See a qualified professional for medical advice.

If you are struggling with food, eating, or body image, calorie tracking may not be appropriate for you. In the US, the ANAD helpline is **1-888-375-7767**. If you are in crisis, call or text **988** (US) or contact your local emergency services.

## Changes

We will post any changes here and update the date above. Significant changes will be announced in the app.

## Contact

**shivpatelca2@gmail.com**

---

*This document is provided as a product-accurate starting point; independent legal review is recommended before relying on it in regulated markets.*

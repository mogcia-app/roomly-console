# Firebase Functions Deploy

## Overview

This project now includes a Firestore-triggered Firebase Function that watches `chat_threads/{threadId}` and sends frontdesk notifications when a guest or AI message increases frontdesk unread state.

Source files:

- `functions/index.js`
- `functions/package.json`

## Before First Deploy

1. Install the Firebase CLI if it is not already available.
2. Authenticate with Firebase:

```bash
firebase login
```

3. Install Functions dependencies:

```bash
npm run functions:install
```

## Required Runtime Environment

The deployed Function does not read the Next.js root `.env.local` file.

Provide these variables to the Functions runtime before deploy:

- `RESEND_API_KEY`
- `FRONTDESK_EMAIL_FROM`
- `FRONTDESK_EMAIL_REPLY_TO`
- `FRONTDESK_API_BASE_URL`

The trigger uses the default Firebase Admin credentials from the deployed project, so the local `FIREBASE_ADMIN_*` variables are not required in production Functions.

## Recommended Local Env File For Functions

Create a local file at:

```bash
functions/.env.roomly-f19b0
```

Example contents:

```dotenv
RESEND_API_KEY=...
FRONTDESK_EMAIL_FROM=...
FRONTDESK_EMAIL_REPLY_TO=...
FRONTDESK_API_BASE_URL=https://roomly-console.com
```

Firebase Functions will load this per-project env file during deploy for the `roomly-f19b0` project.

## Deploy Commands

Deploy only Functions:

```bash
npm run deploy:functions
```

Deploy Firestore rules and indexes:

```bash
npm run deploy:firestore
```

## Pre-Deploy Checks

Run:

```bash
npm run lint
npm run functions:check
```

## Notes

- Notification recipient emails are resolved from `hotel_frontdesk_settings.notification_emails` first.
- If that list is empty, the Function falls back to active `hotel_admin` and `hotel_front` user emails.
- Duplicate sends are prevented with `frontdesk_push_dispatches`.

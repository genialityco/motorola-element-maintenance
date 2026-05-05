# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Polyglot monorepo for a maintenance-ticket CRM whose users interact through WhatsApp and whose admins use a Next.js panel. There are **four independent npm packages** — none share a root `package.json`. Run `npm install` and scripts inside each package directory:

- [backend/](backend/) — NestJS REST API (port 3001, prefix `/api`). This is the **active** WhatsApp bot runtime; treat it as the source of truth for the conversational state machine.
- [functions/](functions/) — Firebase Cloud Functions (older / alternative implementation of the same bot via `onTaskDispatched` queue, plus a callable `transitionTicketStatus` and `onTicketStatusUpdated` Firestore trigger). The backend's in-process `onSnapshot` listener has effectively replaced the latter — be careful not to enable both at once or status-change notifications will fire twice.
- [web/](web/) — Next.js 16 + React 19 + Mantine 9 admin panel (Tailwind v4 also installed). See [web/AGENTS.md](web/AGENTS.md): Next.js 16 has breaking changes vs. training data; consult `web/node_modules/next/dist/docs/` before writing Next-specific code.
- [shared/types/](shared/types/) — Plain `.ts` types (`Ticket`, `User`, `Role`, `TicketStatus`) imported by relative path (e.g. `../../../../../shared/types`). No build/publish step.

Firebase project: `lenovo-experiences` (see [.firebaserc](.firebaserc)). Both backend and web fall back to this `projectId` when no service account is provided so the emulators work out of the box.

## Common commands

Backend (NestJS):
```
cd backend
npm run start:dev        # watch mode on :3001
npm run build && npm run start:prod
```
Backend needs either `USE_FIREBASE_EMULATORS=true` **or** `GOOGLE_APPLICATION_CREDENTIALS` pointing at a service-account JSON. Without one of these, Firestore/Auth/Storage calls fail.

Web (Next.js 16):
```
cd web
npm run dev              # :3000
npm run build && npm start
npm run lint             # eslint flat-config
```
Set `NEXT_PUBLIC_USE_EMULATORS=true` to point the client SDK at local emulators (see [web/src/lib/firebase.ts](web/src/lib/firebase.ts)).

Firebase Functions:
```
cd functions
npm run build            # tsc → lib/
npm run serve            # build + emulators (only functions)
npm run deploy           # firebase deploy --only functions
npm run lint             # ESLint with google config — runs on predeploy
```
`firebase deploy` runs `lint` then `build` as `predeploy` hooks (see root [firebase.json](firebase.json)). A failed lint blocks deploy.

Emulators (root, run from repo root):
```
firebase emulators:start
```
Root [firebase.json](firebase.json) maps emulators to **functions:5010, firestore:8010, ui:4010**. The web client and backend hardcode these ports. Note that [functions/firebase.json](functions/firebase.json) declares conflicting ports (5001/8080) — that file is for running emulators *from inside* `functions/`, but if you do, the web client and backend won't be able to reach them. Prefer running emulators from the repo root.

There are **no test scripts** in any package — don't invent `npm test` commands.

## Architecture

### Zero-trust write model
[firestore.rules](firestore.rules) blocks **all** client writes (`allow write: if false`) on `tickets/*` and `users/*`. Every mutation must go through the Admin SDK — i.e., either the NestJS backend or a Cloud Function. The web app is read-only for these collections; it subscribes via `onSnapshot` and triggers status changes by calling backend endpoints. When adding a new mutation path, do not loosen the rules — add a backend endpoint or callable function instead.

### WhatsApp bot state machine
The bot's state lives in Firestore at `whatsapp_sessions/{phone}` with fields like `state`, `tempPhotos`, `targetPhone`, `pendingTickets`, `pendingTicketId`, `botEnabled`. Authoritative implementation: [backend/src/whatsapp/whatsapp.service.ts](backend/src/whatsapp/whatsapp.service.ts). States in use (string literals — keep them spelled exactly):

`IDLE`, `WAITING_PHONE_FOR_TICKET_CREATION`, `WAITING_PHOTOS_AND_DESC`, `WAITING_PHONE_FOR_STATUS`, `WAITING_ACTION_AFTER_STATUS`, `WAITING_TICKET_SELECTION_EDIT`, `WAITING_NEW_DESCRIPTION`, `WAITING_TICKET_SELECTION_DELETE`, `WAITING_TICKET_SELECTION_FINALIZE`.

Critical detail: in `WAITING_PHOTOS_AND_DESC`, `tempPhotos` must be re-read from Firestore on every message — multiple inbound images race, and stale in-memory copies will lose photos. The simulator endpoint reuses `processMessage` with an `onResponse` collector callback so the same code path drives both real WhatsApp traffic and the in-browser simulator.

Two media ingestion paths feed the same processor: `image.directUrl` (already-uploaded, used by the simulator) and `image.id` (real Meta webhook — `uploadMedia` downloads from Graph API and persists to `whatsapp_media/{phone}/...` in Storage with `makePublic`).

`botEnabled === false` short-circuits the processor: the user's message is still saved to history, but no automated reply is generated. The admin's chat UI uses this to take over a conversation.

### Ticket status notifications
[backend/src/whatsapp/whatsapp.service.ts](backend/src/whatsapp/whatsapp.service.ts) starts a `firebase.db.collection('tickets').onSnapshot` listener at module init that diffs `status` against an in-memory `ticketStatusCache` and DMs the reporter on changes. The legacy [functions/src/whatsapp.ts](functions/src/whatsapp.ts) `onTicketStatusUpdated` trigger does the same thing — if both run against the same project, users get duplicate notifications.

### Status transition contract
Both [backend/src/tickets/tickets.service.ts](backend/src/tickets/tickets.service.ts) and [functions/src/tickets.ts](functions/src/tickets.ts) implement the same transition: a Firestore transaction that updates `status` + `timestamps.updatedAt` and appends a `statusHistory/` subdocument with `{previousStatus, newStatus, changedBy: {uid, role}, comments, timestamp}`. The backend version accepts an extra `FINALIZADO` state (used by the WhatsApp "finalize" flow) that the callable function does not.

### Auth
Backend uses [backend/src/auth/firebase-auth.guard.ts](backend/src/auth/firebase-auth.guard.ts) — `Authorization: Bearer <Firebase ID token>` → `verifyIdToken` → attaches decoded token as `req.user`. Roles (`admin`, `host`, `client`, `workshop`, `transporter`) are read from custom claims (`req.user.role`). `WhatsappController` mounts the guard only on `/send` and `/bot-toggle` — the webhook and simulator endpoints are public by design.

### Web admin
Single nested `app/admin` route group with auth gating in [web/src/app/admin/layout.tsx](web/src/app/admin/layout.tsx) (Firebase Auth email/password; renders a login screen if `onAuthStateChanged` returns null). Live ticket list at `/admin/dashboard`, chat console at `/admin/dashboard/chats`, and the bot simulator at `/admin/dev/simulator`. Mantine is loaded via `MantineProvider` in [web/src/app/layout.tsx](web/src/app/layout.tsx) — keep `'use client'` on any page that uses Mantine components.

## Conventions worth knowing

- User-facing strings throughout the codebase are in **Spanish**. Match the existing tone when adding messages — especially in the WhatsApp bot, where reply text is part of the UX contract.
- `Ticket.status` values are uppercase Spanish identifiers (`REPORTADO`, `REVISION`, `EN_REPARACION`, `REPARADO`, `ENTREGADO`, plus `FINALIZADO` in the backend). Don't translate or normalize them.
- Storage layout: `whatsapp_media/{phone}/{timestamp}_{rand-or-mediaId}.{ext}`, files made public via `makePublic()`. The chat history renders these URLs directly.
- Firestore composite indexes in [firestore.indexes.json](firestore.indexes.json) cover `events`, `imageTasks`, `photo_booth_prompts`, and `wishes` — these collections are not in this codebase. They appear to belong to a sibling project sharing the `lenovo-experiences` Firebase project; leave them alone unless asked.

# Frontend (Next.js 14)

## Local development (stable)

This project is configured to run frontend on `3000` and backend on `8000`.

### 1) Configure env

Copy `.env.example` to `.env.local` and keep:

```dotenv
API_BASE_URL=http://127.0.0.1:8000
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

### 2) Start frontend

```powershell
npm run dev -- --port 3000
```

Or from project root (starts backend + frontend together):

```powershell
powershell -ExecutionPolicy Bypass -File .\start-dev.ps1
```

Open `http://127.0.0.1:3000`.

### 2.1) Playwright E2E (critical revision flow)

Preconditions:

- Frontend starts on `3000`
- Backend is available on `8000`
- E2E credentials are configured (`E2E_USERNAME` / `E2E_PASSWORD`)

Install browser once:

```powershell
npx playwright install chromium
```

Run E2E tests:

```powershell
npm run e2e
```

Run headed mode:

```powershell
npm run e2e:headed
```

Implemented scenarios in `tests/e2e/inventory-flow.spec.ts`:

- login → inventory → search/select item → save entry → recent visible
- offline queue item → back online → sync
- export file download exists
- closed session blocks save (UI shows `Сессия закрыта`)

### 3) Auth smoke check

Use active credentials from your environment:

- username: `E2E_USERNAME`
- password: `E2E_PASSWORD`

### Notes

- Server route handlers (`app/api/*`) use `API_BASE_URL` first, then fallback to `NEXT_PUBLIC_API_BASE_URL`.
- Client-side requests use `NEXT_PUBLIC_API_BASE_URL`.

## Inventory outside-zone contract

Inventory page sends outside-zone fields on entry save/update:

- `counted_outside_zone: boolean`
- `outside_zone_note: string | null`

Response fields used by UI (`recent` and entry payloads):

- `counted_outside_zone`
- `counted_by_zone_id`
- `counted_by_zone`
- `outside_zone_note`

Export contract (`GET /inventory/sessions/{session_id}/export`, csv/xlsx) includes:

- `CountedOutsideZone`
- `CountedByZone`

These fields are now part of the stable contract and should be preserved in frontend request/response typings.

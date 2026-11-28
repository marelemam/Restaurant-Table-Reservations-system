# Maria Staff Operations API Reference

## Conventions

- Local base URL: `http://localhost:3002`
- Protected base path: `/api/staff`
- Protected requests require `Authorization: Bearer <Cognito access token>`
- Allowed roles: `Staff` or `Admin`, except where a stricter rule is shown
- JSON error responses use `error` and may include validation `details`

## Public endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Service health and ownership |
| GET | `/api/staff` | Staff component capability list |

## Waitlist

| Method | Path | Request/Rule | Success |
|---|---|---|---|
| POST | `/api/staff/waitlist` | `{customerName, phone, partySize}`; party size 1–20 | `201` |
| GET | `/api/staff/waitlist` | Lists active `waiting` and `notified` entries with queue position | `200` |
| PATCH | `/api/staff/waitlist/:id/notify` | Only a `waiting` entry can be notified | `200` |
| PATCH | `/api/staff/waitlist/:id/cancel` | Only `waiting` or `notified` can be cancelled | `200` |

## Attendance

| Method | Path | Request/Rule | Success |
|---|---|---|---|
| POST | `/api/staff/attendance/check-ins` | `{reservationId, notes?}`; duplicate attendance rejected | `201` |
| POST | `/api/staff/attendance/no-shows` | `{reservationId, scheduledStartTime, notes?}`; grace period enforced | `201` |
| GET | `/api/staff/attendance?date=YYYY-MM-DD` | Date is optional | `200` |

## Seating

| Method | Path | Request/Rule | Success |
|---|---|---|---|
| POST | `/api/staff/seating` | `{tableId}` plus exactly one of `reservationId` or `waitlistId` | `201` |
| GET | `/api/staff/seating` | Lists active seating sessions | `200` |
| PATCH | `/api/staff/seating/:id/transfer` | `{newTableId}`; destination must be free | `200` |
| PATCH | `/api/staff/seating/:id/checkout` | Only active seating can be checked out | `200` |

## Analytics and audit

| Method | Path | Access/Rule | Success |
|---|---|---|---|
| GET | `/api/staff/analytics/daily?date=YYYY-MM-DD` | Staff: today only; Admin: historical dates | `200` |
| GET | `/api/staff/activity` | Staff: own activity; Admin: all/filter by `staffId` | `200` |

Activity filters are `staffId`, `action`, `entityType`, `limit` (1–100) and
`offset` (0 or greater).

## Expected error statuses

| Status | Meaning |
|---:|---|
| 400 | Input validation failed |
| 401 | Missing, invalid or expired authentication |
| 403 | Authenticated user lacks permission |
| 404 | Route or requested entity not found |
| 409 | Business-rule or workflow-state conflict |
| 500 | Unexpected internal error |
| 503 | Authentication or required dependency unavailable |

The Staff-to-Reservation and Staff-to-Table network calls are intentionally not
listed as complete until the owners implement and confirm the endpoints in
`service-integration-contract.md`.

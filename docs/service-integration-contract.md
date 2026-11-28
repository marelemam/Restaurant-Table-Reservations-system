# Restaurant System Service Integration Contract

## 1. Purpose

This document defines how the three project services communicate.

The project uses the term **Reservation** consistently instead of mixing “Booking” and “Reservation”.

The services are:

- Customer Reservation Service
- Table Management Service
- Staff Operations Service

All protected service requests must forward the Cognito access token:

```http
Authorization: Bearer <Cognito access token>
```

---

## 2. Reservation Service Contract

Base URL:

```text
http://localhost:3001
```

Environment variable used by Staff Operations:

```text
RESERVATION_SERVICE_URL=http://localhost:3001
```

### 2.1 Get a Reservation

```http
GET /reservations/:id
```

Staff Operations uses this endpoint before:

- Customer check-in
- Recording a no-show
- Seating a reservation customer

Successful response:

```json
{
  "reservation": {
    "reservationId": "reservation-001",
    "customerId": "customer-001",
    "partySize": 4,
    "status": "confirmed",
    "startTime": "2026-11-28T18:00:00.000Z",
    "endTime": "2026-11-28T19:30:00.000Z"
  }
}
```

Expected status codes:

| Status | Meaning |
|---|---|
| 200 | Reservation found |
| 400 | Invalid reservation ID |
| 401 | Authentication required |
| 403 | Permission denied |
| 404 | Reservation not found |
| 500 | Internal service error |

### 2.2 Update Reservation Status

```http
PATCH /reservations/:id/status
```

Request body:

```json
{
  "status": "checked_in"
}
```

Supported statuses:

- `confirmed`
- `checked_in`
- `no_show`
- `seated`
- `completed`
- `cancelled`

Successful response:

```json
{
  "message": "Reservation status updated",
  "reservation": {
    "reservationId": "reservation-001",
    "status": "checked_in"
  }
}
```

Business rules:

- A cancelled reservation cannot be checked in.
- A no-show reservation cannot be seated.
- A completed reservation cannot return to an active status.
- The reservation duration must not exceed the project’s maximum allowed duration.
- Status changes must be validated by the backend.

---

## 3. Table Service Contract

Base URL:

```text
http://localhost:3003
```

Environment variable used by Staff Operations:

```text
TABLE_SERVICE_URL=http://localhost:3003
```

### 3.1 Get a Table

```http
GET /api/tables/:id
```

Staff Operations uses this endpoint before creating or transferring a seating session.

Successful response:

```json
{
  "table": {
    "tableId": "T-01",
    "capacity": 4,
    "status": "available"
  }
}
```

Expected status codes:

| Status | Meaning |
|---|---|
| 200 | Table found |
| 400 | Invalid table ID |
| 401 | Authentication required |
| 403 | Permission denied |
| 404 | Table not found |
| 500 | Internal service error |

### 3.2 Occupy a Table

```http
POST /api/tables/:id/occupy
```

Request body:

```json
{
  "seatingId": "00000000-0000-4000-8000-000000000201",
  "sourceType": "reservation",
  "sourceId": "reservation-001",
  "partySize": 4
}
```

Successful response:

```json
{
  "message": "Table occupied successfully",
  "table": {
    "tableId": "T-01",
    "status": "occupied"
  }
}
```

Business rules:

- The table must exist.
- The table must be available.
- The party size must not exceed the table capacity.
- A table cannot have two active seating sessions.
- The seating ID must be recorded with the table occupancy.

### 3.3 Release a Table

```http
POST /api/tables/:id/release
```

Request body:

```json
{
  "seatingId": "00000000-0000-4000-8000-000000000201"
}
```

Successful response:

```json
{
  "message": "Table released successfully",
  "table": {
    "tableId": "T-01",
    "status": "available"
  }
}
```

Business rules:

- The table must currently be occupied.
- The supplied seating ID must match the table’s active seating session.
- Releasing a table makes it available for another customer.

---

## 4. Staff Operations Integration Flow

### 4.1 Check-in Flow

1. Staff submits a reservation ID.
2. Staff Operations requests the reservation from Reservation Service.
3. Reservation Service confirms that the reservation exists and is eligible.
4. Staff Operations records the attendance event.
5. Reservation Service updates the reservation status to `checked_in`.
6. Staff Operations records the action in its activity log.

### 4.2 No-show Flow

1. Staff or EventBridge starts the no-show workflow.
2. Staff Operations validates the reservation and scheduled time.
3. Staff Operations applies the no-show grace-period rule.
4. The attendance event is recorded as `no_show`.
5. Reservation Service updates the reservation status to `no_show`.
6. Staff Operations publishes an operational SQS event.

### 4.3 Seating Flow

1. Staff selects a reservation or waitlist customer.
2. Staff Operations requests the table from Table Service.
3. Table Service confirms availability and sufficient capacity.
4. Staff Operations creates the seating session.
5. Table Service marks the table as `occupied`.
6. Staff Operations records the action in its activity log.

### 4.4 Checkout Flow

1. Staff checks out an active seating session.
2. Staff Operations marks the session as `checked_out`.
3. Staff Operations calls Table Service to release the table.
4. Table Service marks the table as `available`.
5. Staff Operations records the checkout action.

---

## 5. Authentication and Authorization

- Cognito provides JWT access tokens.
- Customer, Staff and Admin groups are stored in Cognito.
- Customer users cannot access Staff Operations endpoints.
- Staff users can perform daily operational functions.
- Admin users can access historical analytics and all staff activity.
- Authorization is enforced in each backend service.
- Hiding frontend controls is not considered sufficient authorization.

---

## 6. Failure Handling

Staff Operations will:

- Apply a short timeout when calling another service.
- Return `502 Bad Gateway` when another service returns an invalid response.
- Return `503 Service Unavailable` when another service cannot be reached.
- Never expose internal service URLs or stack traces.
- Forward the authenticated user’s Cognito JWT when appropriate.
- Never write access tokens or passwords to logs.
- Add the request ID to integration error logs.
- Avoid reporting a workflow as successful when a required service call fails.

---

## 7. Current Implementation Status

| Integration item | Status |
|---|---|
| Staff Operations service URL configuration | Complete |
| Reservation Service health endpoint | Complete |
| Reservation lookup endpoint | Complete |
| Reservation status endpoint | Complete |
| Table lookup endpoint | Complete |
| Table occupy endpoint | Complete |
| Table release endpoint | Complete |
| Staff Operations integration clients | Complete |
| Per-service automated tests | Complete |
| Staging end-to-end test | Run after environment configuration |

The Reservation and Table service owners must confirm these endpoint paths and response formats before Staff Operations implements the live service calls.

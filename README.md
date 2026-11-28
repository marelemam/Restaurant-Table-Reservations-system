# Restaurant Table Reservation System

Integrated Node.js/Express system containing the three team components:

| Service | Owner scope | Local URL | Lambda handler |
|---|---|---|---|
| Reservation | Customer profiles and reservations | `http://localhost:3001` | `app.handler` |
| Staff Operations | Attendance, waitlist, seating and analytics | `http://localhost:3002` | `lambda.handler` |
| Table Management | Tables, capacity, policies and occupancy | `http://localhost:3003/api/tables` | `app.handler` |

## Integration guarantees

- One Cognito access token and the `Customer`, `Staff`, and `Admin` groups are used by all services.
- Table IDs are UUIDs everywhere.
- Reservation status transitions are validated by the Reservation Service.
- Reservation creation validates table capacity, operational status and maximum duration.
- Staff check-in/no-show updates the reservation status.
- Staff seating/transfer/checkout occupies or releases the table.
- Database credentials can be loaded from AWS Secrets Manager; secrets are not committed.
- All outbound service calls have a timeout and return controlled dependency errors.

## Local preparation

Create an untracked `.env` in each service from its `.env.example`. Use the same PostgreSQL database and Cognito configuration in all three.

```bash
cd backend/reservation-service && npm ci
cd ../staff-service && npm ci
cd ../table-service && npm ci
```

Initialize the shared database from the staff service:

```bash
cd backend/staff-service
npm run db:init
npm run db:seed
```

Start the services in three terminals:

```bash
cd backend/reservation-service && npm start
cd backend/staff-service && npm start
cd backend/table-service && npm start
```

## Verification

```bash
cd backend/reservation-service && npm test
cd backend/staff-service && npm test
cd backend/table-service && npm test
```

The static frontend can now call the three API bases. See [docs/integration-readiness.md](docs/integration-readiness.md) for frontend and AWS deployment configuration.

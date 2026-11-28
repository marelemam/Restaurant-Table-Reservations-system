# Restaurant Table Reservation System

Cloud-based restaurant reservation system built with Node.js, Express,
PostgreSQL and AWS-compatible serverless services.

## Maria – Staff Operations

Maria's independently owned component provides:

- Waitlist management with queue and status rules
- Attendance check-in and grace-period no-show processing
- Transactional seating, table transfer and checkout
- Daily operational analytics and staff activity auditing
- Cognito JWT authorization for Staff and Admin roles
- Lambda, API Gateway, Secrets Manager, SNS, SQS and EventBridge integration
- A static Staff Operations dashboard

### Verify the backend

From `backend/staff-service`:

```bash
npm ci
npm test
```

Copy `.env.example` to `.env` for local development and supply your own values.
Never commit `.env` or access tokens.

### Important project documents

- `docs/maria-predeployment-checklist.md`
- `docs/maria-api-reference.md`
- `docs/maria-security-evidence.md`
- `docs/service-integration-contract.md`
- `k6/README.md`

Maria's component is locally complete and integration-ready. Real cross-service
calls remain gated on the Reservation and Table service owners implementing and
confirming the endpoints in the integration contract.

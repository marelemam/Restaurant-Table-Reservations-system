# Integration, Frontend and Cloud Handoff

## Backend API bases

| Purpose | Local base |
|---|---|
| Reservation | `http://localhost:3001` |
| Staff Operations | `http://localhost:3002/api/staff` |
| Table Management | `http://localhost:3003/api/tables` |

The frontend must send `Authorization: Bearer <access-token>` to every protected endpoint. It must not make authorization decisions on its own; backend role checks remain authoritative.

## Required frontend configuration

Use a public runtime configuration file containing only:

- Reservation API URL
- Staff API URL
- Table API URL
- Cognito endpoint/region
- Cognito user-pool client ID

Never put a database URL, AWS secret key, Cognito user password, or access token in frontend files.

## Required AWS resources

1. Three Lambda functions, one per service.
2. API Gateway routes for each Lambda.
3. One Cognito user pool with `Customer`, `Staff`, and `Admin` groups.
4. Secrets Manager secret containing `DATABASE_URL`.
5. IAM execution roles allowing CloudWatch Logs and access to only that secret.
6. S3 plus CloudFront for the static frontend.
7. Maria's SQS, SNS, and EventBridge resources for operational events, notifications, and scheduled no-shows.

## Lambda environment variables

All Lambdas require Cognito and database configuration. Prefer `DATABASE_SECRET_ID` over `DATABASE_URL`.

Reservation additionally requires `TABLE_SERVICE_URL`. Staff requires `RESERVATION_SERVICE_URL` and `TABLE_SERVICE_URL`. All production deployments must set `NODE_ENV=production` and must not enable `DEV_AUTH_BYPASS`.

## API Gateway layout

Recommended public paths:

- `/reservations/{proxy+}` -> Reservation Lambda
- `/staff/{proxy+}` -> Staff Operations Lambda
- `/tables/{proxy+}` -> Table Lambda

If API Gateway removes or adds a prefix, configure route mappings consistently before connecting the frontend.

## Pre-deployment gate

- Run all three test suites.
- Apply `database/schema.sql` to a clean staging database.
- Verify Customer, Staff, and Admin tokens.
- Run one end-to-end reservation -> check-in -> seating -> checkout workflow.
- Confirm table status returns to `available`.
- Confirm CloudWatch logs contain no tokens or database credentials.
- Run the five-VU smoke test before the 200/1000-VU load tests.

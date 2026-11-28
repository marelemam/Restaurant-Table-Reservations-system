# Maria Staff Operations – Pre-deployment Gate

## Complete locally

- [x] Waitlist workflow with queue position, notify and cancellation rules
- [x] Attendance check-in, duplicate prevention and no-show grace period
- [x] Seating, transfer and checkout workflows with transactional protection
- [x] Daily analytics and role-limited activity audit logs
- [x] PostgreSQL schema, constraints and seed data
- [x] Cognito JWT verification and Staff/Admin backend authorization
- [x] Secrets Manager, SNS, SQS and EventBridge integration code
- [x] Lambda adapter and API Gateway-compatible Express application
- [x] Staff dashboard connected to Staff Operations endpoints
- [x] Runtime dashboard configuration separated from application logic
- [x] Restricted CORS configuration
- [x] Automated tests: 8 suites and 40 tests passing on 28 November 2026
- [x] Reproducible k6 script for 200-VU load and 1000-VU stress tests
- [x] Service integration contract and security evidence

## Integration gate – requires Mariam and Marihan

- [ ] Reservation lookup and status endpoints supplied by Reservation Service
- [ ] Table lookup, occupy and release endpoints supplied by Table Service
- [ ] Confirm final endpoint paths and JSON field names
- [ ] Implement live Staff-to-Reservation and Staff-to-Table calls
- [ ] Run cross-service contract and failure-handling tests

## Cloud deployment gate

- [ ] Create/update Cognito groups and test users
- [ ] Store the production database URL in Secrets Manager
- [ ] Package Staff Lambda with production dependencies
- [ ] Deploy Lambda, API Gateway routes and IAM policies
- [ ] Configure SNS, SQS and EventBridge resources
- [ ] Upload dashboard to S3 and update `frontend/staff-dashboard/config.js`
- [ ] Set `ALLOWED_ORIGINS` to the deployed dashboard origin
- [ ] Verify CloudWatch logs contain no tokens, passwords or database URLs
- [ ] Run authenticated smoke, security and integration tests
- [ ] Run final 200-VU load test, then the separate 1000-VU stress test

## Evidence rule

The preliminary 1000-VU result reached 614 active VUs, had 5.46% failed HTTP
requests and a 9.99-second p95, and also contained a test-script exception. It
is useful diagnostic evidence but is not a successful final load-test result.

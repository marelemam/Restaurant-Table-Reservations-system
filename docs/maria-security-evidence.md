# Maria – Staff Operations Security Evidence

## 1. Component Scope

Maria owns the Staff Operations service, including:

- Waitlist management
- Customer attendance and no-show recording
- Seating, transfer and checkout workflows
- Operational analytics
- Staff activity auditing
- EventBridge, SQS and SNS integrations

Protected requests use Cognito JWT access tokens. PostgreSQL credentials are retrieved through Secrets Manager.

## 2. Role and Permission Matrix

| Operation | Customer | Staff | Admin |
|---|---:|---:|---:|
| Access staff routes | Denied | Allowed | Allowed |
| Manage waitlist | Denied | Allowed | Allowed |
| Record attendance | Denied | Allowed | Allowed |
| Manage seating | Denied | Allowed | Allowed |
| View today’s analytics | Denied | Allowed | Allowed |
| View historical analytics | Denied | Denied | Allowed |
| View own activity | Denied | Allowed | Allowed |
| View all staff activity | Denied | Denied | Allowed |

Authorization is enforced in the Express backend, not only in the frontend.

## 3. Threat Model

| ID | Threat | Application-specific scenario | Mitigation |
|---|---|---|---|
| T1 | Token spoofing | An attacker submits a fake or modified JWT to staff endpoints. | Cognito JWT signatures, issuer, client ID, token type and expiry are verified using `aws-jwt-verify`. |
| T2 | Privilege escalation | A Customer or Staff user attempts to perform an Admin operation. | Cognito groups are checked by backend middleware. Historical analytics and unrestricted activity access require Admin permission. |
| T3 | IDOR | A Staff user changes `staffId` to access another employee’s activity. | The backend derives the authenticated staff ID from the JWT and rejects access to another staff member’s logs with `403`. |
| T4 | SQL injection | Malicious values are submitted through waitlist, analytics or activity query parameters. | Express Validator checks input and PostgreSQL queries use parameter placeholders rather than string concatenation. |
| T5 | Invalid workflow transition | A cancelled waitlist entry is notified, or an occupied table receives a second active session. | Status transitions are checked in SQL transactions and partial unique indexes prevent duplicate active sessions. |
| T6 | Secret disclosure | The Neon password or database URL is committed to GitHub or embedded in Lambda code. | Secrets Manager stores the database connection string. `.env` is excluded from Git and only example variable names are committed. |
| T7 | Event tampering or replay | A forged or repeated EventBridge/SQS event records duplicate no-shows. | Lambda validates the event action and required values. Database constraints and duplicate checks protect attendance records. IAM restricts service permissions. |
| T8 | Audit-log disclosure | Staff users attempt to view complete logs containing other employees’ actions. | Staff can only view their own activity. Admin users can view and filter all activity. Tokens and passwords are not written to activity logs. |

## 4. Security Tests

| ID | Security test | Expected result | Result |
|---|---|---|---|
| ST01 | Request a protected staff endpoint without a token. | `401 Authentication required` | Passed |
| ST02 | Submit an invalid or expired Cognito access token. | `401 Invalid or expired access token` | Passed |
| ST03 | Use a Customer token on a Staff Operations endpoint. | `403 Staff or Admin permission required` | Passed |
| ST04 | Use Staff to request historical analytics. | `403 Staff can only view today's analytics` | Passed |
| ST05 | Use Staff to request another staff member’s activity. | `403 Staff members can only view their own activity` | Passed |
| ST06 | Use Admin to request historical analytics and all activity. | `200 OK` | Passed |
| ST07 | Submit an invalid UUID to a waitlist or seating endpoint. | `400 Validation failed` | Passed |
| ST08 | Create a second active seating session for the same table or customer. | `409 Conflict` | Passed |
| ST09 | Submit a waitlist party size of zero. | `400 Validation failed` | Passed |
| ST10 | Scan the repository for committed credentials and `.env` files. | No credentials or environment files found | Passed |

## 5. Existing Automated-Test Evidence

The Staff Operations Jest suite verifies authentication, validation, workflows and role restrictions.

Latest result:

- Test suites: 8 passed
- Tests: 38 passed
- Failed tests: 0

## 6. Cloud Security Controls

- Cognito: authentication and JWT group claims
- IAM: least-privilege Lambda, Scheduler, SQS and SNS permissions
- Secrets Manager: database connection secret
- CloudWatch: Lambda execution and error logs
- API Gateway: protected REST API entry point
- SQS: asynchronous operational events
- SNS: waitlist notification events
- EventBridge Scheduler: automatic no-show processing
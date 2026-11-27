-- Development and testing data only.
-- Do not use real customer information.

BEGIN;

INSERT INTO staff_operations.attendance_events (
    attendance_id,
    reservation_id,
    attendance_status,
    recorded_by,
    recorded_at,
    notes
)
VALUES
(
    '00000000-0000-4000-8000-000000000001',
    'reservation-demo-001',
    'checked_in',
    'cognito-staff-demo-001',
    CURRENT_TIMESTAMP - INTERVAL '30 minutes',
    'Development test check-in'
),
(
    '00000000-0000-4000-8000-000000000002',
    'reservation-demo-002',
    'no_show',
    'cognito-staff-demo-001',
    CURRENT_TIMESTAMP - INTERVAL '20 minutes',
    'Development test no-show'
)
ON CONFLICT DO NOTHING;

INSERT INTO staff_operations.waitlist_entries (
    waitlist_id,
    customer_name,
    phone,
    party_size,
    estimated_wait_minutes,
    status,
    notified_at,
    created_by,
    created_at,
    updated_at
)
VALUES
(
    '00000000-0000-4000-8000-000000000101',
    'Example Walk-in One',
    '01000000001',
    4,
    20,
    'waiting',
    NULL,
    'cognito-staff-demo-001',
    CURRENT_TIMESTAMP - INTERVAL '10 minutes',
    CURRENT_TIMESTAMP
),
(
    '00000000-0000-4000-8000-000000000102',
    'Example Walk-in Two',
    '01000000002',
    2,
    10,
    'notified',
    CURRENT_TIMESTAMP - INTERVAL '2 minutes',
    'cognito-staff-demo-001',
    CURRENT_TIMESTAMP - INTERVAL '15 minutes',
    CURRENT_TIMESTAMP
)
ON CONFLICT DO NOTHING;

INSERT INTO staff_operations.seating_sessions (
    seating_id,
    reservation_id,
    waitlist_id,
    table_id,
    seated_at,
    checkout_at,
    status,
    recorded_by
)
VALUES
(
    '00000000-0000-4000-8000-000000000201',
    'reservation-demo-001',
    NULL,
    'table-demo-01',
    CURRENT_TIMESTAMP - INTERVAL '25 minutes',
    NULL,
    'seated',
    'cognito-staff-demo-001'
)
ON CONFLICT DO NOTHING;

INSERT INTO staff_operations.staff_activity_logs (
    activity_id,
    staff_id,
    action,
    entity_type,
    entity_id,
    request_id,
    timestamp,
    details
)
VALUES
(
    '00000000-0000-4000-8000-000000000301',
    'cognito-staff-demo-001',
    'CUSTOMER_CHECKED_IN',
    'reservation',
    'reservation-demo-001',
    'seed-request-001',
    CURRENT_TIMESTAMP - INTERVAL '30 minutes',
    '{"source":"seed.sql","environment":"development"}'::JSONB
),
(
    '00000000-0000-4000-8000-000000000302',
    'cognito-staff-demo-001',
    'WAITLIST_ENTRY_CREATED',
    'waitlist',
    '00000000-0000-4000-8000-000000000101',
    'seed-request-002',
    CURRENT_TIMESTAMP - INTERVAL '10 minutes',
    '{"source":"seed.sql","environment":"development"}'::JSONB
)
ON CONFLICT DO NOTHING;

COMMIT;
BEGIN;

CREATE SCHEMA IF NOT EXISTS staff_operations;

CREATE TABLE IF NOT EXISTS staff_operations.attendance_events (
    attendance_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    reservation_id VARCHAR(100) NOT NULL UNIQUE,

    attendance_status VARCHAR(20) NOT NULL
        CHECK (
            attendance_status IN (
                'checked_in',
                'no_show'
            )
        ),

    recorded_by VARCHAR(128) NOT NULL,

    recorded_at TIMESTAMPTZ NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    notes TEXT,

    CHECK (
        CHAR_LENGTH(TRIM(reservation_id)) > 0
    )
);

CREATE TABLE IF NOT EXISTS staff_operations.waitlist_entries (
    waitlist_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    customer_name VARCHAR(120) NOT NULL,

    phone VARCHAR(30) NOT NULL,

    party_size SMALLINT NOT NULL
        CHECK (
            party_size BETWEEN 1 AND 20
        ),

    estimated_wait_minutes INTEGER NOT NULL
        CHECK (
            estimated_wait_minutes BETWEEN 0 AND 240
        ),

    status VARCHAR(20) NOT NULL
        DEFAULT 'waiting'
        CHECK (
            status IN (
                'waiting',
                'notified',
                'seated',
                'cancelled',
                'expired'
            )
        ),

    notified_at TIMESTAMPTZ,

    created_by VARCHAR(128) NOT NULL,

    created_at TIMESTAMPTZ NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMPTZ NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    CHECK (
        CHAR_LENGTH(TRIM(customer_name)) >= 2
    ),

    CHECK (
        CHAR_LENGTH(TRIM(phone)) >= 7
    )
);

CREATE TABLE IF NOT EXISTS staff_operations.seating_sessions (
    seating_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    reservation_id VARCHAR(100),

    waitlist_id UUID
        REFERENCES staff_operations.waitlist_entries(waitlist_id),

    table_id VARCHAR(100) NOT NULL,

    seated_at TIMESTAMPTZ NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    checkout_at TIMESTAMPTZ,

    status VARCHAR(20) NOT NULL
        DEFAULT 'seated'
        CHECK (
            status IN (
                'seated',
                'checked_out'
            )
        ),

    recorded_by VARCHAR(128) NOT NULL,

    CHECK (
        (
            reservation_id IS NOT NULL
            AND waitlist_id IS NULL
        )
        OR
        (
            reservation_id IS NULL
            AND waitlist_id IS NOT NULL
        )
    ),

    CHECK (
        checkout_at IS NULL
        OR checkout_at >= seated_at
    )
);

CREATE TABLE IF NOT EXISTS staff_operations.staff_activity_logs (
    activity_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    staff_id VARCHAR(128) NOT NULL,

    action VARCHAR(100) NOT NULL,

    entity_type VARCHAR(50) NOT NULL,

    entity_id VARCHAR(100) NOT NULL,

    request_id VARCHAR(100),

    timestamp TIMESTAMPTZ NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    details JSONB NOT NULL
        DEFAULT '{}'::JSONB
);

CREATE INDEX IF NOT EXISTS idx_attendance_reservation
    ON staff_operations.attendance_events (
        reservation_id
    );

CREATE INDEX IF NOT EXISTS idx_waitlist_status_created
    ON staff_operations.waitlist_entries (
        status,
        created_at
    );

CREATE INDEX IF NOT EXISTS idx_activity_staff_timestamp
    ON staff_operations.staff_activity_logs (
        staff_id,
        timestamp DESC
    );

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_table_session
    ON staff_operations.seating_sessions (
        table_id
    )
    WHERE status = 'seated';

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_reservation_session
    ON staff_operations.seating_sessions (
        reservation_id
    )
    WHERE
        status = 'seated'
        AND reservation_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_waitlist_session
    ON staff_operations.seating_sessions (
        waitlist_id
    )
    WHERE
        status = 'seated'
        AND waitlist_id IS NOT NULL;

COMMIT;
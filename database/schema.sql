

CREATE SCHEMA IF NOT EXISTS tables_cfg;     -- Mariam
CREATE SCHEMA IF NOT EXISTS reservation;    -- Marihan
CREATE SCHEMA IF NOT EXISTS staff;          -- Maria

-- ========== tables_cfg (Mariam) ==========
CREATE TABLE tables_cfg.restaurant_tables (
    table_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_number VARCHAR(20) UNIQUE NOT NULL,
    capacity INT NOT NULL CHECK (capacity > 0),
    location VARCHAR(100),
    operational_status VARCHAR(30) NOT NULL DEFAULT 'available'
        CHECK (operational_status IN ('available', 'occupied', 'maintenance'))
);

CREATE TABLE tables_cfg.booking_policies (
    policy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    max_duration INT NOT NULL CHECK (max_duration > 0),
    preparation_buffer INT NOT NULL DEFAULT 0 CHECK (preparation_buffer >= 0)
);

-- ========== reservation (Marihan) ==========
CREATE TABLE reservation.customers (
    customer_id TEXT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20)
);

CREATE TABLE reservation.reservations (
    reservation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id TEXT NOT NULL REFERENCES reservation.customers(customer_id),
    table_id UUID NOT NULL REFERENCES tables_cfg.restaurant_tables(table_id),
    reservation_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    party_size INT NOT NULL CHECK (party_size > 0),
    status VARCHAR(30) NOT NULL DEFAULT 'confirmed'
        CHECK (status IN ('pending','confirmed','checked_in','seated','cancelled','completed','no_show')),
    CHECK (end_time > start_time)
);

-- ========== staff (Maria) ==========
CREATE TABLE staff.attendance (
    attendance_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_id UUID UNIQUE NOT NULL REFERENCES reservation.reservations(reservation_id),
    check_in_time TIMESTAMP,
    attendance_status VARCHAR(30) NOT NULL
        CHECK (attendance_status IN ('checked_in','no_show','not_arrived'))
);

CREATE TABLE staff.waitlist (
    waitlist_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    party_size INT NOT NULL CHECK (party_size > 0),
    queue_position INT NOT NULL CHECK (queue_position > 0),
    status VARCHAR(30) NOT NULL DEFAULT 'waiting'
        CHECK (status IN ('waiting','seated','cancelled'))
);

CREATE TABLE staff.seating_records (
    seating_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_id UUID NOT NULL REFERENCES reservation.reservations(reservation_id),
    table_id UUID NOT NULL REFERENCES tables_cfg.restaurant_tables(table_id),
    seated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    checkout_at TIMESTAMP,
    status VARCHAR(30) NOT NULL DEFAULT 'seated' CHECK (status IN ('seated','completed')),
    CHECK (checkout_at IS NULL OR checkout_at >= seated_at)
);

CREATE TABLE staff.reservation_events (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_id UUID NOT NULL REFERENCES reservation.reservations(reservation_id),
    event_type VARCHAR(50) NOT NULL,
    "timestamp" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    details TEXT
);

CREATE TABLE staff.staff_activity_logs (
    activity_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id TEXT NOT NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id TEXT,
    "timestamp" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    details TEXT
);

-- Enable GiST support for UUID equality
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Prevent overlapping reservations for the same table
ALTER TABLE reservation.reservations
ADD CONSTRAINT no_overlapping_reservations
EXCLUDE USING gist (
    table_id WITH =,
    tsrange(
        reservation_date + start_time,
        reservation_date + end_time,
        '[)'
    ) WITH &&
)
WHERE (
    status IN ('pending', 'confirmed', 'checked_in', 'seated')
);

-- ========== Indexes ==========
CREATE INDEX idx_reservations_date ON reservation.reservations(reservation_date);
CREATE INDEX idx_reservations_customer ON reservation.reservations(customer_id);
CREATE INDEX idx_reservations_table_date ON reservation.reservations(table_id, reservation_date);
CREATE INDEX idx_events_reservation ON staff.reservation_events(reservation_id);
CREATE INDEX idx_seating_reservation ON staff.seating_records(reservation_id);

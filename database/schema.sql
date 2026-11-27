CREATE SCHEMA IF NOT EXISTS tables_cfg;


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
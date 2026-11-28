CREATE SCHEMA IF NOT EXISTS reservation;

CREATE TABLE reservation.customer (
  customer_id SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  email       VARCHAR(255) NOT NULL UNIQUE,
  phone       VARCHAR(20)
);

CREATE TABLE reservation.reservation (
  reservation_id   SERIAL PRIMARY KEY,
  customer_id      INT NOT NULL REFERENCES reservation.customer(customer_id),
  table_id         UUID NOT NULL,
  reservation_date DATE NOT NULL,
  start_time       TIME NOT NULL,
  end_time         TIME NOT NULL,
  party_size       INT NOT NULL CHECK (party_size > 0),
  status           VARCHAR(20) NOT NULL DEFAULT 'confirmed'
                   CHECK (status IN ('confirmed', 'cancelled', 'completed', 'no_show')),
  CHECK (end_time > start_time)
);

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE reservation.reservation
ADD CONSTRAINT no_overlapping_bookings
EXCLUDE USING gist (
  table_id WITH =,
  tsrange(reservation_date + start_time, reservation_date + end_time) WITH &&
) WHERE (status = 'confirmed');

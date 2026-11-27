INSERT INTO reservation.customers (customer_id, name, email, phone) VALUES
('customer-demo-1', 'Ahmed Ali', 'ahmed@example.com', '01012345678'),
('customer-demo-2', 'Sara Mohamed', 'sara@example.com', '01098765432')
ON CONFLICT (customer_id) DO NOTHING;

INSERT INTO tables_cfg.restaurant_tables
(table_id, table_number, capacity, location, operational_status) VALUES
('11111111-1111-4111-8111-111111111111', 'T1', 2, 'Window', 'available'),
('22222222-2222-4222-8222-222222222222', 'T2', 4, 'Main Hall', 'available'),
('33333333-3333-4333-8333-333333333333', 'T3', 6, 'Main Hall', 'available')
ON CONFLICT (table_id) DO NOTHING;

INSERT INTO tables_cfg.booking_policies (policy_id, max_duration, preparation_buffer) VALUES
('44444444-4444-4444-8444-444444444444', 120, 15)
ON CONFLICT (policy_id) DO NOTHING;

INSERT INTO reservation.reservations
(reservation_id, customer_id, table_id, reservation_date, start_time, end_time, party_size, status) VALUES
('55555555-5555-4555-8555-555555555555', 'customer-demo-1',
 '22222222-2222-4222-8222-222222222222', CURRENT_DATE + 1, '18:00', '20:00', 3, 'confirmed')
ON CONFLICT (reservation_id) DO NOTHING;

INSERT INTO staff.waitlist (waitlist_id, customer_name, phone, party_size, queue_position, status) VALUES
('66666666-6666-4666-8666-666666666666', 'Mona Hassan', '01055556666', 2, 1, 'waiting')
ON CONFLICT (waitlist_id) DO NOTHING;
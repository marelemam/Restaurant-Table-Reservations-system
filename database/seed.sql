INSERT INTO tables_cfg.restaurant_tables
(table_id, table_number, capacity, location, operational_status) VALUES
('11111111-1111-4111-8111-111111111111', 'T1', 2, 'Window', 'available'),
('22222222-2222-4222-8222-222222222222', 'T2', 4, 'Main Hall', 'available'),
('33333333-3333-4333-8333-333333333333', 'T3', 6, 'Main Hall', 'available')
ON CONFLICT (table_id) DO NOTHING;

INSERT INTO tables_cfg.booking_policies (policy_id, max_duration, preparation_buffer) VALUES
('44444444-4444-4444-8444-444444444444', 120, 15)
ON CONFLICT (policy_id) DO NOTHING;
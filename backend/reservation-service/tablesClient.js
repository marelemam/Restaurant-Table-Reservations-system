// Talks to Mariam's Table & Restaurant Configuration service.
// Her routes (all need a logged-in user):
//   GET /:id                    one table
//   GET /suitable?party_size=N  available tables that fit N people
//   GET /policies               booking policies (max_duration, preparation_buffer)
//
// TABLE_SERVICE_URL is the base address of her service, including the path her
// routes are mounted on, e.g. http://localhost:3002/tables
//
// STAND-IN MODE: when TABLE_SERVICE_URL is empty AND ALLOW_FAKE_AUTH=true (local
// testing only), a small pretend list of tables is used instead. On Lambda,
// ALLOW_FAKE_AUTH is never set, so the stand-in list can never be used there.

const BASE_URL = (process.env.TABLE_SERVICE_URL || '').replace(/\/+$/, '');
const TIMEOUT_MS = 5000;

const STAND_IN_TABLES = [
  { table_id: '11111111-1111-4111-8111-000000000001', table_number: 'T1', capacity: 2, location: 'window',       operational_status: 'available' },
  { table_id: '11111111-1111-4111-8111-000000000002', table_number: 'T2', capacity: 4, location: 'window',       operational_status: 'available' },
  { table_id: '11111111-1111-4111-8111-000000000003', table_number: 'T3', capacity: 4, location: 'patio',        operational_status: 'available' },
  { table_id: '11111111-1111-4111-8111-000000000004', table_number: 'T4', capacity: 6, location: 'main hall',    operational_status: 'available' },
  { table_id: '11111111-1111-4111-8111-000000000005', table_number: 'T5', capacity: 8, location: 'private room', operational_status: 'available' },
  { table_id: '11111111-1111-4111-8111-000000000006', table_number: 'T6', capacity: 4, location: 'patio',        operational_status: 'maintenance' },
];

// Minutes, matching Mariam's booking_policies columns
const STAND_IN_POLICY = { max_duration: 180, preparation_buffer: 15 };

class TableServiceError extends Error {
  constructor(message, status = null) {
    super(message);
    this.code = 'TABLE_SERVICE_UNAVAILABLE';
    this.status = status;
  }
}

function usingStandIn() {
  return !BASE_URL && process.env.ALLOW_FAKE_AUTH === 'true';
}

function mode() {
  if (usingStandIn()) return 'stand-in';
  return BASE_URL ? 'table-service' : 'not-configured';
}

// Calls Mariam's service, passing on the caller's login token.
// Returns the JSON body, or null for "not found" / "bad id".
async function callTableService(path, authHeader) {
  if (!BASE_URL) {
    throw new TableServiceError('TABLE_SERVICE_URL is not configured');
  }

  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      headers: authHeader ? { Authorization: authHeader } : {},
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new TableServiceError(`cannot reach table service (${err.name})`);
  }

  if (response.status === 404 || response.status === 400) return null;
  if (!response.ok) {
    throw new TableServiceError(`table service answered ${response.status}`, response.status);
  }
  return response.json();
}

async function getTable(tableId, authHeader) {
  if (usingStandIn()) {
    return STAND_IN_TABLES.find((t) => t.table_id === tableId) || null;
  }
  return callTableService(`/${encodeURIComponent(tableId)}`, authHeader);
}

async function getSuitableTables(partySize, authHeader) {
  if (usingStandIn()) {
    return STAND_IN_TABLES
      .filter((t) => t.capacity >= partySize && t.operational_status === 'available')
      .sort((a, b) => a.capacity - b.capacity);
  }
  const rows = await callTableService(`/suitable?party_size=${encodeURIComponent(partySize)}`, authHeader);
  return Array.isArray(rows) ? rows : [];
}

// Returns { maxDurationMinutes, bufferMinutes }. Uses the first policy row.
async function getPolicy(authHeader) {
  const rows = usingStandIn() ? [STAND_IN_POLICY] : await callTableService('/policies', authHeader);
  const policy = Array.isArray(rows) ? rows[0] : null;
  return {
    maxDurationMinutes: policy ? Number(policy.max_duration) || null : null,
    bufferMinutes: policy ? Number(policy.preparation_buffer) || 0 : 0,
  };
}

module.exports = { getTable, getSuitableTables, getPolicy, mode, TableServiceError };

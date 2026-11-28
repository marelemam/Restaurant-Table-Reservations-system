function minutes(time) {
  const [hours, mins] = String(time).split(':').map(Number);
  return hours * 60 + mins;
}

async function request(path, authorization) {
  const baseUrl = process.env.TABLE_SERVICE_URL;
  if (!baseUrl) return null;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number(process.env.SERVICE_TIMEOUT_MS || 3000)
  );
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
      headers: authorization ? { authorization } : {},
      signal: controller.signal
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || 'table service rejected the request');
      error.statusCode = response.status >= 500 ? 502 : response.status;
      throw error;
    }
    return body;
  } catch (error) {
    if (error.statusCode) throw error;
    const unavailable = new Error('table service is unavailable');
    unavailable.statusCode = 503;
    throw unavailable;
  } finally {
    clearTimeout(timeout);
  }
}

async function validateTableForReservation(req, tableId, partySize, startTime, endTime) {
  if (!process.env.TABLE_SERVICE_URL) return;
  const authorization = req.get('authorization');
  const table = await request(`/api/tables/${encodeURIComponent(tableId)}`, authorization);
  if (table.operational_status !== 'available') {
    const error = new Error('selected table is not operationally available');
    error.statusCode = 409;
    throw error;
  }
  if (Number(table.capacity) < partySize) {
    const error = new Error('selected table is too small for this party');
    error.statusCode = 409;
    throw error;
  }

  const policies = await request('/api/tables/policies', authorization);
  const policy = Array.isArray(policies) ? policies[0] : null;
  const duration = minutes(endTime) - minutes(startTime);
  if (policy && duration > Number(policy.max_duration)) {
    const error = new Error(`reservation exceeds the ${policy.max_duration}-minute limit`);
    error.statusCode = 400;
    throw error;
  }
}

module.exports = { validateTableForReservation };

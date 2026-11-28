const DEFAULT_TIMEOUT_MS = 3000;

class ServiceCallError extends Error {
    constructor(message, statusCode = 502) {
        super(message);
        this.name = "ServiceCallError";
        this.statusCode = statusCode;
    }
}

async function callService(baseUrl, path, req, options = {}) {
    if (!baseUrl) return null;

    const controller = new AbortController();
    const timeout = setTimeout(
        () => controller.abort(),
        Number(process.env.SERVICE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
    );

    const headers = { "content-type": "application/json" };
    const authorization = req?.get?.("authorization");
    if (authorization) headers.authorization = authorization;

    try {
        const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
            ...options,
            headers: { ...headers, ...(options.headers || {}) },
            signal: controller.signal
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new ServiceCallError(
                body.error || `Dependent service returned HTTP ${response.status}`,
                response.status >= 500 ? 502 : response.status
            );
        }
        return body;
    } catch (error) {
        if (error instanceof ServiceCallError) throw error;
        throw new ServiceCallError("Dependent service is unavailable", 503);
    } finally {
        clearTimeout(timeout);
    }
}

function getReservation(req, reservationId) {
    return callService(
        process.env.RESERVATION_SERVICE_URL,
        `/reservations/${encodeURIComponent(reservationId)}`,
        req
    );
}

function updateReservationStatus(req, reservationId, status) {
    return callService(
        process.env.RESERVATION_SERVICE_URL,
        `/reservations/${encodeURIComponent(reservationId)}/status`,
        req,
        { method: "PATCH", body: JSON.stringify({ status }) }
    );
}

function occupyTable(req, tableId, data) {
    return callService(
        process.env.TABLE_SERVICE_URL,
        `/api/tables/${encodeURIComponent(tableId)}/occupy`,
        req,
        { method: "POST", body: JSON.stringify(data) }
    );
}

function releaseTable(req, tableId, seatingId) {
    return callService(
        process.env.TABLE_SERVICE_URL,
        `/api/tables/${encodeURIComponent(tableId)}/release`,
        req,
        { method: "POST", body: JSON.stringify({ seatingId }) }
    );
}

module.exports = {
    ServiceCallError,
    getReservation,
    updateReservationStatus,
    occupyTable,
    releaseTable
};

"use strict";

const CONFIG = Object.freeze({
    apiRoot: "",
    cognitoEndpoint: "",
    cognitoClientId: "",
    testMode: false,
    maxDaysAhead: 30,
    ...(window.CUSTOMER_APP_CONFIG || {})
});

const SESSION_KEY = "customerAppSession";

const state = {
    // { kind: "token", token, label }  or  { kind: "test", customerId, label }
    session: readSavedSession(),
    reservations: [],
    editingId: null,
    tableNames: readSavedTableNames() // table_id -> "T5 · window"
};

/* ---------- Small helpers ---------- */

function element(id) {
    return document.getElementById(id);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function statusClass(status) {
    return String(status || "unknown")
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "");
}

// "2026-12-01" for the user's own day (not UTC)
function localDate(date = new Date()) {
    const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return shifted.toISOString().slice(0, 10);
}

// "2026-12-01T19:30" in the user's own time
function localDateTime(date = new Date()) {
    const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return shifted.toISOString().slice(0, 16);
}

function addDays(isoDate, days) {
    const date = new Date(`${isoDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function shortTime(time) {
    return String(time || "").slice(0, 5);
}

function isUpcoming(reservation) {
    const start = `${reservation.reservation_date}T${shortTime(reservation.start_time)}`;
    return start > localDateTime();
}

function showToast(message, isError = false) {
    const toast = element("toast");
    toast.textContent = message;
    toast.className = `toast visible${isError ? " error" : ""}`;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
        toast.className = "toast";
    }, 4000);
}

function readSavedSession() {
    try {
        return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    } catch {
        return null;
    }
}

function readSavedTableNames() {
    try {
        return JSON.parse(sessionStorage.getItem("customerAppTableNames") || "{}");
    } catch {
        return {};
    }
}

function rememberTable(table) {
    state.tableNames[table.table_id] =
        table.location ? `${table.table_number} · ${table.location}` : table.table_number;
    sessionStorage.setItem("customerAppTableNames", JSON.stringify(state.tableNames));
}

// Show "T5 · window" if we know it, otherwise the start of the table ID
function tableLabel(tableId) {
    return state.tableNames[tableId] || `${String(tableId).slice(0, 8)}…`;
}

function decodeJwt(token) {
    try {
        const part = token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
        const padded = part.padEnd(Math.ceil(part.length / 4) * 4, "=");
        return JSON.parse(window.atob(padded));
    } catch {
        return {};
    }
}

/* ---------- Talking to the reservation service ---------- */

function authHeaders() {
    if (!state.session) {
        return {};
    }
    if (state.session.kind === "token") {
        return { Authorization: `Bearer ${state.session.token}` };
    }
    // Test mode: the stand-in ID card. Only works when the backend has ALLOW_FAKE_AUTH=true.
    return {
        "X-User-Role": "customer",
        "X-Customer-Id": String(state.session.customerId)
    };
}

async function apiRequest(path, options = {}) {
    if (!CONFIG.apiRoot) {
        throw new Error("The reservation service address is not configured");
    }

    const headers = { ...authHeaders(), ...(options.headers || {}) };
    if (options.body) {
        headers["Content-Type"] = "application/json";
    }

    let response;
    try {
        response = await fetch(`${CONFIG.apiRoot}${path}`, { ...options, headers });
    } catch {
        throw new Error("Can't reach the reservation service. Is it running?");
    }

    const text = await response.text();
    let payload = {};
    if (text) {
        try {
            payload = JSON.parse(text);
        } catch {
            payload = { error: text };
        }
    }

    if (!response.ok) {
        if (response.status === 401 && state.session) {
            logout();
            throw new Error("Your session has ended. Please sign in again.");
        }
        const message = Array.isArray(payload.errors)
            ? payload.errors.join(" · ")
            : payload.error || `Request failed (${response.status})`;
        throw new Error(message);
    }

    return payload;
}

/* ---------- Signing in ---------- */

async function cognitoLogin(username, password) {
    if (!CONFIG.cognitoEndpoint || !CONFIG.cognitoClientId) {
        throw new Error("Sign-in isn't set up yet. Use test sign-in for now.");
    }

    const response = await fetch(CONFIG.cognitoEndpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-amz-json-1.1",
            "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth"
        },
        body: JSON.stringify({
            AuthFlow: "USER_PASSWORD_AUTH",
            ClientId: CONFIG.cognitoClientId,
            AuthParameters: { USERNAME: username, PASSWORD: password }
        })
    });

    const payload = await response.json();
    if (!response.ok || !payload.AuthenticationResult?.AccessToken) {
        throw new Error(payload.message || payload.Message || "Sign-in failed");
    }
    return payload.AuthenticationResult.AccessToken;
}

function startSession(session) {
    state.session = session;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));

    element("currentUser").textContent = session.label;
    element("loginView").hidden = true;
    element("appView").hidden = false;
    element("loginStatus").textContent = "";

    activatePanel("book");
    loadServiceStatus();
    loadReservations().catch((error) => showToast(error.message, true));
}

function startTokenSession(token) {
    const claims = decodeJwt(token);
    if (!claims.sub) {
        throw new Error("The sign-in token is not valid");
    }
    if (claims.exp && Number(claims.exp) * 1000 <= Date.now()) {
        throw new Error("The sign-in token has expired");
    }
    startSession({
        kind: "token",
        token,
        label: claims.email || claims.username || claims["cognito:username"] || "Customer"
    });
}

function startTestSession(customerId, name) {
    startSession({
        kind: "test",
        customerId,
        label: name ? `${name} (#${customerId})` : `Customer #${customerId}`
    });
}

function logout() {
    state.session = null;
    state.reservations = [];
    state.editingId = null;
    sessionStorage.removeItem(SESSION_KEY);

    element("appView").hidden = true;
    element("loginView").hidden = false;
    element("password").value = "";
    element("editCard").hidden = true;
}

/* ---------- Navigation ---------- */

function activatePanel(name) {
    document.querySelectorAll(".panel").forEach((panel) => panel.classList.remove("active"));
    document.querySelectorAll(".nav-button").forEach((button) => {
        button.classList.toggle("active", button.dataset.panel === name);
    });

    element(`${name}Panel`)?.classList.add("active");

    const button = document.querySelector(`.nav-button[data-panel="${name}"]`);
    element("pageTitle").textContent = button?.textContent.trim() || "Reservations";

    if (name === "mine") {
        loadReservations().catch((error) => showToast(error.message, true));
    }
}

/* ---------- Service status ---------- */

async function loadServiceStatus() {
    const status = element("serviceStatusMetric");
    try {
        const response = await fetch(`${CONFIG.apiRoot}/health`, { cache: "no-store" });
        if (!response.ok) throw new Error();
        status.textContent = "Online";
        status.className = "healthy-text";
    } catch {
        status.textContent = "Unavailable";
        status.className = "status-unavailable";
    }
}

/* ---------- My reservations ---------- */

async function loadReservations() {
    const payload = await apiRequest("/reservations");
    state.reservations = Array.isArray(payload) ? payload : [];
    renderReservations();
}

function renderReservations() {
    const body = element("mineTableBody");
    const list = state.reservations;

    const upcoming = list.filter((r) => r.status === "confirmed" && isUpcoming(r));
    element("upcomingMetric").textContent = upcoming.length;
    element("nextMetric").textContent = upcoming.length
        ? `${upcoming[0].reservation_date} · ${shortTime(upcoming[0].start_time)}`
        : "—";

    if (list.length === 0) {
        body.innerHTML = `
            <tr><td colspan="7" class="empty-row">You have no reservations yet</td></tr>
        `;
        return;
    }

    body.innerHTML = list
        .map((r) => {
            const canChange = r.status === "confirmed" && isUpcoming(r);
            const id = escapeHtml(r.reservation_id);

            return `
                <tr>
                    <td>${id}</td>
                    <td>${escapeHtml(r.reservation_date)}</td>
                    <td>${escapeHtml(shortTime(r.start_time))} – ${escapeHtml(shortTime(r.end_time))}</td>
                    <td title="${escapeHtml(r.table_id)}">${escapeHtml(tableLabel(r.table_id))}</td>
                    <td>${escapeHtml(r.party_size)}</td>
                    <td>
                        <span class="status-badge ${statusClass(r.status)}">
                            ${escapeHtml(String(r.status).replaceAll("_", " "))}
                        </span>
                    </td>
                    <td>
                        ${canChange ? `
                            <div class="table-actions">
                                <button class="small-button" data-action="change" data-id="${id}">Change</button>
                                <button class="small-button danger" data-action="cancel" data-id="${id}">Cancel</button>
                            </div>
                        ` : "—"}
                    </td>
                </tr>
            `;
        })
        .join("");
}

function openEdit(id) {
    const r = state.reservations.find((item) => String(item.reservation_id) === String(id));
    if (!r) return;

    state.editingId = r.reservation_id;
    element("editLabel").textContent = `#${r.reservation_id}`;
    element("editDate").value = r.reservation_date;
    element("editStart").value = shortTime(r.start_time);
    element("editEnd").value = shortTime(r.end_time);
    element("editParty").value = r.party_size;
    element("editCard").hidden = false;
    element("editCard").scrollIntoView({ behavior: "smooth", block: "start" });
}

function emailNote(sent) {
    return sent ? "A confirmation email is on its way." : "We couldn't send the email this time.";
}

/* ---------- Date limits (match the backend rules) ---------- */

function applyDateLimits() {
    const today = localDate();
    const lastDay = addDays(today, CONFIG.maxDaysAhead);

    ["bookDate", "editDate"].forEach((id) => {
        element(id).min = today;
        element(id).max = lastDay;
    });

    if (!element("bookDate").value) {
        element("bookDate").value = addDays(today, 1);
    }

    element("bookingRules").textContent =
        `Book up to ${CONFIG.maxDaysAhead} days ahead, for at least 30 minutes, up to 20 people`;
}

/* ---------- Event listeners ---------- */

element("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button");
    element("loginStatus").textContent = "Signing in…";
    button.disabled = true;

    try {
        const token = await cognitoLogin(element("username").value.trim(), element("password").value);
        startTokenSession(token);
        showToast("Signed in");
    } catch (error) {
        element("loginStatus").textContent = error.message;
    } finally {
        button.disabled = false;
    }
});

element("testLoginForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const id = Number(element("testCustomerId").value);
    if (!Number.isInteger(id) || id < 1) {
        element("loginStatus").textContent = "Enter a valid customer number";
        return;
    }
    startTestSession(id);
});

element("registerForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const name = element("registerName").value.trim();

    try {
        const customer = await apiRequest("/customers", {
            method: "POST",
            body: JSON.stringify({
                name,
                email: element("registerEmail").value.trim(),
                phone: element("registerPhone").value.trim() || null
            })
        });
        form.reset();
        startTestSession(customer.customer_id, name);
        showToast(`Welcome! Your customer number is ${customer.customer_id}`);
    } catch (error) {
        element("loginStatus").textContent = error.message;
    }
});

element("logoutButton").addEventListener("click", logout);

document.querySelectorAll(".nav-button").forEach((button) => {
    button.addEventListener("click", () => activatePanel(button.dataset.panel));
});

function resetTablePicker(message = "Find free tables first") {
    const select = element("bookTable");
    select.innerHTML = `<option value="">${escapeHtml(message)}</option>`;
    select.disabled = true;
}

// Ask the reservation service which tables are free for the chosen slot.
// The service gets the suitable tables from Mariam's table service,
// then removes the ones already booked at that time.
element("findTables").addEventListener("click", async () => {
    const button = element("findTables");
    const query = new URLSearchParams({
        date: element("bookDate").value,
        start: element("bookStart").value,
        end: element("bookEnd").value,
        partySize: element("bookParty").value
    });

    button.disabled = true;
    resetTablePicker("Searching…");

    try {
        const result = await apiRequest(`/availability?${query}`);
        const free = Array.isArray(result.tables) ? result.tables : [];

        if (free.length === 0) {
            resetTablePicker("No free tables for that time");
            element("availabilityNote").textContent =
                "Nothing free for that slot. Try another time or a smaller party.";
            return;
        }

        free.forEach(rememberTable);
        const select = element("bookTable");
        select.innerHTML = free
            .map((t) => `
                <option value="${escapeHtml(t.table_id)}">
                    ${escapeHtml(t.table_number)} · seats ${escapeHtml(t.capacity)}${t.location ? ` · ${escapeHtml(t.location)}` : ""}
                </option>
            `)
            .join("");
        select.disabled = false;

        element("availabilityNote").textContent =
            `${free.length} table${free.length === 1 ? "" : "s"} free.` +
            (result.bufferMinutes ? ` Tables are cleaned for ${result.bufferMinutes} minutes between bookings.` : "");
    } catch (error) {
        resetTablePicker();
        showToast(error.message, true);
    } finally {
        button.disabled = false;
    }
});

// Changing the slot means the old search results no longer apply
["bookDate", "bookStart", "bookEnd", "bookParty"].forEach((id) => {
    element(id).addEventListener("change", () => resetTablePicker());
});

element("bookingForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;

    try {
        const reservation = await apiRequest("/reservations", {
            method: "POST",
            body: JSON.stringify({
                tableId: element("bookTable").value,
                reservationDate: element("bookDate").value,
                startTime: element("bookStart").value,
                endTime: element("bookEnd").value,
                partySize: Number(element("bookParty").value)
            })
        });
        showToast(`Booked! Reservation #${reservation.reservation_id}. ${emailNote(reservation.emailSent)}`);
        resetTablePicker();
        activatePanel("mine");
    } catch (error) {
        showToast(error.message, true);
    } finally {
        button.disabled = false;
    }
});

element("mineTableBody").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;

    const id = button.dataset.id;

    if (button.dataset.action === "change") {
        openEdit(id);
        return;
    }

    if (!window.confirm(`Cancel reservation #${id}?`)) return;

    try {
        const result = await apiRequest(`/reservations/${encodeURIComponent(id)}/cancel`, { method: "PATCH" });
        showToast(`Reservation #${id} cancelled. ${result.emailSent ? "We've emailed you a confirmation." : ""}`);
        if (String(state.editingId) === String(id)) element("editCard").hidden = true;
        await loadReservations();
    } catch (error) {
        showToast(error.message, true);
    }
});

element("editForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.editingId) return;

    try {
        await apiRequest(`/reservations/${encodeURIComponent(state.editingId)}`, {
            method: "PATCH",
            body: JSON.stringify({
                reservationDate: element("editDate").value,
                startTime: element("editStart").value,
                endTime: element("editEnd").value,
                partySize: Number(element("editParty").value)
            })
        });
        showToast(`Reservation #${state.editingId} updated`);
        element("editCard").hidden = true;
        state.editingId = null;
        await loadReservations();
    } catch (error) {
        showToast(error.message, true);
    }
});

element("closeEdit").addEventListener("click", () => {
    element("editCard").hidden = true;
    state.editingId = null;
});

element("refreshMine").addEventListener("click", () => {
    loadReservations().catch((error) => showToast(error.message, true));
});

/* ---------- Start ---------- */

element("testModeBox").hidden = !CONFIG.testMode;
applyDateLimits();

if (state.session) {
    if (state.session.kind === "token") {
        try {
            startTokenSession(state.session.token);
        } catch {
            logout();
        }
    } else {
        startSession(state.session);
    }
}

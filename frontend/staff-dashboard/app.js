"use strict";

const CONFIG = {
    apiRoot:
        "http://03901ab751.execute-api.localhost.floci.io:4566/api/staff",

    cognitoEndpoint: "http://localhost:4566/",

    cognitoClientId: "e8dcd01480564525949aa19fcc"
};

const state = {
    accessToken: sessionStorage.getItem("mariaStaffAccessToken"),
    waitlist: [],
    attendance: [],
    seating: [],
    activity: []
};

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

function formatDate(value) {
    if (!value) {
        return "—";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return escapeHtml(value);
    }

    return date.toLocaleString();
}

function statusClass(status) {
    return String(status || "unknown")
        .toLowerCase()
        .replaceAll(" ", "_")
        .replace(/[^a-z0-9_-]/g, "");
}

function showToast(message, isError = false) {
    const toast = element("toast");

    toast.textContent = message;
    toast.className = `toast visible${isError ? " error" : ""}`;

    window.clearTimeout(showToast.timer);

    showToast.timer = window.setTimeout(() => {
        toast.className = "toast";
    }, 3500);
}

function extractArray(payload, possibleKeys) {
    if (Array.isArray(payload)) {
        return payload;
    }

    for (const key of possibleKeys) {
        if (Array.isArray(payload?.[key])) {
            return payload[key];
        }
    }

    if (payload?.data) {
        return extractArray(payload.data, possibleKeys);
    }

    return [];
}

function decodeJwt(token) {
    try {
        const encodedPayload = token.split(".")[1];
        const normalised = encodedPayload
            .replaceAll("-", "+")
            .replaceAll("_", "/");

        const payload = decodeURIComponent(
            window
                .atob(normalised)
                .split("")
                .map((character) =>
                    `%${character
                        .charCodeAt(0)
                        .toString(16)
                        .padStart(2, "0")}`
                )
                .join("")
        );

        return JSON.parse(payload);
    } catch {
        return {};
    }
}

async function apiRequest(path, options = {}) {
    if (!state.accessToken) {
        throw new Error("Authentication required");
    }

    const headers = {
        Authorization: `Bearer ${state.accessToken}`,
        ...(options.headers || {})
    };

    if (options.body) {
        headers["Content-Type"] = "application/json";
    }

    const response = await fetch(`${CONFIG.apiRoot}${path}`, {
        ...options,
        headers
    });

    const responseText = await response.text();

    let payload = {};

    if (responseText) {
        try {
            payload = JSON.parse(responseText);
        } catch {
            payload = {
                message: responseText
            };
        }
    }

    if (!response.ok) {
        const message =
            payload.error ||
            payload.message ||
            payload.details?.[0]?.msg ||
            `Request failed with status ${response.status}`;

        throw new Error(message);
    }

    return payload;
}

async function cognitoLogin(username, password) {
    const response = await fetch(CONFIG.cognitoEndpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-amz-json-1.1",
            "X-Amz-Target":
                "AWSCognitoIdentityProviderService.InitiateAuth"
        },
        body: JSON.stringify({
            AuthFlow: "USER_PASSWORD_AUTH",
            ClientId: CONFIG.cognitoClientId,
            AuthParameters: {
                USERNAME: username,
                PASSWORD: password
            }
        })
    });

    const payload = await response.json();

    if (!response.ok || !payload.AuthenticationResult?.AccessToken) {
        throw new Error(
            payload.message ||
            payload.Message ||
            "Cognito authentication failed"
        );
    }

    return payload.AuthenticationResult.AccessToken;
}

async function activateSession(token) {
    if (!token || token.split(".").length !== 3) {
        throw new Error("A valid JWT access token is required");
    }

    state.accessToken = token.trim();

    sessionStorage.setItem(
        "mariaStaffAccessToken",
        state.accessToken
    );

    const claims = decodeJwt(state.accessToken);

    element("currentUser").textContent =
        claims.username ||
        claims["cognito:username"] ||
        claims.sub ||
        "Authenticated staff";

    element("loginView").hidden = true;
    element("dashboardView").hidden = false;

    await loadDashboard();
}

function logout() {
    state.accessToken = null;

    sessionStorage.removeItem("mariaStaffAccessToken");

    element("dashboardView").hidden = true;
    element("loginView").hidden = false;
    element("password").value = "";
    element("manualToken").value = "";
    element("loginStatus").textContent = "";
}

function activatePanel(panelName) {
    document.querySelectorAll(".panel").forEach((panel) => {
        panel.classList.remove("active");
    });

    document.querySelectorAll(".nav-button").forEach((button) => {
        button.classList.toggle(
            "active",
            button.dataset.panel === panelName
        );
    });

    const selectedPanel = element(
        `${panelName}Panel`
    );

    if (selectedPanel) {
        selectedPanel.classList.add("active");
    }

    const selectedButton = document.querySelector(
        `.nav-button[data-panel="${panelName}"]`
    );

    element("pageTitle").textContent =
        selectedButton?.textContent.trim() || "Staff Operations";
}

/* Waitlist */

async function loadWaitlist() {
    const payload = await apiRequest("/waitlist");

    state.waitlist = extractArray(payload, [
        "waitlist",
        "entries",
        "waitlistEntries",
        "items"
    ]);

    renderWaitlist();

    element("waitingMetric").textContent =
        state.waitlist.filter((entry) =>
            ["waiting", "notified"].includes(entry.status)
        ).length;
}

function renderWaitlist() {
    const tableBody = element("waitlistTableBody");

    if (state.waitlist.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-row">
                    No active waitlist entries
                </td>
            </tr>
        `;

        return;
    }

    tableBody.innerHTML = state.waitlist
        .map((entry) => {
            const id =
                entry.waitlist_id ||
                entry.waitlistId ||
                entry.id;

            return `
                <tr>
                    <td>${escapeHtml(entry.customer_name || entry.customerName)}</td>
                    <td>${escapeHtml(entry.phone)}</td>
                    <td>${escapeHtml(entry.party_size || entry.partySize)}</td>
                    <td>
                        ${escapeHtml(
                            entry.estimated_wait_minutes ??
                            entry.estimatedWaitMinutes ??
                            "—"
                        )} min
                    </td>
                    <td>
                        <span class="status-badge ${statusClass(entry.status)}">
                            ${escapeHtml(entry.status)}
                        </span>
                    </td>
                    <td>
                        <div class="table-actions">
                            <button
                                class="small-button"
                                data-waitlist-action="notify"
                                data-id="${escapeHtml(id)}"
                            >
                                Notify
                            </button>

                            <button
                                class="small-button"
                                data-waitlist-action="seat"
                                data-id="${escapeHtml(id)}"
                            >
                                Seat
                            </button>

                            <button
                                class="small-button danger"
                                data-waitlist-action="cancel"
                                data-id="${escapeHtml(id)}"
                            >
                                Cancel
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        })
        .join("");
}

/* Attendance */

async function loadAttendance() {
    const payload = await apiRequest("/attendance");

    state.attendance = extractArray(payload, [
        "attendance",
        "attendanceEvents",
        "events",
        "items"
    ]);

    renderAttendance();

    element("attendanceMetric").textContent =
        state.attendance.length;
}

function renderAttendance() {
    const tableBody = element("attendanceTableBody");

    if (state.attendance.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" class="empty-row">
                    No attendance events
                </td>
            </tr>
        `;

        return;
    }

    tableBody.innerHTML = state.attendance
        .map(
            (event) => `
                <tr>
                    <td>${escapeHtml(
                        event.reservation_id ||
                        event.reservationId
                    )}</td>

                    <td>
                        <span class="status-badge ${statusClass(
                            event.attendance_status ||
                            event.attendanceStatus ||
                            event.status
                        )}">
                            ${escapeHtml(
                                event.attendance_status ||
                                event.attendanceStatus ||
                                event.status
                            )}
                        </span>
                    </td>

                    <td>${escapeHtml(
                        event.recorded_by ||
                        event.recordedBy
                    )}</td>

                    <td>${formatDate(
                        event.recorded_at ||
                        event.recordedAt
                    )}</td>

                    <td>${escapeHtml(event.notes || "—")}</td>
                </tr>
            `
        )
        .join("");
}

/* Seating */

async function loadSeating() {
    const payload = await apiRequest("/seating");

    state.seating = extractArray(payload, [
        "seating",
        "seatingSessions",
        "sessions",
        "items"
    ]);

    renderSeating();

    element("seatingMetric").textContent =
        state.seating.filter(
            (session) => session.status === "seated"
        ).length;
}

function renderSeating() {
    const tableBody = element("seatingTableBody");

    if (state.seating.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" class="empty-row">
                    No seating sessions
                </td>
            </tr>
        `;

        return;
    }

    tableBody.innerHTML = state.seating
        .map((session) => {
            const id =
                session.seating_id ||
                session.seatingId ||
                session.id;

            const source =
                session.reservation_id ||
                session.reservationId ||
                session.waitlist_id ||
                session.waitlistId;

            const sourceType =
                session.reservation_id ||
                session.reservationId
                    ? "Reservation"
                    : "Waitlist";

            return `
                <tr>
                    <td>
                        <strong>${sourceType}</strong><br>
                        ${escapeHtml(source)}
                    </td>

                    <td>${escapeHtml(
                        session.table_id ||
                        session.tableId
                    )}</td>

                    <td>${formatDate(
                        session.seated_at ||
                        session.seatedAt
                    )}</td>

                    <td>
                        <span class="status-badge ${statusClass(
                            session.status
                        )}">
                            ${escapeHtml(session.status)}
                        </span>
                    </td>

                    <td>
                        <div class="table-actions">
                            <button
                                class="small-button"
                                data-seating-action="transfer"
                                data-id="${escapeHtml(id)}"
                            >
                                Transfer
                            </button>

                            <button
                                class="small-button danger"
                                data-seating-action="checkout"
                                data-id="${escapeHtml(id)}"
                            >
                                Checkout
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        })
        .join("");
}

/* Analytics */

function flattenAnalytics(value, prefix = "") {
    const results = [];

    Object.entries(value || {}).forEach(([key, childValue]) => {
        const label = prefix ? `${prefix} ${key}` : key;

        if (
            childValue !== null &&
            typeof childValue === "object" &&
            !Array.isArray(childValue)
        ) {
            results.push(
                ...flattenAnalytics(childValue, label)
            );
        } else {
            results.push({
                label,
                value: Array.isArray(childValue)
                    ? childValue.length
                    : childValue
            });
        }
    });

    return results;
}

async function loadAnalytics() {
    const selectedDate = element("analyticsDate").value;

    const query = selectedDate
        ? `?date=${encodeURIComponent(selectedDate)}`
        : "";

    const payload = await apiRequest(
        `/analytics/daily${query}`
    );

    const analytics =
        payload.analytics ||
        payload.data ||
        payload;

    const flattened = flattenAnalytics(analytics);

    element("analyticsContent").innerHTML =
        flattened.length > 0
            ? flattened
                .map(
                    (item) => `
                        <article class="analytics-item">
                            <span>
                                ${escapeHtml(
                                    item.label.replaceAll("_", " ")
                                )}
                            </span>
                            <strong>
                                ${escapeHtml(item.value ?? "—")}
                            </strong>
                        </article>
                    `
                )
                .join("")
            : `
                <p class="empty-row">
                    No analytics available
                </p>
            `;
}

/* Activity logs */

async function loadActivity() {
    const payload = await apiRequest("/activity");

    state.activity = extractArray(payload, [
        "activity",
        "activities",
        "activityLogs",
        "logs",
        "items"
    ]);

    const tableBody = element("activityTableBody");

    if (state.activity.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" class="empty-row">
                    No activity logs
                </td>
            </tr>
        `;

        return;
    }

    tableBody.innerHTML = state.activity
        .map(
            (log) => `
                <tr>
                    <td>${formatDate(
                        log.timestamp ||
                        log.created_at ||
                        log.createdAt
                    )}</td>

                    <td>${escapeHtml(
                        log.staff_id ||
                        log.staffId ||
                        "—"
                    )}</td>

                    <td>${escapeHtml(log.action)}</td>

                    <td>
                        ${escapeHtml(
                            log.entity_type ||
                            log.entityType
                        )}
                        <br>
                        ${escapeHtml(
                            log.entity_id ||
                            log.entityId
                        )}
                    </td>

                    <td>${escapeHtml(
                        log.request_id ||
                        log.requestId ||
                        "—"
                    )}</td>
                </tr>
            `
        )
        .join("");
}

/* Dashboard loading */

async function loadDashboard() {
    const results = await Promise.allSettled([
        loadWaitlist(),
        loadAttendance(),
        loadSeating(),
        loadAnalytics(),
        loadActivity()
    ]);

    const failure = results.find(
        (result) => result.status === "rejected"
    );

    if (failure) {
        showToast(failure.reason.message, true);
    }
}

/* Event listeners */

element("loginForm").addEventListener(
    "submit",
    async (event) => {
        event.preventDefault();

        const status = element("loginStatus");
        const submitButton =
            event.currentTarget.querySelector("button");

        status.textContent = "Signing in…";
        submitButton.disabled = true;

        try {
            const token = await cognitoLogin(
                element("username").value.trim(),
                element("password").value
            );

            await activateSession(token);

            status.textContent = "";
            showToast("Signed in successfully");
        } catch (error) {
            status.textContent = error.message;
        } finally {
            submitButton.disabled = false;
        }
    }
);

element("useTokenButton").addEventListener(
    "click",
    async () => {
        try {
            await activateSession(
                element("manualToken").value.trim()
            );

            showToast("Access token accepted");
        } catch (error) {
            element("loginStatus").textContent =
                error.message;
        }
    }
);

element("logoutButton").addEventListener("click", logout);

document.querySelectorAll(".nav-button").forEach((button) => {
    button.addEventListener("click", () => {
        activatePanel(button.dataset.panel);
    });
});

element("waitlistForm").addEventListener(
    "submit",
    async (event) => {
        event.preventDefault();

        try {
            await apiRequest("/waitlist", {
                method: "POST",
                body: JSON.stringify({
                    customerName:
                        element("customerName").value.trim(),
                    phone:
                        element("customerPhone").value.trim(),
                    partySize: Number(
                        element("partySize").value
                    )
                })
            });

            event.target.reset();
            await loadWaitlist();

            showToast("Walk-in added to the waitlist");
        } catch (error) {
            showToast(error.message, true);
        }
    }
);

element("waitlistTableBody").addEventListener(
    "click",
    async (event) => {
        const button = event.target.closest(
            "[data-waitlist-action]"
        );

        if (!button) {
            return;
        }

        const id = button.dataset.id;
        const action = button.dataset.waitlistAction;

        try {
            if (action === "seat") {
                element("seatingSource").value = "waitlist";
                element("seatingSourceId").value = id;

                activatePanel("seating");
                return;
            }

            await apiRequest(`/waitlist/${id}/${action}`, {
                method: "PATCH"
            });

            await loadWaitlist();

            showToast(
                action === "notify"
                    ? "Customer marked as notified"
                    : "Waitlist entry cancelled"
            );
        } catch (error) {
            showToast(error.message, true);
        }
    }
);

element("checkInForm").addEventListener(
    "submit",
    async (event) => {
        event.preventDefault();

        try {
            await apiRequest("/attendance/check-ins", {
                method: "POST",
                body: JSON.stringify({
                    reservationId:
                        element(
                            "checkInReservationId"
                        ).value.trim(),
                    notes:
                        element("checkInNotes").value.trim() ||
                        null
                })
            });

            event.target.reset();
            await loadAttendance();

            showToast("Customer checked in successfully");
        } catch (error) {
            showToast(error.message, true);
        }
    }
);

element("noShowForm").addEventListener(
    "submit",
    async (event) => {
        event.preventDefault();

        try {
            const scheduledValue =
                element("scheduledStartTime").value;

            await apiRequest("/attendance/no-shows", {
                method: "POST",
                body: JSON.stringify({
                    reservationId:
                        element(
                            "noShowReservationId"
                        ).value.trim(),
                    scheduledStartTime:
                        new Date(scheduledValue).toISOString(),
                    notes:
                        element("noShowNotes").value.trim() ||
                        null
                })
            });

            event.target.reset();
            await loadAttendance();

            showToast("No-show recorded successfully");
        } catch (error) {
            showToast(error.message, true);
        }
    }
);

element("seatingForm").addEventListener(
    "submit",
    async (event) => {
        event.preventDefault();

        const source = element("seatingSource").value;
        const sourceId =
            element("seatingSourceId").value.trim();

        const body = {
            tableId: element("tableId").value.trim()
        };

        if (source === "reservation") {
            body.reservationId = sourceId;
        } else {
            body.waitlistId = sourceId;
        }

        try {
            await apiRequest("/seating", {
                method: "POST",
                body: JSON.stringify(body)
            });

            event.target.reset();

            await Promise.all([
                loadSeating(),
                loadWaitlist()
            ]);

            showToast("Customer seated successfully");
        } catch (error) {
            showToast(error.message, true);
        }
    }
);

element("seatingTableBody").addEventListener(
    "click",
    async (event) => {
        const button = event.target.closest(
            "[data-seating-action]"
        );

        if (!button) {
            return;
        }

        const id = button.dataset.id;
        const action = button.dataset.seatingAction;

        try {
            if (action === "transfer") {
                const newTableId = window.prompt(
                    "Enter the new table ID:"
                );

                if (!newTableId) {
                    return;
                }

                await apiRequest(
                    `/seating/${id}/transfer`,
                    {
                        method: "PATCH",
                        body: JSON.stringify({
                            newTableId: newTableId.trim()
                        })
                    }
                );

                showToast("Customer transferred successfully");
            } else {
                const confirmed = window.confirm(
                    "Checkout this customer?"
                );

                if (!confirmed) {
                    return;
                }

                await apiRequest(
                    `/seating/${id}/checkout`,
                    {
                        method: "PATCH"
                    }
                );

                showToast("Customer checked out successfully");
            }

            await loadSeating();
        } catch (error) {
            showToast(error.message, true);
        }
    }
);

element("refreshWaitlist").addEventListener(
    "click",
    () => loadWaitlist().catch(
        (error) => showToast(error.message, true)
    )
);

element("refreshAttendance").addEventListener(
    "click",
    () => loadAttendance().catch(
        (error) => showToast(error.message, true)
    )
);

element("refreshSeating").addEventListener(
    "click",
    () => loadSeating().catch(
        (error) => showToast(error.message, true)
    )
);

element("loadAnalytics").addEventListener(
    "click",
    () => loadAnalytics().catch(
        (error) => showToast(error.message, true)
    )
);

element("refreshActivity").addEventListener(
    "click",
    () => loadActivity().catch(
        (error) => showToast(error.message, true)
    )
);

/* Initial page state */

element("analyticsDate").value =
    new Date().toISOString().slice(0, 10);

if (state.accessToken) {
    activateSession(state.accessToken).catch((error) => {
        logout();
        element("loginStatus").textContent =
            `Saved session could not be restored: ${error.message}`;
    });
}
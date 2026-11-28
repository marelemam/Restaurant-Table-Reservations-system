const crypto = require("crypto");

// ---- JWKS (المفاتيح العامة بتاعة Cognito) ----
let jwksCache = { keys: null, fetchedAt: 0 };
const JWKS_TTL_MS = 10 * 60 * 1000;

async function loadJwks(force = false) {
    const url = process.env.COGNITO_JWKS_URL;
    if (!url) {
        const e = new Error("COGNITO_JWKS_URL is not configured");
        e.code = "AUTH_CONFIG";
        throw e;
    }
    const fresh = Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS;
    if (jwksCache.keys && fresh && !force) return jwksCache.keys;

    let res;
    try {
        res = await fetch(url);
    } catch {
        const e = new Error("Cannot reach JWKS endpoint");
        e.code = "JWKS_UNAVAILABLE";
        throw e;
    }
    if (!res.ok) {
        const e = new Error("JWKS endpoint returned " + res.status);
        e.code = "JWKS_UNAVAILABLE";
        throw e;
    }
    const body = await res.json();
    jwksCache = { keys: body.keys || [], fetchedAt: Date.now() };
    return jwksCache.keys;
}

async function getPublicKey(kid) {
    let keys = await loadJwks();
    let jwk = keys.find((k) => k.kid === kid);
    if (!jwk) {                       // ممكن المفاتيح اتغيّرت: حدّثي مرة
        keys = await loadJwks(true);
        jwk = keys.find((k) => k.kid === kid);
    }
    if (!jwk) throw new Error("Unknown signing key");
    return crypto.createPublicKey({ key: jwk, format: "jwk" });
}

// ---- التحقق من الـ token ----
async function verifyToken(token) {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Malformed token");

    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());

    // RS256 بس. ده بيمنع هجوم "alg: none"
    if (header.alg !== "RS256") throw new Error("Unsupported algorithm");

    const key = await getPublicKey(header.kid);
    const signatureOk = crypto.verify(
        "RSA-SHA256",
        Buffer.from(parts[0] + "." + parts[1]),
        key,
        Buffer.from(parts[2], "base64url")
    );
    if (!signatureOk) throw new Error("Bad signature");

    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < now) throw new Error("Token expired");

    if (process.env.COGNITO_ISSUER && payload.iss !== process.env.COGNITO_ISSUER) {
        throw new Error("Wrong issuer");
    }
    if (payload.token_use && !["access", "id"].includes(payload.token_use)) {
        throw new Error("Wrong token type");
    }
    if (process.env.COGNITO_CLIENT_ID) {
        const clientId = payload.client_id || payload.aud;
        if (clientId !== process.env.COGNITO_CLIENT_ID) throw new Error("Wrong client");
    }
    return payload;
}

// ---- Middleware ----
function logAuthFailure(req, reason) {
    // بنسجّل السبب والمسار بس. الـ token ما بيتسجّلش أبداً
    console.warn(JSON.stringify({
        type: "AUTH_FAILED",
        reason,
        method: req.method,
        path: req.originalUrl,
        ip: req.ip
    }));
}

async function requireAuth(req, res, next) {
    const header = req.headers.authorization || "";
    const match = header.match(/^Bearer (.+)$/i);
    if (!match) {
        logAuthFailure(req, "missing_token");
        return res.status(401).json({ error: "Authentication required" });
    }
    try {
        const claims = await verifyToken(match[1]);
        const rawGroups = claims["cognito:groups"] || [];

        const groups = (
            Array.isArray(rawGroups)
                ? rawGroups
                : [rawGroups]
        ).map((group) => String(group).toLowerCase());

        let role = "customer";

        if (groups.includes("admin")) {
            role = "admin";
        } else if (groups.includes("staff")) {
            role = "staff";
        }

        req.user = {
            id: claims.sub,
            email: claims.email || null,
            role,
            groups
        };
        return next();
    } catch (err) {
        if (err.code === "JWKS_UNAVAILABLE" || err.code === "AUTH_CONFIG") {
            console.error("Auth infrastructure problem:", err.message);
            return res.status(503).json({ error: "Authentication service unavailable" });
        }
        logAuthFailure(req, err.message);
        return res.status(401).json({ error: "Invalid or expired token" });
    }
}

function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: "Authentication required" });
        if (!allowedRoles.includes(req.user.role)) {
            console.warn(JSON.stringify({
                type: "ACCESS_DENIED",
                userId: req.user.id,
                role: req.user.role,
                method: req.method,
                path: req.originalUrl
            }));
            return res.status(403).json({ error: "Forbidden" });
        }
        next();
    };
}

module.exports = { requireAuth, requireRole, verifyToken };
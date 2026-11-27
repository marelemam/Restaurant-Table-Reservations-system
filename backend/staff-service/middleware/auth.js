const {
    CognitoJwtVerifier
} = require("aws-jwt-verify");

let verifier = null;
let verifierConfiguration = null;

function isDevelopmentBypassEnabled() {
    return (
        process.env.NODE_ENV !== "production" &&
        process.env.DEV_AUTH_BYPASS === "true"
    );
}

function getDevelopmentGroup() {
    return process.env.DEV_AUTH_GROUP === "Admin"
        ? "Admin"
        : "Staff";
}

function getCognitoVerifier() {
    const userPoolId =
        process.env.COGNITO_USER_POOL_ID;

    const clientId =
        process.env.COGNITO_CLIENT_ID;

    if (!userPoolId || !clientId) {
        const error = new Error(
            "Cognito configuration is missing"
        );

        error.code =
            "COGNITO_CONFIGURATION_MISSING";

        throw error;
    }

    const currentConfiguration =
        `${userPoolId}:${clientId}`;

    if (
        !verifier ||
        verifierConfiguration !== currentConfiguration
    ) {
        verifier = CognitoJwtVerifier.create({
            userPoolId,
            tokenUse: "access",
            clientId
        });

        verifierConfiguration =
            currentConfiguration;
    }

    return verifier;
}

function extractBearerToken(req) {
    const authorizationHeader =
        req.get("authorization");

    if (!authorizationHeader) {
        return null;
    }

    const match = authorizationHeader.match(
        /^Bearer\s+(.+)$/i
    );

    return match ? match[1].trim() : null;
}

async function authenticateRequest(req, res) {
    if (isDevelopmentBypassEnabled()) {
        req.user = {
            sub: "local-development-staff",
            groups: [getDevelopmentGroup()]
        };

        return true;
    }

    const token = extractBearerToken(req);

    if (!token) {
        res.status(401).json({
            error: "Authentication required"
        });

        return false;
    }

    try {
        const payload =
            await getCognitoVerifier().verify(token);

        const cognitoGroups =
            payload["cognito:groups"];

        req.user = {
            sub: payload.sub,
            username:
                payload.username ||
                payload["cognito:username"] ||
                null,
            groups: Array.isArray(cognitoGroups)
                ? cognitoGroups
                : [],
            scope: payload.scope || ""
        };

        return true;
    } catch (error) {
        if (
            error.code ===
            "COGNITO_CONFIGURATION_MISSING"
        ) {
            console.error(
                "Authentication configuration error:",
                error.message
            );

            res.status(503).json({
                error:
                    "Authentication service is not configured"
            });

            return false;
        }

        console.warn(
            "Cognito token verification failed:",
            error.name
        );

        res.status(401).json({
            error: "Invalid or expired access token"
        });

        return false;
    }
}

async function requireGroups(
    req,
    res,
    next,
    allowedGroups
) {
    const authenticated =
        await authenticateRequest(req, res);

    if (!authenticated) {
        return;
    }

    const userGroups =
        req.user.groups || [];

    const isAllowed = userGroups.some(
        (group) => allowedGroups.includes(group)
    );

    if (!isAllowed) {
        return res.status(403).json({
            error: `${allowedGroups.join(
                " or "
            )} permission required`
        });
    }

    return next();
}

async function requireStaffOrAdmin(
    req,
    res,
    next
) {
    return requireGroups(
        req,
        res,
        next,
        ["Staff", "Admin"]
    );
}

async function requireAdmin(req, res, next) {
    return requireGroups(
        req,
        res,
        next,
        ["Admin"]
    );
}

module.exports = {
    requireStaffOrAdmin,
    requireAdmin
};
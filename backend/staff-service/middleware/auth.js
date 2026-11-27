const {
    CognitoJwtVerifier,
    JwtVerifier
} = require("aws-jwt-verify");

const {
    validateCognitoJwtFields
} = require(
    "aws-jwt-verify/cognito-verifier"
);

let verifier = null;
let verifierConfiguration = null;
let localJwksLoadPromise = null;

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

function createAuthenticationError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

async function loadLocalJwks(
    targetVerifier,
    jwksUri
) {
    if (!localJwksLoadPromise) {
        localJwksLoadPromise = (async () => {
            try {
                const response = await fetch(jwksUri);

                if (!response.ok) {
                    throw new Error(
                        `JWKS returned HTTP ${response.status}`
                    );
                }

                const jwks = await response.json();

                if (
                    !jwks ||
                    !Array.isArray(jwks.keys)
                ) {
                    throw new Error(
                        "Invalid JWKS response"
                    );
                }

                targetVerifier.cacheJwks(jwks);
            } catch (error) {
                throw createAuthenticationError(
                    "COGNITO_JWKS_UNAVAILABLE",
                    "Unable to load local Cognito public keys"
                );
            }
        })();
    }

    try {
        await localJwksLoadPromise;
    } catch (error) {
        localJwksLoadPromise = null;
        throw error;
    }
}

async function getJwtVerifier() {
    const userPoolId =
        process.env.COGNITO_USER_POOL_ID;

    const clientId =
        process.env.COGNITO_CLIENT_ID;

    const localIssuer =
        process.env.COGNITO_ISSUER;

    const localJwksUri =
        process.env.COGNITO_JWKS_URI;

    if (!clientId) {
        throw createAuthenticationError(
            "COGNITO_CONFIGURATION_MISSING",
            "Cognito configuration is missing"
        );
    }

    const hasLocalIssuer = Boolean(localIssuer);
    const hasLocalJwks = Boolean(localJwksUri);

    if (hasLocalIssuer !== hasLocalJwks) {
        throw createAuthenticationError(
            "COGNITO_CONFIGURATION_MISSING",
            "Both the local issuer and JWKS URI are required"
        );
    }

    if (hasLocalIssuer && hasLocalJwks) {
        const configuration =
            `floci:${localIssuer}:${localJwksUri}:${clientId}`;

        if (
            !verifier ||
            verifierConfiguration !== configuration
        ) {
            verifier = JwtVerifier.create({
                issuer: localIssuer,
                audience: null,
                jwksUri: localJwksUri,

                customJwtCheck: ({ payload }) =>
                    validateCognitoJwtFields(
                        payload,
                        {
                            tokenUse: "access",
                            clientId
                        }
                    )
            });

            verifierConfiguration = configuration;
            localJwksLoadPromise = null;
        }

        await loadLocalJwks(
            verifier,
            localJwksUri
        );

        return verifier;
    }

    if (!userPoolId) {
        throw createAuthenticationError(
            "COGNITO_CONFIGURATION_MISSING",
            "Cognito user pool ID is missing"
        );
    }

    const configuration =
        `aws:${userPoolId}:${clientId}`;

    if (
        !verifier ||
        verifierConfiguration !== configuration
    ) {
        verifier = CognitoJwtVerifier.create({
            userPoolId,
            tokenUse: "access",
            clientId
        });

        verifierConfiguration = configuration;
        localJwksLoadPromise = null;
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
        const activeVerifier =
            await getJwtVerifier();

        const payload =
            await activeVerifier.verify(token);

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
                "COGNITO_CONFIGURATION_MISSING" ||
            error.code ===
                "COGNITO_JWKS_UNAVAILABLE"
        ) {
            console.error(
                "Authentication service error:",
                error.message
            );

            res.status(503).json({
                error:
                    "Authentication service is unavailable"
            });

            return false;
        }

        console.warn(
            "Cognito token verification failed:",
            error.name,
            error.message
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

    const userGroups = req.user.groups || [];

    const isAllowed = userGroups.some(
        (group) => allowedGroups.includes(group)
    );

    if (!isAllowed) {
        return res.status(403).json({
            error:
                `${allowedGroups.join(" or ")} ` +
                "permission required"
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
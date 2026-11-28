"use strict";

// Public runtime endpoint configuration. Update these values after deployment.
// Do not place passwords, database URLs or access tokens in this file.
window.MARIA_STAFF_CONFIG = {
    apiRoot: "http://localhost:3002/api/staff",
    healthUrl: "http://localhost:3002/health",
    cognitoEndpoint: "http://localhost:4566/",
    cognitoClientId: "REPLACE_AFTER_COGNITO_SETUP",
    k6StatusUrl: "http://localhost:6565/v1/status"
};

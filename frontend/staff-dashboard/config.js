"use strict";

// Public runtime endpoint configuration. Update these values after deployment.
// Do not place passwords, database URLs or access tokens in this file.
window.MARIA_STAFF_CONFIG = {
    apiRoot:
        "http://03901ab751.execute-api.us-east-1.localhost:4566/api/staff",
    healthUrl:
        "http://03901ab751.execute-api.us-east-1.localhost:4566/health",
    cognitoEndpoint: "http://localhost:4566/",
    cognitoClientId: "e8dcd01480564525949aa19fcc",
    k6StatusUrl: "http://localhost:6565/v1/status"
};

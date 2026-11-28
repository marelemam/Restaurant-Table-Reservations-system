"use strict";

// Public settings only. Never put passwords, database URLs or API keys here.
window.CUSTOMER_APP_CONFIG = {
    // Where the reservation service lives.
    // Local:  "http://localhost:3001"
    // Floci:  "http://reservation-api.execute-api.localhost.floci.io:4566"
    apiRoot: "http://localhost:3001",

    // Cognito login (same Cognito as the rest of the team, on Floci)
    cognitoEndpoint: "http://localhost:4566/",
    cognitoClientId: "165b7f9a5efa437395571f52e4",

    // LOCAL TESTING ONLY: sign in with a customer number instead of Cognito.
    // The backend only accepts this when ALLOW_FAKE_AUTH=true, which is never set on Lambda.
    testMode: true,

    // Must match the backend rule in validation.js
    maxDaysAhead: 30
};
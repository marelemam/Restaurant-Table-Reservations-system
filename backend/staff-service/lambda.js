const serverless = require("serverless-http");
const app = require("./app");
const {
    loadDatabaseSecret
} = require("./config/loadDatabaseSecret");
const {
    processScheduledNoShow
} = require("./jobs/processScheduledNoShow");

const proxyHandler = serverless(app);

module.exports.handler = async (event, context) => {
    await loadDatabaseSecret();

    if (
        event &&
        event.action === "PROCESS_RESERVATION_NO_SHOW"
    ) {
        return processScheduledNoShow(event);
    }

    return proxyHandler(event, context);
};
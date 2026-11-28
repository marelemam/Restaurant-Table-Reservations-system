const crypto = require("crypto");
const {
    SQSClient,
    SendMessageCommand
} = require("@aws-sdk/client-sqs");



let sqsClient;

function getSqsClient() {
    if (!sqsClient) {
        const configuration = {
            region:
                process.env.AWS_REGION ||
                process.env.AWS_DEFAULT_REGION ||
                "us-east-1"
        };

        if (process.env.AWS_ENDPOINT_URL) {
            configuration.endpoint = process.env.AWS_ENDPOINT_URL;

            configuration.credentials = {
                accessKeyId:
                    process.env.AWS_ACCESS_KEY_ID || "test",
                secretAccessKey:
                    process.env.AWS_SECRET_ACCESS_KEY || "test"
            };
        }

        sqsClient = new SQSClient(configuration);
    }

    return sqsClient;
}

async function publishStaffEvent(eventType, payload = {}) {
    const queueUrl = process.env.STAFF_EVENTS_QUEUE_URL;

    if (!queueUrl) {
        console.warn(
            `SQS event skipped because STAFF_EVENTS_QUEUE_URL is not configured: ${eventType}`
        );

        return {
            published: false,
            skipped: true
        };
    }

    const event = {
        eventId: crypto.randomUUID(),
        eventType,
        source: "staff-service",
        occurredAt: new Date().toISOString(),
        payload
    };

    try {
        const result = await getSqsClient().send(
            new SendMessageCommand({
                QueueUrl: queueUrl,
                MessageBody: JSON.stringify(event),
                MessageAttributes: {
                    eventType: {
                        DataType: "String",
                        StringValue: eventType
                    }
                }
            })
        );

        console.log(
            `SQS event published: ${eventType} (${result.MessageId})`
        );

        return {
            published: true,
            messageId: result.MessageId,
            event
        };
    } catch (error) {
        console.error(
            `SQS event publishing failed for ${eventType}:`,
            error.message
        );

        return {
            published: false,
            error: error.message
        };
    }
}

module.exports = {
    publishStaffEvent
};
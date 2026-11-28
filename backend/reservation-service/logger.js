// Writes one JSON line per event, so CloudWatch can search by "type".
// Never pass secrets, tokens or email addresses in here.
function write(level, type, details) {
  const line = JSON.stringify({
    type,
    service: 'reservation-service',
    time: new Date().toISOString(),
    ...details,
  });
  if (level === 'warn') console.warn(line);
  else console.log(line);
}

const logEvent = (type, details = {}) => write('info', type, details);
const logWarn  = (type, details = {}) => write('warn', type, details);

module.exports = { logEvent, logWarn };
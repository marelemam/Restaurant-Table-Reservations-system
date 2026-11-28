// Placeholder rules: later these come from Mariam's BookingPolicy and Table data
const RULES = {
  maxPartySize: 20,
  minDurationMinutes: 30,
  maxDurationMinutes: 240,
  maxDaysAhead: 30,
  timeZone: 'Africa/Cairo',
};

// "19:30" -> 1170 (minutes since midnight)
function toMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

// Current restaurant time as text, e.g. "2026-11-27 02:47:13"
function nowInRestaurant() {
  return new Date().toLocaleString('sv-SE', { timeZone: RULES.timeZone });
}

// Is "2026-02-30" a real date?
function isRealDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const d = new Date(text + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === text;
}

function isTime(text) {
  return typeof text === 'string' && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(text);
}

function validateReservation(r) {
  const errors = [];
  const { customerId, tableId, reservationDate, startTime, endTime, partySize } = r;

  // 1. Format checks
  if (!Number.isInteger(customerId) || customerId < 1) errors.push('customerId must be a positive whole number');
  //////
  const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (typeof tableId !== 'string' || !UUID_REGEX.test(tableId)) {
    errors.push('tableId must be a valid UUID');
  }
  /////
  if (!isRealDate(reservationDate)) errors.push('reservationDate must be a real date like 2026-12-01');
  if (!isTime(startTime)) errors.push('startTime must look like 19:00');
  if (!isTime(endTime)) errors.push('endTime must look like 21:00');
  if (!Number.isInteger(partySize)) errors.push('partySize must be a whole number');

  // Stop here if the basics are wrong, the checks below need clean values
  if (errors.length) return errors;

  // 2. Party size
  if (partySize < 1 || partySize > RULES.maxPartySize) {
    errors.push(`partySize must be between 1 and ${RULES.maxPartySize}`);
  }

  // 3. Length of the booking
  const duration = toMinutes(endTime) - toMinutes(startTime);
  if (duration <= 0) {
    errors.push('endTime must be after startTime');
  } else if (duration < RULES.minDurationMinutes) {
    errors.push(`booking must be at least ${RULES.minDurationMinutes} minutes`);
  } else if (duration > RULES.maxDurationMinutes) {
    errors.push(`booking can be at most ${RULES.maxDurationMinutes / 60} hours`);
  }

  // 4. Not in the past
  const now = nowInRestaurant();
  const bookingStart = `${reservationDate} ${startTime.slice(0, 5)}`;
  if (bookingStart <= now.slice(0, 16)) {
    errors.push('reservation must be in the future');
  }

  // 5. Not too far ahead
  const lastDay = new Date(now.slice(0, 10) + 'T00:00:00Z');
  lastDay.setUTCDate(lastDay.getUTCDate() + RULES.maxDaysAhead);
  if (reservationDate > lastDay.toISOString().slice(0, 10)) {
    errors.push(`you can only book up to ${RULES.maxDaysAhead} days ahead`);
  }

  return errors;
}

module.exports = { validateReservation, RULES };

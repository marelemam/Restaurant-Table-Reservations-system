const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = 'Restaurant Reservations <onboarding@resend.dev>';

// Stop names like "<script>" from turning into code inside the email
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Sends an email. Returns true if Resend accepted it, false if anything went wrong.
// It never throws, so a failed email can't break a booking.
async function sendEmail(to, subject, html) {
  if (!resend) {
    console.warn('RESEND_API_KEY is missing, email not sent');
    return false;
  }
  try {
    const { data, error } = await resend.emails.send({ from: FROM, to: [to], subject, html });
    if (error) {
      console.error('Email failed:', error.message);
      return false;
    }
    console.log('Email sent:', data.id);
    return true;
  } catch (err) {
    console.error('Email failed:', err.message);
    return false;
  }
}

function sendConfirmation(customer, r) {
  return sendEmail(
    customer.email,
    `Your table is booked for ${r.reservation_date}`,
    `<p>Hi ${escapeHtml(customer.name)},</p>
     <p>Your reservation is confirmed:</p>
     <ul>
       <li>Reservation number: ${r.reservation_id}</li>
       <li>Date: ${r.reservation_date}</li>
       <li>Time: ${r.start_time.slice(0, 5)} to ${r.end_time.slice(0, 5)}</li>
       <li>Party size: ${r.party_size}</li>
     </ul>
     <p>See you soon!</p>`
  );
}

function sendCancellation(customer, r) {
  return sendEmail(
    customer.email,
    `Your reservation for ${r.reservation_date} is cancelled`,
    `<p>Hi ${escapeHtml(customer.name)},</p>
     <p>Your reservation number ${r.reservation_id} on ${r.reservation_date}
        at ${r.start_time.slice(0, 5)} has been cancelled.</p>`
  );
}

module.exports = { sendConfirmation, sendCancellation };
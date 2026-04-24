const Mailgun = require('mailgun.js');
const FormData = require('form-data');

let client = null;
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || 'noblecollective.org';
const FROM_ADDRESS = 'Noble Collective <notifications@' + MAILGUN_DOMAIN + '>';

function getClient() {
  if (client) return client;
  const apiKey = process.env.MAILGUN_API_KEY;
  if (!apiKey) return null;
  const mg = new Mailgun(FormData);
  client = mg.client({ username: 'api', key: apiKey });
  return client;
}

async function sendEmail({ to, subject, html }) {
  const mg = getClient();
  if (!mg) {
    console.log('[EMAIL] Mailgun not configured (MAILGUN_API_KEY not set) — skipping email to', to);
    return null;
  }
  try {
    const result = await mg.messages.create(MAILGUN_DOMAIN, {
      from: FROM_ADDRESS,
      'h:Reply-To': 'steve@noblecollective.org',
      to: [to],
      subject,
      html,
      'h:List-Unsubscribe': '<https://resources.noblecollective.org/notifications>',
    });
    console.log('[EMAIL] Sent to', to, '—', subject, '— id:', result.id);
    return result;
  } catch (err) {
    console.error('[EMAIL] Failed to send to', to, ':', err.message);
    return null;
  }
}

async function sendBatch(emails) {
  for (const email of emails) {
    await sendEmail(email);
    // Small delay between sends to be nice to the API
    await new Promise(r => setTimeout(r, 100));
  }
}

module.exports = { sendEmail, sendBatch };

const express = require('express');
const Stripe = require('stripe');

const app = express();

// ===== CONFIGURATION (set these in Railway's Variables tab) =====
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;       // From Stripe Dashboard > Developers > API keys
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET; // The whsec_... value from your webhook destination
const GA4_MEASUREMENT_ID = process.env.GA4_MEASUREMENT_ID;     // e.g. G-XXXXXXX
const GA4_API_SECRET = process.env.GA4_API_SECRET;             // From GA4 > Admin > Data Streams > Measurement Protocol API secrets

const stripe = Stripe(STRIPE_SECRET_KEY);

// Stripe requires the RAW body (not parsed JSON) to verify the signature.
// So we use express.raw() ONLY for the webhook route.
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;

  // 1. Verify the request genuinely came from Stripe
  try {
    const signature = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // 2. Always respond 200 quickly so Stripe doesn't retry unnecessarily.
  //    We process the event AFTER responding.
  res.status(200).json({ received: true });

  // 3. Handle the event types we care about
  try {
    if (event.type === 'checkout.session.completed') {
      await handlePurchaseEvent(event.data.object, {
        amount: event.data.object.amount_total,
        currency: event.data.object.currency,
        transactionId: event.data.object.id,
        email: event.data.object.customer_details?.email || event.data.object.customer_email,
        customerId: event.data.object.customer,
      });
    } else if (event.type === 'invoice.paid') {
      await handlePurchaseEvent(event.data.object, {
        amount: event.data.object.amount_paid,
        currency: event.data.object.currency,
        transactionId: event.data.object.id,
        email: event.data.object.customer_email, // may be null; see note below
        customerId: event.data.object.customer,
      });
    } else {
      console.log(`Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error('Error processing event:', err);
  }
});

/**
 * Sends a "purchase" event to GA4 via the Measurement Protocol.
 */
async function handlePurchaseEvent(stripeObject, { amount, currency, transactionId, email, customerId }) {
  // amount is in the smallest currency unit (e.g. paise/cents). Convert to a decimal value.
  const value = amount / 100;

  // GA4 requires a client_id. Since this is a server-to-server event with no browser session,
  // we generate a stable pseudo client_id from the Stripe customer ID so repeat events
  // for the same customer are at least grouped together in GA4.
  const clientId = customerId ? customerId.replace('cus_', '') + '.0' : `${Date.now()}.${Math.random()}`;

  const payload = {
    client_id: clientId,
    events: [
      {
        name: 'purchase',
        params: {
          currency: (currency || 'usd').toUpperCase(),
          value: value,
          transaction_id: transactionId,
          items: [
            {
              item_id: 'eventologist_subscription',
              item_name: 'Eventologist Subscription',
            },
          ],
        },
      },
    ],
  };

  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${GA4_MEASUREMENT_ID}&api_secret=${GA4_API_SECRET}`;

  const response = await fetch(url, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  console.log(
    `GA4 purchase event sent | email=${email} | amount=${value} ${currency} | transaction=${transactionId} | status=${response.status}`
  );
}

// Simple health check route so you can confirm the server is alive in a browser
app.get('/', (req, res) => {
  res.send('Eventologist webhook server is running.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

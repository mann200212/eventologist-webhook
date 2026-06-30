const express = require('express');
const Stripe = require('stripe');

const app = express();

// ===== CONFIGURATION (set these in Railway's Variables tab) =====
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;         // From Stripe Dashboard > Developers > API keys
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET; // The whsec_... value from your webhook destination
const GA4_MEASUREMENT_ID = process.env.GA4_MEASUREMENT_ID;       // e.g. G-XXXXXXX
const GA4_API_SECRET = process.env.GA4_API_SECRET;               // From GA4 > Admin > Data Streams > Measurement Protocol API secrets

const stripe = Stripe(STRIPE_SECRET_KEY);

// Stripe requires the RAW body (not parsed JSON) to verify the signature.
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

  // 2. Respond 200 immediately so Stripe doesn't retry unnecessarily
  res.status(200).json({ received: true });

  // 3. Process the event and forward to GA4
  try {
    if (event.type === 'checkout.session.completed') {
      const obj = event.data.object;
      await handlePurchaseEvent({
        amount: obj.amount_total,
        currency: obj.currency,
        transactionId: obj.id,
        email: obj.customer_details?.email || obj.customer_email,
        customerId: obj.customer,
      });
    } else if (event.type === 'invoice.paid') {
      const obj = event.data.object;
      await handlePurchaseEvent({
        amount: obj.amount_paid,
        currency: obj.currency,
        transactionId: obj.id,
        email: obj.customer_email,
        customerId: obj.customer,
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
async function handlePurchaseEvent({ amount, currency, transactionId, email, customerId }) {
  const value = amount / 100; // smallest currency unit -> decimal

  // GA4 requires a client_id. Since this is server-to-server with no browser session,
  // we derive a stable pseudo client_id from the Stripe customer ID.
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

  console.log('========== GA4 EVENT SENT ==========');
  console.log('Email:', email);
  console.log('Amount:', value, currency);
  console.log('Transaction ID:', transactionId);
  console.log('Client ID used:', clientId);
  console.log('GA4 response status:', response.status);
  console.log('=====================================');
}

// Health check route
app.get('/', (req, res) => {
  res.send('Eventologist webhook server is running.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

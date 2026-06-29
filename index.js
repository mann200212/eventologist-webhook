const express = require('express');
const Stripe = require('stripe');

const app = express();

// ===== CONFIGURATION (set these in Railway's Variables tab) =====
const STRIPE_SECRET_KEY = process.env.mk_1TYOwsKBi2AtJCGPYb9vRyH3;       // From Stripe Dashboard > Developers > API keys
const STRIPE_WEBHOOK_SECRET = process.env.whsec_4deS6E4RqL91T6QVcd7tMQ9yzv10xLpx; // The whsec_... value from your webhook destination

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

  // 2. Respond 200 immediately
  res.status(200).json({ received: true });

  // 3. TEMPORARY: just log the data so we can confirm it's arriving correctly.
  //    (GA4 forwarding will be added once GA4 Measurement ID + API secret are ready.)
  console.log('========== WEBHOOK RECEIVED ==========');
  console.log('Event type:', event.type);

  if (event.type === 'checkout.session.completed') {
    const obj = event.data.object;
    console.log('Amount total:', obj.amount_total);
    console.log('Amount subtotal:', obj.amount_subtotal);
    console.log('Currency:', obj.currency);
    console.log('Customer email:', obj.customer_details?.email || obj.customer_email);
    console.log('Customer ID:', obj.customer);
    console.log('Session ID (transaction id):', obj.id);
    console.log('Payment status:', obj.payment_status);
  } else if (event.type === 'invoice.paid') {
    const obj = event.data.object;
    console.log('Amount paid:', obj.amount_paid);
    console.log('Currency:', obj.currency);
    console.log('Customer email:', obj.customer_email);
    console.log('Customer ID:', obj.customer);
    console.log('Invoice ID (transaction id):', obj.id);
    console.log('Subscription ID:', obj.subscription);
  } else {
    console.log('Unhandled event type — full payload below:');
    console.log(JSON.stringify(event.data.object, null, 2));
  }
  console.log('=======================================');
});

// Health check route
app.get('/', (req, res) => {
  res.send('Eventologist webhook server is running.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

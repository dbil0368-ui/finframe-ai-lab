# VYBORA international billing setup

Premium is planned at USD $5/month. Checkout is deliberately disabled until all checks below pass.

## Vercel environment variables

Set these only in Vercel Project Settings → Environment Variables. Never paste secrets into chat, source code, or GitHub.

Required for AI and server-side database operations:
- GEMINI_API_KEY
- SUPABASE_SECRET_KEY

Required for USD Premium:
- RAZORPAY_KEY_ID
- RAZORPAY_KEY_SECRET
- RAZORPAY_WEBHOOK_SECRET
- RAZORPAY_USD_PLAN_ID

Optional for the legacy INR plans:
- RAZORPAY_STARTER_PLAN_ID
- RAZORPAY_PRO_PLAN_ID

Preview and Production must have separate environment-scoped values:
- Preview: Razorpay Test Mode credentials (rzp_test_...) and the Test USD plan ID in RAZORPAY_USD_PLAN_ID.
- Production: Razorpay Live Mode credentials (rzp_live_...) and the Live USD plan ID in RAZORPAY_USD_PLAN_ID, only after Razorpay approves international card payments.

The app rejects Test keys in Production and Live keys in Preview. Billing subscriptions are separated by environment in Supabase so Preview test subscriptions cannot grant Production Premium entitlements or block a real subscription.

## Razorpay plan and webhook

Create a monthly USD 5.00 subscription plan in the matching Razorpay mode. Put that mode's plan_ identifier in RAZORPAY_USD_PLAN_ID for the matching Vercel environment. The database billing_plans row stores shared price/currency metadata only; do not use one shared database plan ID for both Test and Live.

Webhook URL: https://vybora-trend-hub.vercel.app/api/billing/webhook

Configure the webhook secret to match RAZORPAY_WEBHOOK_SECRET and subscribe to subscription authenticated/activated/charged/pending/halted/cancelled/completed/paused/resumed plus payment captured/failed events.

## Release gates

1. Configure Preview server-side AI and Supabase secrets.
2. Test sign-in, verified-email requirement, Creator Kit cloud sync and AI generation.
3. Configure Preview Razorpay Test Mode keys and Test USD plan ID; test checkout.
4. Confirm webhook signature verification, duplicate-event handling, environment-scoped subscription status updates and AI limits.
5. Finalise Privacy and Terms using the real legal entity, jurisdiction, contact and retention/deletion procedures.
6. Obtain Razorpay International Cards approval.
7. Only then add Production Live credentials and Live USD plan ID, then verify a real controlled transaction before public billing launch.

Do not enable Production checkout before all release gates pass.

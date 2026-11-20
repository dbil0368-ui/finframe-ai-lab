# VYBORA international billing setup

Premium is planned at USD $5/month. Checkout is deliberately disabled until all checks below pass.

## Environment variables

Set these only in Vercel Project Settings → Environment Variables. Never paste secrets into chat, source code, or GitHub.

- SUPABASE_SECRET_KEY
- RAZORPAY_KEY_ID
- RAZORPAY_KEY_SECRET
- RAZORPAY_WEBHOOK_SECRET

Preview must use Razorpay Test Mode credentials (rzp_test_...) and a Test USD plan. Production must use Live Mode credentials (rzp_live_...) and a Live USD plan only after Razorpay approves international card payments. The API rejects a mismatched key mode.

## Razorpay plan and webhook

Create a monthly USD 5.00 subscription plan in the matching Razorpay mode. Store its plan_ identifier in public.billing_plans.razorpay_plan_id for plan_key = pro_usd.

Webhook URL: https://vybora-trend-hub.vercel.app/api/billing/webhook

Configure the webhook secret to match RAZORPAY_WEBHOOK_SECRET and subscribe to subscription authenticated/activated/charged/pending/halted/cancelled/completed/paused/resumed plus payment captured/failed events.

## Release gates

1. Test sign-in and verified-email requirement.
2. Test a Preview checkout using Test Mode keys and plan.
3. Confirm webhook signature verification, duplicate-event handling, and subscription status updates.
4. Confirm AI limits reflect the active plan.
5. Finalise Privacy and Terms using the real legal entity, jurisdiction, contact and retention/deletion procedures.
6. Obtain Razorpay International Cards approval.
7. Only then add Live Mode credentials and Live USD plan to Production.

Do not enable Production checkout before all release gates pass.

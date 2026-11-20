# VYBORA USD Premium billing setup

This branch adds a server-side Razorpay subscription endpoint for the planned **$5 USD/month** Premium plan. The checkout is intentionally fail-closed: the button stays disabled until the USD plan and all server secrets are configured.

## Required Vercel environment variables

Add these to the **vybora-trend-hub** Vercel project (Preview first, then Production after testing):

- `SUPABASE_SECRET_KEY` — Supabase secret key for server-only database access.
- `RAZORPAY_KEY_ID` — Razorpay Test key ID initially; Live key ID only after approval and testing.
- `RAZORPAY_KEY_SECRET` — matching Razorpay key secret.
- `RAZORPAY_WEBHOOK_SECRET` — a webhook secret you choose in Razorpay Dashboard.

Never put these values in frontend code, GitHub, or chat.

## Razorpay plan

Create a **Subscription Plan** in Razorpay in the same mode as the API keys:

- Period: Monthly
- Amount: USD 5.00
- Billing cycles: 1200 (100 years; customers can cancel under the published subscription terms)

Copy the resulting `plan_...` ID. Update the `razorpay_plan_id` field for `plan_key = pro_usd` in `public.billing_plans`. The database row is already seeded with USD, amount 500 (minor units), and 1200 monthly cycles.

Use a Test-mode plan ID with Test API keys first. Replace it with the Live-mode plan ID only after International Cards approval and successful test verification.

## Webhook

Configure this URL in Razorpay Dashboard:

`https://vybora-trend-hub.vercel.app/api/billing/webhook`

Set the webhook secret to the same value as `RAZORPAY_WEBHOOK_SECRET`. Subscribe to:

- `subscription.authenticated`
- `subscription.activated`
- `subscription.charged`
- `subscription.pending`
- `subscription.halted`
- `subscription.cancelled`
- `subscription.completed`
- `subscription.paused`
- `subscription.resumed`
- `payment.captured`
- `payment.failed`

## Flow and safety

- Browser sends only the Supabase access token; the server resolves the authenticated user.
- The server selects the fixed USD plan from Supabase; client input cannot set amount, currency, or plan.
- Razorpay subscription creation uses server-side Basic authentication.
- The hosted Razorpay short URL is returned only after the subscription row is stored.
- Webhook signature verification and event-id deduplication remain server-side.
- Do not enable checkout in production until the International Cards request is approved, legal policy pages are complete, test-mode flow and webhook are verified, and live credentials/plan are configured.

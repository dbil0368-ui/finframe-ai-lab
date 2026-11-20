# VYBORA AI Virtual Try-On

The VYBORA Workspace uses the authenticated Vercel endpoint `/api/image` and Gemini image generation for AI Virtual Try-On. It does not require a third-party try-on provider URL.

## Required secure environment variables

Configure these in Vercel Project Settings → Environment Variables for both Preview and Production:

- `GEMINI_API_KEY`: private Google Gemini Developer API key.
- `SUPABASE_SECRET_KEY`: private Supabase secret key used only by the server to enforce VYBORA usage limits.

Never put either value in browser code, GitHub files, or a public chat. After adding or changing environment variables, redeploy the relevant environment.

## How it works

1. The user signs in through Supabase Auth.
2. The browser resizes both selected images locally before upload.
3. The browser sends the portrait and garment reference images to `/api/image` with the user's Supabase access token.
4. The server validates the session, applies the daily Virtual Try-On limit through `consume_vybora_tryon_request`, and calls the configured Gemini image model.
5. The generated image is returned to the browser for review and download.

The server does not persist the uploaded or generated image. Google Gemini processing is subject to Google's applicable API terms and privacy policies. Users should only upload images they have permission to use.

## Manual preview

The manual overlay remains available as a separate browser-only preview. It is not AI clothing fitting.

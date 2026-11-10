# FinFrame AI Virtual Try-On backend

The GitHub Pages site is static. It cannot safely hold an AI provider secret or run a server, so the AI button uses the optional Vercel serverless endpoint at `/api/tryon`.

## Current status

- The browser interface and secure server-side proxy are scaffolded.
- **AI generation is not active until a compatible virtual try-on provider is selected and configured.**
- Do not paste API keys into `index.html`, GitHub Pages files, or a public chat.

## Deploy the API

1. Import this GitHub repository into a Vercel project.
2. In Vercel Project Settings → Environment Variables, add:
   - `TRYON_PROVIDER_URL`: the provider's HTTPS endpoint that accepts multipart form data.
   - `TRYON_API_KEY`: the private server-side bearer token.
3. The provider endpoint must accept multipart fields named `person` and `garment`, and return JSON containing an image as `imageUrl`, `imageBase64`, or `output` (string or first string in an array).
4. Deploy the Vercel project and configure the site/API routing so `/api/tryon` reaches this function. GitHub Pages alone does not host this API.
5. Review the provider's pricing, image retention, privacy, and usage terms before allowing visitors to upload photos.

The proxy forwards the multipart request without parsing or storing the uploaded images. Add provider-specific validation, abuse protection/rate limiting, and privacy disclosures before public launch. The browser limits each selected image to 10 MB; this is not a substitute for server-side provider limits.

## Local/manual preview

The existing manual overlay preview remains available and does not require a backend. It is not AI clothing fitting.

# HelpFinder AI

Standalone conversational AI web app in the `helpfinder-app` directory.

## What is included

- Chat-style interface with New Chat and recent conversation history
- Browser-local conversation storage (not synced between devices)
- Supabase email sign-in
- Gemini responses with Google Search grounding and source links
- Global country/region and free-text answer-language settings
- Homepage entry points for relocation, jobs/study, travel, local services, translation, document guidance, digital/consumer help and everyday problem solving
- Basic per-user request throttling (best effort per serverless instance)

## Deploy as a separate Vercel project

1. Create a **new** Vercel project connected to this GitHub repository.
2. Set **Root Directory** to `helpfinder-app`.
3. Keep the project framework as Other / no framework; no build command is required.
4. Add the server-side environment variable `GEMINI_API_KEY` for Production and Preview.
5. Optionally set `GEMINI_MODEL`; the default is `gemini-2.5-flash,gemini-2.5-flash-lite`.
6. Deploy the `main` branch.

Do not put the Gemini API key in the HTML or commit it to GitHub. Add it only in Vercel Environment Variables. Gemini API usage and Google Search grounding may have usage limits or charges; review Google's current pricing and have a parent/guardian handle any billing setup.

## Authentication

The current frontend reuses an existing Supabase project's public publishable key for email authentication; it is not yet a separate Supabase project dedicated only to HelpFinder. The key is intended to be public; no Supabase secret/service-role key is used in the browser. For a fully isolated backend, create a dedicated Supabase project and replace the URL and publishable key in `index.html` and `api/helpfinder.js`.

## Global product scope

HelpFinder AI is intended for people in any country. The homepage categories are guided starting prompts, not separate verified databases or guaranteed service integrations. The assistant uses Gemini with Google Search grounding to research current questions; users should verify immigration, employment, education, travel, legal, financial and other high-impact requirements with official local sources. Country-specific availability and language quality can vary.

## Privacy and limits

- Chat history is saved in the user's browser only. Clearing browser storage removes it.
- Chat messages are sent to the HelpFinder API and Google's Gemini API to generate answers. Do not enter passwords, verification codes, payment details, or sensitive personal information.
- The in-memory throttle is only best-effort and is not a durable global quota. Before public launch, add a shared database-backed usage limit, abuse monitoring, privacy policy, and terms.
- AI responses can be inaccurate. Users should verify important information with official sources and seek qualified help for high-stakes matters.

## API

`POST /api/helpfinder` expects a signed-in Supabase bearer token and JSON:
```json
{
  "question": "Your question",
  "history": [{"role": "user", "content": "Earlier message"}],
  "region": "Global",
  "language": "English"
}
```

The endpoint returns an answer, grounded source links, and search queries when available.

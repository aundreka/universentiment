# Universentiment

Universentiment is a sentiment-analysis AI chatbot that lets prospective students ask about campus life across Philippine universities. The web UI gathers a user question, forwards it to the FastAPI sentiment microservice, and returns both a human-readable answer and a structured sentiment breakdown so visitors can quickly understand how students feel about workload, dorms, clubs, safety, and other school-life topics.

## What it does

- Chats about campus culture, resources, and student experiences in the Philippines by prompting a safe OpenRouter (GPT-4o-mini) assistant.
- Runs every reply through an automated sentiment analysis pipeline (VADER + NLTK sentence tokenizer) to expose overall tone, sentence-level labels, and the most positive/negative excerpts.
- Falls back to canned guidance when the AI endpoint is unreachable while still giving a sentiment digest and confidence indicator.
- Caches recent question/school combinations (900-second TTL) so repeat inquiries return nearly instant responses and metadata about the source, overview, and TL;DR.

## Tech stack

- **Front-end:** Next.js 16.1 with the App Router, React 19.2, and Tailwind CSS 4 via PostCSS + [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) for the Geist-inspired typography.
- **Back-end:** FastAPI served with Uvicorn, using Python 3.x foundations plus `requests`, `pydantic`, `python-dotenv`, and `fastapi.responses.JSONResponse` to power `/api/chat`.
- **Sentiment analysis:** NLTK sentence tokenization and the VADER lexicon (`vaderSentiment`) translate chatbot text into compound/pos/neu/neg scores, plus helpers that compute a confidence level and extract overview/TL;DR snippets.
- **AI integration:** OpenRouter (default `openai/gpt-4o-mini`) generates opinion-style replies that are curated to avoid claiming real sources; the backend honors `OPENROUTER_API_KEY`, `OPENROUTER_SITE_URL`, and `OPENROUTER_MODEL` environment variables.
- **Dev tooling:** ESLint 9 family, TypeScript 5, and npm scripts for `dev`, `build`, `start`, and `lint`.

## Getting started

1. Install dependencies:
   ```bash
   npm install
   pip install -r backend/requirements.txt
   ```
2. Populate `.env.local` (or system env vars) with:
   ```
   OPENROUTER_API_KEY=your-key
   OPENROUTER_SITE_URL=http://localhost:3000
   OPENROUTER_APP_NAME=Universentiment
   OPENROUTER_MODEL=openai/gpt-4o-mini
   ```
3. Run the backend (FastAPI/UVicorn):
   ```bash
   uvicorn backend.main:app --reload --port 8000
   ```
4. Start the Next.js app:
   ```bash
   npm run dev
   ```
   The front end proxies `/api/chat` to the FastAPI server by default.

## Deploying

Host the Next.js site on Vercel (or any static+node host) and keep the FastAPI service running on a dedicated compute pair. Ensure the production `.env` provides a working OpenRouter key plus the same cache-friendly settings so chatbot responses stay fast and traceable.

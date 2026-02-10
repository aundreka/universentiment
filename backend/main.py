import os
import requests
import json
import re
import time
from typing import List, Optional
from fastapi import FastAPI
import traceback
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from dotenv import load_dotenv
import nltk
import ssl
from pathlib import Path
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

# Load environment variables from project root, then fallback to default behavior
ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env.local")
load_dotenv()

# Download NLTK data if not present
def init_nltk():
    try:
        # Fix SSL issues for NLTK download on some systems (like macOS)
        try:
            _create_unverified_https_context = ssl._create_unverified_context
        except AttributeError:
            pass
        else:
            ssl._create_default_https_context = _create_unverified_https_context

        try:
            nltk.data.find('tokenizers/punkt')
        except (LookupError, OSError):
            print("Downloading NLTK 'punkt' model...")
            nltk.download('punkt', quiet=True)

        try:
            nltk.data.find('tokenizers/punkt_tab')
        except (LookupError, OSError):
            nltk.download('punkt_tab', quiet=True)
    except Exception as e:
        print(f"Warning: NLTK initialization failed: {e}")

init_nltk()

app = FastAPI()

# Initialize sentiment analyzer
analyzer = SentimentIntensityAnalyzer()

class Message(BaseModel):
    role: str
    content: str

class School(BaseModel):
    id: Optional[str] = None
    name: str

class ChatRequestBody(BaseModel):
    school: School
    messages: List[Message]
    topic: Optional[str] = None
    freshness_days: Optional[int] = None

CACHE_TTL_SECONDS = 900
SUMMARY_CACHE = {}

def get_last_user_text(messages: List[Message]) -> str:
    for m in reversed(messages):
        if m.role == "user":
            return m.content
    return ""

def extract_json(text: str):
    try:
        # Find JSON object using regex to handle potential markdown wrappers
        match = re.search(r"\{[\s\S]*\}", text)
        if match:
            json_str = match.group(0)
            return json.loads(json_str)
    except Exception:
        pass
    return None
    
def get_sentiment_label(compound_score: float) -> str:
    if compound_score >= 0.05:
        return "positive"
    elif compound_score <= -0.05:
        return "negative"
    else:
        return "neutral"

def perform_sentiment_analysis(text: str):
    # Overall sentiment
    overall_scores = analyzer.polarity_scores(text)
    overall_sentiment = {
        "compound": overall_scores["compound"],
        "label": get_sentiment_label(overall_scores["compound"]),
        "pos": overall_scores["pos"],
        "neu": overall_scores["neu"],
        "neg": overall_scores["neg"],
    }

    # Sentence-level sentiment
    try:
        sentences = nltk.sent_tokenize(text)
    except Exception:
        # Fallback to simple splitting if NLTK tokenizer fails
        sentences = [s.strip() for s in text.split('\n') if s.strip()]

    sentence_analysis = []
    most_positive_sentence = {"text": None, "sentiment": {"compound": -2.0}}
    most_negative_sentence = {"text": None, "sentiment": {"compound": 2.0}}

    if not sentences:
        return {
            "overall_sentiment": overall_sentiment,
            "sentences": [],
            "relevant_sentences": {
                "most_positive": None,
                "most_negative": None,
            }
        }

    for sentence in sentences:
        scores = analyzer.polarity_scores(sentence)
        sentiment_data = {
            "compound": scores["compound"],
            "label": get_sentiment_label(scores["compound"]),
            "pos": scores["pos"],
            "neu": scores["neu"],
            "neg": scores["neg"],
        }
        sentence_analysis.append({
            "text": sentence,
            "sentiment": sentiment_data
        })

        if sentiment_data["compound"] > most_positive_sentence["sentiment"]["compound"]:
            most_positive_sentence = {"text": sentence, "sentiment": sentiment_data}
        if sentiment_data["compound"] < most_negative_sentence["sentiment"]["compound"]:
            most_negative_sentence = {"text": sentence, "sentiment": sentiment_data}

    if most_positive_sentence["sentiment"]["compound"] < 0.05:
        most_positive_sentence = None
    if most_negative_sentence["sentiment"]["compound"] > -0.05:
        most_negative_sentence = None

    return {
        "overall_sentiment": overall_sentiment,
        "sentences": sentence_analysis,
        "relevant_sentences": {
            "most_positive": most_positive_sentence,
            "most_negative": most_negative_sentence,
        }
    }

def compute_confidence(text: str, overall_sentiment: dict):
    length = len(text)
    magnitude = abs(overall_sentiment.get("compound", 0.0))
    pos = overall_sentiment.get("pos", 0.0)
    neg = overall_sentiment.get("neg", 0.0)
    balance_gap = abs(pos - neg)

    if length < 200 or magnitude < 0.15 or balance_gap < 0.1:
        return "low"
    if length < 500 or magnitude < 0.35:
        return "medium"
    return "high"

def is_school_related(text: str) -> bool:
    if not text:
        return False
    keywords = [
        "campus", "class", "classes", "prof", "professor", "lecturer", "org",
        "organization", "clubs", "dorm", "housing", "residence", "tuition",
        "scholarship", "cafeteria", "canteen", "library", "facilities",
        "student", "students", "workload", "social", "nightlife", "friend",
        "friends", "major", "course", "school", "university"
    ]
    lower = text.lower()
    return any(k in lower for k in keywords)

def normalize_cache_key(school_name: str, topic: Optional[str], freshness_days: Optional[int], question: str):
    normalized_question = re.sub(r"\s+", " ", (question or "").strip().lower())
    topic_part = (topic or "").strip().lower()
    freshness_part = str(freshness_days or 0)
    return f"{school_name.lower()}||{topic_part}||{freshness_part}||{normalized_question}"

def get_cached_summary(cache_key: str):
    cached = SUMMARY_CACHE.get(cache_key)
    if not cached:
        return None
    if (cached["ts"] + CACHE_TTL_SECONDS) < time.time():
        SUMMARY_CACHE.pop(cache_key, None)
        return None
    return cached["value"]

def set_cached_summary(cache_key: str, value: dict):
    SUMMARY_CACHE[cache_key] = {"ts": time.time(), "value": value}

def fallback_response_with_analysis(school_name: str, question: str, note: Optional[str] = None):
    reply_text = (
        f"Here's some sample feedback for **{school_name}** regarding \"{question}\":\n\n"
        f"- \"The community here is what you make of it. If you join orgs, you'll find your people, but it's easy to feel lost if you don't put yourself out there.\"\n"
        f"- \"I'd say the workload is intense but manageable. Profs are a mixed bag, some are amazing, others just read from slides. Typical big university stuff.\"\n"
        f"- \"Social life is pretty centered around campus events and the local bars. It can get a bit repetitive, but it's fun for the first couple of years.\"\n\n"
    )
    meta = {"mode": "stub", "note": note}
    
    analysis = perform_sentiment_analysis(reply_text)

    return {
        "reply": reply_text,
        "meta": meta,
        "analysis": analysis
    }

def generate_with_openrouter(school_name: str, question: str, topic: Optional[str] = None, freshness_days: Optional[int] = None) -> Optional[str]:
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        return None

    model = os.getenv("OPENROUTER_MODEL", "openai/gpt-4o-mini")
    site_url = os.getenv("OPENROUTER_SITE_URL", "http://localhost:3000")
    app_name = os.getenv("OPENROUTER_APP_NAME", "Universentiment")

    topic_line = f"Topic: {topic}\n" if topic else ""
    timeframe_line = f"Timeframe: last {freshness_days} days\n" if freshness_days else ""
    prompt = (
        "You are an assistant helping students understand campus life sentiment. "
        "Respond with 3-5 short quotes (bullet points) that could plausibly represent student opinions, "
        "but clearly avoid claiming they are from real people. Keep it concise and helpful.\n\n"
        f"School: {school_name}\n"
        f"{topic_line}{timeframe_line}"
        f"Question: {question}\n"
    )

    try:
        resp = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "HTTP-Referer": site_url,
                "X-Title": app_name,
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": "Be concise and safe. Do not claim real sources."},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.7,
            },
            timeout=30,
        )
        if resp.status_code != 200:
            print(f"[openrouter] Non-200 response: {resp.status_code} {resp.text}")
            return None
        data = resp.json()
        choices = data.get("choices") or []
        if not choices:
            return None
        text = (choices[0].get("message", {}) or {}).get("content", "")
        return text.strip() or None
    except Exception as e:
        print(f"[openrouter] Error calling OpenRouter API: {e}")
        return None

@app.post("/api/chat")
async def chat(body: ChatRequestBody):
    try:
        school_name = body.school.name
        question = get_last_user_text(body.messages)
        topic = body.topic
        freshness_days = body.freshness_days

        if (not question or not question.strip()) and topic:
            question = f"{topic}"

        if not topic and not is_school_related(question):
            return JSONResponse(content={
                "reply": "That doesn’t look school-life related. Ask about campus life, orgs, workload, dorms, or social life.",
                "meta": {"mode": "guardrail", "guardrail": True},
                "analysis": None,
                "confidence": "low"
            })

        cache_key = normalize_cache_key(school_name, topic, freshness_days, question)
        cached = get_cached_summary(cache_key)
        if cached:
            cached["meta"]["cache_hit"] = True
            return JSONResponse(content=cached)

        # Use OpenRouter only (no Reddit)
        ai_reply = generate_with_openrouter(school_name, question, topic=topic, freshness_days=freshness_days)
        if ai_reply:
            analysis = perform_sentiment_analysis(ai_reply)
            confidence = compute_confidence(ai_reply, analysis["overall_sentiment"])
            payload = {
                "reply": ai_reply,
                "meta": {
                    "mode": "openrouter",
                    "model": os.getenv("OPENROUTER_MODEL", "openai/gpt-4o-mini"),
                    "cache_hit": False,
                    "topic": topic,
                    "freshness_days": freshness_days,
                    "prompt": question,
                    "source_note": None
                },
                "analysis": analysis,
                "confidence": confidence
            }
            set_cached_summary(cache_key, payload)
            return JSONResponse(content={
                **payload
            })

        note = "OpenRouter not configured or failed."
        fallback = fallback_response_with_analysis(school_name, question, note=note)
        fallback_analysis = fallback.get("analysis") or {}
        overall = fallback_analysis.get("overall_sentiment") or {}
        confidence = compute_confidence(fallback.get("reply", ""), overall) if overall else "low"
        payload = {
            "reply": fallback.get("reply"),
            "meta": {
                **(fallback.get("meta") or {}),
                "cache_hit": False,
                "topic": topic,
                "freshness_days": freshness_days,
                "prompt": question,
                "source_note": None
            },
            "analysis": fallback.get("analysis"),
            "confidence": confidence
        }
        set_cached_summary(cache_key, payload)
        return JSONResponse(content=payload)

    except Exception as e:
        print(f"[/api/chat] UNHANDLED EXCEPTION: {e}")
        print(traceback.format_exc())
        return JSONResponse(
            status_code=500,
            content={"error": "An unexpected error occurred on the server."}
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

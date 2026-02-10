import os
import requests
import json
import re
from typing import List, Optional
from fastapi import FastAPI
import traceback
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from dotenv import load_dotenv
import nltk
import ssl
from pathlib import Path
import praw
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

def search_reddit(school_name: str, query: str, limit: int = 5) -> List[str]:
    client_id = os.getenv("REDDIT_CLIENT_ID")
    client_secret = os.getenv("REDDIT_CLIENT_SECRET")
    user_agent = os.getenv("REDDIT_USER_AGENT")

    if not all([client_id, client_secret, user_agent]):
        print("[search_reddit] Missing Reddit API credentials. Set REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, and REDDIT_USER_AGENT in .env.local")
        return ["__REDDIT_MISSING_CREDS__"]

    try:
        reddit = praw.Reddit(
            client_id=client_id,
            client_secret=client_secret,
            user_agent=user_agent,
            read_only=True
        )

        # Simple subreddit mapping for better targeting
        subreddit_map = {
            "University of Santo Tomas": "Tomasino",
            "University of the Philippines": "peyups",
            "Ateneo de Manila University": "ADMU"
        }
        subreddit_name = subreddit_map.get(school_name, school_name.replace(" ", ""))
        subreddit = reddit.subreddit(subreddit_name)

        comments = []
        # Search for submissions related to the query
        for submission in subreddit.search(query, limit=5, sort="relevance"):
            # Fetch top-level comments, avoiding "MoreComments" objects
            submission.comments.replace_more(limit=0)
            for comment in submission.comments.list():
                if len(comments) >= limit:
                    break
                # Add comments that are not too short
                if len(comment.body) > 50:
                    comments.append(comment.body)
            if len(comments) >= limit:
                break

        if not comments:
            return [f"No relevant Reddit comments found on r/{subreddit_name} for '{query}'. Try a different topic."]

        return comments
    except Exception as e:
        print(f"[search_reddit] Error fetching from Reddit: {e}")
        return [f"An error occurred while trying to fetch data from Reddit. The subreddit r/{subreddit_name} may not exist or there could be an API issue."]

def generate_with_openrouter(school_name: str, question: str) -> Optional[str]:
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        return None

    model = os.getenv("OPENROUTER_MODEL", "openai/gpt-4o-mini")
    site_url = os.getenv("OPENROUTER_SITE_URL", "http://localhost:3000")
    app_name = os.getenv("OPENROUTER_APP_NAME", "Universentiment")

    prompt = (
        "You are an assistant helping students understand campus life sentiment. "
        "Respond with 3-5 short quotes (bullet points) that could plausibly represent student opinions, "
        "but clearly avoid claiming they are from real people. Keep it concise and helpful.\n\n"
        f"School: {school_name}\n"
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

        # Use OpenRouter only (no Reddit)
        ai_reply = generate_with_openrouter(school_name, question)
        if ai_reply:
            analysis = perform_sentiment_analysis(ai_reply)
            return JSONResponse(content={
                "reply": ai_reply,
                "meta": {"mode": "openrouter", "model": os.getenv("OPENROUTER_MODEL", "openai/gpt-4o-mini")},
                "analysis": analysis
            })

        note = "OpenRouter not configured or failed."
        return JSONResponse(content=fallback_response_with_analysis(school_name, question, note=note))

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

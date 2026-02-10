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
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

# Load environment variables from .env.local or .env
load_dotenv(".env.local")
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
        f"_(This is a stub response. The AI model is currently unavailable.)_"
    )
    meta = {"mode": "stub", "note": note}
    
    analysis = perform_sentiment_analysis(reply_text)

    return {
        "reply": reply_text,
        "meta": meta,
        "analysis": analysis
    }

@app.post("/api/chat")
async def chat(body: ChatRequestBody):
    try:
        school_name = body.school.name
        question = get_last_user_text(body.messages)

        api_key = os.getenv("OPENROUTER_API_KEY")
        if not api_key:
            print("[/api/chat] Missing OPENROUTER_API_KEY in .env")
            return JSONResponse(content=fallback_response_with_analysis(school_name, question, "Missing OPENROUTER_API_KEY"))

        model = "arcee-ai/trinity-large-preview:free"
        
        system_prompt = (
            "You are an AI assistant that synthesizes student feedback from online discussions (like Reddit) about colleges.\n"
            "Your goal is to provide realistic, sample feedback based on common knowledge about a university's student life.\n"
            "Present feedback as if they were comments from different students. Keep the response concise and in plain text."
        )

        messages = [{"role": "system", "content": system_prompt}]
        for m in body.messages:
            messages.append({"role": m.role, "content": m.content})
        
        messages.append({
            "role": "user",
            "content": (
                f"School: {school_name}\n"
                f"Student question: \"{question}\"\n\n"
                "Based on simulated online discussions, generate a list of 3-5 pieces of feedback about this topic. "
                "Each piece of feedback should be a short paragraph, written as if it's from a different student. "
                "Start each with a bullet point. Do not use JSON."
            )
        })

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": os.getenv("OPENROUTER_SITE_URL", "http://localhost:3000"),
            "X-Title": os.getenv("OPENROUTER_APP_NAME", "College Sentiment Guide"),
        }

        payload = {
            "model": model,
            "messages": messages,
            "temperature": 0.4,
            "max_tokens": 1500,
        }

        response = requests.post("https://openrouter.ai/api/v1/chat/completions", headers=headers, json=payload)
        
        if response.status_code != 200:
            print(f"[/api/chat] OpenRouter returned error {response.status_code}: {response.text}")
            return JSONResponse(content=fallback_response_with_analysis(school_name, question, f"OpenRouter error {response.status_code}"))

        data = response.json()
        reply = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        
        print("\n--- AI RAW RESPONSE ---")
        print(reply)
        print("--- END AI RAW RESPONSE ---\n")

        if not reply:
            print("[/api/chat] OpenRouter returned an empty reply.")
            return JSONResponse(content=fallback_response_with_analysis(school_name, question, "OpenRouter returned empty reply"))

        report = extract_json(reply)

        if not report:
            print("[/api/chat] Failed to parse JSON from reply. Analyzing as raw text.")
            analysis = perform_sentiment_analysis(reply)
            return JSONResponse(content={
                "reply": reply,
                "meta": {"mode": "openrouter", "model": model, "format": "raw_text"},
                "analysis": analysis
            })

        print("[/api/chat] Successfully parsed JSON report from AI.")
        overall_evidence_text = ""
        theme_scores = []
        themes = report.get("themes", []) if isinstance(report.get("themes", []), list) else []

        for t in themes:
            if not isinstance(t, dict):
                continue
            ev = t.get("evidence", [])
            if isinstance(ev, list):
                ev_text = " ".join([str(x) for x in ev])
            else:
                ev_text = str(ev)
            overall_evidence_text += " " + ev_text
            theme_scores.append({
                "name": t.get("name", "unknown"),
                "model_label": t.get("label", "unknown"),
                "vader": perform_sentiment_analysis(ev_text)["overall_sentiment"]
            })
        overall_vader = perform_sentiment_analysis(overall_evidence_text)["overall_sentiment"]

        return JSONResponse(content={
            "reply": report,
            "meta": {"mode": "openrouter", "model": model, "format": "json_report"},
            "analysis": {
                "overall_vader_from_evidence": overall_vader,
                "themes_vader_from_evidence": theme_scores
            }
        })

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
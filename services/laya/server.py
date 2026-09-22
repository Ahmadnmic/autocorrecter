"""
Laya decision service: the open-source System 1 decision model (Apache-2.0, convaiinnovations/laya) behind the same
HTTP shape the app already speaks to Jev, so the web app, the desktop app and the keyboard need no protocol change.

    POST /v1/decisions   {"state": {...}, "questions": {...}}  ->  {"answers": {...}}
    GET  /health         model, device, warm state

Answers mirror Jev: choice -> {choice, confidence, probabilities}, noul -> {noul}, score -> {score}.
Set LAYA_API_KEY to require `authorization: Bearer <key>`; leave it unset only for a service bound to localhost.
"""

import os
import time
from typing import Any, Dict

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel

MODEL = os.environ.get("LAYA_MODEL", "multilingual")  # English + Danish both go through the multilingual checkpoint
DEVICE = os.environ.get("LAYA_DEVICE")  # cuda / mps / cpu; None lets Laya choose
API_KEY = os.environ.get("LAYA_API_KEY", "")
MAX_QUESTIONS = int(os.environ.get("LAYA_MAX_QUESTIONS", "24"))

app = FastAPI(title="laya-decisions")
_agent = None
_loaded_at = 0.0


def agent():
    """Load the checkpoint once, at startup, and keep it resident: a cold build costs seconds."""
    global _agent, _loaded_at
    if _agent is None:
        import laya

        t0 = time.time()
        repo = "convaiinnovations/laya"
        kwargs = {"device": DEVICE} if DEVICE else {}
        _agent = laya.load(repo, **kwargs) if MODEL in ("english", "root") else laya.load(repo, subfolder=MODEL, **kwargs)
        _loaded_at = time.time() - t0
    return _agent


class Decision(BaseModel):
    state: Dict[str, Any]
    questions: Dict[str, Any]


@app.on_event("startup")
def warm() -> None:
    try:
        a = agent()
        a.predict({"text": "warm"}, {"ok": {"type": "noul", "instructions": "Is this a warm-up request?"}})
    except Exception as e:  # a cold service still answers /health with the reason
        print(f"warm-up failed: {e}", flush=True)


@app.get("/health")
def health() -> Dict[str, Any]:
    return {"ok": _agent is not None, "model": MODEL, "device": DEVICE or "auto", "load_seconds": round(_loaded_at, 2)}


@app.post("/v1/decisions")
def decisions(body: Decision, request: Request) -> Dict[str, Any]:
    if API_KEY:
        header = request.headers.get("authorization", "")
        if header != f"Bearer {API_KEY}" and request.headers.get("x-api-key", "") != API_KEY:
            raise HTTPException(status_code=401, detail="unauthorized")
    questions = dict(list(body.questions.items())[:MAX_QUESTIONS])
    if not questions:
        return {"answers": {}}
    t0 = time.time()
    try:
        result = agent().predict(body.state, questions)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"laya: {e}") from e
    answers: Dict[str, Any] = {}
    for key, ans in (result.get("answers") or {}).items():
        out: Dict[str, Any] = {}
        if "choice" in ans:
            out["choice"] = ans["choice"]
            out["confidence"] = ans.get("confidence")
            if ans.get("probabilities"):
                out["probabilities"] = ans["probabilities"]
        if "noul" in ans:
            out["noul"] = ans["noul"]
        if "score" in ans:
            out["score"] = ans["score"]
        answers[key] = out
    return {"answers": answers, "ms": int((time.time() - t0) * 1000), "model": MODEL}

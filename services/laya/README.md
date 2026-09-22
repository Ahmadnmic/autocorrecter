# Laya decision service

Runs [Laya](https://github.com/NandhaKishorM/laya) (Apache-2.0) behind the HTTP shape the app already uses for Jev.
The app sends `{state, questions}` and gets `{answers}` back; nothing else in the pipeline changes.

## Run it locally

    uv venv --python 3.12 && uv pip install -r requirements.txt
    LAYA_MODEL=multilingual uv run uvicorn server:app --port 8080

First start downloads the checkpoint (~1.3 GB for `multilingual`) into the Hugging Face cache.

## Point the web app at it

    LAYA_URL=http://127.0.0.1:8080/v1/decisions     # or the deployed URL
    LAYA_API_KEY=<same value as the service>        # omit only for localhost

With `LAYA_URL` set, every decision goes to Laya; if it is unreachable and a Jev key is configured, the app falls
back to Jev for that request. Unset `LAYA_URL` to go back to Jev entirely.

## Deploy

    docker build -t laya-decisions .
    docker run -p 8080:8080 -e LAYA_API_KEY=secret laya-decisions

Any container host works (Fly.io, Render, Railway, a VPS). CPU is enough: ~200-460 ms per request, against ~250 ms
for the hosted Jev API. A GPU host (`LAYA_DEVICE=cuda`) brings it to ~33 ms.

Checkpoints: `multilingual` (322M, 100+ languages including Danish, the default here), `english` (421M,
English only), `typed-decisions` (421M). English and Danish are both served well by `multilingual`.

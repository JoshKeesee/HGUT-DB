import os
import shutil
import time
import logging
import warnings
import sys
import requests
from bs4 import BeautifulSoup
from quart import Quart, request, jsonify, Response
from gradio_client import Client
from huggingface_hub import InferenceClient

logging.disable(sys.maxsize)
warnings.filterwarnings("ignore")
logger = logging.getLogger("werkzeug")
logger.setLevel(logging.ERROR)

mp = "assets/Alfred-Indigo"
c = InferenceClient("meta-llama/Meta-Llama-3-8B-Instruct", token=os.getenv("HF_TOKEN"))
i = Client("Nymbo/Stable-Diffusion-3", hf_token=os.getenv("HF_TOKEN"))
a = Client("artificialguybr/Stable-Audio-Open-Zero", hf_token=os.getenv("HF_TOKEN"))
v = Client("Nymbo/Instant-Video", hf_token=os.getenv("HF_TOKEN"))

async def iter_over_async(ait):
    async for item in ait:
        yield item

async def t(data):
    name = data["name"]
    yield f"data: {{\"status\":\"Calling the {name} tool...\"}}\n\n"
    del data["name"]
    if name == "text-to-image":
        r = await i.predict(
            **data,
            api_name="/run"
        )[0]["image"]
        fp = f"files/{round(time.time() * 1000)}.{r.split('.')[-1]}"
        shutil.move(r, fp)
        yield f"data: {{\"response\":\"/{fp}\", \"status\":\"{name.capitalize()} tool completed\"}}\n\n"
    elif name == "text-to-audio":
        r = await a.predict(
            **data,
            api_name="/predict"
        )
        fp = f"files/{round(time.time() * 1000)}.{r.split('.')[-1]}"
        shutil.move(r, fp)
        yield f"data: {{\"response\":\"/{fp}\", \"status\":\"{name.capitalize()} tool completed\"}}\n\n"
    elif name == "text-to-video":
        r = await v.predict(
            **data,
            api_name="/generate_image"
        )["video"]
        fp = f"files/{round(time.time() * 1000)}.{r.split('.')[-1]}"
        shutil.move(r, fp)
        yield f"data: {{\"response\":\"/{fp}\", \"status\":\"{name.capitalize()} tool completed\"}}\n\n"
    elif name == "web-search":
        yield f"data: {{\"status\":\"Calling web search for {data['query']}...\"}}\n\n"
        url = f"https://www.googleapis.com/customsearch/v1?key={os.getenv('GOOGLE_SEARCH_API')}&cx=f189b339c002241b9&q={data['query']}"
        items = requests.get(url).json()["items"]
        r = None
        while r is None and len(items) > 0:
            yield f"data: {{\"status\":\"Searching web page...\"}}\n\n"
            r = requests.get(items[0]["link"])
            yield f"data: {{\"status\":\"Extracting information from web page...\"}}\n\n"
            b = BeautifulSoup(r.text, "html.parser")
            t = b.get_text()
            t = " ".join(t.split(" ")[:1000]).replace("\n", " ").replace('"', "'")
            r = None
            if len(t) > 0:
                r = t
            else:
                items.pop(0)
        yield f"data: {{\"response\":\"{r}\", \"status\":\"{name.capitalize()} tool completed\"}}\n\n"

app = Quart(__name__)

@app.route("/generate", methods=["POST"])
async def generate():
    try:
        data = await request.get_json()
        m = data["messages"]
        mt = data["max_tokens"]
        r = c.chat_completion(
            messages=m,
            max_tokens=mt
        )
        return jsonify({"response": r.choices[0].message.content})
    except Exception as e:
        return jsonify({"error": str(e)})

@app.route("/generate-content", methods=["POST"])
async def generate_content():
    try:
        data = await request.get_json()
        return Response(iter_over_async(t(data)), content_type="text/event-stream")
    except Exception as e:
        return jsonify({"error": str(e)})

if __name__ == "__main__":
    print("AI server running on port 5000")
    app.run(port=5000, use_reloader=False)
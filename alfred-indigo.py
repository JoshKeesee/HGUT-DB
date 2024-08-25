import os
import shutil
import time
import logging
import warnings
import sys
import requests
import json
from bs4 import BeautifulSoup
from quart import Quart, request, jsonify, Response
from gradio_client import Client
from groq import Groq

logging.disable(sys.maxsize)
warnings.filterwarnings("ignore")
logger = logging.getLogger("werkzeug")
logger.setLevel(logging.ERROR)

c = Groq(api_key=os.getenv("GROQ"))
i = Client("fcyai/FLUX.1-merged", hf_token=os.getenv("HF_TOKEN"))
a = Client("artificialguybr/Stable-Audio-Open-Zero", hf_token=os.getenv("HF_TOKEN"))
v = Client("Nymbo/Instant-Video", hf_token=os.getenv("HF_TOKEN"))

async def iter_over_async(ait):
    async for item in ait:
        f = json.dumps(item)
        yield f"data: {f} <end-event>"

async def t(data):
    try:
        name = data["name"]
        yield {"status": f"Calling the {name} tool..."}
        del data["name"]
        if name == "text-to-image":
            r = i.predict(
                **data,
                api_name="/infer"
            )[0]
            fp = f"files/{round(time.time() * 1000)}.{r.split('.')[-1]}"
            shutil.move(r, fp)
            yield {"response": f"/{fp}", "status": f"{name.capitalize()} tool completed"}
        elif name == "text-to-audio":
            r = a.predict(
                **data,
                api_name="/predict"
            )
            fp = f"files/{round(time.time() * 1000)}.{r.split('.')[-1]}"
            shutil.move(r, fp)
            yield {"response": f"/{fp}", "status": f"{name.capitalize()} tool completed"}
        elif name == "text-to-video":
            r = v.predict(
                **data,
                api_name="/generate_image"
            )["video"]
            fp = f"files/{round(time.time() * 1000)}.{r.split('.')[-1]}"
            shutil.move(r, fp)
            yield {"response": f"/{fp}", "status": f"{name.capitalize()} tool completed"}
        elif name == "web-search":
            results = []
            headers = {
                "User-Agent": "Mozilla/5.0 (Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/111.0"
            }
            timeout = 5
            with requests.Session() as s:
                yield {"status": f"Calling web search for {data['query']}..."}
                r = s.get(
                    url="https://www.google.com/search",
                    headers=headers,
                    params={"q": data["query"], "num": data["num_results"], "udm": 14},
                    timeout=timeout,
                    verify=False
                )
                r.raise_for_status()
                b = BeautifulSoup(r.text, "html.parser")
                items = b.find_all("div", attrs={"class": "g"})
                f = ""
                for item in items:
                    link = item.find("a", href=True)["href"]
                    yield {"status": f"Searching web page ({items.index(item) + 1}/{len(items)})..."}
                    try:
                        r = s.get(
                            url=link,
                            headers=headers,
                            timeout=timeout,
                            verify=False
                        )
                        r.raise_for_status()
                        yield {"status": f"Extracting relevant information ({items.index(item) + 1}/{len(items)})..."}
                        b = BeautifulSoup(r.text, "html.parser")
                        for tag in b(["script", "style", "header", "footer", "nav", "form", "svg", "noscript"]):
                            tag.extract()
                        t = b.get_text(strip=True)
                        max_chars = 6000
                        if len(t) > max_chars:
                            t = t[:max_chars]
                        results.append({
                            "link": link,
                            "text": t
                        })
                        f += f"Link: {result['link']}\nText: {result['text']}\n"
                        if len(f) > 6000:
                            break
                    except Exception as e: continue
            f = str(f).strip()
            yield {"response": f, "status": f"{name.capitalize()} tool completed"}
    except Exception as e:
        print(e)
        yield {"error": str(e), "status": f"An error occurred while calling the {name} tool"}

app = Quart(__name__)

@app.route("/generate", methods=["POST"])
async def generate():
    try:
        data = await request.get_json()
        m = data["messages"]
        mt = data["max_tokens"]
        r = c.chat.completions.create(
            messages=m,
            model="llama-3.1-70b-versatile",
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
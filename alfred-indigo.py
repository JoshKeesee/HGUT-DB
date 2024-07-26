import os
import shutil
import time
import logging
import click
import warnings
import sys
from flask import Flask, request, jsonify
from transformers import pipeline
from gradio_client import Client
from huggingface_hub import InferenceClient
from assets.model import Model

logging.disable(sys.maxsize)
warnings.filterwarnings("ignore")
logger = logging.getLogger("werkzeug")
logger.setLevel(logging.ERROR)

def secho(text, file=None, nl=None, err=None, color=None, **styles):
    pass

def echo(text, file=None, nl=None, err=None, color=None, **styles):
    pass

click.echo = echo
click.secho = secho

mp = "assets/Alfred-Indigo"
c = InferenceClient("meta-llama/Meta-Llama-3-8B-Instruct", token=os.getenv("HF_TOKEN"))
i = Client("Nymbo/Stable-Diffusion-3", hf_token=os.getenv("HF_TOKEN"))
a = Client("artificialguybr/Stable-Audio-Open-Zero", hf_token=os.getenv("HF_TOKEN"))
v = Client("Nymbo/Instant-Video", hf_token=os.getenv("HF_TOKEN"))

app = Flask(__name__)

@app.route("/generate", methods=["POST"])
def generate_api():
    try:
        m=request.json["messages"]
        mt=request.json["max_tokens"]
        r=c.chat_completion(
            messages=m,
            max_tokens=mt
        )
        return jsonify({"response":r.choices[0].message.content})
    except Exception as e:return jsonify({"error":str(e)})

@app.route("/generate-image", methods=["POST"])
def generate_image_api():
    try:
        m=request.json["prompt"]
        r=i.predict(
            prompt=m,
            api_name="/run"
        )[0]["image"]
        fp=f"files/{round(time.time()*1000)}.{r.split('.')[-1]}"
        shutil.move(r,fp)
        return jsonify({"response":f"/{fp}"})
    except Exception as e:return jsonify({"error":str(e)})

@app.route("/generate-audio", methods=["POST"])
def generate_audio_api():
    try:
        m=request.json["prompt"]
        r=a.predict(
            prompt=m,
            seconds_total=47,
		    steps=150,
            api_name="/predict"
        )
        fp=f"files/{round(time.time()*1000)}.{r.split('.')[-1]}"
        shutil.move(r,fp)
        return jsonify({"response":f"/{fp}"})
    except Exception as e:return jsonify({"error":str(e)})

@app.route("/generate-video", methods=["POST"])
def generate_video_api():
    try:
        m=request.json["prompt"]
        r=v.predict(
            prompt=m,
            motion="",
            api_name="/generate_image"
        )["video"]
        fp=f"files/{round(time.time()*1000)}.{r.split('.')[-1]}"
        shutil.move(r,fp)
        return jsonify({"response":f"/{fp}"})
    except Exception as e:return jsonify({"error":str(e)})

if __name__ == "__main__":
    print("AI server running on port 5000")
    app.run(port=5000)
import os
import shutil
import time
import logging
import click
import warnings
import sys
from flask import Flask, request, jsonify
import torch as pt
from transformers import pipeline
from gradio_client import Client
from assets.llm import LLM

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
ai = LLM.from_pretrained(mp).eval()
t = pt.load(f"{mp}/tokenizer.pth")
g = pipeline("text-generation")
i = Client("sourceoftruthdata/Stable-Diffusion-3", hf_token=os.getenv("HF_TOKEN"))
a = Client("artificialguybr/Stable-Audio-Open-Zero", hf_token=os.getenv("HF_TOKEN"))
v = Client("Nymbo/Instant-Video", hf_token=os.getenv("HF_TOKEN"))

def generate(m,mt=1000):
    try:
        d=pt.device("cuda" if pt.cuda.is_available() else "cpu")
        p=t.apply_chat_template(m,add_generation_prompt=True)
        with pt.no_grad():
            o=pt.tensor(t.encode(p)).unsqueeze(0).to(d)
            for _ in range(mt):
                n=pt.multinomial(pt.nn.functional.softmax(ai(o)[0,-1],dim=0),1).item()
                o=pt.cat([o,pt.tensor([[n]]).to(d)],dim=1)
                if t.decode([n])==t.custom_tokens[3]:break
            o=t.decode(o.squeeze().tolist(),response_only=True)
            return o
    except Exception as e:return{"error":str(e)}

app = Flask(__name__)

@app.route("/generate", methods=["POST"])
def generate_api():
    m=request.json["messages"]
    mt=request.json["max_tokens"]
    return jsonify({"response":generate(m,mt)})

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

@app.route("/predict-text", methods=["POST"])
def predict_api():
    m=request.json["text"]
    mt=request.json["max_tokens"]
    return jsonify({"response":g(m,return_full_text=False,max_new_tokens=mt)[0]["generated_text"]})

if __name__ == "__main__":
    print("AI server running on port 5000")
    app.run(port=5000)
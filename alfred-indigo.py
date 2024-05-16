import logging
import sys
from flask import Flask, request, jsonify
import torch as pt
from assets.llm import LLM

logging.disable(sys.maxsize)

mp = "assets/Alfred-Indigo"
ai = LLM.from_pretrained(mp).eval()
t = pt.load(f"{mp}/tokenizer.pth")

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

if __name__ == "__main__":
    app.run(port=5000)
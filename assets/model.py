import json
import torch
import torch.nn as nn
from assets.llm import LLM
from assets.tokenizer import Tokenizer

# Define the model name
model_name = "Alfred-Indigo"


class Model:
    # Initialize model
    def __init__(self):
        self.device = torch.device(
            "cuda" if torch.cuda.is_available() else "cpu")
        
        # Model paths
        self.model_dir = f"assets/{model_name}"
        self.model_path = f"{self.model_dir}/pytorch_model.bin"
        self.config_path = f"{self.model_dir}/config.json"
        self.tokenizer_path = f"{self.model_dir}/tokenizer.pth"

        # Load model
        self.load()

    # Generate response
    def generate(self, messages, max_tokens=1000, stream=False, stream_fn=None):
        try:
            self.model.eval()
            prompt = self.tokenizer.apply_chat_template(
                messages, add_generation_prompt=True)

            # Check if history is valid
            if "error" in prompt and isinstance(prompt, dict):
                return prompt

            with torch.no_grad():
                # Tokenize prompt
                tokens = self.tokenizer.encode(prompt)
                tokens = torch.tensor(tokens).unsqueeze(0).to(self.device)

                # Setup stream chunk size
                max_chunk = 10
                curr_chunk = 0

                for _ in range(max_tokens):
                    output = self.model(tokens)
                    probabilities = nn.functional.softmax(output[0, -1], dim=0)
                    next_token = torch.multinomial(probabilities, 1).item()
                    tokens = torch.cat([tokens, torch.tensor(
                        [[next_token]]).to(self.device)], dim=1)

                    # Update stream chunk
                    curr_chunk += 1

                    # Check for stop token
                    stop_token = self.tokenizer.decode(
                        [next_token]) == self.tokenizer.custom_tokens[3]

                    # Stream response
                    if stream and (stop_token or (curr_chunk == max_chunk and stream_fn)):
                        text = self.tokenizer.decode(
                            tokens.squeeze().tolist(), response_only=True)
                        stream_fn(text)
                        curr_chunk = 0

                    # Stop if end token is reached
                    if stop_token:
                        break

                # Convert tokens to text
                text = self.tokenizer.decode(
                    tokens.squeeze().tolist(), response_only=True)

                return text
        except Exception as e:
            return {"error": str(e)}
    
    # Load configuration
    def load_config(self):
        with open(self.config_path, "r") as f:
            config = json.load(f)
        return config

    # Get number of parameters
    def num_parameters(self):
        return sum(p.numel() for p in self.model.parameters() if p.requires_grad)
    
    # Load model and tokenizer
    def load(self):
        config = self.load_config()
        self.model = LLM.load(self.model_path, **config)
        self.tokenizer = Tokenizer.load(self.tokenizer_path)
        print(f"Model and tokenizer loaded from model/{model_name}")

import re
import json


class Tokenizer:
    def __init__(self, vocab, custom_tokens=[]):
        self.str_to_int = vocab
        self.str_to_int_lower = {s.lower(): i for s, i in vocab.items()}
        self.int_to_str = {i: s for s, i in vocab.items()}
        self.custom_tokens = custom_tokens

    def encode(self, text):
        preprocessed = re.split(r'([,.?_!"()\']|--|\s)', text)
        preprocessed = [item for item in preprocessed if len(item) > 0]
        preprocessed = [item if item in self.str_to_int
                        else self.int_to_str[self.str_to_int_lower[item.lower()]] if item.lower() in self.str_to_int_lower
                        else "<|unk|>" for item in preprocessed]

        ids = [self.str_to_int[s] for s in preprocessed]
        return ids

    def decode(self, ids, response_only=False):
        text = "".join([self.int_to_str[i] for i in ids])
        text = text.split(
            self.custom_tokens[2])[-1].split(self.custom_tokens[3])[0].strip() if response_only else text
        return text

    def apply_chat_template(self, messages, add_generation_prompt=False):
        text = "<|start-conversation|> "
        last_role = "system"
        for i in range(len(messages)):
            m = messages[i]
            if m["role"] == last_role and m["role"] != "system":
                return {"error": "History roles must alternate between user and assistant."}
            text += f"<|start-{m['role']}|> {m['content']} <|end-{m['role']}|> "
            last_role = m["role"]
        if add_generation_prompt:
            text += "<|start-assistant|> "
        return text
    
    def get_vocab_size(self):
        return len(self.str_to_int)
    
    def save(self, file_path):
        config = {
            "str_to_int": self.str_to_int,
            "int_to_str": self.int_to_str,
            "custom_tokens": self.custom_tokens
        }
        with open(file_path, "w") as f:
            json.dump(config, f, indent=4)
        print(f"Tokenizer configuration saved to {file_path}")

    @classmethod
    def load(cls, file_path):
        with open(file_path, "r") as f:
            config = json.load(f)
        return cls(config["str_to_int"], config.get("custom_tokens", []))
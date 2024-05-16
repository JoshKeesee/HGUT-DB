import re

class Tokenizer:
    def __init__(self, vocab, custom_tokens=[]):
        self.str_to_int = vocab
        self.str_to_int_lower = {s.lower(): i for s, i in vocab.items()}
        self.int_to_str = {i: s for s, i in vocab.items()}
        self.custom_tokens = custom_tokens

    def encode(self, text):
        preprocessed = re.split(r'([,.?_!"()\']|--|\s)', text)
        preprocessed = [item.strip() for item in preprocessed if item.strip()]
        preprocessed = [item if item in self.str_to_int
                        else self.int_to_str[self.str_to_int_lower[item.lower()]] if item.lower() in self.str_to_int_lower
                        else "<|unk|>" for item in preprocessed]

        ids = [self.str_to_int[s] for s in preprocessed]
        return ids

    def decode(self, ids, response_only=False):
        text = " ".join([self.int_to_str[i] for i in ids])
        # Replace spaces before the specified punctuations
        # text = re.sub(r'\s+([,.?!"()\'])', r'\1', text)
        if response_only:
            text = text.split(
                self.custom_tokens[2])[-1].split(self.custom_tokens[3])[0].strip()
            text = self.fix_grammar(text)
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
    
    def fix_grammar(self, text):
        text += " "

        # Remove custom tokens
        for t in self.custom_tokens:
            text = text.replace(t, "")

        # Fix punctuation
        for l in ["m", "s", "t", "ll", "d", "re", "ve"]:
            text = text.replace(f" ' {l} ", f"'{l} ")
        for q in [" ' ", ' " ']:
            a = len([m.start() for m in re.finditer(q, text)]) // 2
            for i in range(a):
                text = text.replace(q, q.rstrip(), 1)
                text = text.replace(q, q.lstrip(), 1)
        for p in [".", "?", "!", ":", ",", ";", ")", "]", "}"]:
            text = text.replace(" " + p, p)
        for p in ["(", "[", "{"]:
            text = text.replace(p + " ", p)
        return text.strip()
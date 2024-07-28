import torch
import torch.nn as nn


class LLM(nn.Module):
    def __init__(self, vocab_size, embed_size, hidden_size, num_layers):
        super(LLM, self).__init__()

        # Initialize LLM
        self.vocab_size = vocab_size
        self.embed_size = embed_size
        self.hidden_size = hidden_size
        self.num_layers = num_layers
        self.dropout = nn.Dropout(0.1)
        
        self.embedding = nn.Embedding(vocab_size, embed_size)
        self.gru = nn.GRU(embed_size, hidden_size, num_layers, dropout=(0.1 if num_layers > 1 else 0), batch_first=True)
        self.fc = nn.Linear(hidden_size, vocab_size)

    def forward(self, x):
        # Forward pass
        x = self.embedding(x)
        x = self.dropout(x)
        x, _ = self.gru(x)
        x = self.fc(x)
        return x
    
    def save(self, model_path):
        # Save model state dict
        torch.save(self.state_dict(), model_path)

    @classmethod
    def load(cls, model_path, vocab_size, embed_size=128, hidden_size=128, num_layers=2, **kwargs):
        # Load model
        model = cls(vocab_size, embed_size, hidden_size, num_layers)
        model.load_state_dict(torch.load(f"{model_path}"))
        model.eval()  # Set model to evaluation mode
        return model
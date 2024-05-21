import torch
import torch.nn as nn
from huggingface_hub import PyTorchModelHubMixin


class LLM(
        nn.Module,
        PyTorchModelHubMixin,
        tags=[
            "pytorch_model_hub_mixin",
            "model_hub_mixin",
        ],
        license="apache-2.0",
        languages=[
            "en",
        ],
        pipeline_tag="text-generation",
        library_name="transformers",
        repo_url="https://github.com/JoshKeesee/Alfred-Indigo",
    ):
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

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
        super().__init__()
        self.embedding = nn.Embedding(vocab_size, embed_size)
        self.rnn = nn.GRU(embed_size, hidden_size, num_layers, batch_first=True)
        self.fc = nn.Linear(hidden_size, vocab_size)

    def forward(self, x):
        x = self.embedding(x)
        x, _ = self.rnn(x)
        x = self.fc(x)
        return x
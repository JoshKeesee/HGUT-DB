---
license: apache-2.0
tags:
- conversational
languages:
- en
pipeline_tag: text-generation
widget:
- example_title: Hello
  messages:
  - role: user
    content: Hello!
- example_title: Tell a story
  messages:
  - role: user
    content: Tell me a scary story
- example_title: Jokes
  messages:
  - role: user
    content: Tell me a funny joke
inference:
  parameters:
    max_new_tokens: 300
    stop:
    - <|end-assistant|>
---

This model has been pushed to the Hub using the [PytorchModelHubMixin](https://huggingface.co/docs/huggingface_hub/package_reference/mixins#huggingface_hub.PyTorchModelHubMixin) integration:
- Library: https://github.com/JoshKeesee/Alfred-Indigo
- Docs: [More Information Needed]
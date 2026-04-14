---
title: "Attention Is All You Need — Explained"
source_url: https://www.youtube.com/watch?v=FAKE_TEST_ID
source_type: video
date_ingested: 2026-04-14
wiki: ai
topic: transformers
tags: [transformers, attention, NLP]
ingest_method: yt-dlp
transcription_method: faster-whisper
duration_seconds: 1823
wiki_updated: false
---

## Content (raw transcript)

Today we're going to talk about the transformer architecture introduced in the 2017 paper
"Attention Is All You Need" by Vaswani et al.

The key innovation is the self-attention mechanism. For each token in the sequence,
we compute a weighted sum over all other tokens. The weights come from the dot product
between a query vector Q and key vectors K, scaled by the square root of the key dimension:

  Attention(Q, K, V) = softmax(QK^T / sqrt(d_k)) * V

Multi-head attention runs this in parallel across H heads, each learning different
relationships. The outputs are concatenated and projected:

  MultiHead(Q,K,V) = Concat(head_1,...,head_h) W^O

The positional encoding uses sine and cosine functions of different frequencies
to inject position information since the model has no recurrence.

Feed-forward layers apply two linear transformations with a ReLU in between:
  FFN(x) = max(0, xW_1 + b_1)W_2 + b_2

The encoder stack has 6 layers. Each layer has self-attention + feed-forward.
The decoder has cross-attention on top of self-attention to attend to encoder output.

"""
Entity extraction model wrapper.
Uses a transformer-based NER model to extract entities and relationships
from text chunks for the Graph RAG pipeline.
"""

import os
import re

import torch
from transformers import pipeline, Pipeline


DEFAULT_MODEL = os.getenv("NER_MODEL", "dslim/bert-base-NER")
DEFAULT_DEVICE = os.getenv("DEVICE", "cpu")

DEVICE_MAP = {"cpu": -1, "cuda": 0, "cuda:0": 0, "cuda:1": 1}

MAX_CHARS = 2048


class EntityExtractor:
    """Wraps a token-classification (NER) pipeline."""

    def __init__(
        self,
        model_name: str = DEFAULT_MODEL,
        device: str = DEFAULT_DEVICE,
    ):
        print(f"[EntityExtractor] Loading model {model_name} on {device}...")
        device_idx = DEVICE_MAP.get(device, -1)
        self.pipe: Pipeline = pipeline(
            "ner",
            model=model_name,
            aggregation_strategy="simple",
            device=device_idx,
        )
        self.model = self.pipe.model
        self.tokenizer = self.pipe.tokenizer
        print("[EntityExtractor] Ready.")

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _deduplicate(self, raw_entities: list[dict]) -> list[dict]:
        """Deduplicate and clean raw NER pipeline output."""
        entities: list[dict] = []
        seen: set[str] = set()

        for ent in raw_entities:
            word = ent["word"].strip()
            word = re.sub(r"^##", "", word).strip()
            if not word or len(word) < 2:
                continue

            key = f"{word.lower()}|{ent['entity_group']}"
            if key in seen:
                continue
            seen.add(key)

            entities.append(
                {
                    "text": word,
                    "label": ent["entity_group"],
                    "score": round(float(ent["score"]), 4),
                    "start": ent.get("start"),
                    "end": ent.get("end"),
                }
            )

        return entities

    def _mean_pool_entity(
        self,
        hidden_states: torch.Tensor,
        offsets: list[tuple[int, int]],
        char_start: int,
        char_end: int,
    ) -> list[float]:
        """
        Mean-pool hidden states over the token span that covers
        [char_start, char_end) using the tokenizer's offset mapping.

        Falls back to the CLS vector (position 0) if no tokens overlap.
        """
        token_indices = []
        for idx, (tok_start, tok_end) in enumerate(offsets):
            if tok_start == tok_end == 0:
                continue  # special token
            if tok_end > char_start and tok_start < char_end:
                token_indices.append(idx)

        if not token_indices:
            return hidden_states[0].tolist()  # CLS fallback

        span_vectors = hidden_states[token_indices]
        return span_vectors.mean(dim=0).tolist()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def extract(self, texts: list[str]) -> list[dict]:
        """
        Extract entities from a list of text chunks.

        Returns a list of dicts per chunk:
        {
            "text": "<original chunk>",
            "entities": [
                {"text": "Microsoft", "label": "ORG", "score": 0.99},
                ...
            ]
        }
        """
        results: list[dict] = []

        for text in texts:
            truncated = text[:MAX_CHARS]
            raw = self.pipe(truncated)
            entities = self._deduplicate(raw)

            for ent in entities:
                ent.pop("start", None)
                ent.pop("end", None)

            results.append({"text": truncated, "entities": entities})

        return results

    def extract_with_embeddings(self, texts: list[str]) -> list[dict]:
        """
        Same as extract(), but each entity also includes an ``embedding``
        field — a 768-dim vector produced by mean-pooling the BERT hidden
        states across the entity's token span.
        """
        results: list[dict] = []

        for text in texts:
            truncated = text[:MAX_CHARS]

            raw = self.pipe(truncated)
            entities = self._deduplicate(raw)

            if not entities:
                results.append({"text": truncated, "entities": []})
                continue

            encoding = self.tokenizer(
                truncated,
                return_tensors="pt",
                truncation=True,
                return_offsets_mapping=True,
            )
            offsets = encoding.pop("offset_mapping")[0].tolist()

            device = next(self.model.parameters()).device
            input_ids = encoding["input_ids"].to(device)
            attention_mask = encoding["attention_mask"].to(device)
            token_type_ids = encoding.get("token_type_ids")
            if token_type_ids is not None:
                token_type_ids = token_type_ids.to(device)

            with torch.no_grad():
                outputs = self.model(
                    input_ids=input_ids,
                    attention_mask=attention_mask,
                    token_type_ids=token_type_ids,
                    output_hidden_states=True,
                )

            # Last hidden state, squeeze batch dim
            hidden = outputs.hidden_states[-1].squeeze(0)

            for ent in entities:
                char_start = ent.pop("start", None)
                char_end = ent.pop("end", None)

                if char_start is not None and char_end is not None:
                    ent["embedding"] = self._mean_pool_entity(
                        hidden, offsets, char_start, char_end
                    )
                else:
                    ent["embedding"] = hidden[0].tolist()  # CLS fallback

            results.append({"text": truncated, "entities": entities})

        return results

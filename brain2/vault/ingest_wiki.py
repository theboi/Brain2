"""Wiki ingest runner — extract → clean → classify → merge (Karpathy core)."""
from __future__ import annotations
import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from brain2.knowledge.extract import extract_to_markdown
from brain2.llm.providers import CompletionRequest, ServiceClass
from brain2.vault.fs import write_text_atomic
from brain2.vault.git import CommitBatch, commit_batch
from brain2.vault.index_md import generate_index_md
from brain2.vault.indexer import index_file
from brain2.vault.log_md import append_log_line
from brain2.vault.parser import canonical_topic

logger = logging.getLogger(__name__)

_VALID_CLASSES = ("sources", "entities", "concepts", "synthesis")
_WIKILINK_RE = re.compile(r"\[\[[^\]\n]+\]\]")


def run_wiki(store, gateway, req) -> str | None:
    project = store.get_project_for_watch(req.project_id)
    root = Path(project.vault_path)

    # Extract to text
    raw_path = req.raw_path
    if raw_path.suffix in (".md", ".txt"):
        raw_text = raw_path.read_text(encoding="utf-8", errors="replace")
        raw_md = extract_to_markdown(raw_path, mime="text/markdown", raw_text=raw_text)
    else:
        raw_md = extract_to_markdown(raw_path, mime=None)

    cleaned = _llm_clean(gateway, req.tenant_id, raw_md)
    emitted = _llm_classify(gateway, req.tenant_id, cleaned)

    batch = CommitBatch(root)
    iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    touched_paths = []

    for entry in emitted:
        topic = canonical_topic(entry["topic"])
        klass = entry.get("class", "concepts")
        if klass not in _VALID_CLASSES:
            klass = "concepts"

        page_path = root / "wiki" / klass / f"{topic}.md"
        existing = page_path.read_text(encoding="utf-8") if page_path.exists() else ""
        merged = _llm_merge(gateway, req.tenant_id, topic, existing, cleaned)
        if not _WIKILINK_RE.search(merged):
            logger.warning("merged page %r contains no [[wikilinks]]", topic)
        write_text_atomic(page_path, merged)
        batch.touched(page_path); touched_paths.append(page_path)

        sources_path = root / "wiki" / "sources" / f"{topic}.md"
        existing_src = sources_path.read_text(encoding="utf-8") if sources_path.exists() else f"# {topic}\n\n"
        section = f"\n## Source: {raw_path.name} @ {iso}\n\n{cleaned}\n"
        write_text_atomic(sources_path, existing_src + section)
        batch.touched(sources_path); touched_paths.append(sources_path)

    # Index pages into cache BEFORE generating index.md
    for p in touched_paths:
        index_file(store, req.project_id, root, p)
    new_index = generate_index_md(store, req.project_id)
    write_text_atomic(root / "index.md", new_index)
    batch.touched(root / "index.md")

    append_log_line(root / "log.md",
                    f"ingest(wiki): {raw_path.name} → {len(emitted)} page(s)")
    batch.touched(root / "log.md")

    sha = commit_batch(store, batch, project_id=req.project_id,
                       tenant_id=req.tenant_id, kind="ingest",
                       message=f"ingest(wiki): {raw_path.name}",
                       agent_id="ingest-wiki@1", source_file=str(raw_path))

    index_file(store, req.project_id, root, root / "index.md")
    index_file(store, req.project_id, root, root / "log.md")
    return sha


def _llm_clean(gateway, tenant_id: str, raw_text: str) -> str:
    prompt = (
        "Clean and structure the following raw text into clear, neutral, "
        "encyclopedic prose suitable for a wiki. Preserve facts. Return only "
        "the cleaned prose.\n\n---\n" + raw_text[:50000]
    )
    req = CompletionRequest(prompt=prompt, model="", service_class=ServiceClass.BATCH)
    resp = gateway.complete(tenant_id, "__wiki_clean__", req)
    return resp.text


def _llm_classify(gateway, tenant_id: str, cleaned: str) -> list[dict]:
    prompt = (
        "Read the cleaned wiki text below and emit a JSON array of pages it "
        "implies. Each entry: {\"topic\": str, \"class\": one of "
        f"{list(_VALID_CLASSES)}, \"tldr\": str ≤ 120 chars}}.\n"
        "Return ONLY the JSON array. No prose.\n\n---\n" + cleaned[:50000]
    )
    req = CompletionRequest(prompt=prompt, model="", service_class=ServiceClass.BATCH)
    resp = gateway.complete(tenant_id, "__wiki_classify__", req)
    try:
        parsed = json.loads(resp.text)
        assert isinstance(parsed, list)
        return parsed
    except (json.JSONDecodeError, AssertionError, TypeError) as exc:
        raise ValueError(f"classify pass returned invalid JSON: {exc}") from exc


def _llm_merge(gateway, tenant_id: str, topic: str, existing: str, incoming: str) -> str:
    prompt = (
        "You are a technical wiki editor. Merge the existing page (if any) "
        "with the new content for topic " + repr(topic) + ".\n"
        "Rules:\n"
        "- Output a single coherent page. Encyclopedic tone. Preserve facts.\n"
        "- For EVERY named concept, entity, or source mentioned, wrap it in "
        "  [[wikilinks]]. The graph is the value. This is mandatory.\n"
        "- Use explicit zone prefixes when citing static or dynamic material.\n"
        "- Do not invent facts.\n\n"
        f"Existing:\n---\n{existing}\n---\n\nIncoming:\n---\n{incoming}\n---\n"
        "Return only the merged page content (no commentary)."
    )
    req = CompletionRequest(prompt=prompt, model="", service_class=ServiceClass.BATCH)
    resp = gateway.complete(tenant_id, "__wiki_merge__", req)
    return resp.text

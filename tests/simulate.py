"""
End-to-end synchronous pipeline simulation.
Overrides vault paths to a temp dir. No queue daemons needed.

Usage:
  python tests/simulate.py --input tests/fixtures/sample_transcript.md --wiki ai
"""
import argparse
import json
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

TAXONOMY_SEED = """\
## Topics

| slug | display_name | description | aliases |
|------|-------------|-------------|---------|
| transformers | Transformers | Attention mechanisms, encoder-decoder, BERT, GPT variants | attention, self-attention |
| retrieval-augmented-generation | Retrieval-Augmented Generation | Vector search, chunking, hybrid retrieval, reranking | rag, retrieval |
"""


def _step(n: int, name: str):
    print(f"\n[SIM] ── Step {n}: {name} ──")


def main():
    parser = argparse.ArgumentParser(description="WikiBot end-to-end pipeline simulation")
    parser.add_argument("--input", required=True, help="Path to fixture .md file")
    parser.add_argument("--wiki", default="ai", help="Wiki name (default: ai)")
    args = parser.parse_args()

    # ── Setup ─────────────────────────────────────────────────────────────────
    print("[SIM] Setting up temp vault...")
    import config

    tmpvault = tempfile.mkdtemp(prefix="wikibot_sim_")
    config.WIKIS_ROOT = tmpvault
    config.WIKI_ROOT = os.path.join(tmpvault, args.wiki)
    config.RAW_DIR = os.path.join(config.WIKI_ROOT, "raw")
    config.WIKI_DIR = os.path.join(config.WIKI_ROOT, "wiki")
    config.META_DIR = os.path.join(config.WIKI_DIR, "_meta")
    config.TAXONOMY_FILE = os.path.join(config.META_DIR, "taxonomy.md")
    config.QUEUE_DB = os.path.join(tmpvault, ".queue", "tasks.db")

    os.makedirs(config.META_DIR, exist_ok=True)
    os.makedirs(os.path.join(tmpvault, ".queue"), exist_ok=True)

    # Seed taxonomy.md
    with open(config.TAXONOMY_FILE, "w", encoding="utf-8") as f:
        f.write(TAXONOMY_SEED)
    print(f"[SIM] Temp vault: {tmpvault}")
    print(f"[SIM] Taxonomy seeded at: {config.TAXONOMY_FILE}")

    # Read fixture
    input_path = args.input
    if not os.path.isabs(input_path):
        input_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), input_path)
    with open(input_path, encoding="utf-8") as f:
        raw_content = f.read()
    print(f"[SIM] Loaded fixture: {input_path} ({len(raw_content)} chars)")

    # ── Step 1: Ollama classify ───────────────────────────────────────────────
    _step(1, "Ollama classify")
    from workers.ollama_worker import call_ollama, read_taxonomy_table, get_known_slugs

    taxonomy = read_taxonomy_table()
    classify_input = (
        f"## Taxonomy\n{taxonomy}\n\n## Document to classify\n{raw_content[:3000]}"
    )

    try:
        classify_response = call_ollama("ollama_classify.txt", classify_input)
    except Exception as e:
        print(f"[SIM] ERROR: Ollama classify failed: {e}")
        sys.exit(1)

    print(f"[SIM] Ollama raw response: {classify_response[:300]}")

    try:
        classify_result = json.loads(classify_response)
    except json.JSONDecodeError as e:
        print(f"[SIM] ERROR: classify response is not JSON: {e}")
        sys.exit(1)

    topic = classify_result.get("match")
    if not topic:
        print(f"[SIM] ERROR: No topic match returned. Full result: {classify_result}")
        sys.exit(1)

    known = get_known_slugs()
    if topic not in known:
        print(f"[SIM] ERROR: Returned topic '{topic}' not in taxonomy. Known: {known}")
        sys.exit(1)

    print(f"[SIM] Classified topic: {topic}")

    # ── Step 2: Ollama clean-summarise ────────────────────────────────────────
    _step(2, "Ollama clean-summarise")

    try:
        clean_response = call_ollama("ollama_clean_summarise.txt", raw_content[:8000])
    except Exception as e:
        print(f"[SIM] ERROR: Ollama clean-summarise failed: {e}")
        sys.exit(1)

    print(f"[SIM] Ollama raw response: {clean_response[:300]}")

    try:
        clean_result = json.loads(clean_response)
    except json.JSONDecodeError as e:
        print(f"[SIM] ERROR: clean-summarise response is not JSON: {e}")
        sys.exit(1)

    required_fields = ["title", "file_slug", "tags", "cleaned_content", "summary"]
    missing = [f for f in required_fields if f not in clean_result]
    if missing:
        print(f"[SIM] ERROR: clean-summarise missing fields: {missing}")
        sys.exit(1)

    print(f"[SIM] Title: {clean_result['title']}")
    print(f"[SIM] Slug:  {clean_result['file_slug']}")
    print(f"[SIM] Tags:  {clean_result['tags']}")
    print(f"[SIM] Summary (first 200 chars): {clean_result['summary'][:200]}")

    # ── Step 3: Write /raw/ file ──────────────────────────────────────────────
    _step(3, "Write /raw/ file")
    from workers.ollama_worker import write_raw_file
    from datetime import date

    frontmatter = {
        "title": clean_result["title"],
        "source_type": "text",
        "date_ingested": date.today().isoformat(),
        "wiki": args.wiki,
        "topic": topic,
        "tags": clean_result["tags"],
        "ingest_method": "pasted",
        "wiki_updated": False,
    }

    raw_file_path = write_raw_file(
        topic,
        clean_result["file_slug"],
        frontmatter,
        clean_result["cleaned_content"],
        clean_result["summary"],
    )
    print(f"[SIM] Wrote raw file: {raw_file_path}")

    if not os.path.exists(raw_file_path):
        print(f"[SIM] ERROR: Raw file not found at {raw_file_path}")
        sys.exit(1)

    # ── Step 4: Claude wiki-update ────────────────────────────────────────────
    _step(4, "Claude wiki-update")
    from wiki.updater import run_wiki_update

    try:
        n_merged = run_wiki_update(topic)
    except Exception as e:
        print(f"[SIM] ERROR: wiki-update failed: {e}")
        sys.exit(1)

    wiki_page_path = os.path.join(config.WIKI_DIR, topic, f"{topic}.md")
    if not os.path.exists(wiki_page_path):
        print(f"[SIM] ERROR: Wiki page not created at {wiki_page_path}")
        sys.exit(1)

    print(f"[SIM] Merged {n_merged} source(s).")
    print(f"[SIM] Wiki page: {wiki_page_path}")

    with open(wiki_page_path, encoding="utf-8") as f:
        wiki_content = f.read()
    print(f"[SIM] Wiki page size: {len(wiki_content)} chars")

    # ── Step 5: Ollama lint ───────────────────────────────────────────────────
    _step(5, "Ollama lint")
    from wiki.health import run_lint

    issues = run_lint(topic)
    if issues:
        print(f"[SIM] Lint issues ({len(issues)}):")
        for issue in issues:
            print(f"  [{issue['type']}] {issue['file']}: {issue['detail']}")
    else:
        print("[SIM] No lint issues ✅")

    # ── Final summary ─────────────────────────────────────────────────────────
    print(f"\n[SIM] ── Simulation complete ──")
    print(f"[SIM] Temp vault: {tmpvault}")
    print(f"[SIM] Topic: {topic}")
    print(f"[SIM] Raw file: {raw_file_path}")
    print(f"[SIM] Wiki page: {wiki_page_path}")
    print("[SIM] ✅ All steps passed.")


if __name__ == "__main__":
    main()

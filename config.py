# ============================================================
# WikiBot — Central Configuration
# All daemons import from this file. Change values here only.
# ============================================================

# ── Wiki Identity ────────────────────────────────────────────
# The name of the active wiki. Used as the Anki deck namespace
# and as the prefix for all concept IDs: "<WIKI_NAME>/<concept-slug>"
# Single wiki for MVP. Multi-wiki support is a future feature.
WIKI_NAME = "ai"

# ── Paths (derived — do not change unless restructuring) ─────
import os
# Root path of all wiki vaults on this machine.
WIKIS_ROOT = os.path.expanduser("~/Knowledge")
# The Obsidian vault folder is "WikiBot-AI", distinct from the logical WIKI_NAME ("ai")
VAULT_FOLDER = "WikiBot-AI"
WIKI_ROOT    = os.path.join(WIKIS_ROOT, VAULT_FOLDER)
RAW_DIR      = os.path.join(WIKI_ROOT, "raw")
WIKI_DIR     = os.path.join(WIKI_ROOT, "wiki")
META_DIR     = os.path.join(WIKI_DIR, "_meta")
TAXONOMY_FILE = os.path.join(META_DIR, "taxonomy.md")   # single source of truth for topics
QUEUE_DB     = os.path.join(WIKIS_ROOT, ".queue", "tasks.db")

# ── Telegram ─────────────────────────────────────────────────
# Bot token from @BotFather. Keep this secret — use env var in production.
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")

# Your personal Telegram user ID. Bot only responds to this ID.
# Find yours by messaging @userinfobot on Telegram.
TELEGRAM_ALLOWED_USER_ID = int(os.environ.get("TELEGRAM_USER_ID", "0"))

# ── Claude API ───────────────────────────────────────────────
# API key from console.anthropic.com. Keep secret — use env var.
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

# Model to use for all Claude API calls.
# claude-sonnet-4-6 is the recommended balance of quality and cost.
# Upgrade to claude-opus-4-6 if wiki merge quality is poor on complex topics.
CLAUDE_MODEL = "claude-sonnet-4-6"

# Max tokens for Claude responses.
# 8192 handles long wiki page merges comfortably.
# Lower to 4096 if you want to reduce cost on smaller wikis.
CLAUDE_MAX_TOKENS = 8192

# ── Ollama ───────────────────────────────────────────────────
# Local Ollama server URL. Default port is 11434.
OLLAMA_BASE_URL = "http://localhost:11434"

# Model for all local Ollama tasks: classify, clean, summarise, lint.
# qwen2.5:14b is the MVP default — good quality on 32GB RAM MacBook.
# Upgrade to qwen2.5:32b on Mac Mini for better summarisation quality.
OLLAMA_MODEL = "qwen2.5:14b"

# Ollama request timeout in seconds.
# 14b models on first token typically take 10–20s on Apple Silicon.
# Increase to 180 if you see timeout errors on long transcripts.
OLLAMA_TIMEOUT = 120

# ── AnkiConnect ──────────────────────────────────────────────
# AnkiConnect REST API endpoint. Anki must be running with AnkiConnect plugin.
ANKI_CONNECT_URL = "http://localhost:8765"

# Anki deck name for this wiki. Cards are namespaced per wiki.
# Changing this after cards exist will orphan existing cards — don't change lightly.
ANKI_DECK_NAME = f"WikiBot::{WIKI_NAME.upper()}"

# AnkiConnect API version. Do not change unless AnkiConnect upgrades break things.
ANKI_CONNECT_VERSION = 6

# ── Concept ID / Card Naming ─────────────────────────────────
# Card IDs follow the format: "<wiki_name>/<concept-slug>"
# e.g. "ai/dense-sparse-retrieval"
# Slugs are normalised before use: lowercase, hyphens, stop words stripped.
# Add words to this list if you find slug collisions on common terms.
SLUG_STOP_WORDS = {
    "a", "an", "the", "and", "or", "of", "in", "vs",
    "to", "for", "is", "are", "with", "how", "what", "why"
}

# ── Task Queue ───────────────────────────────────────────────
# Maximum number of retries before a task is escalated to the user via Telegram.
QUEUE_MAX_RETRIES = 3

# Backoff delays in seconds between retries. List length must equal QUEUE_MAX_RETRIES.
# Default: 1 min, 5 min, 1 hr. Increase if Claude API rate limits are being hit.
QUEUE_RETRY_BACKOFFS = [60, 300, 3600]

# How often each worker polls the queue for new tasks (seconds).
QUEUE_POLL_INTERVAL = 5

# ── Wiki Updater ─────────────────────────────────────────────
# How often the claude_worker proactively scans for unprocessed /raw/ files.
# This is separate from the queue poll — it catches anything missed by the queue.
# 15 minutes is a good default.
WIKI_UPDATE_POLL_INTERVAL = 900  # 15 minutes

# Maximum word count for a wiki topic page before sub-page splitting is suggested
# during /compile health check. Below this threshold, all content stays in one file.
WIKI_MAX_PAGE_WORDS = 2000

# ── /ask Write-Back ──────────────────────────────────────────
# Minimum word count for an /ask response to be proposed for wiki write-back.
WRITEBACK_MIN_WORDS = 300

# Minimum number of distinct wiki pages referenced in an /ask response
# for it to be proposed for write-back. Ensures synthesis across multiple concepts.
WRITEBACK_MIN_WIKI_REFS = 3

# ── yt-dlp ───────────────────────────────────────────────────
# Retry backoff schedule for yt-dlp download failures (seconds).
# 1 min = transient network error. 1 hr = platform rate limiting.
# 1 day = extended outage (Instagram/TikTok). After all retries: prompt manual upload.
YTDLP_RETRY_BACKOFFS = [60, 3600, 86400]

# ── faster-whisper ───────────────────────────────────────────
# Whisper model size. "large-v2" gives best accuracy on technical content.
# Use "medium" if transcription speed is too slow.
WHISPER_MODEL = "large-v2"

# Device for faster-whisper inference.
# "mps" = Apple Silicon GPU (MacBook/Mac Mini). "cuda" = NVIDIA. "cpu" = fallback.
WHISPER_DEVICE = "mps"

# Compute type for faster-whisper. "float16" is fastest on MPS.
# Use "int8" if you hit memory errors. "float32" for CPU.
WHISPER_COMPUTE_TYPE = "float16"

# ── Taxonomy ─────────────────────────────────────────────────
# Pre-seeded topic slugs for MVP. These map directly to folder names in /raw/.
# Ollama uses taxonomy.md (slug + description + aliases) for classification.
# To add a topic: add a row to taxonomy.md. The folder is created automatically.
# To rename a topic: use /rename <old-slug> <new-slug> bot command.
# Multi-wiki topic sets are a future feature.
TAXONOMY_SEED_TOPICS = [
    "transformers",
    "retrieval-augmented-generation",
    "reinforcement-learning",
    "llm-training",
    "llm-inference",
    "agents",
    "computer-vision",
    "datasets-and-benchmarks",
    "ai-safety",
    "ml-engineering",
]

# ── Logging ──────────────────────────────────────────────────
# Log level for all daemons. "INFO" for production. "DEBUG" to trace queue flow.
LOG_LEVEL = "INFO"

# Log file path. Each daemon appends to this file.
LOG_FILE = os.path.join(WIKIS_ROOT, ".logs", "wikibot.log")

# Maximum log file size in bytes before rotation. 10MB default.
LOG_MAX_BYTES = 10 * 1024 * 1024

# Number of rotated log files to keep.
LOG_BACKUP_COUNT = 5

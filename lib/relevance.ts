/**
 * Pre-filter: is a fetched item actually about AI?
 *
 * Most of our sources (lib/sources.ts) are AI-focused, but some general
 * publications (Simon Willison's blog, HN, general tech RSS) intersperse
 * non-AI posts. We filter at ingest so they never reach Claude.
 *
 * Two pattern groups:
 *  - SHORT tokens (≤3 chars) need word boundaries to avoid matching "AI" inside "main", "hair", etc.
 *  - LONG tokens are matched as substrings (false positives are rare).
 */

const SHORT_AI_TOKENS = ["ai", "ml", "llm", "gpt", "rag"]

const LONG_AI_TOKENS = [
  // Companies / model families
  "anthropic",
  "claude",
  "openai",
  "chatgpt",
  "gemini",
  "deepmind",
  "meta ai",
  "llama",
  "mistral",
  "cohere",
  "huggingface",
  "hugging face",
  "perplexity",
  "grok",
  "xai",
  "stability ai",
  "midjourney",
  "runway",
  // Concepts / engineering
  "machine learning",
  "deep learning",
  "neural network",
  "transformer",
  "embedding",
  "fine-tun",
  "pretrain",
  "multimodal",
  "diffusion model",
  "language model",
  "foundation model",
  "agent",
  "agentic",
  "retrieval augmented",
  "retrieval-augmented",
  "prompt engineer",
  "vector database",
  "vector db",
  "tokeniz",
  "inference",
  "context window",
  "function calling",
  "tool use",
  // Hebrew
  "בינה מלאכותית",
  "מודל שפה",
  "למידת מכונה",
  "למידה עמוקה",
  "רשת נוירונים",
]

const SHORT_PATTERN = new RegExp(`\\b(${SHORT_AI_TOKENS.join("|")})\\b`, "i")

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

const LONG_PATTERN = new RegExp(`(${LONG_AI_TOKENS.map(escapeRegex).join("|")})`, "i")

export function isAIRelated(title: string, content: string): boolean {
  const haystack = `${title}\n${content.slice(0, 1500)}`
  return SHORT_PATTERN.test(haystack) || LONG_PATTERN.test(haystack)
}

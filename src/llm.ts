import OpenAI from "openai";
import { requireEnv } from "./config.js";

// Both agents talk to an LLM through an OpenAI-compatible API:
// Ollama Cloud when OLLAMA_API_KEY is set, otherwise OpenRouter.
const useOllama = Boolean(process.env.OLLAMA_API_KEY?.trim());

export const llm = useOllama
  ? new OpenAI({ apiKey: requireEnv("OLLAMA_API_KEY"), baseURL: "https://ollama.com/v1" })
  : new OpenAI({ apiKey: requireEnv("OPENROUTER_API_KEY"), baseURL: "https://openrouter.ai/api/v1" });

export const LLM_MODEL =
  process.env.LLM_MODEL ?? (useOllama ? "gpt-oss:120b" : "nvidia/nemotron-3-super-120b-a12b:free");
export const LLM_PROVIDER = useOllama ? "Ollama Cloud" : "OpenRouter";

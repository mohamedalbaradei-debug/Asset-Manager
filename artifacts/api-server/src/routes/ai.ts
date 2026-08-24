import { Router, type IRouter, type Request, type Response } from "express";
import { chatWithProvider, freeGroqChat, getFreeQuota, type ChatMessage } from "../lib/groq";

const router: IRouter = Router();

router.get("/ai/status", async (req: Request, res: Response): Promise<void> => {
  res.json({ ...getFreeQuota(req.user), updatedAt: new Date().toISOString() });
});

router.post("/ai/chat", async (req: Request, res: Response): Promise<void> => {
  const body = req.body ?? {};

  const provider = typeof body.provider === "string" ? body.provider : "";
  const apiKey = typeof body.apiKey === "string" ? body.apiKey : "";
  const model = typeof body.model === "string" ? body.model : "";
  const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl : undefined;
  const systemPrompt = typeof body.systemPrompt === "string" ? body.systemPrompt : undefined;
  const messages: ChatMessage[] = Array.isArray(body.messages)
    ? body.messages.filter(
        (m: unknown): m is ChatMessage =>
          typeof m === "object" &&
          m != null &&
          ((m as ChatMessage).role === "user" || (m as ChatMessage).role === "assistant") &&
          typeof (m as ChatMessage).content === "string"
      )
    : [];

  if (messages.length === 0) {
    res.status(400).json({ error: "At least one message is required." });
    return;
  }

  // User-provided key path vs the bot's free AI quota. The key is used only
  // inside the request and is never logged or persisted.
  const usingFree = provider === "free" || !apiKey;
  const reply = usingFree
    ? await freeGroqChat(systemPrompt ?? "You are an expert investment analyst.", messages, req.user)
    : await chatWithProvider({
        provider: provider as "openai" | "anthropic" | "groq" | "deepseek" | "custom" | "gemini",
        apiKey,
        model,
        baseUrl,
        systemPrompt,
        messages,
      });

  if (reply.ok) {
    res.json({ ok: true, content: reply.content });
  } else {
    res.status(502).json({ ok: false, error: reply.error ?? "AI chat failed." });
  }
});

export default router;
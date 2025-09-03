// server/routes/chat.js
const express = require("express");
const router = express.Router();

const openai = require("../../adapters/openai");
const anthropic = require("../../adapters/anthropic");
const MODEL_CFG = require("../config/models");

// Map providers to their adapters
const ADAPTERS = {
  openai,
  anthropic,
};

// Helper: validate provider & model; return { providerKey, model }
function resolveProviderAndModel({ provider = "openai", model }) {
  const cfg = MODEL_CFG[provider];
  if (!cfg) {
    const known = Object.keys(MODEL_CFG);
    const msg = `Unknown provider '${provider}'. Known providers: ${known.join(", ")}`;
    return { error: msg };
  }

  // If a model is provided, ensure it's allowed; otherwise use default
  let resolvedModel = model || cfg.defaultModel;
  if (!cfg.models.includes(resolvedModel)) {
    const msg = `Invalid model '${resolvedModel}' for provider '${provider}'. Allowed: ${cfg.models.join(", ")}`;
    return { error: msg };
  }

  return { providerKey: provider, model: resolvedModel };
}

/**
 * POST /api/chat
 * body: {
 *   provider: 'openai' | 'anthropic',
 *   model?: string,                 // must be in MODEL_CFG[provider].models
 *   messages: [{role, content}],    // OpenAI-style
 *   stream?: boolean                // SSE stream if true
 * }
 */
router.post("/", async (req, res) => {
  try {
    const { provider: reqProvider, model: reqModel, messages, stream = false } = req.body || {};

    // Basic validation
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages[] required" });
    }

    const { error, providerKey, model } = resolveProviderAndModel({
      provider: reqProvider,
      model: reqModel,
    });
    if (error) return res.status(400).json({ error });

    const adapter = ADAPTERS[providerKey];
    if (!adapter?.chat) {
      return res.status(500).json({ error: `Adapter missing for provider '${providerKey}'` });
    }

    // STREAMING via SSE
    if (stream) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const iterator = await adapter.chat({
        model,
        messages,
        stream: true,
      });

      try {
        for await (const chunk of iterator) {
          let textDelta = "";

          // OpenAI: { choices[{delta:{content}}] }
          if (chunk?.choices?.length) {
            const d = chunk.choices[0].delta;
            if (typeof d?.content === "string") textDelta = d.content;
          }

          // Anthropic: { type: 'content_block_delta', delta: { text } }
          if (!textDelta && chunk?.type === "content_block_delta" && chunk?.delta?.text) {
            textDelta = chunk.delta.text;
          }

          if (textDelta) {
            res.write(`event: token\ndata: ${JSON.stringify({ text: textDelta })}\n\n`);
          }
        }
      } catch (err) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
      } finally {
        res.write(`event: done\ndata: {}\n\n`);
        res.end();
      }
      return;
    }

    // NON-STREAM
    const out = await adapter.chat({
      model,
      messages,
      stream: false,
    });

    return res.json({ provider: providerKey, model, text: out.text });
  } catch (err) {
    console.error("POST /api/chat error:", err);
    return res.status(500).json({ error: "chat_failed", message: err.message });
  }
});

module.exports = router;

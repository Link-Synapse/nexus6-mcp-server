// server/config/models.js
// Single source of truth for provider model lists & defaults.
// Keep this file updated if you add/remove models.

module.exports = {
  openai: {
    defaultModel: "gpt-4o-mini",
    models: [
      "gpt-4o-mini",
      "gpt-4o",
      "gpt-4.1-mini",
      // add more as desired
    ],
  },

  anthropic: {
    // Working, dated Anthropic model ID you already tested:
    defaultModel: "claude-3-7-sonnet-20250219",
    models: [
      "claude-3-7-sonnet-20250219",
      // If your account has access, you can add:
      // "claude-sonnet-4-20250514",
      // "claude-3-5-haiku-20241022", etc.
    ],
  },
};

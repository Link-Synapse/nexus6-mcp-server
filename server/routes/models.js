// server/routes/models.js
const express = require("express");
const router = express.Router();
const MODEL_CFG = require("../config/models");

/**
 * GET /api/models
 * Returns all providers with their allowed models and defaults.
 */
router.get("/", (_req, res) => {
  res.json(MODEL_CFG);
});

/**
 * GET /api/models/:provider
 * Returns models for a single provider.
 */
router.get("/:provider", (req, res) => {
  const { provider } = req.params || {};
  const cfg = MODEL_CFG[provider];
  if (!cfg) {
    return res.status(404).json({
      error: `Unknown provider '${provider}'`,
      knownProviders: Object.keys(MODEL_CFG),
    });
  }
  res.json(cfg);
});

module.exports = router;

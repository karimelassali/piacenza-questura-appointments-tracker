const OpenAI = require("openai");
const fs = require("fs/promises");
const path = require("path");

const config = require("../config");
const logger = require("../utils/logger");
const prompts = require("./prompts");

class AIVerifier {
  constructor() {
    this.client = new OpenAI({
      apiKey: config.ai.apiKey,
      baseURL: config.ai.apiUrl, // https://integrate.api.nvidia.com/v1
    });
  }

  async verify(screenshotPath, domData) {
    if (!config.ai.enabled) {
      logger.info("AI disabled, skipping verification.");
      return null;
    }

    try {
      logger.info(
        `[AI Diagnostic] Starting verification with ${config.ai.modelName}...`
      );

      const prompt = prompts.VERIFIER_PROMPT
        .replace("{domText}", (domData.text || "").substring(0, 3000))
        .replace("{dates}", JSON.stringify(domData.dates || []))
        .replace("{slots}", JSON.stringify(domData.slots || []));

      logger.info("[AI Prompt Preview]: " + prompt.substring(0, 500));

      const startTime = Date.now();

      // TEXT-ONLY request for GLM with streaming and thinking support
      const fetch = require('node-fetch');
      
      const payload = {
        model: config.ai.modelName,
        messages: [
          {
            role: "system",
            content: "You are a strict booking appointment verifier. Return ONLY valid JSON. No markdown. No explanations."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0,
        top_p: 1,
        max_tokens: 2000,
        stream: true
      };

      const apiUrl = config.ai.apiUrl.endsWith('/chat/completions') 
        ? config.ai.apiUrl 
        : `${config.ai.apiUrl}/chat/completions`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.ai.apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${await response.text()}`);
      }

      let raw = "";
      logger.info("[AI Reasoning]:");
      
      // Parse SSE stream
      let buffer = "";
      for await (const chunk of response.body) {
        buffer += chunk.toString();
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const data = JSON.parse(line.slice(6));
              const delta = data.choices[0]?.delta || {};
              
              if (delta.reasoning_content) {
                process.stdout.write(`\x1b[90m${delta.reasoning_content}\x1b[0m`);
              }
              if (delta.content) {
                raw += delta.content;
              }
            } catch (e) {
              // ignore parse errors for partial chunks
            }
          }
        }
      }
      console.log("\n");


      logger.info(
        "[AI Raw Content]: " + JSON.stringify(raw)
      );

      if (!raw.trim()) {
        throw new Error("AI returned empty content");
      }

      const cleaned = raw
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();

      const jsonText = this.extractJson(cleaned);

      if (!jsonText) {
        throw new Error(
          `No valid JSON found in response. Raw: ${cleaned}`
        );
      }

      let aiResponse;

      try {
        aiResponse = JSON.parse(jsonText);
      } catch (err) {
        logger.error("[AI JSON Parse Error]", {
          message: err.message,
          jsonText,
        });

        throw err;
      }

      await this.saveDebugArtifacts(
        screenshotPath,
        {
          prompt,
          rawResponse: raw,
          cleanedResponse: cleaned,
          model: config.ai.modelName,
        },
        aiResponse
      );

      logger.info("[AI Verification Completed]", {
        status: aiResponse.status,
        confidence: aiResponse.confidence,
      });

      return aiResponse;
    } catch (error) {
      logger.error("[AI Diagnostic] ERROR:", {
        message: error.message,
        stack: error.stack,
      });

      return {
        status: "fallback",
        confidence: 0,
        reason: error.message,
      };
    }
  }

  extractJson(text) {
    const match = text.match(/\{[\s\S]*\}/);

    if (!match) return null;

    return match[0];
  }

  async saveDebugArtifacts(screenshotPath, payload, response) {
    try {
      const timestamp = Date.now();

      const debugDir = path.resolve(
        config.storage.debugDir,
        `${timestamp}`
      );

      await fs.mkdir(debugDir, { recursive: true });

      await fs.writeFile(
        path.join(debugDir, "ai_payload.json"),
        JSON.stringify(payload, null, 2)
      );

      await fs.writeFile(
        path.join(debugDir, "ai_response.json"),
        JSON.stringify(response, null, 2)
      );

      if (screenshotPath) {
        await fs.copyFile(
          screenshotPath,
          path.join(debugDir, "screenshot.png")
        );
      }

      logger.info(
        `[AI Debug] Saved artifacts to ${debugDir}`
      );
    } catch (err) {
      logger.error("[AI Debug Save Error]", {
        message: err.message,
      });
    }
  }
}

module.exports = new AIVerifier();
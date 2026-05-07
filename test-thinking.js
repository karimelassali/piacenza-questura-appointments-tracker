require("dotenv").config();
const OpenAI = require("openai");

async function test() {
  const client = new OpenAI({
    apiKey: "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",
    baseURL: process.env.AI_API_URL,
  });

  console.log("Model: z-ai/glm4.7");

  try {
    const completion = await client.chat.completions.create({
      model: "google/gemma-4-31b-it",
      messages: [{ role: "user", content: "Hello, reply with JSON only. {'status':'ok'}" }],
      extra_body: {
        chat_template_kwargs: { enable_thinking: true, clear_thinking: false }
      }
    });
    console.log("Response:", JSON.stringify(completion, null, 2));
  } catch (error) {
    console.error("Error:", error);
  }
}

test();

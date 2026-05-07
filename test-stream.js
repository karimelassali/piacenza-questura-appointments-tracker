require("dotenv").config();
const OpenAI = require("openai");

async function test() {
  const client = new OpenAI({
    apiKey: process.env.AI_API_KEY,
    baseURL: process.env.AI_API_URL,
  });

  try {
    const completion = await client.chat.completions.create({
      model: "z-ai/glm4.7", // Let's test if this model works with streaming
      messages: [{ role: "user", content: "Write a short JSON object: {'status':'ok'}" }],
      temperature: 1,
      top_p: 1,
      max_tokens: 16384,
      stream: true,
      extra_body: {
        chat_template_kwargs: { enable_thinking: true, clear_thinking: false }
      }
    });

    let content = "";
    let reasoning = "";

    for await (const chunk of completion) {
      if (!chunk.choices || chunk.choices.length === 0) continue;
      const delta = chunk.choices[0].delta;
      
      if (delta.reasoning_content) {
        reasoning += delta.reasoning_content;
        process.stdout.write(`\x1b[90m${delta.reasoning_content}\x1b[0m`);
      }
      if (delta.content) {
        content += delta.content;
        process.stdout.write(delta.content);
      }
    }
    console.log("\n\nFinal Content:", content);
  } catch (error) {
    console.error("Error:", error);
  }
}

test();

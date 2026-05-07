const fetch = require('node-fetch');

async function test() {
  const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": "Bearer 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",
      "Content-Type": "application/json",
      "Accept": "text/event-stream"
    },
    body: JSON.stringify({
      model: "z-ai/glm4.7",
      messages: [{"role":"user","content":"Hello"}],
      temperature: 1,
      top_p: 1,
      max_tokens: 1024,
      stream: true,
      chat_template_kwargs: {"enable_thinking":true,"clear_thinking":false}
    })
  });

  if (!response.ok) {
    console.log("Status:", response.status);
    console.log("Body:", await response.text());
  } else {
    console.log("Success");
  }
}

test();

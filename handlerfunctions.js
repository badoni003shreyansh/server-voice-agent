import { GoogleGenerativeAI } from "@google/generative-ai";
import { sanitizeMessageHistory } from "./functions.js";
import { Groq } from "groq-sdk";
import { greetings } from "./greetings_voice_bot.js"; // Import greetings directly

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

export async function handleShoppingQuery(transcript, messageHistory = []) {
  if (!transcript || typeof transcript !== "string") {
    throw new Error("Invalid transcript parameter");
  }

  const sanitizedHistory = sanitizeMessageHistory(messageHistory);

  // Prepare the prompt for Gemini
  const prompt = `You are a smart shopping assistant. Based on the user's request, analyze their message and respond appropriately with helpful shopping guidance.

User's message: ${transcript}

Previous conversation context:
${JSON.stringify(sanitizedHistory, null, 2)}

Response Requirements:
- Provide practical, actionable advice based on the user's request
- Keep messages concise but helpful (2-4 sentences typically)
- Focus on general shopping tips, product categories, or broad recommendations
- Avoid specific product mentions unless the user has already specified a product type
- If the user asks for help deciding between broad categories, provide guidance on how to choose
- If the user asks about deals, promotions, or general shopping tips, provide relevant advice
- If the user asks "what should I buy for..." without specifics, suggest general categories or considerations

Respond with ONLY a JSON-formatted message containing your shopping advice in the following format:
{
  "message": "your helpful shopping advice here"
}`;

  try {
    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    // Parse the response (Gemini might return text that needs to be extracted as JSON)
    let parsed;
    try {
      // Try to parse directly if it's JSON
      parsed = JSON.parse(text);
    } catch (e) {
      // If not JSON, extract the JSON part from the response
      const jsonMatch = text.match(/\{.*\}/s);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        // If no JSON found, wrap the entire response as a message
        parsed = { message: text };
      }
    }

    if (!parsed.message) {
      throw new Error("No message found in response");
    }
    return parsed;
  } catch (error) {
    console.error("Error in handleShoppingQuery with Gemini:", error);

    // Fallback responses (same as before)
    if (
      transcript.toLowerCase().includes("gift") ||
      transcript.toLowerCase().includes("present")
    ) {
      return {
        message:
          "For gifts, consider the recipient's interests and hobbies. Popular options include books, personalized items, experience gifts, or subscription services. Think about what would make them happy or solve a problem they have.",
      };
    } else if (
      transcript.toLowerCase().includes("deal") ||
      transcript.toLowerCase().includes("sale")
    ) {
      return {
        message:
          "To find the best deals, check weekly ads, sign up for store newsletters, and look for clearance sections both in-store and online. Many stores offer price matching if you find a better deal elsewhere.",
      };
    } else if (
      transcript.toLowerCase().includes("choose") ||
      transcript.toLowerCase().includes("decide")
    ) {
      return {
        message:
          "When deciding between options, consider your budget, how often you'll use the item, and any specific features you need. Reading reviews and comparing specifications can help you make an informed decision.",
      };
    }

    // Generic fallback if no specific patterns matched
    return {
      message:
        "I'd be happy to help with your shopping question. Could you provide a few more details about what you're looking for? For example, are you shopping for a specific occasion or type of product?",
    };
  }
}

export async function handleShoppingIntent(transcript, messageHistory = []) {
  if (!transcript || typeof transcript !== "string") {
    throw new Error("Invalid transcript parameter");
  }

  const sanitizedHistory = sanitizeMessageHistory(messageHistory);

  const messages = [
    {
      role: "system",
      content: `You are a smart shopping assistant. Based on the user's request, extract the main product they're looking for and respond with ONLY a JSON object containing the search query. 
      
      Example:
{
  "searchQuery": "wireless bluetooth headphones",
  "category": "electronics"
}
  If the user is unsure on what to buy, suggest a general category or product type.
  Example 1: {
  "searchQuery": "home decor items",
  "category": "home decor"
  }
  Example 2: {
  "searchQuery": "birthday party supplies",
  "category": "party supplies"
  } 
  example 3: {
  "searchQuery": "electronics",
  "category": "electronics"
  }

For birthday party requests, suggest appropriate party supplies, decorations, or gifts.
Keep the search query simple and focused on the main product type.
IMPORTANT: Your response must be valid JSON format only, no additional text.`,
    },
    ...sanitizedHistory,
    {
      role: "user",
      content: transcript,
    },
  ];

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages,
      model: "llama-3.3-70b-versatile",
      temperature: 0.3,
      max_tokens: 256,
      response_format: { type: "json_object" },
      stream: false,
    });

    const response = chatCompletion.choices[0]?.message?.content;
    if (!response?.trim()) {
      throw new Error("Empty response from Groq API");
    }

    try {
      const parsed = JSON.parse(response);
      if (!parsed.searchQuery) {
        throw new Error("No search query found in response");
      }
      return parsed;
    } catch (parseError) {
      console.error("JSON parsing error:", parseError);
      if (
        transcript.toLowerCase().includes("birthday") ||
        transcript.toLowerCase().includes("party")
      ) {
        return {
          searchQuery: "birthday party supplies",
          category: "party supplies",
        };
      }
      throw new Error(`Failed to parse Groq response: ${parseError.message}`);
    }
  } catch (error) {
    console.error("Groq API error:", error);
    throw new Error(`Groq API failed: ${error.message}`);
  }
}

function getRandomIndex(max) {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return array[0] % max;
}

export async function handleGreetingIntent() {
  const response = greetings[getRandomIndex(greetings.length)];
  return {
    intent: "greeting",
    message: response,
    timestamp: new Date().toISOString(),
  };
}

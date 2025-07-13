import "dotenv/config";
import { Groq } from "groq-sdk";
import { clarifications } from "./greetings_voice_bot.js";
import {
  handleShoppingQuery,
  handleShoppingIntent,
  handleGreetingIntent,
} from "./handlerfunctions.js";
import { GoogleGenerativeAI } from "@google/generative-ai";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const googleModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// Helper function to ensure message content is always a string
export function sanitizeMessageHistory(messageHistory) {
  if (!Array.isArray(messageHistory)) {
    return [];
  }

  return messageHistory.map((message) => ({
    role: message.role || "user",
    content:
      typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content),
  }));
}

// Function to determine user intent
async function determineIntent(transcript, messageHistory = []) {
  if (!transcript || typeof transcript !== "string") {
    throw new Error("Invalid transcript parameter");
  }

  const sanitizedHistory = sanitizeMessageHistory(messageHistory);

  const messages = [
    {
      role: "system",
      content: `You are a smart intent detection assistant. Analyze the user's message and determine their primary intent.
Analyze the user's message and determine their primary intent. Respond with ONLY a JSON object containing:
"intent": Either "greeting", "shopping", or "general_shopping"
"confidence": A confidence score between 0 and 1
Intent Definitions:
"greeting"
Use for messages that are:

Simple greetings (hello, hi, good morning, etc.)
Social pleasantries (how are you, thank you, goodbye)
General conversation starters without product focus
Questions about store hours, location, or contact information
Complaints or feedback not related to specific products
Small talk or chitchat
Requests for human assistance or customer service

"shopping"
Use for messages that are:

Product inquiries or questions about specific items
Requests for product recommendations or suggestions
Price comparisons or budget-related product questions
Questions about product availability, stock, or features
Purchase-related queries (shipping, returns, warranties)
Product troubleshooting or usage questions
Requests to find products matching specific criteria
Comparisons between different products or brands

"general_shopping"
Use for messages that are:

Broad shopping inquiries without specific products mentioned
General questions about shopping processes or policies
Requests for shopping advice or general guidance
Questions about categories of products rather than specific items
General browsing or exploration queries ("What do you sell?")
Non-specific shopping-related help requests
General questions about deals, promotions, or sales
Broad questions about product types or categories

Confidence Scoring Guidelines:

0.9-1.0: Crystal clear intent with unambiguous keywords
0.7-0.8: Strong indicators present but some ambiguity
0.5-0.6: Mixed signals or unclear context
0.3-0.4: Weak indicators, mostly guessing
0.1-0.2: Very unclear, almost random classification

Edge Cases:

"Hi, do you have wireless headphones?" → Should be "shopping" (greeting + specific product mention, but product is main focus)
"Hello, can you help me?" → Should be "greeting" (help request without product context)
"Can you tell me your store hours?" → Should be "greeting" (store info, not product)
"Thanks, also do you sell birthday decorations?" → Should be "shopping" (pleasantry + specific product request, product is main focus)
"I'm looking for a gift, but also wanted to say hi!" → Should be "general_shopping" (mixed, but general shopping help is primary request)
"What kind of products do you sell?" → Should be "general_shopping" (broad shopping inquiry)
"Do you have any sales going on?" → Should be "general_shopping" (general promotion inquiry)
"I need help finding the right laptop for gaming" → Should be "shopping" (specific product category with criteria)

Classification Rules:

If the intent of the user is to buy a product or inquire about a specific product: classify as "shopping" with high confidence
If the intent is to browse or ask general shopping questions without specific products: classify as "general_shopping" with high confidence
If the intent is to greet or engage socially without product context: classify as "greeting" with high confidence
If the intent is a mix of greeting and product inquiry, classify based on the main focus:

If the greeting is secondary and product inquiry is primary: classify as "shopping" with high confidence
If the greeting is primary and product inquiry is secondary: classify as "greeting" with high confidence


If the intent is about store information or customer service without product context: classify as "greeting" with high confidence
If the intent is unclear or mixed: classify as "unclear" with a confidence score below 0.5 and provide a clarification question

Key Distinction - Intent to Shop vs. Intent to Ask Query:

"shopping" = Clear intention to purchase, buy, or get specific product information for potential purchase
"general_shopping" = Information-seeking about shopping in general, browsing, or asking questions about shopping processes without specific purchase intent

If the intent is unclear or mixed, classify as "unclear" with a confidence score below 0.5 and provide a clarification question.
Example Responses:
json{"intent": "greeting", "confidence": 0.95}
{"intent": "shopping", "confidence": 0.87}
{"intent": "general_shopping", "confidence": 0.75}
{"intent": "unclear", "confidence": 0.4, "clarification": "Are you looking for product help or just saying hello?"}
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
      model: "llama3-8b-8192",
      temperature: 0.2,
      max_tokens: 100,
      response_format: { type: "json_object" },
      stream: false,
    });

    const response = chatCompletion.choices[0]?.message?.content;
    if (!response) {
      throw new Error("Empty response from Groq API");
    }

    const parsed = JSON.parse(response);
    if (
      !parsed.intent ||
      (parsed.intent !== "greeting" &&
        parsed.intent !== "shopping" &&
        parsed.intent !== "unclear" &&
        parsed.intent !== "general_shopping")
    ) {
      throw new Error("Invalid intent received");
    }

    return parsed;
  } catch (error) {
    console.error("Intent detection error:", error);
    return { intent: "genral_shopping", confidence: 0.8 };
  }
}

async function searchProducts(query) {
  if (!query || typeof query !== "string") {
    throw new Error("Invalid query parameter");
  }

  if (!process.env.RAPIDAPI_KEY) {
    throw new Error("Missing RapidAPI key");
  }

  const searchUrl = `https://real-time-amazon-data.p.rapidapi.com/search?query=${encodeURIComponent(
    query
  )}&page=1&country=US&sort_by=RELEVANCE&product_condition=ALL`;

  try {
    const response = await fetch(searchUrl, {
      method: "GET",
      headers: {
        "x-rapidapi-key": process.env.RAPIDAPI_KEY,
        "x-rapidapi-host": "real-time-amazon-data.p.rapidapi.com",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    if (data?.data?.products && Array.isArray(data.data.products)) {
      return data.data.products;
    }

    throw new Error("No products found in API response");
  } catch (err) {
    console.error("Error fetching products:", err);
    throw new Error(`Failed to fetch products: ${err.message}`);
  }
}

async function rankProducts(products, userQuery) {
  if (!products || !Array.isArray(products)) {
    throw new Error("Invalid products data structure");
  }

  if (products.length === 0) {
    throw new Error("No products available");
  }

  // Take first 3 products and format them consistently
  const topProducts = products.slice(0, 3).map((product, index) => {
    // Extract title/name
    const title = product.product_title || "N/A";

    // Extract price
    const price = product.product_price || "N/A";

    // Extract image
    const image = product.product_photo || "N/A";

    // Extract product link
    const link =
      product.product_url ||
      `https://www.amazon.com/s?k=${encodeURIComponent(title)}`;

    // Extract shipping info
    const shipping = product.delivery || "N/A";

    // Extract rating if available
    const rating = product.product_star_rating
      ? `${product.product_star_rating}/5 (${
          product.product_num_ratings || 0
        } reviews)`
      : "Not rated";

    return {
      rank: index + 1,
      title,
      price,
      link,
      image,
      shipping,
      rating,
      reason: "Top matching results",
    };
  });

  return topProducts;
}

export async function getMessageFromAgent(transcript, messageHistory = []) {
  try {
    if (!transcript || typeof transcript !== "string") {
      return {
        error: "Invalid input",
        message: "Please provide a valid product request.",
      };
    }

    console.log("Step 1: Determining user intent...");
    let intentResult;
    try {
      intentResult = await determineIntent(transcript, messageHistory);
    } catch (error) {
      console.error("Intent detection failed:", error);
      return {
        error: "Failed to understand request",
        message: "Could you please clarify your request?",
        details: error.message,
      };
    }

    console.log("Intent detected:", intentResult.intent);

    if (intentResult.intent === "greeting") {
      try {
        return await handleGreetingIntent();
      } catch (error) {
        console.error("Greeting handler failed:", error);
        return {
          intent: "greeting",
          message: "Hello! How can I assist you today?",
          error: error.message,
        };
      }
    } else if (intentResult.intent === "shopping") {
      console.log("Step 2: Getting search query from user input...");
      let searchResult;
      try {
        searchResult = await handleShoppingIntent(transcript, messageHistory);
      } catch (error) {
        console.error("Search query extraction failed:", error);
        return {
          error: "Failed to understand product request",
          message: "Could you please clarify what product you're looking for?",
          details: error.message,
        };
      }

      const searchQuery = searchResult.searchQuery;
      console.log("Search query extracted:", searchQuery);

      console.log("Step 3: Fetching products from API...");
      let productResults;
      try {
        productResults = await searchProducts(searchQuery);
      } catch (error) {
        console.error(" API failed:", error);
        return {
          error: "Failed to fetch products",
          message:
            "Sorry, I couldn't search for products right now. Please try again later.",
          details: error.message,
        };
      }

      console.log("Step 4: Ranking products...");
      let topProducts;
      try {
        topProducts = await rankProducts(productResults, transcript);
      } catch (error) {
        console.error("Product ranking failed:", error);
        return {
          error: "Failed to rank products",
          message:
            "I found some products but couldn't rank them properly. Please try again.",
          details: error.message,
        };
      }

      if (!topProducts || topProducts.length === 0) {
        return {
          error: "No suitable products found",
          message:
            "I couldn't find any suitable products for your request. Try being more specific.",
        };
      }

      return {
        intent: "shopping",
        success: true,
        query: searchQuery,
        recommendations: topProducts,
        message: `Here are my top ${topProducts.length} recommendations for "${searchQuery}":`,
      };
    } else if (intentResult.intent === "unclear") {
      return {
        intent: "unclear",
        message: clarifications[getRandomIndex(clarifications.length)],
        requiresClarification: true,
        clarification:
          intentResult.clarification || "Could you clarify your request?",
      };
    } else if (intentResult.intent === "general_shopping") {
      console.log("Step 2: Handling general shopping queries...");
      let generalShoppingQuery;
      try {
        generalShoppingQuery = await handleShoppingQuery(
          transcript,
          messageHistory
        );
        return {
          intent: "general_shopping",
          success: true,
          message: generalShoppingQuery.message,
        };
      } catch (error) {
        console.error("General shopping query handling failed:", error);
        return {
          error: "Failed to understand general shopping request",
          message: "Could you please clarify what you're looking for?",
          details: error.message,
        };
      }
    }
  } catch (error) {
    console.error("Error in getmessagefromGroq:", error);
    return {
      error: "System error",
      message: "Sorry, something went wrong. Please try again.",
      details: error.message,
    };
  }
}

export async function getProductRecommendationsAPI(req, res) {
  try {
    if (!req.body) {
      return res.status(400).json({
        error: "Missing request body",
        message: "Please provide query and messageHistory in request body",
      });
    }

    const { query, messageHistory = [] } = req.body;

    if (!query) {
      return res.status(400).json({
        error: "Missing query parameter",
        message: "Please provide a query parameter",
      });
    }

    const result = await getMessageFromAgent(query, messageHistory);
    res.json(result);
  } catch (error) {
    console.error("API error:", error);
    res.status(500).json({
      error: "Internal server error",
      message: "Failed to process request",
      details: error.message,
    });
  }
}

// Customer Support functions

export async function processSupportTextWithGemini(
  problemDescription,
  messageHistory = []
) {
  if (!problemDescription || typeof problemDescription !== "string") {
    throw new Error("Invalid problem description");
  }

  const sanitizedHistory = sanitizeMessageHistory(messageHistory);

  try {
    const prompt = `You are a customer support assistant. Analyze the user's problem description and provide helpful support guidance.
    
User's problem: ${problemDescription}

Previous conversation context:
${JSON.stringify(sanitizedHistory, null, 2)}

Response Requirements:
- Provide clear, step-by-step solutions when possible
- Be empathetic and professional
- If the problem requires specific technical support, say so
- For account issues, suggest standard troubleshooting steps
- For product issues, suggest common solutions
- If unclear, ask for more details

Respond with ONLY a JSON object containing:
{
  "response": "your support response",
  "requiresHuman": boolean,
  "nextSteps": ["array", "of", "suggested", "actions"]
}`;

    const result = await googleModel.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    // Parse the response
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      const jsonMatch = text.match(/\{.*\}/s);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        parsed = {
          response: text,
          requiresHuman: true,
          nextSteps: ["Please provide more details about your issue"],
        };
      }
    }

    if (!parsed.response) {
      throw new Error("No response found in Gemini output");
    }

    return {
      success: true,
      ...parsed,
    };
  } catch (error) {
    console.error("Gemini support text processing error:", error);
    throw new Error(`Failed to process support text: ${error.message}`);
  }
}

//image customer support
export async function processSupportImageWithGroq(
  imageBase64,
  problemContext = ""
) {
  if (!imageBase64 || typeof imageBase64 !== "string") {
    throw new Error("Invalid image data");
  }

  try {
    const query = `Analyze the provided image along with any context and help diagnose the problem.
    
Context from user: ${problemContext || "No additional context provided"}

CRITICAL !!!: Return the result in JSON format with this exact structure:
{
  "description": "your description of what you see in the image",
  "issues": ["array", "of", "identified", "issues"],
  "suggestions": ["array", "of", "suggested", "solutions"]
}

If unable to understand the image, return:
{
  "description": "Image not processed",
  "issues": [],
  "suggestions": []
}

Respond ONLY with the JSON object. Use double quotes for all keys and values.`;

    const messages = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: query,
          },
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${imageBase64}`,
            },
          },
        ],
      },
    ];

    const chatCompletion = await groq.chat.completions.create({
      messages,
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      temperature: 0.3,
      max_tokens: 1024,
      response_format: { type: "json_object" },
    });

    const response = chatCompletion.choices[0]?.message?.content;
    if (!response) {
      throw new Error("Empty response from Groq API");
    }

    let parsed;
    try {
      parsed = JSON.parse(response);
    } catch (e) {
      // Fallback response if JSON parsing fails
      parsed = {
        description: "Image not processed",
        issues: [],
        suggestions: [],
      };
    }

    // Ensure required fields exist
    if (
      !parsed.description ||
      !Array.isArray(parsed.issues) ||
      !Array.isArray(parsed.suggestions)
    ) {
      parsed = {
        description: "Invalid response format",
        issues: [],
        suggestions: [],
      };
    }

    return {
      success: true,
      ...parsed,
    };
  } catch (error) {
    console.error("Groq image processing error:", error);
    // Return a standardized error response
    return {
      success: false,
      description: "Failed to process image",
      issues: [],
      suggestions: [],
      error: error.message,
    };
  }
}

//rank product recommendations function
async function rankProductRecommendations(products, userQuery) {
  if (!products || !Array.isArray(products)) {
    throw new Error("Invalid products data structure");
  }

  if (products.length === 0) {
    throw new Error("No products available");
  }

  // Take first 3 products and format them consistently
  const topProducts = products.slice(0, 5).map((product, index) => {
    // Extract title/name
    const title = product.product_title || "N/A";

    // Extract price
    const price = product.product_price || "N/A";

    // Extract image
    const image = product.product_photo || "N/A";

    // Extract product link
    const link =
      product.product_url ||
      `https://www.amazon.com/s?k=${encodeURIComponent(title)}`;

    // Extract shipping info
    const shipping = product.delivery || "N/A";

    // Extract rating if available
    const rating = product.product_star_rating
      ? `${product.product_star_rating}/5 (${
          product.product_num_ratings || 0
        } reviews)`
      : "Not rated";

    return {
      rank: index + 1,
      title,
      price,
      link,
      image,
      shipping,
      rating,
      reason: "Top matching results",
    };
  });

  return topProducts;
}
//product recommendations function
export async function getShoppingRecommendations(
  transcript,
  messageHistory = []
) {
  try {
    if (!transcript || typeof transcript !== "string") {
      return {
        error: "Invalid input",
        message: "Please provide a valid product request.",
      };
    }

    console.log("Step 1: Getting search query from user input...");
    let searchResult;
    try {
      searchResult = await handleShoppingIntent(transcript, messageHistory);
    } catch (error) {
      console.error("Search query extraction failed:", error);
      return {
        error: "Failed to understand product request",
        message: "Could you please clarify what product you're looking for?",
        details: error.message,
      };
    }

    const searchQuery = searchResult.searchQuery;
    console.log("Search query extracted:", searchQuery);

    console.log("Step 2: Fetching products from API...");
    let productResults;
    try {
      productResults = await searchProducts(searchQuery);
    } catch (error) {
      console.error(" API failed:", error);
      return {
        error: "Failed to fetch products",
        message:
          "Sorry, I couldn't search for products right now. Please try again later.",
        details: error.message,
      };
    }

    console.log("Step 3: Ranking products...");
    let topProducts;
    try {
      topProducts = await rankProductRecommendations(
        productResults,
        transcript
      );
    } catch (error) {
      console.error("Product ranking failed:", error);
      return {
        error: "Failed to rank products",
        message:
          "I found some products but couldn't rank them properly. Please try again.",
        details: error.message,
      };
    }

    if (!topProducts || topProducts.length === 0) {
      return {
        error: "No suitable products found",
        message:
          "I couldn't find any suitable products for your request. Try being more specific.",
      };
    }

    return {
      intent: "shopping",
      success: true,
      query: searchQuery,
      recommendations: topProducts,
      message: `Here are my top ${topProducts.length} recommendations for "${searchQuery}":`,
    };
  } catch (error) {
    console.error("Error in getmessagefromGroq:", error);
    return {
      error: "System error",
      message: "Sorry, something went wrong. Please try again.",
      details: error.message,
    };
  }
}

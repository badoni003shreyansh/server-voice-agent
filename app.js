import express from "express";
import cors from "cors";
import {
  getMessageFromAgent,
  processSupportTextWithGemini,
  processSupportImageWithGroq,
} from "./functions.js";

const app = express();
const port = process.env.PORT || 5001;

// Middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cors());

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    error: "Internal server error",
    message: "Something went wrong processing your request",
  });
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    port: port,
  });
});

// Main endpoint for chat interactions
app.post("/chat", async (req, res) => {
  try {
    // Validate request body
    if (!req.body) {
      return res.status(400).json({
        error: "Missing request body",
        message: "Please provide transcript and messageHistory in request body",
      });
    }

    const { transcript, messageHistory = [] } = req.body;

    // Validate transcript
    if (!transcript) {
      return res.status(400).json({
        error: "Missing transcript",
        message: "Please provide a transcript parameter",
      });
    }

    if (typeof transcript !== "string") {
      return res.status(400).json({
        error: "Invalid transcript format",
        message: "Transcript must be a string",
      });
    }

    // Validate messageHistory
    if (!Array.isArray(messageHistory)) {
      return res.status(400).json({
        error: "Invalid messageHistory format",
        message: "MessageHistory must be an array",
      });
    }

    console.log(`Received transcript: ${transcript}`);
    console.log(`Message history length: ${messageHistory.length}`);

    // Get response from Groq
    const response = await getMessageFromAgent(transcript, messageHistory);
    console.log("Response from Groq:", response);

    // Handle error responses
    if (response.error) {
      return res.status(400).json({
        error: response.error,
        message: response.message,
        details: response.details || null,
      });
    }

    // Success response
    res.status(200).json({
      success: true,
      intent: response.intent,
      message: response.message,
      data: response.recommendations || null,
      query: response.query || null,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Chat endpoint error:", error);
    res.status(500).json({
      error: "Server error",
      message: "Failed to process your request",
      details: error.message,
    });
  }
});

// Product search endpoint using new API
app.get("/search-products", async (req, res) => {
  try {
    const query = req.query.q;

    // Validate query parameter
    if (!query) {
      return res.status(400).json({
        error: "Missing query parameter",
        message: "Please provide a 'q' query parameter",
      });
    }

    if (typeof query !== "string") {
      return res.status(400).json({
        error: "Invalid query parameter",
        message: "Query parameter must be a string",
      });
    }

    // Check for required environment variables
    if (!process.env.RAPIDAPI_KEY) {
      console.error("Missing required environment variables");
      return res.status(500).json({
        error: "Configuration error",
        message: "Server configuration is incomplete",
      });
    }

    const searchUrl = `https://real-time-product-search.p.rapidapi.com/search?q=${encodeURIComponent(
      query
    )}&country=us&language=en&page=1&limit=10&sort_by=BEST_MATCH&product_condition=ANY`;

    console.log(`Fetching products for: ${query}`);

    const response = await fetch(searchUrl, {
      method: "GET",
      headers: {
        "x-rapidapi-key": process.env.RAPIDAPI_KEY,
        "x-rapidapi-host": "real-time-product-search.p.rapidapi.com",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `Product Search API error: ${response.status} - ${errorText}`
      );
      throw new Error(`Product Search API error: ${response.status}`);
    }

    const data = await response.json();

    // Validate response data
    if (!data || typeof data !== "object") {
      throw new Error("Invalid response format from Product Search API");
    }

    console.log(
      `Successfully fetched ${data?.data?.products?.length || 0} products`
    );
    res.json({
      success: true,
      data: data,
    });
  } catch (error) {
    console.error("Product search endpoint error:", error);
    res.status(500).json({
      error: "Failed to fetch products",
      message: "Could not retrieve products from the search API",
      details: error.message,
    });
  }
});

// Product offers endpoint using new API
app.get("/product-offers", async (req, res) => {
  try {
    const productId = req.query.product_id;

    // Validate product_id parameter
    if (!productId) {
      return res.status(400).json({
        error: "Missing product_id parameter",
        message: "Please provide a 'product_id' query parameter",
      });
    }

    if (typeof productId !== "string") {
      return res.status(400).json({
        error: "Invalid product_id parameter",
        message: "Product ID parameter must be a string",
      });
    }

    // Check for required environment variables
    if (!process.env.RAPIDAPI_KEY) {
      console.error("Missing required environment variables");
      return res.status(500).json({
        error: "Configuration error",
        message: "Server configuration is incomplete",
      });
    }

    const url = `https://real-time-product-search.p.rapidapi.com/product-offers-v2?product_id=${encodeURIComponent(
      productId
    )}&page=1&country=us&language=en`;

    console.log(`Fetching product offers for: ${productId}`);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "x-rapidapi-key": process.env.RAPIDAPI_KEY,
        "x-rapidapi-host": "real-time-product-search.p.rapidapi.com",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `Product Offers API error: ${response.status} - ${errorText}`
      );
      throw new Error(`Product Offers API error: ${response.status}`);
    }

    const data = await response.json();

    // Validate response data
    if (!data || typeof data !== "object") {
      throw new Error("Invalid response format from Product Offers API");
    }

    console.log(`Successfully fetched product offers`);
    res.json({
      success: true,
      data: data,
    });
  } catch (error) {
    console.error("Product offers endpoint error:", error);
    res.status(500).json({
      error: "Failed to fetch product offers",
      message: "Could not retrieve product offers from the API",
      details: error.message,
    });
  }
});

// Add to app.js (before the 404 handler)
app.post("/support", async (req, res) => {
  try {
    // Validate request body
    if (!req.body) {
      return res.status(400).json({
        error: "Missing request body",
        message: "Please provide problem description and/or image",
      });
    }

    const { problemDescription, imageBase64, messageHistory = [] } = req.body;

    console.log("Support request received:", {
      problemDescription,
      hasImage: !!imageBase64,
      messageHistoryLength: messageHistory.length,
      messageHistory: messageHistory
    });
    // Validate at least one input is provided
    if (!problemDescription && !imageBase64) {
      return res.status(400).json({
        error: "Missing input",
        message: "Please provide either a problem description or an image",
      });
    }

    let textResponse = null;
    let imageResponse = null;

    // Process text if provided
    if (problemDescription) {
      try {
        textResponse = await processSupportTextWithGemini(
          problemDescription,
          messageHistory
        );
      } catch (error) {
        console.error("Text processing failed:", error);
        textResponse = {
          error: "Text processing failed",
          message: "Could not analyze your problem description",
          details: error.message,
        };
      }
    }

    // Process image if provided
    if (imageBase64) {
      try {
        imageResponse = await processSupportImageWithGroq(
          imageBase64,
          problemDescription
        );
      } catch (error) {
        console.error("Image processing failed:", error);
        imageResponse = {
          error: "Image processing failed",
          message: "Could not analyze your image",
          details: error.message,
        };
      }
    }

    if (problemDescription) {
      try {
        textResponse = await processSupportTextWithGemini(problemDescription, messageHistory);
        if (typeof textResponse === "object") {
          textResponse = textResponse.message || JSON.stringify(textResponse);
        }
      } catch (error) {
        textResponse = "Text processing failed";
      }
    }

    if (imageBase64) {
      try {
        imageResponse = await processSupportImageWithGroq(imageBase64, problemDescription);
        if (typeof imageResponse === "object") {
          imageResponse = imageResponse.message || JSON.stringify(imageResponse);
        }
      } catch (error) {
        imageResponse = error.message || "Image processing failed";
      }
    }

    // Combine responses
    const combinedResponse = {
      success: true,
      timestamp: new Date().toISOString(),
      textAnalysis: problemDescription ? textResponse : null,
      imageAnalysis: imageBase64 ? imageResponse : null,
    };

    res.status(200).json(combinedResponse);
  } catch (error) {
    console.error("Support endpoint error:", error);
    res.status(500).json({
      error: "Server error",
      message: "Failed to process your support request",
      details: error.message,
    });
  }
});

// Handle 404 for unknown routes
app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
    message: `The route ${req.method} ${req.path} does not exist`,
  });
});

// Graceful shutdown handling
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully");
  process.exit(0);
});

// Start server
app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
  console.log(`Health check available at http://localhost:${port}/health`);
});

export default app;

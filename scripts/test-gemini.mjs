import { GoogleGenerativeAI } from "@google/generative-ai";

// Replace with your actual key
const genAI = new GoogleGenerativeAI("AIzaSyAKEZJ8ankv_8u2F7_jj7-1_yaixOnsbXE");

async function run() {
  // Use a model name from your successful list
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const prompt = "Write a short poem about a programmer solving a 404 error.";

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    console.log("--- AI Response ---");
    console.log(text);
  } catch (error) {
    console.error("Oops, something went wrong:", error);
  }
}

run();
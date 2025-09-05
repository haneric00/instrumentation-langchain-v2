import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { LangChainInstrumentation } from '../src';
import * as CallbackManagerModule from "@langchain/core/callbacks/manager";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { Bedrock } from "@langchain/community/llms/bedrock";
import { DuckDuckGoSearch } from "@langchain/community/tools/duckduckgo_search";
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

import { PromptTemplate } from "@langchain/core/prompts";
import { BufferMemory } from "langchain/memory";
import { LLMChain } from "langchain/chains";
import * as readline from 'readline';
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";

const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: "my-langchain-project",
  [ATTR_SERVICE_VERSION]: "1.0.0",
})
const customTracerProvider = new NodeTracerProvider({
  resource: resource,
  spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())],
});

// Pass the custom tracer provider to the instrumentation
const lcInstrumentation = new LangChainInstrumentation({
  tracerProvider: customTracerProvider,
});

// Manually instrument the LangChain module
lcInstrumentation.manuallyInstrument(CallbackManagerModule);

const client = new BedrockRuntimeClient({
  region: "us-west-2",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  }
});

const llm = new Bedrock({
  model: 'anthropic.claude-v2',
  region: "us-west-2",
  // modelKwargs: {
  //   max_tokens_to_sample: 500,
  //   temperature: 0.7,
  // },
  maxTokens: 500,
  temperature: 0.7,
});

// Create a Claude-compatible prompt template
// Claude requires prompts to start with "\n\nHuman:" and end with "\n\nAssistant:"
const promptTemplate = PromptTemplate.fromTemplate(`\n\nHuman: You are a helpful AI assistant. Answer the user's questions to the best of your ability.

Chat history:
{chat_history}

Current question: {input}

\n\nAssistant:`);

// Create a memory instance that formats messages properly for Claude
const memory = new BufferMemory({
  memoryKey: "chat_history",
  inputKey: "input",
  returnMessages: false, // Return strings instead of message objects
});

// Create readline interface for terminal interaction
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Function to print a message with some formatting
function printBotMessage(message) {
  console.log("\n🤖 Bot: " + message + "\n");
}

// Function to get user input
function askQuestion(query) {
  return new Promise(resolve => rl.question(`\n👤 \${query}`, resolve));
}

async function initializeConversation() {
  // Create a simple LLM chain with memory
  const chain = new LLMChain({
    llm,
    prompt: promptTemplate,
    memory,
    verbose: true,
  });

  // Create a search tool
  const searchTool = new DuckDuckGoSearch();

  return {
    chain,
    searchTool
  };
}

// Main chat loop
async function chatLoop() {
  printBotMessage("Hello! I'm your AI assistant. What can I help you with today?");
  
  try {
    // Initialize the conversation
    const { chain, searchTool } = await initializeConversation();
    
    // Chat loop
    while (true) {
      const userInput = await askQuestion("You: ");
      
      // Exit condition
      if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
        printBotMessage("Goodbye! Have a great day!");
        break;
      }
      
      console.log("\nThinking...");
      
      try {
        // Check if it's a search request
        if (userInput.toLowerCase().startsWith("search:")) {
          const query = userInput.substring(7).trim();
          printBotMessage(`Searching for: \${query}`);
          const searchResults = await searchTool.invoke(query);
          printBotMessage(`Here's what I found:\n\${searchResults}`);
          
          // Add the search results to memory via a chain call
          await chain.call({
            input: `I searched for "\${query}" and found: \${searchResults.substring(0, 500)}...`
          });
        } else {
          // Regular conversation
          const response = await chain.call({
            input: userInput
          });
          
          // printBotMessage(response.text);
        }
      } catch (error) {
        console.error("Error while processing your request:", error);
        printBotMessage("I encountered an error while processing your request. Please try again.");
      }
    }
  } catch (error) {
    console.error("Error in chat loop:", error);
  } finally {
    rl.close();
  }
}

// Register proper shutdown handler
async function shutdownTelemetry() {
  console.log("Shutting down OpenTelemetry...");
  // await customTracerProvider.shutdown();
  console.log("OpenTelemetry shutdown complete");
  process.exit(0);
}

process.on('SIGINT', shutdownTelemetry);
process.on('SIGTERM', shutdownTelemetry);

console.log("\n=== LangChain Terminal Chatbot ===");
console.log("Type 'exit' or 'quit' to end the conversation.");
console.log("Type 'search: your query' to search the web.\n");
chatLoop().catch(error => {
  console.error("Fatal error:", error);
  rl.close();
  shutdownTelemetry();
});
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { SimpleSpanProcessor, ConsoleSpanExporter, BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

import { LangChainInstrumentation } from "@opentelemetry/instrumentation-langchain";
import * as CallbackManagerModule from "@langchain/core/callbacks/manager";

// THEN: Your application code
import { ChatBedrockConverse } from "@langchain/aws";
import * as process from 'process';
import * as readline from 'readline';
import { TavilySearch } from  "@langchain/tavily";
import { MemorySaver } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { AWSXRayPropagator } from '@opentelemetry/propagator-aws-xray';

import { trace } from '@opentelemetry/api';



// Set up AWS X-Ray propagator
// propagation.setGlobalPropagator(new AWSXRayPropagator());

// Create a resource with service information
const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: "my-langchain-project",
  [ATTR_SERVICE_VERSION]: "1.0.0",
})

// Create OTLP exporter for AWS X-Ray
// const otlpExporter = new OTLPTraceExporter({
//   url: "https://xray.us-west-2.amazonaws.com/v1/traces",
// });

const consoleExporter = new ConsoleSpanExporter();

const customTracerProvider = new NodeTracerProvider({
  resource: resource,
  spanProcessors: [new SimpleSpanProcessor(consoleExporter)]
});

// Register the tracer provider
// customTracerProvider.register({
//   propagator: new AWSXRayPropagator()
// });

// trace.setGlobalTracerProvider(customTracerProvider);

// Create and initialize LangChain instrumentation
const lcInstrumentation = new LangChainInstrumentation({
  tracerProvider: customTracerProvider,
});

// Manually instrument the LangChain module
lcInstrumentation.manuallyInstrument(CallbackManagerModule);



// Ensure AWS credentials are set via environment variables
if (!process.env.BEDROCK_AWS_ACCESS_KEY_ID || !process.env.BEDROCK_AWS_SECRET_ACCESS_KEY) {
  console.warn("AWS credentials not found in environment variables");
}

const llm = new ChatBedrockConverse({
// const llm = new BedrockChat({
  model: "anthropic.claude-3-sonnet-20240229-v1:0",
  region: process.env.BEDROCK_AWS_REGION ?? "us-east-1",
  credentials: {
    accessKeyId: process.env.BEDROCK_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.BEDROCK_AWS_SECRET_ACCESS_KEY,
  },
  temperature: 0,
  maxTokens: 1024,  
  topP: 0.2,
  // stopSequences: ["ooga booga", "booga ooga"],
});

const searchTool = new TavilySearch({
  maxResults: 3,
  tavilyApiKey: "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",
  description: "stupid lame search tool",
});

const agentTools = [searchTool];

const agentCheckpointer = new MemorySaver();
const agent = createReactAgent({
  llm: llm,
  tools: agentTools,
  checkpointSaver: agentCheckpointer,
});

// Create readline interface for terminal interaction
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Function to print a message with some formatting
function printBotMessage(message: string) {
  console.log("\n🤖 Bot: " + message + "\n");
}

// Function to get user input - FIXED the template string
function askQuestion(query: string): Promise<string> {
  return new Promise(resolve => rl.question(`\n👤 ${query}`, resolve));
}

// Main chat loop
async function chatLoop() {
  // Set a unique thread ID for this conversation - FIXED the template string
  const threadId = `thread-\${Date.now()}`;
  
  printBotMessage("Hello! I'm your AI assistant. I can answer questions, search the web, and help you with various tasks. What can I help you with today?");
  
  try {
    while (true) {
      const userInput = await askQuestion("You: ");
      
      // Exit condition
      if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
        printBotMessage("Goodbye! Have a great day!");
        break;
      }
      
      console.log("\nThinking...");
      
      try {
        // Invoke the agent with the user's message
        const agentResponse = await agent.invoke(
          { messages: [new HumanMessage(userInput)] },
          { configurable: { thread_id: threadId } }
        );
        
        // Extract and print the response
        const latestMessage = agentResponse.messages[agentResponse.messages.length - 1];
        printBotMessage(latestMessage.content.toString());
        
      } catch (error) {
        console.error("Error while processing your request:", error);
        printBotMessage("I encountered an error while processing your request. Please try again.");
      }
    }
  } finally {
    rl.close();
  }
}

// Register proper shutdown handler
async function shutdownTelemetry() {
  console.log("Shutting down OpenTelemetry...");
  // await provider.shutdown();
  console.log("OpenTelemetry shutdown complete");
  process.exit(0);
}

// process.on('SIGTERM', shutdownTelemetry);
// process.on('SIGINT', shutdownTelemetry);

// Start the chat
console.log("\n=== LangChain Terminal Chatbot ===");
console.log("Type 'exit' or 'quit' to end the conversation.\n");
chatLoop().catch(error => {
  console.error("Fatal error:", error);
  rl.close();
  shutdownTelemetry();
});

// function getNodeAutoInstrumentations(): import("@opentelemetry/instrumentation").Instrumentation<import("@opentelemetry/instrumentation").InstrumentationConfig> | import("@opentelemetry/instrumentation").Instrumentation<import("@opentelemetry/instrumentation").InstrumentationConfig>[] {
//   throw new Error("Function not implemented.");
// }
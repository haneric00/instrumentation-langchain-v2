import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { SimpleSpanProcessor, ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base";
import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

// import { LangChainInstrumentation } from "@arizeai/openinference-instrumentation-langchain";
import { LangChainInstrumentation } from "../src";
import * as CallbackManagerModule from "@langchain/core/callbacks/manager";

import { ChatBedrockConverse } from "@langchain/aws";
import { PromptTemplate } from "@langchain/core/prompts";
import * as process from 'process';

import { TavilySearch } from  "@langchain/tavily";
import { MemorySaver } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { createReactAgent } from "@langchain/langgraph/prebuilt";

async function main() {
  // Setup OpenTelemetry
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "my-langchain-project",
    [ATTR_SERVICE_VERSION]: "1.0.0",
  });
  
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

  // Setup the LLM
  const llm = new ChatBedrockConverse({
    model: "anthropic.claude-3-sonnet-20240229-v1:0",
    region: process.env.BEDROCK_AWS_REGION ?? "us-east-1",
    credentials: {
      accessKeyId: process.env.BEDROCK_AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.BEDROCK_AWS_SECRET_ACCESS_KEY,
    },
    temperature: 0,
    maxTokens: 1024,
  });

  // Setup the search tool
  const searchTool = new TavilySearch({
    maxResults: 3,
    tavilyApiKey: ""
  });

  const agentTools = [searchTool];

  // Setup the agent
  const agentCheckpointer = new MemorySaver();
  const agent = createReactAgent({
    llm: llm,
    tools: agentTools,
    checkpointSaver: agentCheckpointer,
  });

  try {
    // First query about SF weather
    const agentFinalState = await agent.invoke(
      { messages: [new HumanMessage("what is the current weather in sf")] },
      { configurable: { thread_id: "42" } },
    );

    console.log(
      agentFinalState.messages[agentFinalState.messages.length - 1].content,
    );

    // Follow-up query about NY weather
    const agentNextState = await agent.invoke(
      { messages: [new HumanMessage("what about ny")] },
      { configurable: { thread_id: "42" } },
    );

    console.log(
      agentNextState.messages[agentNextState.messages.length - 1].content,
    );
  } catch (error) {
    console.error("Error during agent execution:", error);
  }
}

// Execute the main function
main().catch(error => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
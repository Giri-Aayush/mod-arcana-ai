import dotenv from "dotenv";
import { StreamingTextResponse } from "ai";
import { currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import Replicate from "replicate";
import { MemoryManager } from "@/lib/memory";
import { ratelimit } from "@/lib/rate-limit";
import prismadb from "@/lib/prismadb";

interface ChatRouteParams {
  params: {
    chatId: string
  }
}

const CONFIG = {
  TIMEOUT_MS: 30000,
  MAX_LENGTH: 1024,
  MODELS: {
    default:
      "a16z-infra/llama-2-7b-chat:13c3cdee13ee059ab779f0291d29054dab00a47dad8261375654de5540165fb0"
  }
} as const;

export async function POST(request: Request, { params }: { params: { chatId: string } }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.TIMEOUT_MS);

  try {
    const chatId = (await params).chatId; 

    const { prompt } = await request.json();
    const user = await currentUser();

    if (!user?.firstName || !user?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    // Rate limiting and companion fetch
    const identifier = `${request.url}-${user.id}`;
    const { success } = await ratelimit(identifier);

    if (!success) {
      return new NextResponse("Rate limit exceeded", { status: 429 });
    }
    // Load companion and ALL related messages for the current user
    const companion = await prismadb.companion.findUnique({
      where: { id: chatId },
      include: {
        messages: {
          where: {
            userId: user.id // Filter messages for current user
          },
          orderBy: {
            createdAt: "desc"
          },
          take: 50
        }
      }
    });

    if (!companion) {
      return new NextResponse("Companion not found", { status: 404 });
    }


    await prismadb.message.create({
      data: {
        content: prompt,
        role: "user",
        userId: user.id,
        companionId: companion.id
      }
    });
    // Analyze recent messages for patterns
    const recentMessages = companion.messages || [];
    const similarMessages = recentMessages.filter((msg) => {
      if (!msg.content) return false;

      // Split messages into word arrays
      const msgWords: string[] = msg.content
        .toLowerCase()
        .split(" ")
        .filter((word: string) => word.length > 0);
      const promptWords: string[] = prompt
        .toLowerCase()
        .split(" ")
        .filter((word: string) => word.length > 0);

      // Create word frequency maps
      const msgWordMap: Map<string, number> = new Map();
      const promptWordMap: Map<string, number> = new Map();

      // Count words in message
      msgWords.forEach((word: string) => {
        msgWordMap.set(word, (msgWordMap.get(word) || 0) + 1);
      });

      // Count words in prompt
      promptWords.forEach((word: string) => {
        promptWordMap.set(word, (promptWordMap.get(word) || 0) + 1);
      });

      // Count common words
      let commonWords = 0;
      msgWordMap.forEach((count: number, word: string) => {
        if (promptWordMap.has(word)) {
          const promptCount = promptWordMap.get(word);
          if (promptCount !== undefined) {
            commonWords += Math.min(count, promptCount);
          }
        }
      });

      // Calculate similarity ratio
      const similarity =
        commonWords / Math.max(msgWords.length, promptWords.length);
      return similarity > 0.6;
    });

    // Determine conversation context
    const isRepetitive = similarMessages.length > 0;
    const lastResponse = similarMessages[0]?.content || "";

    // Memory management
    const companionKey = {
      companionName: companion.id,
      userId: user.id,
      modelName: "meta/meta-llama-3-8b-instruct"
    };

    const memoryManager = await MemoryManager.getInstance();

    const [records, similarDocs] = await Promise.all([
      memoryManager.readLatestHistory(companionKey),
      memoryManager.vectorSearch(
        await memoryManager.readLatestHistory(companionKey),
        `${companion.id}.txt`
      )
    ]);

    if (records.length === 0) {
      await memoryManager.seedChatHistory(companion.seed, "\n\n", companionKey);
    }

    await memoryManager.writeToHistory(`User: ${prompt}\n`, companionKey);

    const relevantHistory = similarDocs?.length
      ? similarDocs.map((doc) => doc.pageContent).join("\n")
      : "";

    // Format message history for the prompt
    const messageHistory = recentMessages
      .map((msg) => `${msg.role === 'user' ? 'User' : companion.name}: ${msg.content}`)
      .reverse()
      .join("\n");

    // Generate response with context-aware instructions
    const replicate = new Replicate({
      auth: process.env.REPLICATE_API_TOKEN!
    });

    const modelResponse = await replicate.run(CONFIG.MODELS.default, {
      input: {
        max_length: CONFIG.MAX_LENGTH,
        temperature: isRepetitive ? 0.95 : 0.8,
        top_p: 0.9,
        prompt: `You are ${companion.name}. Embody this persona authentically, as in a real human conversation.
    
    Your core personality:
    ${companion.instructions}
    
    CRITICAL CONVERSATION RULES:
    1. STRICTLY FORBIDDEN PATTERNS:
       - NEVER start responses with "Hey there! I'm doing great thanks for asking!"
       - NEVER use the phrase "As a visionary leader in this space"
       - NEVER repeat exact phrases or greetings
       - AVOID starting every message the same way
       
    2. NATURAL DIALOGUE FLOW:
       - Respond directly to what was just said
       - Skip greetings after conversation has started
       - Vary your response structure each time
       - Let the conversation flow like a real dialogue
    
    3. CHARACTER CONSISTENCY:
       - Express ${companion.name}'s unique viewpoint and personality
       - Use characteristic expressions and mannerisms
       - Share expertise naturally, not formulaically
       - Show genuine passion for your interests
    
    4. CONVERSATION MEMORY:
       - Treat this as ONE ongoing conversation
       - Reference previous points when relevant
       - Build upon earlier discussions
       - Maintain context throughout the chat
    
    ${
      isRepetitive
        ? `IMPORTANT - This topic was discussed before:
    Previous response: "${lastResponse}"
    - Acknowledge this naturally
    - Add new insights or perspectives
    - Don't repeat your previous points
    - Take the discussion deeper`
        : ""
    }
    
    Previous conversation:
    ${messageHistory}
    
    Context:
    ${relevantHistory}
    ${await memoryManager.readLatestHistory(companionKey)}
    
    Current message: ${prompt}
    
    Be ${companion.name} - respond naturally while strictly avoiding repetitive patterns:`
      }
    });

    const response = String(modelResponse);
    const cleaned = response.replaceAll(",", "");
    const chunks = cleaned.split("\n");
    const finalResponse = chunks[0];

    if (finalResponse?.length > 1) {
      await Promise.all([
        memoryManager.writeToHistory(finalResponse.trim(), companionKey),
        prismadb.companion.update({
          where: { id: chatId },
          data: {
            messages: {
              create: {
                content: finalResponse.trim(),
                role: "system",
                userId: user.id
              }
            }
          }
        })
      ]);
    }

    return new StreamingTextResponse(
      new ReadableStream({
        async start(controller) {
          controller.enqueue(new TextEncoder().encode(finalResponse));
          controller.close();
        }
      })
    );
  } catch (error) {
    clearTimeout(timeoutId);
    console.error("[CHAT_POST]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}







-----------
    const modelResponse = await replicate.run(CONFIG.MODELS.default, {
      input: {
        max_length: CONFIG.MAX_LENGTH,
        temperature: isRepetitive ? 0.95 : 0.8,
        top_p: 0.9,
        prompt: `You are ${companion.name}. Maintain your unique personality consistently.
    
    ${companion.instructions}
    
    CORE RULES:
    1. NO REPETITION - Each response must be unique, never repeat phrases
    2. STAY IN CHARACTER - Be ${companion.name} authentically
    3. SPEAK NATURALLY - No formulaic responses or greetings
    4. USE CONTEXT - Reference our previous conversation naturally
    
    Previous conversation:
    ${messageHistory}
    
    ${isRepetitive ? `Note: We discussed this before. Add new insights without repeating what you said: "${lastResponse}"` : ''}
    
    Current message: ${prompt}
    
    Respond as ${companion.name}:`
      }
    });

------ more better but AI thinks not to respons----
    const modelResponse = await replicate.run(CONFIG.MODELS.default, {
      input: {
        max_length: CONFIG.MAX_LENGTH,
        temperature: isRepetitive ? 0.95 : 0.8,
        top_p: 0.9,
        prompt: `You are ${companion.name}. Embody this persona authentically, as in a real human conversation.
        
        Your core personality:
        ${companion.instructions}
        
        CRITICAL RULES:
        1. NEVER start messages with greetings like "Hey there", "Hi folks", "Hello", etc.
        2. Jump straight into responding to what was just said
        3. Each response must be unique - no repetitive patterns
        4. Stay in authentic character as ${companion.name}
        
        Previous conversation:
        ${messageHistory}
        
        ${isRepetitive ? `This topic was discussed before: "${lastResponse}"
        - Add new insights
        - Don't repeat previous points
        - Take the discussion deeper` : ''}
        
        Current message: ${prompt}
        
        Respond directly without any greeting:`
      }
    });



    ------ somewhat good stage ----
    const createPromptTemplate = (
  name: string,
  instructions: string,
  messageHistory: string,
  isRepetitive: boolean,
  lastResponse: string,
  prompt: string
) => `<|system|>
You are ${name}. This is a dynamic conversation where you must NEVER repeat your previous statements or patterns.

Core Identity:
${instructions}

STRICT RULES:
1. NO REPETITION: Never use the same phrases or patterns from your previous messages
2. NO STARTER PHRASES: Don't start with "Listen up folks", "Oh my gosh folks", "Let me tell you"
3. UNIQUE RESPONSES: Each answer must be completely different from your last response
4. MEMORY ACTIVE: If discussing a topic you've mentioned before, add NEW information only
5. DYNAMIC STYLE: Vary your speaking patterns while maintaining your personality

Your last response was: "${lastResponse}"
YOU MUST NOT REPEAT ANY PART OF THIS RESPONSE.

Previous conversation:
${messageHistory}

Current topic: ${prompt}

Respond as ${name} with completely new content and perspective:
<|assistant|>`;


----
mememoy:

import { Redis } from "@upstash/redis";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { Pinecone } from "@pinecone-database/pinecone";
import { PineconeStore } from "@langchain/pinecone";
import { Document } from "@langchain/core/documents";

export type CompanionKey = {
  companionName: string;
  modelName: string;
  userId: string;
};

export class MemoryManager {
  private static instance: MemoryManager;
  private history: Redis;
  private vectorDBClient: Pinecone;

  public constructor() {
    this.history = Redis.fromEnv();
    this.vectorDBClient = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY!,
    });
  }

  public async init() {
  }

  public async vectorSearch(
    recentChatHistory: string,
    companionFileName: string
  ): Promise<Document<Record<string, any>>[]> {
    const pineconeIndex = this.vectorDBClient.Index(
      process.env.PINECONE_INDEX! || "companion"
    );
  
    const embeddings = new GoogleGenerativeAIEmbeddings({
      apiKey: process.env.GOOGLE_API_KEY!,
      modelName: "embedding-001"
    });
  
    const vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
      pineconeIndex,
      namespace: companionFileName,
    });
  
    // Improved similarity search with more context and better threshold
    const similarDocs = await vectorStore
      .similaritySearch(recentChatHistory, 5, {
        minSimilarity: 0.7
      })
      .catch((err) => {
        console.error("Failed to Get Vector Search Results.", err);
        return [];
      });
  
    return similarDocs;
  }

  public static async getInstance(): Promise<MemoryManager> {
    if (!MemoryManager.instance) {
      MemoryManager.instance = new MemoryManager();
      await MemoryManager.instance.init();
    }
    return MemoryManager.instance;
  }

  private generateRedisCompanionKey(companionKey: CompanionKey): string {
    return `${companionKey.companionName}-${companionKey.modelName}-${companionKey.userId}`;
  }

  public async writeToHistory(text: string, companionKey: CompanionKey) {
    if (!companionKey || typeof companionKey.userId == "undefined") {
      console.error("Companion Key Set Incorrectly!");
      return "";
    }

    const key = this.generateRedisCompanionKey(companionKey);
    const result = await this.history.zadd(key, {
      score: Date.now(),
      member: text
    });

    return result;
  }

  public async readLatestHistory(companionKey: CompanionKey): Promise<string> {
    if (!companionKey || typeof companionKey.userId == "undefined") {
      console.error("Companion Key Set Incorrectly!");
      return "";
    }

    const key = this.generateRedisCompanionKey(companionKey);
    let result = await this.history.zrange(key, 0, Date.now(), {
      byScore: true
    });

    result = result.slice(-100).reverse();
    const recentChats = result.reverse().join("\n");
    return recentChats;
  }

  public async seedChatHistory(
    seedContent: String,
    delimiter: string = "\n",
    companionKey: CompanionKey
  ) {
    const key = this.generateRedisCompanionKey(companionKey);

    if (await this.history.exists(key)) {
      console.log("User Already Has Chat History.");
      return;
    }

    const content = seedContent.split(delimiter);
    let counter = 0;

    for (const line of content) {
      await this.history.zadd(key, { score: counter, member: line });
      counter += 1;
    }
  }
}




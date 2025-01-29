import { Redis } from "@upstash/redis";
import { Pinecone } from "@pinecone-database/pinecone";
import { PineconeStore } from "@langchain/pinecone";
import { Document } from "@langchain/core/documents";
import { OpenAIEmbeddings } from "@langchain/openai";

export type CompanionKey = {
  companionName: string;
  modelName: string;
  userId: string;
};

export class MemoryManager {
  private static instance: MemoryManager;
  private history: Redis;
  private vectorDBClient: Pinecone;
  private vectorStoreCache: Map<string, any>;
  private embeddings: OpenAIEmbeddings;

  public constructor() {
    this.history = Redis.fromEnv();
    this.vectorDBClient = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY!,
    });
    this.vectorStoreCache = new Map();
    
    // Using only valid OpenAIEmbeddings parameters
    this.embeddings = new OpenAIEmbeddings({
      openAIApiKey: process.env.OPENAI_API_KEY,
      modelName: "text-embedding-3-small",
      dimensions: 1536,
      batchSize: 512,
    });
  }

  public async vectorSearch(
    recentChatHistory: string,
    companionFileName: string
  ): Promise<Document<Record<string, any>>[]> {
    const pineconeIndex = this.vectorDBClient.Index(
      process.env.PINECONE_INDEX! || "companion"
    );
  
    const vectorStore = await PineconeStore.fromExistingIndex(this.embeddings, {
      pineconeIndex,
      namespace: companionFileName,
    });
  
    // Truncate text to stay within token limit
    const truncateText = (text: string, maxTokens: number = 8000): string => {
      const words = text.split(/\s+/);
      const estimatedTokens = words.length * 1.3;
      
      if (estimatedTokens <= maxTokens) return text;
      
      const targetWords = Math.floor(maxTokens / 1.3);
      return words.slice(0, targetWords).join(' ');
    };
  
    const truncatedHistory = truncateText(recentChatHistory);
  
    try {
      const similarDocs = await vectorStore.similaritySearch(truncatedHistory, 5, {
        minSimilarity: 0.7,
      });
      
      return similarDocs;
    } catch (err) {
      console.error("Failed to Get Vector Search Results:", err);
      return [];
    }
  }

  public static async getInstance(): Promise<MemoryManager> {
    if (!MemoryManager.instance) {
      MemoryManager.instance = new MemoryManager();
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
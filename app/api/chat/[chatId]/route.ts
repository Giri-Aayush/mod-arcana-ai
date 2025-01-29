// File: app/api/chat/[chatId]/route.ts
import dotenv from "dotenv";
import { StreamingTextResponse } from "ai";
import { currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { OpenAI } from "openai";
import { MemoryManager } from "@/lib/memory";
import { ratelimit } from "@/lib/rate-limit";
import prismadb from "@/lib/prismadb";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!
});

const CONFIG = {
  TIMEOUT_MS: 30000,
  MAX_LENGTH: 300,  // Optimized length
} as const;

const createPromptTemplate = (
  name: string,
  instructions: string,
  messageHistory: string,
  isRepetitive: boolean,
  lastResponse: string,
  prompt: string
) => {
  const recentMessages = messageHistory.split('\n')
    .slice(-12)  // Optimized history size
    .filter(line => line.trim().length > 0)
    .slice(-6);  // Reduced to last 3 messages

  return `<|system|>
You are ${name}. Stay focused on the current topic of discussion.

Core Identity:
${instructions}

CONVERSATION HISTORY (Last 3 exchanges):
${recentMessages.join('\n')}

CURRENT TOPIC: ${prompt}

RULES:
1. STAY ON TOPIC: The user is asking about ${prompt}. Do NOT talk about yourself unless specifically asked
2. NO REPETITION: Don't repeat phrases from your recent messages shown above
3. MEMORY ACTIVE: Reference the conversation history to maintain context
4. FOCUSED RESPONSE: Address the current question directly

Current question: ${prompt}
Response as ${name}, focusing ONLY on the asked topic:
<|assistant|>`;
};

export async function POST(request: Request, { params }: { params: any }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.TIMEOUT_MS);

  try {
    const chatId = params.chatId;
    const { prompt } = await request.json();
    const user = await currentUser();

    if (!user?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const identifier = `${request.url}-${user.id}`;
    
    // Parallel operations for better performance
    const [{ success }, companion, userMessage] = await Promise.all([
      ratelimit(identifier),
      prismadb.companion.findUnique({
        where: { id: chatId },
        include: {
          messages: {
            where: { userId: user.id },
            orderBy: { createdAt: "desc" },
            take: 50  // Reduced for better performance
          }
        }
      }),
      prismadb.message.create({
        data: {
          content: prompt,
          role: "user",
          userId: user.id,
          companionId: chatId
        }
      })
    ]);
    
    if (!success) {
      return new NextResponse("Rate limit exceeded", { status: 429 });
    }
    
    if (!companion) {
      return new NextResponse("Companion not found", { status: 404 });
    }

    // Analyze recent messages for patterns
    const recentMessages = companion.messages || [];
    const similarMessages = recentMessages.filter((msg) => {
      if (!msg.content) return false;

      const msgWords: string[] = msg.content
        .toLowerCase()
        .split(" ")
        .filter((word: string) => word.length > 0);

      const promptWords: string[] = prompt
        .toLowerCase()
        .split(" ")
        .filter((word: string) => word.length > 0);

      const msgWordMap: Map<string, number> = new Map();
      const promptWordMap: Map<string, number> = new Map();

      msgWords.forEach((word: string): void => {
        msgWordMap.set(word, (msgWordMap.get(word) || 0) + 1);
      });

      promptWords.forEach((word: string): void => {
        promptWordMap.set(word, (promptWordMap.get(word) || 0) + 1);
      });

      let commonWords: number = 0;
      msgWordMap.forEach((count: number, word: string): void => {
        if (promptWordMap.has(word)) {
          const promptCount = promptWordMap.get(word);
          if (promptCount !== undefined) {
            commonWords += Math.min(count, promptCount);
          }
        }
      });

      const similarity: number = commonWords / Math.max(msgWords.length, promptWords.length);
      return similarity > 0.6;
    });

    const isRepetitive = similarMessages.length > 0;
    const lastResponse = similarMessages[0]?.content || "";

    const companionKey = {
      companionName: companion.id,
      userId: user.id,
      modelName: "gpt-4"
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

    const messageHistory = recentMessages
      .map((msg) => `${msg.role === 'user' ? 'User' : companion.name}: ${msg.content}`)
      .reverse()
      .join("\n");

    const promptContent = createPromptTemplate(
      companion.name,
      companion.instructions,
      messageHistory,
      isRepetitive,
      lastResponse,
      prompt
    );

    const modelResponse = await openai.chat.completions.create({
      model: "gpt-4-turbo-preview",  // Faster model
      messages: [
        { role: "system", content: promptContent }
      ],
      temperature: 0.7,
      max_tokens: CONFIG.MAX_LENGTH,
      presence_penalty: 0.7,
      top_p: 0.9,
      frequency_penalty: 0.5,
      stream: true
    });

    let fullResponse = '';  // Track complete response

    return new StreamingTextResponse(
      new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          
          try {
            for await (const part of modelResponse) {
              const text = part.choices[0]?.delta?.content || '';
              if (text) {
                fullResponse += text;  // Accumulate the response
                controller.enqueue(encoder.encode(text));
              }
            }

            // Save complete response
            if (fullResponse.length > 1) {
              await Promise.all([
                memoryManager.writeToHistory(fullResponse.trim(), companionKey),
                prismadb.companion.update({
                  where: { id: chatId },
                  data: {
                    messages: {
                      create: {
                        content: fullResponse.trim(),
                        role: "system",
                        userId: user.id
                      }
                    }
                  }
                })
              ]);
            }
          } catch (error) {
            console.error("Streaming error:", error);
            controller.error(error);
          } finally {
            controller.close();
          }
        }
      })
    );

  } catch (error) {
    clearTimeout(timeoutId);
    console.error("[CHAT_POST]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
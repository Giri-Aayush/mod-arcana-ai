"use client";

import React, { ElementRef, useEffect, useRef, useState } from "react";
import { Companion } from "@prisma/client";

import ChatMessage, { ChatMessageProps } from "@/components/chat-message";

interface ChatMessagesProps {
  messages: ChatMessageProps[];
  isLoading: boolean;
  companion: Companion;
}

const transformTextToEmoji = (inputText: string | undefined): string => {
  const reactionToEmoji: Record<string, string> = {
    smirks: "😏",
    smiles: "😊",
    laughs: "😄",
    grins: "😁",
    frowns: "☹",
    cries: "😢",
    winks: "😉",
    sighs: "😮‍💨",
    "rolls eyes": "🙄",
    shrugs: "🤷",
    nods: "🙂",
    gasps: "😮",
    yawns: "🥱",
    blushes: "😊",
    "adjusts glasses": "😎",
    "leaning in": "🤔",
    "excitedly": "🤓",
  };

  if (!inputText) return "";

  // Build a regex pattern for reactions
  const reactionPattern = new RegExp(
    `\\*?(${Object.keys(reactionToEmoji).join("|")})\\*?`,
    "gi"
  );

  return inputText.replace(reactionPattern, (match, reaction) => {
    // Replace matched reaction with corresponding emoji
    const cleanReaction = reaction.toLowerCase();
    return reactionToEmoji[cleanReaction] || match;
  }).replace(/\*.*?\*/g, ""); // Remove remaining text between stars
};




export default function ChatMessages({
  companion,
  isLoading,
  messages
}: ChatMessagesProps) {
  const scrollRef = useRef<ElementRef<"div">>(null);

  const [fakeLoading, setFakeLoading] = useState(
    messages.length === 0 ? true : false
  );

  useEffect(() => {
    const timeout = setTimeout(() => {
      setFakeLoading(false);
    }, 1000);

    console.log("From Message" , messages)

    return () => {
      clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    scrollRef?.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  return (
    <div className="flex-1 overflow-y-auto pr-4">
      <ChatMessage
        isLoading={fakeLoading}
        src={companion.src}
        role="system"
        content={`Hello, I'm ${companion.name}, ${companion.description}.`}
      />
      {messages.map((message , index) => (
        <ChatMessage
          key={index}
          role={message.role}
          content={ transformTextToEmoji(message.content)}
          src={companion.src}
        />
      ))}
      {isLoading && <ChatMessage role="system" src={companion.src} isLoading />}
      <div ref={scrollRef} />
    </div>
  );
}

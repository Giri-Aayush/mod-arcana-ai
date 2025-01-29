import { auth } from '@clerk/nextjs/server';
import { redirect } from "next/navigation";
import prismadb from "@/lib/prismadb";
import ChatClient from "./components/client";

interface ChatIdPageProps {
  params: any;
}

export default async function ChatIdPage({ params }: ChatIdPageProps) {
  const { userId } = await auth();
  const { chatId } = await params;  // Properly await params

  if (!userId) {
    redirect(`/sign-in?redirectUrl=/chat/${chatId}`);
  }

  const companion = await prismadb.companion.findUnique({
    where: { id: chatId },  // Use the awaited chatId directly
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        where: { userId },
      },
      _count: { select: { messages: true } },
    },
  });

  if (!companion) {
    redirect("/");
  }

  return <ChatClient companion={companion} />;
}
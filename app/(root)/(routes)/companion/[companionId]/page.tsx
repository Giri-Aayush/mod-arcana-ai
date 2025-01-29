import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import prismadb from "@/lib/prismadb";
import CompanionForm from "./components/companion-form";

interface CompanionIdPageProps {
  params: any
}

export default async function CompanionIdPage({
  params
}: CompanionIdPageProps) {
  const { userId } = await auth();

  if (!userId) {
    // Using redirect from next/navigation instead of redirectToSignIn
    return redirect("/sign-in");
  }

  // Add error handling for the database queries
  try {
    const companion = await prismadb.companion.findUnique({
      where: {
        id: (await params).companionId,
        userId
      }
    });

    const categories = await prismadb.category.findMany();

    return (
      <CompanionForm 
        initialData={companion} 
        categories={categories} 
      />
    );
  } catch (error) {
    console.error("Error fetching data:", error);
    return redirect("/error");
  }
}
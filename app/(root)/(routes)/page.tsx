import React from "react";
import SearchInput from "@/components/search-input";
import Categories from "@/components/categories";
import prismadb from "@/lib/prismadb";
import Companions from "@/components/companions";

export const dynamic = 'force-dynamic'; // Add this line at the top

interface PageProps {
  searchParams: any;
}

export default async function RootPage({
  searchParams,
}: PageProps) {
  try {
    // Remove the await from searchParams
    const data = await prismadb.companion.findMany({
      where: {
        categoryId: searchParams.categoryId || undefined,
        name: searchParams.name ? {
          contains: searchParams.name
        } : undefined
      },
      orderBy: {
        createdAt: "desc"
      },
      include: {
        _count: {
          select: {
            messages: true
          }
        }
      }
    });

    const categories = await prismadb.category.findMany();

    return (
      <div className="h-full p-4 space-y-2">
        <SearchInput />
        <Categories data={categories} />
        <Companions data={data} />
      </div>
    );
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch companion data");
  }
}
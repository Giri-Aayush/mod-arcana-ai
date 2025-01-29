// File: app/(root)/(routes)/page.tsx
import React from "react";
import SearchInput from "@/components/search-input";
import Categories from "@/components/categories";
import prismadb from "@/lib/prismadb";
import Companions from "@/components/companions";

interface PageProps {
  searchParams: any;
}

export default async function RootPage({
  searchParams,
}: PageProps) {
  try {
    // Await the searchParams before accessing its properties
    const params = await searchParams;
    
    const data = await prismadb.companion.findMany({
      where: {
        categoryId: params.categoryId || undefined,
        name: params.name ? {
          contains: params.name
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
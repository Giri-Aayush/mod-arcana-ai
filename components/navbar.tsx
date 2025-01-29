"use client";

import { Sparkles } from "lucide-react";
import React from "react";
import Link from "next/link";
import { Poppins } from "next/font/google";
import {
  SignInButton,
  SignOutButton,
  SignedIn,
  SignedOut,
  UserButton
} from "@clerk/nextjs";



import { cn } from "@/lib/utils";
import { useProModal } from "@/hooks/use-pro-modal";

import { Button } from "@/components/ui/button";
import { ModeToggle } from "@/components/mode-toggle";
import MobileSidebar from "@/components/mobile-sidebar";

const font = Poppins({
  weight: "600",
  subsets: ["latin"]
});

interface NavbarProps {
  isPro: boolean;
}

export default function Navbar({ isPro }: NavbarProps) {
  const proModal = useProModal();

  return (
    <div
      className="fixed w-full z-50 flex justify-between items-center py-2 px-4 h-16 border-b border-primary/10"
      style={{ backdropFilter: "blur(10px)" }}
    >
      <div className="flex items-center">
        <MobileSidebar isPro={isPro} />
        <Link href="/" className="flex flex-row  items-center">
          <img style={{width : "10%"}} src={"/logo.png"} />
          <h1
            className={cn(
              "hidden md:block text-xl md:text-3xl font-bold text-primary",
              font.className
            )}
          >
            Arcana AI
          </h1>
        </Link>
      </div>
      <div className="flex items-center gap-x-3">
        <SignedIn>
          <UserButton afterSignOutUrl="/" />
        </SignedIn>
        <SignedOut>
          <SignInButton>
            <Button style={{boxShadow: "rgba(0, 0, 0, 0.24) 0px 3px 8px"}} className="text-white bg-btn-bg hover:bg-white hover:text-black">Sign In</Button>
          </SignInButton>
        </SignedOut>
      </div>
    </div>
  );
}

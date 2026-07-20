"use client";

import React, { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Header from "../../../components/Header";
import { toast } from "sonner";

export default function MarketDetailPage() {
  const params = useParams();
  const marketAddress = params.id;

  return (
    <div className="min-h-screen bg-zinc-950">
      <Header />
      <main className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold text-white">Market Detail: {marketAddress}</h1>
        <p className="text-zinc-400 mt-4">Buy/Sell 功能修复中...</p>
      </main>
    </div>
  );
}
"use client";

import type { ReactNode } from "react";

import { EditorNavigationProvider } from "@/components/layout/editor-navigation";
import { AppTopNav } from "@/components/layout/app-top-nav";

export default function UserLayout({ children }: { children: ReactNode }) {
    return (
        <EditorNavigationProvider>
            <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
                <AppTopNav />
                <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
            </div>
        </EditorNavigationProvider>
    );
}

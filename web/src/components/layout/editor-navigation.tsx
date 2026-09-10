"use client";

import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";

type Navigate = (href: string) => void | Promise<void>;
const EditorNavigationContext = createContext<{
    navigate: Navigate;
    register: (guard: Navigate) => () => void;
} | null>(null);

// The global header can leave an editor only through that editor's save guard.
export function EditorNavigationProvider({ children }: { children: ReactNode }) {
    const router = useRouter();
    const guard = useRef<Navigate | null>(null);
    const register = useCallback((next: Navigate) => {
        guard.current = next;
        return () => { if (guard.current === next) guard.current = null; };
    }, []);
    const navigate = useCallback((href: string) => guard.current ? guard.current(href) : router.push(href), [router]);
    const value = useMemo(() => ({ navigate, register }), [navigate, register]);
    return <EditorNavigationContext.Provider value={value}>{children}</EditorNavigationContext.Provider>;
}

export function useEditorNavigation() { return useContext(EditorNavigationContext); }

export const imageAspectOptions = [
    { value: "1:1", label: "1:1", width: 1024, height: 1024, icon: "square" },
    { value: "3:2", label: "3:2", width: 1536, height: 1024, icon: "landscape" },
    { value: "2:3", label: "2:3", width: 1024, height: 1536, icon: "portrait" },
    { value: "4:3", label: "4:3", width: 1344, height: 1024, icon: "landscape" },
    { value: "3:4", label: "3:4", width: 1024, height: 1344, icon: "portrait" },
    { value: "16:9", label: "16:9", width: 1792, height: 1024, icon: "landscape" },
    { value: "9:16", label: "9:16", width: 1024, height: 1792, icon: "portrait" },
    { value: "21:9", label: "21:9", width: 1792, height: 768, icon: "landscape" },
    { value: "auto", label: "auto", width: 0, height: 0, icon: "auto" },
] as const;

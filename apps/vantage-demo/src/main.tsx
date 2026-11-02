import { createRoot } from "react-dom/client";
import { useState } from "react";
import { ThemeProvider, useTheme } from "next-themes";
import { Toaster, toast } from "sonner";
import { Moon, Sun, RotateCcw } from "lucide-react";
import { VantageTool } from "~/app/employer/tools/vantage/VantageTool";
import { Button } from "~/components/ui/button";
import { installPortableTransport } from "./transport";
import "./shell.css";

function clearPreviewPreferences() {
    try {
        window.localStorage.removeItem("vantage:hidden:v1");
    } catch {
        /* Storage may be disabled. */
    }
}
clearPreviewPreferences();
const localDemo = installPortableTransport(window);
function App() {
    const [revision, setRevision] = useState(0);
    const { theme, setTheme } = useTheme();
    return (
        <>
            <header className="portable-banner">
                <div>
                    <strong>Recorded synthetic demo</strong>
                    <span>All edits stay in this tab and reset on reload.</span>
                </div>
                <div className="portable-controls">
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Toggle color theme"
                        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                    >
                        {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                            localDemo.reset();
                            clearPreviewPreferences();
                            setRevision(v => v + 1);
                            toast.success("Recorded demo reset.");
                        }}
                    >
                        <RotateCcw size={14} />
                        Reset demo
                    </Button>
                </div>
            </header>
            <main className="portable-main" key={revision}>
                <VantageTool
                    contextDemoEnabled
                    host={{
                        active: true,
                        storageScope: null,
                        hrefForToolPath: at => `#${at}`,
                        openHref: () =>
                            toast.info(
                                "External workspace links are unavailable in this recorded demo."
                            ),
                    }}
                />
            </main>
            <Toaster richColors position="bottom-right" />
        </>
    );
}
createRoot(document.getElementById("root")!).render(
    <ThemeProvider
        attribute="data-theme"
        defaultTheme="dark"
        enableSystem={false}
        storageKey="vantage-portable-theme-v1"
    >
        <App />
    </ThemeProvider>
);

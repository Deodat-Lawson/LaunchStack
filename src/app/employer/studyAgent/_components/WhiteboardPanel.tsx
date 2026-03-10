"use client";
import { useRef, useState, useEffect } from "react";
import type { Document } from "../page";
import { Button } from "./ui/button";
import { Eraser, Pen, Download, Trash2, Undo, Redo } from "lucide-react";

interface WhiteboardPanelProps {
  document: Document | null;
  isDark?: boolean;
}

type Tool = "pen" | "eraser" | "rectangle" | "circle" | "text";

interface DrawingPath {
  tool: Tool;
  color: string;
  width: number;
  points: { x: number; y: number }[];
}

export function WhiteboardPanel({ document, isDark = false }: WhiteboardPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#6366f1");
  const [lineWidth, setLineWidth] = useState(3);
  const [paths, setPaths] = useState<DrawingPath[]>([]);
  const [currentPath, setCurrentPath] = useState<DrawingPath | null>(null);
  const [history, setHistory] = useState<DrawingPath[][]>([]);
  const [historyStep, setHistoryStep] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    // Clear and redraw
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw grid
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 1;
    const gridSize = 30;
    for (let x = 0; x < canvas.width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Draw all paths
    paths.forEach((path) => {
      drawPath(ctx, path);
    });

    // Draw current path
    if (currentPath) {
      drawPath(ctx, currentPath);
    }
  }, [paths, currentPath]);

  const drawPath = (ctx: CanvasRenderingContext2D, path: DrawingPath) => {
    if (path.points.length < 2) return;

    ctx.strokeStyle = path.color;
    ctx.lineWidth = path.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (path.tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
    } else {
      ctx.globalCompositeOperation = "source-over";
    }

    ctx.beginPath();
    ctx.moveTo(path.points[0]?.x ?? 0, path.points[0]?.y ?? 0);
    
    for (let i = 1; i < path.points.length; i++) {
      ctx.lineTo(path.points[i]?.x ?? 0, path.points[i]?.y ?? 0);
    }
    
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setIsDrawing(true);
    setCurrentPath({
      tool,
      color: tool === "eraser" ? "#ffffff" : color,
      width: tool === "eraser" ? lineWidth * 3 : lineWidth,
      points: [{ x, y }],
    });
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !currentPath) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setCurrentPath({
      ...currentPath,
      points: [...currentPath.points, { x, y }],
    });
  };

  const stopDrawing = () => {
    if (currentPath && currentPath.points.length > 0) {
      const newPaths = [...paths, currentPath];
      setPaths(newPaths);
      
      // Update history
      const newHistory = history.slice(0, historyStep + 1);
      newHistory.push(newPaths);
      setHistory(newHistory);
      setHistoryStep(newHistory.length - 1);
    }
    
    setIsDrawing(false);
    setCurrentPath(null);
  };

  const handleUndo = () => {
    if (historyStep > 0) {
      setHistoryStep(historyStep - 1);
      setPaths(history[historyStep - 1] ?? []);
    }
  };

  const handleRedo = () => {
    if (historyStep < history.length - 1) {
      setHistoryStep(historyStep + 1);
      setPaths(history[historyStep + 1] ?? []);
    }
  };

  const handleClear = () => {
    if (confirm("Clear the whiteboard?")) {
      setPaths([]);
      setHistory([[]]); 
      setHistoryStep(0);
    }
  };

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const link = globalThis.document.createElement("a");
    link.download = "whiteboard.png";
    link.href = canvas.toDataURL();
    link.click();
  };

  const colors = ["#6366f1", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#000000"];

  return (
    <div className={`h-full flex flex-col ${isDark ? 'bg-gray-900' : 'bg-gray-100'}`}>
      {/* Toolbar */}
      <div className={`border-b px-4 py-3 flex items-center gap-4 flex-wrap ${
        isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
      }`}>
        {/* Tools */}
        <div className="flex items-center gap-2 border-r pr-4">
          <Button
            variant={tool === "pen" ? "default" : "outline"}
            size="sm"
            onClick={() => setTool("pen")}
            className="h-9 w-9 p-0"
          >
            <Pen className="w-4 h-4" />
          </Button>
          <Button
            variant={tool === "eraser" ? "default" : "outline"}
            size="sm"
            onClick={() => setTool("eraser")}
            className="h-9 w-9 p-0"
          >
            <Eraser className="w-4 h-4" />
          </Button>
        </div>

        {/* Colors */}
        {tool !== "eraser" && (
          <div className="flex items-center gap-2 border-r pr-4">
            {colors.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`w-7 h-7 rounded-full border-2 transition-all ${
                  color === c ? "border-gray-900 scale-110" : "border-gray-300"
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        )}

        {/* Line Width */}
        <div className="flex items-center gap-2 border-r pr-4">
          <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Size:</span>
          <input
            type="range"
            min="1"
            max="10"
            value={lineWidth}
            onChange={(e) => setLineWidth(Number(e.target.value))}
            className="w-20"
          />
        </div>

        {/* History */}
        <div className="flex items-center gap-2 border-r pr-4">
          <Button
            variant="outline"
            size="sm"
            onClick={handleUndo}
            disabled={historyStep === 0}
            className="h-9 w-9 p-0"
          >
            <Undo className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRedo}
            disabled={historyStep === history.length - 1}
            className="h-9 w-9 p-0"
          >
            <Redo className="w-4 h-4" />
          </Button>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 ml-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={handleClear}
            className="h-9"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Clear
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownload}
            className="h-9"
          >
            <Download className="w-4 h-4 mr-2" />
            Save
          </Button>
        </div>
      </div>

      {/* Whiteboard Canvas */}
      <div className="flex-1 p-6 overflow-hidden">
        <div className="w-full h-full bg-white rounded-lg shadow-lg overflow-hidden">
          <canvas
            ref={canvasRef}
            onMouseDown={startDrawing}
            onMouseMove={draw}
            onMouseUp={stopDrawing}
            onMouseLeave={stopDrawing}
            className="w-full h-full cursor-crosshair"
          />
        </div>
      </div>

      {/* Document Reference */}
      {document && (
        <div className={`border-t px-4 py-2 text-sm ${
          isDark 
            ? 'bg-gray-800 border-gray-700 text-gray-400' 
            : 'bg-white border-gray-200 text-gray-600'
        }`}>
          Teaching from: <span className="text-purple-600">{document.name}</span>
        </div>
      )}
    </div>
  );
}

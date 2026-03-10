"use client";

import { useState, useEffect, useRef } from "react";
import type { Document } from "../page";
import { 
  Bold, 
  Italic, 
  Underline, 
  List, 
  ListOrdered, 
  AlignLeft, 
  AlignCenter,
  AlignRight,
  Undo,
  Redo,
  Type,
  Sparkles,
  Download
} from "lucide-react";
import { Button } from "./ui/button";
import { Separator } from "./ui/separator";

interface CollaborativeDocsEditorProps {
  document: Document | null;
  isDark?: boolean;
}

export function CollaborativeDocsEditor({ document: docProp, isDark = false }: CollaborativeDocsEditorProps) {
  const [content, setContent] = useState("");
  const [aiCursor, setAiCursor] = useState<{ show: boolean; position: number }>({ show: false, position: 0 });
  const editorRef = useRef<HTMLDivElement>(null);

  // Simulate AI typing
  const simulateAITyping = (text: string) => {
    setAiCursor({ show: true, position: content.length });
    let index = 0;
    const interval = setInterval(() => {
      if (index < text.length) {
        setContent((prev) => prev + text[index]);
        setAiCursor((prev) => ({ ...prev, position: prev.position + 1 }));
        index++;
      } else {
        clearInterval(interval);
        setAiCursor({ show: false, position: 0 });
      }
    }, 50);
  };

  useEffect(() => {
    // Initialize with welcome message
    if (!content) {
      setTimeout(() => {
        const welcomeText = `# ${docProp?.name ?? "Collaborative Document"}\n\n*AI Teacher is here to help you learn*\n\n---\n\n`;
        simulateAITyping(welcomeText);
      }, 500);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addAIExplanation = () => {
    const explanation = `\n\n## Key Concepts\n\nLet me explain the main ideas:\n\n1. **First Concept**: This is an important foundation that...\n2. **Second Concept**: Building on the first, we can see that...\n3. **Third Concept**: Finally, this brings everything together.\n\n`;
    simulateAITyping(explanation);
  };

  const formatText = (command: string) => {
    window.document.execCommand(command, false);
  };

  const handleDownload = () => {
    // Create a formatted HTML document
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${docProp?.name ?? "Document"}</title>
  <style>
    body {
      font-family: Georgia, serif;
      font-size: 16px;
      line-height: 1.8;
      max-width: 800px;
      margin: 40px auto;
      padding: 20px;
      color: #1f2937;
    }
    h1 { font-size: 2em; margin-bottom: 1rem; margin-top: 1.5rem; }
    h2 { font-size: 1.5em; margin-bottom: 0.75rem; margin-top: 1.25rem; }
    h3 { font-size: 1.25em; margin-bottom: 0.5rem; margin-top: 1rem; }
    p { margin-bottom: 0.5rem; }
    hr { margin: 1rem 0; border: none; border-top: 1px solid #d1d5db; }
    .italic { font-style: italic; color: #6b7280; }
  </style>
</head>
<body>
${editorRef.current?.innerHTML ?? content}
</body>
</html>
    `.trim();

    // Create blob and download
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = `${docProp?.name.replace(/\.pdf$/, '') ?? 'document'}-edited.html`;
    window.document.body.appendChild(a);
    a.click();
    window.document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`flex flex-col h-full ${isDark ? 'bg-gray-900' : 'bg-white'}`}>
      {/* Toolbar */}
      <div className={`border-b p-2 ${isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'}`}>
        <div className="flex items-center gap-1 flex-wrap">
          {/* Text Formatting */}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => formatText('bold')}
            title="Bold"
          >
            <Bold className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => formatText('italic')}
            title="Italic"
          >
            <Italic className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => formatText('underline')}
            title="Underline"
          >
            <Underline className="w-4 h-4" />
          </Button>

          <Separator orientation="vertical" className="h-6 mx-1" />

          {/* Lists */}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => formatText('insertUnorderedList')}
            title="Bullet List"
          >
            <List className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => formatText('insertOrderedList')}
            title="Numbered List"
          >
            <ListOrdered className="w-4 h-4" />
          </Button>

          <Separator orientation="vertical" className="h-6 mx-1" />

          {/* Alignment */}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => formatText('justifyLeft')}
            title="Align Left"
          >
            <AlignLeft className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => formatText('justifyCenter')}
            title="Align Center"
          >
            <AlignCenter className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => formatText('justifyRight')}
            title="Align Right"
          >
            <AlignRight className="w-4 h-4" />
          </Button>

          <Separator orientation="vertical" className="h-6 mx-1" />

          {/* Undo/Redo */}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => formatText('undo')}
            title="Undo"
          >
            <Undo className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => formatText('redo')}
            title="Redo"
          >
            <Redo className="w-4 h-4" />
          </Button>

          <div className="flex-1" />

          {/* AI Actions */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 bg-purple-50 hover:bg-purple-100 border-purple-200"
            onClick={addAIExplanation}
          >
            <Sparkles className="w-3 h-3 mr-1 text-purple-600" />
            <span className="text-xs">AI Explain</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-8 bg-green-50 hover:bg-green-100 border-green-200"
            onClick={handleDownload}
          >
            <Download className="w-3 h-3 mr-1 text-green-600" />
            <span className="text-xs">Download</span>
          </Button>
        </div>
      </div>

      {/* Document Info */}
      {docProp && (
        <div className={`px-4 py-2 border-b text-xs ${
          isDark ? 'border-gray-700 bg-gray-850 text-gray-400' : 'border-gray-200 bg-gray-50 text-gray-600'
        }`}>
          <div className="flex items-center gap-2">
            <Type className="w-3 h-3" />
            <span>Editing: {docProp.name}</span>
            <span className={isDark ? 'text-gray-600' : 'text-gray-400'}>•</span>
            <span className={`flex items-center gap-1 ${aiCursor.show ? 'text-purple-600' : ''}`}>
              {aiCursor.show && <Sparkles className="w-3 h-3 animate-pulse" />}
              {aiCursor.show ? "AI is typing..." : "You and AI Teacher"}
            </span>
          </div>
        </div>
      )}

      {/* Editor Area */}
      <div className="flex-1 overflow-y-auto">
        <div
          ref={editorRef}
          contentEditable
          className={`min-h-full p-8 focus:outline-none ${
            isDark ? 'bg-gray-900 text-gray-100' : 'bg-white text-gray-900'
          }`}
          style={{
            maxWidth: '800px',
            margin: '0 auto',
            fontFamily: 'Georgia, serif',
            fontSize: '16px',
            lineHeight: '1.8',
          }}
          suppressContentEditableWarning
        >
          {content.split('\n').map((line, index) => {
            // Handle markdown-style formatting
            if (line.startsWith('# ')) {
              return <h1 key={index} className="text-3xl mb-4 mt-6">{line.slice(2)}</h1>;
            }
            if (line.startsWith('## ')) {
              return <h2 key={index} className="text-2xl mb-3 mt-5">{line.slice(3)}</h2>;
            }
            if (line.startsWith('### ')) {
              return <h3 key={index} className="text-xl mb-2 mt-4">{line.slice(4)}</h3>;
            }
            if (line.startsWith('---')) {
              return <hr key={index} className={`my-4 ${isDark ? 'border-gray-700' : 'border-gray-300'}`} />;
            }
            if (line.startsWith('*') && line.endsWith('*') && !line.includes('**')) {
              return <p key={index} className={`italic mb-2 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>{line.slice(1, -1)}</p>;
            }
            if (/^\d+\. /.exec(line)) {
              return <p key={index} className="mb-2 ml-4">{line}</p>;
            }
            if (line.includes('**')) {
              const parts = line.split('**');
              return (
                <p key={index} className="mb-2">
                  {parts.map((part, i) => 
                    i % 2 === 1 ? <strong key={i}>{part}</strong> : part
                  )}
                </p>
              );
            }
            if (line.trim() === '') {
              return <br key={index} />;
            }
            return <p key={index} className="mb-2">{line}</p>;
          })}
          {aiCursor.show && (
            <span className="inline-block w-0.5 h-5 bg-purple-600 animate-pulse ml-0.5" />
          )}
        </div>
      </div>

      {/* Status Bar */}
      <div className={`px-4 py-2 border-t text-xs ${
        isDark ? 'border-gray-700 bg-gray-800 text-gray-500' : 'border-gray-200 bg-gray-50 text-gray-500'
      }`}>
        <div className="flex items-center justify-between">
          <span>{content.split(/\s+/).filter(w => w.length > 0).length} words</span>
          <span>Collaborative editing enabled</span>
        </div>
      </div>
    </div>
  );
}


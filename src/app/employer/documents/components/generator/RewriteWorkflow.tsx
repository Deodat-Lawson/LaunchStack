"use client";

import React, { useState, useCallback } from "react";
import { 
  CheckCircle, 
  ArrowRight, 
  ArrowLeft, 
  Loader2, 
  Sparkles, 
  Eye, 
  Settings,
  FileText,
  RotateCw,
  Check,
  X
} from "lucide-react";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { Badge } from "../ui/badge";
import { cn } from "~/lib/utils";
import { RewritePreviewPanel } from "./RewritePreviewPanel";

interface RewriteWorkflowProps {
  initialText?: string;
  onComplete: (rewrittenText: string) => void;
  onCancel: () => void;
}

type WorkflowStep = 'input' | 'options' | 'preview' | 'complete';

interface RewriteOptions {
  tone: 'professional' | 'casual' | 'formal' | 'technical' | 'creative' | 'persuasive';
  length: 'brief' | 'medium' | 'detailed' | 'comprehensive';
  audience: 'general' | 'technical' | 'executives' | 'students' | 'customers' | 'team';
  customPrompt?: string;
}

const TONE_OPTIONS = [
  { value: 'professional', label: 'Professional', desc: 'Clear, business-appropriate language' },
  { value: 'casual', label: 'Casual', desc: 'Friendly and conversational tone' },
  { value: 'formal', label: 'Formal', desc: 'Academic or official style' },
  { value: 'technical', label: 'Technical', desc: 'Precise, detail-oriented language' },
  { value: 'creative', label: 'Creative', desc: 'Engaging and expressive style' },
  { value: 'persuasive', label: 'Persuasive', desc: 'Compelling and convincing' }
] as const;

const LENGTH_OPTIONS = [
  { value: 'brief', label: 'Brief', desc: 'Concise and to the point' },
  { value: 'medium', label: 'Medium', desc: 'Balanced detail level' },
  { value: 'detailed', label: 'Detailed', desc: 'Comprehensive coverage' },
  { value: 'comprehensive', label: 'Comprehensive', desc: 'Thorough and complete' }
] as const;

const AUDIENCE_OPTIONS = [
  { value: 'general', label: 'General Audience', desc: 'Accessible to everyone' },
  { value: 'technical', label: 'Technical Experts', desc: 'Industry professionals' },
  { value: 'executives', label: 'Executives', desc: 'Decision makers and leaders' },
  { value: 'students', label: 'Students', desc: 'Learning-focused audience' },
  { value: 'customers', label: 'Customers', desc: 'External clients' },
  { value: 'team', label: 'Team Members', desc: 'Internal colleagues' }
] as const;

export function RewriteWorkflow({ initialText = "", onComplete, onCancel }: RewriteWorkflowProps) {
  const [currentStep, setCurrentStep] = useState<WorkflowStep>(initialText ? 'options' : 'input');
  const [text, setText] = useState(initialText);
  const [options, setOptions] = useState<RewriteOptions>({
    tone: 'professional',
    length: 'medium',
    audience: 'general'
  });
  const [rewrittenText, setRewrittenText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRewrite = useCallback(async () => {
    if (!text.trim()) return;
    
    setIsProcessing(true);
    setError(null);

    try {
      const response = await fetch('/api/document-generator/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'rewrite',
          content: text,
          prompt: options.customPrompt,
          options: {
            tone: options.tone,
            length: options.length,
            audience: options.audience
          }
        })
      });

      const data = await response.json() as { success: boolean; message?: string; generatedContent?: string };
      
      if (data.success && typeof data.generatedContent === "string" && data.generatedContent.trim().length > 0) {
        setRewrittenText(data.generatedContent);
        setCurrentStep('preview');
      } else {
        setError(data.message || 'Failed to rewrite text');
      }
    } catch (err) {
      setError('Network error occurred');
    } finally {
      setIsProcessing(false);
    }
  }, [text, options]);

  const handleAcceptRewrite = useCallback(() => {
    onComplete(rewrittenText);
    setCurrentStep('complete');
  }, [rewrittenText, onComplete]);

  const handleRetry = useCallback(() => {
    setCurrentStep('options');
    setRewrittenText("");
    setError(null);
  }, []);

  const getStepNumber = (step: WorkflowStep): number => {
    switch (step) {
      case 'input': return 1;
      case 'options': return 2;
      case 'preview': return 3;
      case 'complete': return 4;
    }
  };

  const renderStepIndicator = () => (
    <div className="flex items-center gap-4 mb-8">
      {(['input', 'options', 'preview', 'complete'] as const).map((step, index) => {
        const stepNumber = index + 1;
        const isActive = step === currentStep;
        const isCompleted = getStepNumber(currentStep) > stepNumber;
        
        return (
          <React.Fragment key={step}>
            <div className="flex items-center gap-2">
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium",
                isCompleted 
                  ? "bg-green-500 text-white"
                  : isActive
                    ? "bg-amber-600 text-white"
                    : "bg-muted text-muted-foreground"
              )}>
                {isCompleted ? (
                  <CheckCircle className="w-4 h-4" />
                ) : (
                  stepNumber
                )}
              </div>
              <span className={cn(
                "text-sm font-medium",
                isActive ? "text-foreground" : "text-muted-foreground"
              )}>
                {step === 'input' && 'Input Text'}
                {step === 'options' && 'Select Options'}  
                {step === 'preview' && 'Preview Result'}
                {step === 'complete' && 'Complete'}
              </span>
            </div>
            {index < 3 && (
              <ArrowRight className="w-4 h-4 text-muted-foreground" />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );

  if (currentStep === 'input') {
    return (
      <div className="max-w-4xl mx-auto p-6">
        {renderStepIndicator()}
        
        <Card className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded">
              <FileText className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold">Input Your Text</h2>
              <p className="text-sm text-muted-foreground">Enter or paste the text you want to rewrite</p>
            </div>
          </div>
          
          <Textarea
            placeholder="Paste your text here..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-40 mb-4"
          />
          
          <div className="flex gap-3">
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button 
              onClick={() => setCurrentStep('options')}
              disabled={!text.trim()}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              Next: Select Options
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (currentStep === 'options') {
    return (
      <div className="max-w-4xl mx-auto p-6">
        {renderStepIndicator()}
        
        <Card className="p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded">
              <Settings className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold">Transformation Options</h2>
              <p className="text-sm text-muted-foreground">Choose how you want your text to be rewritten</p>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-destructive/10 text-destructive text-sm rounded mb-6">
              {error}
            </div>
          )}
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div>
              <label className="block text-sm font-medium mb-2">Tone</label>
              <Select value={options.tone} onValueChange={(value: any) => setOptions(prev => ({ ...prev, tone: value }))}>
                <SelectTrigger className="text-left min-h-12 h-12 py-3">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TONE_OPTIONS.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      <div className="text-left">
                        <div className="font-medium">{option.label}</div>
                        <div className="text-xs text-muted-foreground">{option.desc}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Length</label>
              <Select value={options.length} onValueChange={(value: any) => setOptions(prev => ({ ...prev, length: value }))}>
                <SelectTrigger className="text-left min-h-12 h-12 py-3">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LENGTH_OPTIONS.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      <div className="text-left">
                        <div className="font-medium">{option.label}</div>
                        <div className="text-xs text-muted-foreground">{option.desc}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Audience</label>
              <Select value={options.audience} onValueChange={(value: any) => setOptions(prev => ({ ...prev, audience: value }))}>
                <SelectTrigger className="text-left min-h-12 h-12 py-3">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUDIENCE_OPTIONS.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      <div className="text-left">
                        <div className="font-medium">{option.label}</div>
                        <div className="text-xs text-muted-foreground">{option.desc}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium mb-2">Additional Instructions (Optional)</label>
            <Textarea
              placeholder="Any specific requirements or style preferences..."
              value={options.customPrompt || ""}
              onChange={(e) => setOptions(prev => ({ ...prev, customPrompt: e.target.value }))}
              rows={5}
              className="min-h-32"
            />
          </div>

          <div className="border-t pt-4">
            <div className="mb-4">
              <p className="text-sm font-medium mb-2">Selected Options:</p>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{TONE_OPTIONS.find(t => t.value === options.tone)?.label}</Badge>
                <Badge variant="secondary">{LENGTH_OPTIONS.find(l => l.value === options.length)?.label}</Badge>
                <Badge variant="secondary">{AUDIENCE_OPTIONS.find(a => a.value === options.audience)?.label}</Badge>
              </div>
            </div>
          </div>
          
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setCurrentStep('input')}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <Button 
              onClick={handleRewrite}
              disabled={isProcessing}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Rewriting...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate Rewrite
                </>
              )}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (currentStep === 'preview') {
    return (
      <div className="max-w-6xl mx-auto p-6">
        {renderStepIndicator()}
        
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded">
              <Eye className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold">Preview Your Rewrite</h2>
              <p className="text-sm text-muted-foreground">Review the changes and decide whether to accept them</p>
            </div>
          </div>

          <RewritePreviewPanel
            originalText={text}
            proposedText={rewrittenText}
            onAccept={handleAcceptRewrite}
            onReject={onCancel}
            onTryAgain={handleRetry}
            isRetrying={isProcessing}
          />

          <div className="flex gap-3">
            <Button variant="outline" onClick={handleRetry}>
              <RotateCw className="w-4 h-4 mr-2" />
              Try Different Options
            </Button>
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button 
              onClick={handleAcceptRewrite}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              <Check className="w-4 h-4 mr-2" />
              Accept Rewrite
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Complete step
  return (
    <div className="max-w-4xl mx-auto p-6">
      {renderStepIndicator()}
      
      <Card className="p-6 text-center">
        <div className="p-3 bg-green-100 dark:bg-green-900/30 rounded-full w-fit mx-auto mb-4">
          <CheckCircle className="w-8 h-8 text-green-600" />
        </div>
        <h2 className="text-xl font-semibold mb-2">Rewrite Complete!</h2>
        <p className="text-muted-foreground mb-6">
          Your text has been successfully rewritten and applied to the document.
        </p>
        <Button onClick={onCancel} className="bg-amber-600 hover:bg-amber-700 text-white">
          Close
        </Button>
      </Card>
    </div>
  );
}
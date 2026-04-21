import { useState } from 'react';
import { ArrowLeft, Sparkles, FileText, Loader2, GraduationCap, X, Plus, Check, Power } from 'lucide-react';
import { Button } from "~/app/employer/documents/components/ui/button";
import { Input } from "~/app/employer/documents/components/ui/input";
import { Label } from "~/app/employer/documents/components/ui/label";
import { Textarea } from "~/app/employer/documents/components/ui/textarea";
import { Badge } from "~/app/employer/documents/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/app/employer/documents/components/ui/select';
import { Card } from "~/app/employer/documents/components/ui/card";

interface DocumentTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  preview: string;
}

interface DocumentGeneratorConfigProps {
  template: DocumentTemplate;
  onBack: () => void;
  onGenerate: (config: DocumentConfig) => void;
}

export interface DocumentConfig {
  title: string;
  description: string;
  tone: string;
  length: string;
  audience: string;
  additionalDetails: string;
  keywords: string[];
  includeResearch: boolean;
  arxivCategory?: string;
}

const tones = [
  { value: 'professional', label: 'Professional' },
  { value: 'casual', label: 'Casual' },
  { value: 'formal', label: 'Formal' },
  { value: 'technical', label: 'Technical' },
  { value: 'creative', label: 'Creative' },
  { value: 'persuasive', label: 'Persuasive' },
];

const lengths = [
  { value: 'brief', label: 'Brief (1-2 pages)' },
  { value: 'medium', label: 'Medium (3-5 pages)' },
  { value: 'detailed', label: 'Detailed (6-10 pages)' },
  { value: 'comprehensive', label: 'Comprehensive (10+ pages)' },
];

const audiences = [
  { value: 'general', label: 'General Audience' },
  { value: 'technical', label: 'Technical Experts' },
  { value: 'executives', label: 'Executives/Leadership' },
  { value: 'students', label: 'Students/Academia' },
  { value: 'customers', label: 'Customers/Clients' },
  { value: 'team', label: 'Team Members' },
];

const arxivCategories = [
  { value: 'all', label: 'All Categories' },
  { value: 'cs.AI', label: 'Artificial Intelligence' },
  { value: 'cs.LG', label: 'Machine Learning' },
  { value: 'cs.CL', label: 'Natural Language Processing' },
  { value: 'cs.CV', label: 'Computer Vision' },
  { value: 'cs.SE', label: 'Software Engineering' },
  { value: 'stat.ML', label: 'Statistics (ML)' },
  { value: 'physics', label: 'Physics' },
  { value: 'math', label: 'Mathematics' },
  { value: 'q-bio', label: 'Quantitative Biology' },
  { value: 'q-fin', label: 'Quantitative Finance' },
  { value: 'econ', label: 'Economics' },
];

// Templates that benefit from research
const researchTemplates = ['research', 'whitepaper', 'technical', 'report'];

export function DocumentGeneratorConfig({ template, onBack, onGenerate }: DocumentGeneratorConfigProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tone, setTone] = useState('professional');
  const [length, setLength] = useState('medium');
  const [audience, setAudience] = useState('general');
  const [additionalDetails, setAdditionalDetails] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState('');
  const [includeResearch, setIncludeResearch] = useState(researchTemplates.includes(template.id));
  const [arxivCategory, setArxivCategory] = useState('all');
  const [isGenerating, setIsGenerating] = useState(false);

  const addKeyword = () => {
    const trimmed = keywordInput.trim();
    if (trimmed && !keywords.includes(trimmed) && keywords.length < 10) {
      setKeywords([...keywords, trimmed]);
      setKeywordInput('');
    }
  };

  const removeKeyword = (keyword: string) => {
    setKeywords(keywords.filter(k => k !== keyword));
  };

  const handleKeywordKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addKeyword();
    }
  };

  const handleGenerate = () => {
    if (!title.trim() || !description.trim()) return;

    setIsGenerating(true);
    
    onGenerate({
      title,
      description,
      tone,
      length,
      audience,
      additionalDetails,
      keywords,
      includeResearch,
      arxivCategory: arxivCategory === 'all' ? undefined : arxivCategory,
    });
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header - Fixed */}
      <div className="flex-shrink-0 bg-background border-b border-border p-6">
        <div className="max-w-4xl mx-auto">
          <Button variant="ghost" size="sm" onClick={onBack} className="mb-4 text-muted-foreground hover:text-foreground hover:bg-muted">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Templates
          </Button>
          <div className="flex items-start gap-4">
            <div className="p-3 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
              <FileText className="w-6 h-6 text-purple-600" />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold mb-2 text-foreground">Configure Your {template.name}</h1>
              <p className="text-muted-foreground">
                {template.description}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Configuration Form - Scrollable */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6 space-y-6">
          {/* Template Preview Card */}
          <Card className="p-6 bg-card border-border">
            <div className="flex items-center gap-2 mb-3 text-foreground">
              <Sparkles className="w-5 h-5 text-purple-600" />
              <h2 className="font-semibold">Template Preview</h2>
            </div>
            
            {/* PDF-style Document Preview */}
            <div className="bg-muted p-6 rounded-lg border border-border">
              {/* Scrollable multi-page container */}
              <div className="max-h-[600px] overflow-y-auto">
                <div className="max-w-2xl mx-auto space-y-6">
                  {/* Page 1 */}
                  <div className="bg-white dark:bg-gray-900 rounded shadow-lg overflow-hidden border border-gray-200 dark:border-gray-700 relative">
                    {/* Document Header */}
                    <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                      <div className="h-5 bg-gray-900 dark:bg-gray-100 rounded w-3/4 mb-3" />
                      <div className="h-3 bg-gray-300 dark:bg-gray-600 rounded w-1/3" />
                    </div>
                    
                    {/* Document Body - Lines simulating text */}
                    <div className="p-6 space-y-4">
                      {/* Paragraph 1 */}
                      <div className="space-y-2">
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-full" />
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-full" />
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-5/6" />
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-full" />
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-4/5" />
                      </div>
                      
                      {/* Section Header */}
                      <div className="pt-2">
                        <div className="h-3 bg-gray-600 dark:bg-gray-400 rounded w-2/5 mb-2" />
                      </div>
                      
                      {/* Paragraph 2 */}
                      <div className="space-y-2">
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-full" />
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-full" />
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-full" />
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-5/6" />
                      </div>

                      {/* Section Header */}
                      <div className="pt-2">
                        <div className="h-3 bg-gray-600 dark:bg-gray-400 rounded w-2/5 mb-2" />
                      </div>
                      
                      {/* Paragraph 3 */}
                      <div className="space-y-2">
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-full" />
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-5/6" />
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-full" />
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-11/12" />
                      </div>
                      
                      {/* Bullet list simulation */}
                      <div className="space-y-2 pl-4">
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 bg-gray-400 rounded-full flex-shrink-0" />
                          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-4/5" />
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 bg-gray-400 rounded-full flex-shrink-0" />
                          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 bg-gray-400 rounded-full flex-shrink-0" />
                          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-full" />
                        </div>
                      </div>
                    </div>
                    
                    {/* Category badge */}
                    <div className="absolute top-4 right-4">
                      <span className="text-xs px-2 py-1 bg-purple-600 text-white rounded font-medium shadow-sm">
                        {template.category}
                      </span>
                    </div>
                    
                    {/* Page number */}
                    <div className="absolute bottom-4 right-4 text-xs text-gray-400">Page 1</div>
                  </div>

                  {/* Page 2 */}
                  <div className="bg-white dark:bg-gray-900 rounded shadow-lg overflow-hidden border border-gray-200 dark:border-gray-700 relative">
                    <div className="p-6 space-y-4">
                      {/* Section Header */}
                      <div className="h-3 bg-gray-600 dark:bg-gray-400 rounded w-2/5 mb-3" />
                      
                      {/* Paragraph */}
                      <div className="space-y-2">
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-full" />
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-full" />
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-4/5" />
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-full" />
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-5/6" />
                      </div>
                      
                      {/* Section Header */}
                      <div className="pt-2">
                        <div className="h-3 bg-gray-600 dark:bg-gray-400 rounded w-2/5 mb-2" />
                      </div>
                      
                      {/* Paragraph */}
                      <div className="space-y-2">
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-full" />
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-full" />
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-full" />
                      </div>

                      {/* Table simulation */}
                      <div className="pt-3 space-y-2">
                        <div className="flex gap-2">
                          <div className="h-2 bg-gray-400 dark:bg-gray-500 rounded w-1/3" />
                          <div className="h-2 bg-gray-400 dark:bg-gray-500 rounded w-1/3" />
                          <div className="h-2 bg-gray-400 dark:bg-gray-500 rounded w-1/3" />
                        </div>
                        <div className="flex gap-2">
                          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
                          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
                          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
                        </div>
                        <div className="flex gap-2">
                          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
                          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
                          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
                        </div>
                      </div>
                    </div>
                    
                    {/* Page number */}
                    <div className="absolute bottom-4 right-4 text-xs text-gray-400">Page 2</div>
                  </div>

                  {/* Page 3 */}
                  <div className="bg-white dark:bg-gray-900 rounded shadow-lg overflow-hidden border border-gray-200 dark:border-gray-700 relative">
                    <div className="p-6 space-y-4">
                      {/* Paragraph */}
                      <div className="space-y-2">
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-full" />
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-5/6" />
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-full" />
                      </div>
                      
                      {/* Section Header */}
                      <div className="pt-2">
                        <div className="h-3 bg-gray-600 dark:bg-gray-400 rounded w-2/5 mb-2" />
                      </div>
                      
                      {/* Numbered list simulation */}
                      <div className="space-y-2 pl-4">
                        <div className="flex items-start gap-2">
                          <div className="text-xs text-gray-400 mt-0.5">1.</div>
                          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-11/12" />
                        </div>
                        <div className="flex items-start gap-2">
                          <div className="text-xs text-gray-400 mt-0.5">2.</div>
                          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-4/5" />
                        </div>
                        <div className="flex items-start gap-2">
                          <div className="text-xs text-gray-400 mt-0.5">3.</div>
                          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-full" />
                        </div>
                      </div>

                      {/* Section Header */}
                      <div className="pt-3">
                        <div className="h-3 bg-gray-600 dark:bg-gray-400 rounded w-1/3 mb-2" />
                      </div>
                      
                      {/* Paragraph */}
                      <div className="space-y-2">
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-full" />
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-full" />
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
                      </div>
                    </div>
                    
                    {/* Page number */}
                    <div className="absolute bottom-4 right-4 text-xs text-gray-400">Page 3</div>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Document Details */}
          <Card className="p-6 bg-card border-border">
            <h2 className="font-semibold mb-4 text-foreground">Document Details</h2>
            <div className="space-y-4">
              {/* Title */}
              <div className="space-y-2">
                <Label htmlFor="title" className="text-foreground">
                  Document Title <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="title"
                  placeholder="e.g., Q4 2025 Marketing Strategy"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="bg-background border-border"
                />
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label htmlFor="description" className="text-foreground">
                  What should this document cover? <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  id="description"
                  placeholder="Describe the main topics, goals, and key points you want to include..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="min-h-[120px] bg-background border-border"
                />
                <p className="text-xs text-muted-foreground">
                  Be specific about what you want the AI to generate. Include key topics, data points, or sections you need.
                </p>
              </div>

              {/* Tone */}
              <div className="space-y-2">
                <Label htmlFor="tone" className="text-foreground">Writing Tone</Label>
                <Select value={tone} onValueChange={setTone}>
                  <SelectTrigger id="tone" className="bg-background border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {tones.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Length */}
              <div className="space-y-2">
                <Label htmlFor="length" className="text-foreground">Document Length</Label>
                <Select value={length} onValueChange={setLength}>
                  <SelectTrigger id="length" className="bg-background border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {lengths.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Audience */}
              <div className="space-y-2">
                <Label htmlFor="audience" className="text-foreground">Target Audience</Label>
                <Select value={audience} onValueChange={setAudience}>
                  <SelectTrigger id="audience" className="bg-background border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {audiences.map((a) => (
                      <SelectItem key={a.value} value={a.value}>
                        {a.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Keywords */}
              <div className="space-y-2">
                <Label htmlFor="keywords" className="text-foreground">
                  Keywords (Optional)
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="keywords"
                    placeholder="Add a keyword and press Enter..."
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    onKeyDown={handleKeywordKeyDown}
                    className="bg-background border-border flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={addKeyword}
                    disabled={!keywordInput.trim() || keywords.length >= 10}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
                {keywords.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {keywords.map((keyword) => (
                      <Badge
                        key={keyword}
                        variant="secondary"
                        className="px-3 py-1 text-sm flex items-center gap-1"
                      >
                        {keyword}
                        <button
                          type="button"
                          onClick={() => removeKeyword(keyword)}
                          className="ml-1 hover:text-red-500 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Keywords help AI find relevant research and focus the content. Add up to 10 keywords.
                </p>
              </div>

              {/* Additional Details */}
              <div className="space-y-2">
                <Label htmlFor="additional" className="text-foreground">Additional Instructions (Optional)</Label>
                <Textarea
                  id="additional"
                  placeholder="Any specific requirements, sections to include, data to incorporate, or style preferences..."
                  value={additionalDetails}
                  onChange={(e) => setAdditionalDetails(e.target.value)}
                  className="min-h-[100px] bg-background border-border"
                />
              </div>
            </div>
          </Card>

          {/* Research Integration Card */}
          <Card className={`p-6 border-2 transition-all duration-200 ${
            includeResearch 
              ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-300 dark:border-rose-700' 
              : 'bg-card border-border'
          }`}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-lg transition-colors ${
                  includeResearch 
                    ? 'bg-rose-500 text-white' 
                    : 'bg-rose-100 dark:bg-rose-900/30'
                }`}>
                  <GraduationCap className={`w-5 h-5 ${includeResearch ? 'text-white' : 'text-rose-600'}`} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold text-foreground">Research Integration</h2>
                    {includeResearch && (
                      <span className="px-2 py-0.5 text-xs font-medium bg-rose-500 text-white rounded-full">
                        ENABLED
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Automatically search and incorporate academic papers from arXiv.org to create 
                    research-backed content with proper citations.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant={includeResearch ? "default" : "outline"}
                size="sm"
                onClick={() => setIncludeResearch(!includeResearch)}
                className={`min-w-[90px] transition-all ${
                  includeResearch 
                    ? 'bg-rose-500 hover:bg-rose-600 text-white border-rose-500' 
                    : 'border-border text-muted-foreground hover:text-foreground hover:border-rose-300'
                }`}
              >
                {includeResearch ? (
                  <>
                    <Check className="w-4 h-4 mr-1.5" />
                    On
                  </>
                ) : (
                  <>
                    <Power className="w-4 h-4 mr-1.5" />
                    Off
                  </>
                )}
              </Button>
            </div>

            {includeResearch && (
              <div className="mt-4 pt-4 border-t border-border space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="arxiv-category" className="text-foreground">arXiv Category (Optional)</Label>
                  <Select value={arxivCategory} onValueChange={setArxivCategory}>
                    <SelectTrigger id="arxiv-category" className="bg-background border-border">
                      <SelectValue placeholder="All Categories" />
                    </SelectTrigger>
                    <SelectContent>
                      {arxivCategories.map((cat) => (
                        <SelectItem key={cat.value} value={cat.value}>
                          {cat.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Focus research on a specific field, or leave empty to search all categories.
                  </p>
                </div>

                <div className="p-3 bg-rose-50 dark:bg-rose-900/20 rounded-lg border border-rose-200 dark:border-rose-800">
                  <p className="text-sm text-rose-700 dark:text-rose-300">
                    <strong>How it works:</strong> The AI will search arXiv for papers related to your topic 
                    and keywords, then synthesize their findings into your document with proper academic citations.
                  </p>
                </div>
              </div>
            )}
          </Card>

          {/* AI Generation Tips */}
          <Card className="p-6 bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800">
            <div className="flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-purple-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold mb-2 text-foreground">Tips for Better Results</h3>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• Be specific about what you want - the more detail, the better the output</li>
                  <li>• Include key points, statistics, or examples you want covered</li>
                  <li>• Mention any specific sections or structure you need</li>
                  <li>• You can always refine the document with AI after generation</li>
                </ul>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Action Bar - Fixed */}
      <div className="flex-shrink-0 bg-background border-t border-border p-6">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            <span className="text-red-500">*</span> Required fields
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={onBack} className="border-border text-muted-foreground hover:text-foreground">
              Cancel
            </Button>
            <Button
              onClick={handleGenerate}
              disabled={!title.trim() || !description.trim() || isGenerating}
              className="bg-purple-600 hover:bg-purple-700 text-white min-w-[160px]"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate Document
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}


